import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  Activity,
  Cloud,
  Database,
  Server,
  RefreshCw,
  CheckCircle2,
  XCircle,
  HelpCircle,
  AlertTriangle,
  Clock,
  Play,
  Square,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Icons, queryGetGraph, queryGetProfile } from "@/lib/utils";
import { omitBy, map, includes, trim, find } from "lodash-es";
import ForceGraph3D, { NodeObject } from "react-force-graph-3d";
import SpriteText from "three-spritetext";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Profiles } from "@/data/data";
import type { Graph as GraphType } from "@/types/types";
import { useTheme } from "@/components/theme-provider";
import { toast } from "@/components/ui/use-toast";
import { MetricChart } from "@/components/monitoring/MetricChart";
import { AlarmStatusGrid } from "@/components/monitoring/AlarmStatusGrid";
import { AwsHealthStatus } from "@/components/monitoring/AwsHealthStatus";
import {
  useCloudWatchMetrics,
  useCloudWatchAlarms,
  useResourceStatus,
} from "@/hooks/useMonitoring";
import { useAwsHealth } from "@/hooks/useAwsHealth";
import type { MetricDataQuery } from "@/lib/aws-clients";
import {
  startInstance,
  stopInstance,
  startNeptuneCluster,
  stopNeptuneCluster,
  createBastionInstance,
  getSsmParameter,
  describeInstances,
  describeNeptuneClusters,
} from "@/lib/aws-clients";


export const Route = createFileRoute("/_authenticated/_layout/monitoring")({
  component: Monitoring,
});

// ─── Known resource identifiers ──────────────────────────────────────
// TODO: After first deploy, replace these with the actual values from
// `cdk-infra.json` (or wire them up to read from CDK outputs at build time).
const BASTION_SSM_PARAM = "/socialActiveApp/bastion/instance-id";
const NEPTUNE_CLUSTER_ID = "TODO-replace-after-first-deploy";

/** Actual deployed Lambda function names (from CloudFormation outputs) */
const LAMBDA_FUNCTIONS: Record<string, string> = {
  queryFn:    "TODO-replace-after-first-deploy",
  aiQueryFn:  "TODO-replace-after-first-deploy",
  mutationFn: "TODO-replace-after-first-deploy",
  bulkLoadFn: "TODO-replace-after-first-deploy",
};

// ─── GitHub Status API types ─────────────────────────────────────────
type GitHubComponentStatus =
  | "operational"
  | "degraded_performance"
  | "partial_outage"
  | "major_outage";

interface GitHubComponent {
  id: string;
  name: string;
  status: GitHubComponentStatus;
  description: string | null;
}

interface GitHubIncidentUpdate {
  body: string;
  created_at: string;
  status: string;
}

interface GitHubIncident {
  id: string;
  name: string;
  status: string;
  impact: string;
  shortlink: string;
  created_at: string;
  updated_at: string;
  incident_updates: GitHubIncidentUpdate[];
  components: GitHubComponent[];
}

const TRACKED_COMPONENT_IDS: Record<string, string> = {
  "8l4ygp009s5s": "Git Operations",
  "4230lsnqdsld": "Webhooks",
  brv1bkgrwx7q: "API Requests",
  kr09ddfgbfsf: "Issues",
  hhtssxt0f5v2: "Pull Requests",
  br0l2tvcx85d: "Actions",
  st3j38cctv9l: "Packages",
  vg70hn9s2tyj: "Pages",
};

// ─── Status indicator helpers ────────────────────────────────────────

function EC2StateBadge({ state }: { state: string }) {
  const map: Record<string, { color: string; icon: typeof CheckCircle2 }> = {
    running: {
      color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
      icon: CheckCircle2,
    },
    stopped: {
      color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
      icon: XCircle,
    },
    stopping: {
      color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
      icon: AlertTriangle,
    },
    pending: {
      color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
      icon: Clock,
    },
    terminated: {
      color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
      icon: XCircle,
    },
  };
  const info = map[state] ?? {
    color: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    icon: HelpCircle,
  };
  const Icon = info.icon;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${info.color}`}
    >
      <Icon className="h-4 w-4" />
      {state.charAt(0).toUpperCase() + state.slice(1)}
    </span>
  );
}

function NeptuneStateBadge({ status }: { status: string }) {
  const isUp = status === "available";
  const isStopped = status === "stopped";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
        isUp
          ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
          : isStopped
            ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
            : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
      }`}
    >
      {isUp ? (
        <CheckCircle2 className="h-4 w-4" />
      ) : isStopped ? (
        <XCircle className="h-4 w-4" />
      ) : (
        <AlertTriangle className="h-4 w-4" />
      )}
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

/** Green / Yellow / Red checkbox-style indicator for GitHub component status */
function GitHubStatusIndicator({ status }: { status: GitHubComponentStatus }) {
  switch (status) {
    case "operational":
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded-sm bg-green-500 flex items-center justify-center">
            <CheckCircle2 className="h-2.5 w-2.5 text-white" />
          </span>
          <span className="text-sm text-green-700 dark:text-green-400">
            Operational
          </span>
        </span>
      );
    case "degraded_performance":
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded-sm bg-yellow-500 flex items-center justify-center">
            <AlertTriangle className="h-2.5 w-2.5 text-white" />
          </span>
          <span className="text-sm text-yellow-700 dark:text-yellow-400">
            Degraded
          </span>
        </span>
      );
    case "partial_outage":
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded-sm bg-yellow-500 flex items-center justify-center">
            <AlertTriangle className="h-2.5 w-2.5 text-white" />
          </span>
          <span className="text-sm text-yellow-700 dark:text-yellow-400">
            Partial Outage
          </span>
        </span>
      );
    case "major_outage":
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded-sm bg-red-500 flex items-center justify-center">
            <XCircle className="h-2.5 w-2.5 text-white" />
          </span>
          <span className="text-sm text-red-700 dark:text-red-400">
            Major Outage
          </span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3.5 w-3.5 rounded-sm bg-gray-400 flex items-center justify-center">
            <HelpCircle className="h-2.5 w-2.5 text-white" />
          </span>
          <span className="text-sm text-gray-500">Unknown</span>
        </span>
      );
  }
}

function formatDuration(start: string): string {
  const ms = Date.now() - new Date(start).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hrs < 24) return `${hrs}h ${remainMins}m`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h`;
}

// ─── CloudWatch metric query builders ────────────────────────────────

function lambdaMetricQueries(
  stat: string,
  metricName: string,
  period = 300
): MetricDataQuery[] {
  return Object.entries(LAMBDA_FUNCTIONS).map(([label, fullName], idx) => ({
    Id: `m${idx}`,
    Label: label,
    MetricStat: {
      Metric: {
        Namespace: "AWS/Lambda",
        MetricName: metricName,
        Dimensions: [{ Name: "FunctionName", Value: fullName }],
      },
      Period: period,
      Stat: stat,
    },
  }));
}

function neptuneMetricQuery(
  metricName: string,
  stat: string,
  label: string,
  period = 300
): MetricDataQuery[] {
  return [
    {
      Id: "n0",
      Label: label,
      MetricStat: {
        Metric: {
          Namespace: "AWS/Neptune",
          MetricName: metricName,
          Dimensions: [
            { Name: "DBClusterIdentifier", Value: NEPTUNE_CLUSTER_ID },
          ],
        },
        Period: period,
        Stat: stat,
      },
    },
  ];
}

// ─── Neptune Graph Section ────────────────────────────────────────────

function GraphSection() {
  const { theme } = useTheme();
  const resolvedTheme =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);
  const GRAPH_HEIGHT = 520;

  const [name, setName] = useState("");
  const [graphData, setGraphData] = useState<{
    nodes: Array<{ id: string; label: string }>;
    links: Array<{ source: string; target: string; value: string }>;
  }>({ nodes: [], links: [] });
  const [profile, setProfile] = useState<
    Array<{
      search_name?: string;
      usage?: string;
      belong_to?: string;
      authored_by?: string;
      affiliated_with?: string;
      people?: string;
      made_by?: string | null;
    }>
  >([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);

  // Measure container width
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setContainerWidth(width);
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    queryGetGraph("id")
      .then((res) => setGraphData(res.data.getGraph))
      .catch((err: any) =>
        toast({
          variant: "destructive",
          title: "Query Error",
          description: err?.errors?.[0]?.message ?? String(err),
        })
      );
  }, []);

  useEffect(() => {
    if (!name) return;
    setProfileLoading(true);
    queryGetProfile(name, "id")
      .then((res) => setProfile(res.data.getProfile))
      .catch((err: any) => {
        console.error(err);
        toast({
          variant: "destructive",
          title: "Query Error",
          description: err?.errors?.[0]?.message ?? String(err),
        });
      })
      .finally(() => setProfileLoading(false));
  }, [name]);

  const Details = () => {
    const res = omitBy(profile[0], (v: string) => includes(v, "[]"));
    const data: GraphType[] = [];
    map(res, (v, k) => {
      find(Profiles, (obj) => {
        if (obj.value === k) data.push({ ...obj, data: v });
      });
    });
    return (
      <div className="flex flex-col py-8">
        {map(data, (item: GraphType, idx: number) => (
          <div key={idx}>
            <div className="flex flex-row justify-between py-4">
              <div className="basis=1/4 font-bold">{item.description}</div>
            </div>
            <div className="basis=1/4 py-4">{trim(item.data, "[]")}</div>
            <Separator />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div ref={containerRef} className="w-full overflow-hidden rounded-md border" style={{ height: GRAPH_HEIGHT }}>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Relation</SheetTitle>
          </SheetHeader>
          {profileLoading ? (
            <div className="flex flex-col space-y-3 py-8">
              <Skeleton className="h-[100px] rounded-xl" />
              <div className="space-y-2">
                <Skeleton className="h-4" />
                <Skeleton className="h-4" />
              </div>
            </div>
          ) : profile.length > 0 ? (
            <Details />
          ) : null}
        </SheetContent>
      </Sheet>
      <ForceGraph3D
        graphData={graphData}
        nodeAutoColorBy="label"
        backgroundColor={resolvedTheme === "dark" ? "#000000" : "#ffffff"}
        height={GRAPH_HEIGHT}
        width={containerWidth}
        nodeLabel="id"
        onNodeClick={(event: { id: string }) => {
          setName(event.id);
          setSheetOpen(true);
        }}
        nodeThreeObject={(node: NodeObject) => {
          if (typeof node.id !== "string") return undefined as any;
          const sprite = new SpriteText(node.id);
          sprite.color = node.color as string;
          sprite.textHeight = 8;
          return sprite;
        }}
        linkThreeObjectExtend={true}
        linkColor={() => (resolvedTheme === "dark" ? "#999999" : "#333333")}
        linkThreeObject={(link: { source: string; target: string }) => {
          const sprite = new SpriteText(`${link.source} > ${link.target}`);
          sprite.color = "lightgrey";
          sprite.textHeight = 1.5;
          return sprite;
        }}
        linkPositionUpdate={(
          sprite: { position: Record<string, number> },
          { start, end }: { start: Record<string, number>; end: Record<string, number> }
        ) => {
          const mid: Record<string, number> = {};
          ["x", "y", "z"].forEach((c) => {
            mid[c] = start[c] + (end[c] - start[c]) / 2;
          });
          Object.assign(sprite.position, mid);
        }}
      />
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────

function Monitoring() {
  // ── Dynamic bastion instance ID (polled from SSM every 5s until resolved) ──
  const [bastionInstanceId, setBastionInstanceId] = useState<string | null>(null);
  const [bastionSsmLoaded, setBastionSsmLoaded] = useState(false);
  const [bastionSsmError, setBastionSsmError] = useState<string | null>(null);
  const bastionSsmIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bastionSsmAttemptsRef = useRef(0);

  useEffect(() => {
    const tryFetch = async () => {
      bastionSsmAttemptsRef.current += 1;
      try {
        const id = await getSsmParameter(BASTION_SSM_PARAM);
        // null = ParameterNotFound — no instance tracked, stop polling
        if (id) setBastionInstanceId(id);
        setBastionSsmLoaded(true);
        setBastionSsmError(null);
        if (bastionSsmIntervalRef.current) {
          clearInterval(bastionSsmIntervalRef.current);
          bastionSsmIntervalRef.current = null;
        }
      } catch (err: any) {
        setBastionSsmError(err?.message ?? String(err));
        // After 3 attempts give up waiting — show Create button so user isn't stuck
        if (bastionSsmAttemptsRef.current >= 3) {
          setBastionSsmLoaded(true);
          if (bastionSsmIntervalRef.current) {
            clearInterval(bastionSsmIntervalRef.current);
            bastionSsmIntervalRef.current = null;
          }
        }
      }
    };

    tryFetch();
    bastionSsmIntervalRef.current = setInterval(tryFetch, 5000);
    return () => {
      if (bastionSsmIntervalRef.current) {
        clearInterval(bastionSsmIntervalRef.current);
        bastionSsmIntervalRef.current = null;
      }
    };
  }, []);

  // ── Resource status (EC2 + Neptune) ──
  const resources = useResourceStatus(
    bastionInstanceId ? [bastionInstanceId] : [],
    [NEPTUNE_CLUSTER_ID],
    0
  );

  // Re-fetch EC2 status once SSM resolves the instance ID (the hook only
  // runs once on mount, so it sees an empty array when bastionInstanceId is null)
  const resourcesRefreshRef = useRef(resources.refresh);
  resourcesRefreshRef.current = resources.refresh;
  useEffect(() => {
    if (bastionInstanceId) {
      resourcesRefreshRef.current();
    }
  }, [bastionInstanceId]);

  // ── CloudWatch Alarms ──
  const alarmsHook = useCloudWatchAlarms(0);

  // ── Lambda Metrics ──
  const lambdaInvocationQueries = useMemo(
    () => lambdaMetricQueries("Sum", "Invocations"),
    []
  );
  const lambdaInvocations = useCloudWatchMetrics({
    queries: lambdaInvocationQueries,
    hours: 6,
    refreshInterval: 0,
  });

  const lambdaErrorQueries = useMemo(
    () => lambdaMetricQueries("Sum", "Errors"),
    []
  );
  const lambdaErrors = useCloudWatchMetrics({
    queries: lambdaErrorQueries,
    hours: 6,
    refreshInterval: 0,
  });

  const lambdaDurationQueries = useMemo(
    () => lambdaMetricQueries("Average", "Duration"),
    []
  );
  const lambdaDuration = useCloudWatchMetrics({
    queries: lambdaDurationQueries,
    hours: 6,
    refreshInterval: 0,
  });

  // ── Neptune Metrics ──
  const neptuneCpuQueries = useMemo(
    () => neptuneMetricQuery("CPUUtilization", "Average", "CPU %"),
    []
  );
  const neptuneCpu = useCloudWatchMetrics({
    queries: neptuneCpuQueries,
    hours: 6,
    refreshInterval: 0,
  });

  const neptuneCapQueries = useMemo(
    () =>
      neptuneMetricQuery(
        "ServerlessDatabaseCapacity",
        "Average",
        "NCU"
      ),
    []
  );
  const neptuneCapacity = useCloudWatchMetrics({
    queries: neptuneCapQueries,
    hours: 6,
    refreshInterval: 0,
  });

  // ── AWS Health Status ──
  const awsHealth = useAwsHealth(0);

  // ── GitHub Status ──
  const [ghComponents, setGhComponents] = useState<
    Record<string, GitHubComponentStatus>
  >({});
  const [ghIncidents, setGhIncidents] = useState<GitHubIncident[]>([]);
  const [ghLoading, setGhLoading] = useState(false);
  const ghFetched = useRef(false);

  const fetchGitHubStatus = useCallback(async () => {
    const isInitial = !ghFetched.current;
    if (isInitial) setGhLoading(true);
    try {
      const [compRes, incRes] = await Promise.all([
        fetch("https://www.githubstatus.com/api/v2/components.json"),
        fetch("https://www.githubstatus.com/api/v2/incidents/unresolved.json"),
      ]);
      if (!compRes.ok || !incRes.ok) throw new Error("GitHub Status API error");
      const compData = await compRes.json();
      const incData = await incRes.json();
      const statusMap: Record<string, GitHubComponentStatus> = {};
      for (const comp of compData.components as GitHubComponent[]) {
        if (TRACKED_COMPONENT_IDS[comp.id]) {
          statusMap[comp.id] = comp.status;
        }
      }
      setGhComponents(statusMap);
      setGhIncidents(incData.incidents as GitHubIncident[]);
      ghFetched.current = true;
    } catch (error: any) {
      // Only log — don't show disruptive toasts on background refresh failures
      console.warn("GitHub Status fetch error:", error);
    } finally {
      setGhLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchGitHubStatus();
  }, [fetchGitHubStatus]);

  // ── Aggregate refresh ──
  const refreshAll = useCallback(() => {
    resources.refresh();
    alarmsHook.refresh();
    lambdaInvocations.refresh();
    lambdaErrors.refresh();
    lambdaDuration.refresh();
    neptuneCpu.refresh();
    neptuneCapacity.refresh();
    awsHealth.refresh();
    fetchGitHubStatus();
  }, [
    resources,
    alarmsHook,
    lambdaInvocations,
    lambdaErrors,
    lambdaDuration,
    neptuneCpu,
    neptuneCapacity,
    awsHealth,
    fetchGitHubStatus,
  ]);

  const anyLoading = resources.loading || alarmsHook.loading || awsHealth.loading || ghLoading;

  // Resolve resources
  const bastion = resources.ec2Instances.find(
    (i) => i.instanceId === bastionInstanceId
  );
  const neptune = resources.neptuneClusters[0];

  // ── Start / Stop controls ──
  const [bastionActionLoading, setBastionActionLoading] = useState(false);
  const [neptuneActionLoading, setNeptuneActionLoading] = useState(false);

  const handleBastionToggle = useCallback(async () => {
    if (!bastion) return;
    setBastionActionLoading(true);
    const targetState = bastion.state === "running" ? "stopped" : "running";
    try {
      if (bastion.state === "running") {
        await stopInstance(bastionInstanceId!);
      } else {
        await startInstance(bastionInstanceId!);
      }
      // Poll until the instance reaches the target state (up to ~2 min)
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const instances = await describeInstances([bastionInstanceId!]);
        const currentState = instances[0]?.state ?? "unknown";
        resources.refresh();
        if (currentState === targetState) break;
      }
    } catch (err: any) {
      console.error("Bastion toggle error:", err);
    } finally {
      setBastionActionLoading(false);
    }
  }, [bastion, bastionInstanceId, resources]);

  const [bastionCreateStatus, setBastionCreateStatus] = useState<string | null>(null);
  const [bastionCreateError, setBastionCreateError] = useState<string | null>(null);

  const handleBastionCreate = useCallback(async () => {
    setBastionCreateError(null);
    setBastionCreateStatus("Launching…");
    try {
      const newId = await createBastionInstance();
      setBastionInstanceId(newId);

      // Poll until running (up to ~2 min, every 5s)
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const instances = await describeInstances([newId]);
        const state = instances[0]?.state ?? "pending";
        if (state === "running") break;
        setBastionCreateStatus(state.charAt(0).toUpperCase() + state.slice(1) + "…");
      }

      resources.refresh();
    } catch (err: any) {
      console.error("Bastion create error:", err);
      setBastionCreateError(err?.message ?? String(err));
    } finally {
      setBastionCreateStatus(null);
    }
  }, [resources]);

  const handleNeptuneToggle = useCallback(async () => {
    if (!neptune) return;
    setNeptuneActionLoading(true);
    const targetStatus = neptune.status === "available" ? "stopped" : "available";
    try {
      if (neptune.status === "available") {
        await stopNeptuneCluster(NEPTUNE_CLUSTER_ID);
      } else {
        await startNeptuneCluster(NEPTUNE_CLUSTER_ID);
      }
      // Poll until the cluster reaches the target status (up to ~10 min)
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 10000));
        const clusters = await describeNeptuneClusters([NEPTUNE_CLUSTER_ID]);
        const currentStatus = clusters[0]?.status ?? "unknown";
        resources.refresh();
        if (currentStatus === targetStatus) break;
      }
    } catch (err: any) {
      console.error("Neptune toggle error:", err);
    } finally {
      setNeptuneActionLoading(false);
    }
  }, [neptune, resources]);

  return (
    <main className="grid flex-1 items-start gap-3 p-4 sm:px-6 sm:py-0">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            Monitoring
          </h1>
          <p className="text-xs text-muted-foreground">
            Infrastructure status, metrics &amp; alarms
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refreshAll}
          disabled={anyLoading}
        >
          {anyLoading ? (
            <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Refresh
        </Button>
      </div>

      {/* ── Row 1: Resource Status + Alarms ── */}
      <Card>
        <CardContent className="p-4">
          {resources.error && (
            <p className="mb-3 rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {resources.error}
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-[auto_auto_1fr]">
            {/* Resource status */}
            <div className="grid gap-3 sm:grid-cols-2 sm:w-max">
              {/* Bastion */}
              <div className="flex flex-col rounded-md border p-3 gap-2 w-44">
                <div className="flex items-center gap-2">
                  <Server className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="text-xs font-medium">SSM Bastion Host</p>
                </div>
                {!bastionSsmLoaded || (resources.loading && !bastion) ? (
                  <>
                    <Skeleton className="h-5 w-20 rounded-full" />
                    <Skeleton className="h-3 w-16" />
                  </>
                ) : bastion && bastion.state !== "terminated" ? (
                  <>
                    <EC2StateBadge state={bastion.state} />
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-[11px] text-muted-foreground">{bastion.instanceType}</p>
                      <p className="text-[11px] text-muted-foreground">{import.meta.env.VITE_COGNITO_REGION || "us-east-1"}</p>
                    </div>
                    <p className="text-[11px] text-muted-foreground font-mono">{bastionInstanceId}</p>
                  </>
                ) : (
                  <EC2StateBadge state="terminated" />
                )}
                {(bastionSsmError || bastionCreateError) && (
                  <p className="text-[10px] text-red-600 dark:text-red-400 break-words leading-tight">
                    {bastionSsmError ?? bastionCreateError}
                  </p>
                )}
                {bastionSsmLoaded && bastion && bastion.state !== "terminated" ? (
                  <Button
                    variant={bastion.state === "running" ? "destructive" : "default"}
                    size="sm"
                    className="w-full h-7 text-xs mt-auto"
                    disabled={bastionActionLoading || !["running", "stopped"].includes(bastion.state)}
                    onClick={handleBastionToggle}
                  >
                    {bastionActionLoading ? (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    ) : bastion.state === "running" ? (
                      <Square className="mr-1.5 h-3 w-3" />
                    ) : (
                      <Play className="mr-1.5 h-3 w-3" />
                    )}
                    {bastion.state === "running" ? "Stop Instance" : "Start Instance"}
                  </Button>
                ) : bastionSsmLoaded ? (
                  <Button
                    variant="default"
                    size="sm"
                    className="w-full h-7 text-xs mt-auto"
                    disabled={bastionCreateStatus !== null}
                    onClick={handleBastionCreate}
                  >
                    {bastionCreateStatus !== null ? (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="mr-1.5 h-3 w-3" />
                    )}
                    {bastionCreateStatus ?? "Create Instance"}
                  </Button>
                ) : null}
              </div>

              {/* Neptune */}
              <div className="flex flex-col rounded-md border p-3 gap-2 w-44">
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="text-xs font-medium">Neptune Cluster</p>
                </div>
                {resources.loading && !neptune ? (
                  <>
                    <Skeleton className="h-5 w-20 rounded-full" />
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </>
                ) : neptune ? (
                  <>
                    <NeptuneStateBadge status={neptune.status} />
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-[11px] text-muted-foreground">
                        {neptune.engine} {neptune.engineVersion}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{import.meta.env.VITE_COGNITO_REGION || "us-east-1"}</p>
                    </div>
                    {neptune.serverlessV2ScalingMin != null && (
                      <p className="text-[11px] text-muted-foreground">
                        {neptune.serverlessV2ScalingMin}–{neptune.serverlessV2ScalingMax} NCU (serverless)
                      </p>
                    )}
                  </>
                ) : (
                  <span className="text-[11px] text-muted-foreground">Not found</span>
                )}
                {neptune && (
                  <Button
                    variant={neptune.status === "available" ? "destructive" : "default"}
                    size="sm"
                    className="w-full h-7 text-xs mt-auto"
                    disabled={neptuneActionLoading || !["available", "stopped"].includes(neptune.status)}
                    onClick={handleNeptuneToggle}
                  >
                    {neptuneActionLoading ? (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    ) : neptune.status === "available" ? (
                      <Square className="mr-1.5 h-3 w-3" />
                    ) : (
                      <Play className="mr-1.5 h-3 w-3" />
                    )}
                    {neptune.status === "available" ? "Stop Cluster" : "Start Cluster"}
                  </Button>
                )}
              </div>
            </div>

            {/* Divider */}
            <Separator orientation="vertical" className="hidden lg:block" />
            <Separator className="lg:hidden" />

            {/* Alarms */}
            <AlarmStatusGrid
              alarms={alarmsHook.alarms}
              loading={alarmsHook.loading}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Row 2: All Metrics (Lambda + Neptune) ── */}
      <Collapsible defaultOpen={false}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="pb-2 pt-4 px-4 cursor-pointer select-none group">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90" />
                <Activity className="h-4 w-4" />
                CloudWatch Metrics
                <span className="text-xs font-normal text-muted-foreground">— last 6 hours</span>
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="grid gap-4 p-4 pt-2">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MetricChart
              title="Lambda Invocations"
              results={lambdaInvocations.data}
              loading={lambdaInvocations.loading}
              height={160}
              bare
            />
            <MetricChart
              title="Lambda Errors"
              results={lambdaErrors.data}
              loading={lambdaErrors.loading}
              height={160}
              bare
            />
            <MetricChart
              title="Lambda Duration (avg)"
              results={lambdaDuration.data}
              loading={lambdaDuration.loading}
              unit="ms"
              yAxisWidth={55}
              height={160}
              bare
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricChart
              title="Neptune CPU"
              results={neptuneCpu.data}
              loading={neptuneCpu.loading}
              unit="%"
              height={160}
              bare
            />
            <MetricChart
              title="Neptune NCU"
              description="Serverless Capacity"
              results={neptuneCapacity.data}
              loading={neptuneCapacity.loading}
              unit=" NCU"
              height={160}
              bare
            />
          </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* ── Row 3: Cloud Dependencies (AWS Health + GitHub side-by-side) ── */}
      <Collapsible defaultOpen={false}>
        {(() => {
          // Compute summary for collapsed badge
          const awsOk = awsHealth.statuses.filter(s => s.health === "operational").length;
          const awsTotal = awsHealth.statuses.length;
          const awsBad = awsTotal - awsOk;
          const ghStatuses = Object.values(ghComponents);
          const ghOk = ghStatuses.filter(s => s === "operational").length;
          const ghTotal = ghStatuses.length;
          const ghBad = ghTotal - ghOk;
          const allOk = awsBad === 0 && ghBad === 0 && awsTotal > 0;
          const anyIssue = awsBad > 0 || ghBad > 0;
          return (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4 flex flex-row items-center justify-between">
            <CollapsibleTrigger asChild>
              <CardTitle className="flex items-center gap-2 text-sm cursor-pointer select-none group">
                <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90" />
                <Cloud className="h-4 w-4" />
                Cloud Dependencies
                {/* Collapsed health summary — hidden when open */}
                <span className="flex items-center gap-1.5 ml-2 group-data-[state=open]:hidden">
                  {(awsHealth.loading || ghLoading) ? (
                    <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                  ) : allOk ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      <span className="text-xs font-normal text-muted-foreground">All systems operational</span>
                    </>
                  ) : anyIssue ? (
                    <>
                      <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
                      <span className="text-xs font-normal text-muted-foreground">
                        {awsBad > 0 && `${awsBad} AWS`}
                        {awsBad > 0 && ghBad > 0 && ", "}
                        {ghBad > 0 && `${ghBad} GitHub`}
                        {" "}issue{(awsBad + ghBad) !== 1 ? "s" : ""}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs font-normal text-muted-foreground">No data</span>
                  )}
                </span>
              </CardTitle>
            </CollapsibleTrigger>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => { awsHealth.refresh(); fetchGitHubStatus(); }}
              disabled={awsHealth.loading || ghLoading}
            >
              {(awsHealth.loading || ghLoading) ? (
                <Icons.spinner className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-3 w-3" />
              )}
              Refresh
            </Button>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="grid gap-4 p-4 pt-2 lg:grid-cols-[3fr_1fr]">
          {/* AWS Health */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold">
                <Activity className="h-3.5 w-3.5" />
                AWS Service Health
                <span className="text-[10px] font-normal text-muted-foreground">(us-east-1)</span>
              </h3>
              <a
                href="https://health.aws.amazon.com/health/status"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-muted-foreground underline"
              >
                health.aws.amazon.com
              </a>
            </div>
            <AwsHealthStatus
              statuses={awsHealth.statuses}
              loading={awsHealth.loading}
              error={awsHealth.error}
            />
          </div>

          {/* GitHub Status */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold">
                <Cloud className="h-3.5 w-3.5" />
                GitHub
              </h3>
              <a
                href="https://www.githubstatus.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-muted-foreground underline"
              >
                githubstatus.com
              </a>
            </div>

            {ghLoading ? (
              <div className="grid gap-1.5">
                {Object.keys(TRACKED_COMPONENT_IDS).map((_, idx) => (
                  <Skeleton key={idx} className="h-7 rounded" />
                ))}
              </div>
            ) : (
              <div className="grid gap-1.5">
                {Object.entries(TRACKED_COMPONENT_IDS).map(([id, label]) => (
                  <div
                    key={id}
                    className="flex items-center justify-between rounded border px-2 py-1"
                  >
                    <span className="text-xs">{label}</span>
                    <GitHubStatusIndicator
                      status={ghComponents[id] ?? "operational"}
                    />
                  </div>
                ))}
              </div>
            )}

            {ghIncidents.length > 0 && (
              <div className="mt-3">
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-yellow-700 dark:text-yellow-400">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Active Incidents
                </h4>
                <div className="grid gap-2">
                  {ghIncidents.map((incident) => {
                    const latestUpdate = incident.incident_updates?.[0];
                    return (
                      <div
                        key={incident.id}
                        className="rounded border border-yellow-300 p-2 dark:border-yellow-700"
                      >
                        <div className="flex items-start justify-between gap-1">
                          <a
                            href={incident.shortlink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium underline"
                          >
                            {incident.name}
                          </a>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {formatDuration(incident.created_at)}
                          </span>
                        </div>
                        {latestUpdate && (
                          <p className="mt-1 text-[10px] text-muted-foreground line-clamp-2">
                            {latestUpdate.body}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
          );
        })()} 
      </Collapsible>

      {/* ── Row 4: Neptune Graph ── */}
      <Collapsible defaultOpen={false}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="pb-2 pt-4 px-4 cursor-pointer select-none group">
              <CardTitle className="flex items-center gap-2 text-sm">
                <ChevronRight className="h-4 w-4 transition-transform group-data-[state=open]:rotate-90" />
                <Database className="h-4 w-4" />
                Neptune Graph
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="p-4 pt-2">
              <GraphSection />
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

    </main>
  );
}
