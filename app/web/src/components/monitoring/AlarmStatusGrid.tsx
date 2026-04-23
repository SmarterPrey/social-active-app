/**
 * AlarmStatusGrid — renders CloudWatch alarm states grouped by service,
 * with colour-coded badges and tooltips describing what each alarm means.
 */
import { useMemo } from "react";
import {
  CheckCircle2,
  XCircle,
  HelpCircle,
  AlertTriangle,
  Zap,
  Database,
  Globe,
  Shield,
  Server,
} from "lucide-react";
import type { MetricAlarm } from "@/lib/aws-clients";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TooltipProvider } from "@radix-ui/react-tooltip";

export interface AlarmStatusGridProps {
  alarms: MetricAlarm[];
  loading?: boolean;
}

// ─── Alarm descriptions keyed by pattern in the alarm name ───────────
interface AlarmInfo {
  trigger: string;
  meaning: string;
}

/** Match alarm names to human-readable descriptions */
function getAlarmInfo(name: string): AlarmInfo {
  const n = name.toLowerCase();

  // Lambda
  if (n.includes("error") && !n.includes("appsync") && !n.includes("cloudfront"))
    return {
      trigger: ">= 1 error in a 5-minute window",
      meaning: "A Lambda function threw an unhandled exception or timed out. Check CloudWatch Logs for the failing function.",
    };
  if (n.includes("throttle"))
    return {
      trigger: ">= 1 throttle in a 5-minute window",
      meaning: "Lambda concurrency limit reached — invocations were refused. Consider raising reserved concurrency.",
    };

  // Neptune
  if (n.includes("neptune") && n.includes("cpu"))
    return {
      trigger: "CPU >= 80% for 15 minutes",
      meaning: "Neptune cluster under sustained heavy load. Graph queries may slow down. Optimize queries or increase max NCU.",
    };
  if (n.includes("neptune") && n.includes("capacity"))
    return {
      trigger: "Serverless NCU >= 6 for 15 minutes",
      meaning: "Neptune approaching its scaling ceiling (6 of 8 NCU). Raise the max NCU limit or optimize query patterns.",
    };
  if (n.includes("neptune") && n.includes("queue"))
    return {
      trigger: "Pending requests >= 10 for 10 minutes",
      meaning: "Requests backing up faster than Neptune can process them. Usually follows high CPU or max capacity.",
    };

  // AppSync
  if (n.includes("appsync") && n.includes("5xx"))
    return {
      trigger: ">= 1 server error (5XX) in a 5-minute window",
      meaning: "The GraphQL API returned an internal server error. Check the associated Lambda alarms and CloudWatch Logs.",
    };

  // CloudFront
  if (n.includes("cloudfront") && n.includes("5xx"))
    return {
      trigger: "5XX error rate >= 5% for 15 minutes",
      meaning: "The CDN is returning server errors to users. Could indicate a bad deployment, S3 origin issue, or upstream AWS problem.",
    };

  // Fallback — use the alarm's own description if available
  return {
    trigger: "Threshold breached",
    meaning: "Check the alarm configuration in CloudWatch for details.",
  };
}

// ─── Service grouping ────────────────────────────────────────────────
interface ServiceGroup {
  label: string;
  icon: React.ReactNode;
  alarms: MetricAlarm[];
}

function groupAlarmsByService(alarms: MetricAlarm[]): ServiceGroup[] {
  const groups: Record<string, MetricAlarm[]> = {
    Lambda: [],
    Neptune: [],
    AppSync: [],
    CloudFront: [],
    Other: [],
  };

  for (const alarm of alarms) {
    const name = (alarm.AlarmName ?? "").toLowerCase();
    if (name.includes("neptune")) groups.Neptune.push(alarm);
    else if (name.includes("appsync")) groups.AppSync.push(alarm);
    else if (name.includes("cloudfront")) groups.CloudFront.push(alarm);
    else if (name.includes("error") || name.includes("throttle")) groups.Lambda.push(alarm);
    else groups.Other.push(alarm);
  }

  const iconClass = "h-3.5 w-3.5";
  const result: ServiceGroup[] = [];
  if (groups.Lambda.length) result.push({ label: "Lambda", icon: <Zap className={iconClass} />, alarms: groups.Lambda });
  if (groups.Neptune.length) result.push({ label: "Neptune", icon: <Database className={iconClass} />, alarms: groups.Neptune });
  if (groups.AppSync.length) result.push({ label: "AppSync", icon: <Server className={iconClass} />, alarms: groups.AppSync });
  if (groups.CloudFront.length) result.push({ label: "CloudFront", icon: <Globe className={iconClass} />, alarms: groups.CloudFront });
  if (groups.Other.length) result.push({ label: "Other", icon: <Shield className={iconClass} />, alarms: groups.Other });
  return result;
}

// ─── Visual helpers ──────────────────────────────────────────────────
function stateIcon(state: string | undefined) {
  switch (state) {
    case "OK":
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />;
    case "ALARM":
      return <XCircle className="h-3.5 w-3.5 text-red-600" />;
    case "INSUFFICIENT_DATA":
      return <HelpCircle className="h-3.5 w-3.5 text-gray-400" />;
    default:
      return <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />;
  }
}

function stateBadgeClasses(state: string | undefined) {
  switch (state) {
    case "OK":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400";
    case "ALARM":
      return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400";
    case "INSUFFICIENT_DATA":
      return "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400";
    default:
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400";
  }
}

/** Derive a short human label from the alarm name */
function shortLabel(name: string | undefined): string {
  if (!name) return "Unknown";
  return name
    .replace(/^[^-]+-ObservabilityStack-/i, "")
    .replace(/[A-Z0-9]{8,}$/, "")
    .replace(/-+$/, "");
}

function sortByState(alarms: MetricAlarm[]): MetricAlarm[] {
  const order: Record<string, number> = { ALARM: 0, INSUFFICIENT_DATA: 1, OK: 2 };
  return [...alarms].sort(
    (a, b) => (order[a.StateValue ?? ""] ?? 3) - (order[b.StateValue ?? ""] ?? 3)
  );
}

// ─── Component ───────────────────────────────────────────────────────
export function AlarmStatusGrid({ alarms, loading }: AlarmStatusGridProps) {
  // Deduplicate alarms by name to prevent duplicate React keys
  const uniqueAlarms = useMemo(() => {
    const seen = new Set<string>();
    return alarms.filter((a) => {
      const name = a.AlarmName ?? "";
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });
  }, [alarms]);

  const alarming = uniqueAlarms.filter((a) => a.StateValue === "ALARM");
  const groups = groupAlarmsByService(uniqueAlarms);

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium">
          Application Alarms ({uniqueAlarms.length})
        </span>
        {alarming.length > 0 && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-400">
            {alarming.length} in alarm
          </span>
        )}
      </div>
      {loading ? (
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-4 w-24 mb-1.5 rounded" />
              <div className="flex flex-wrap gap-1.5">
                <Skeleton className="h-7 w-36 rounded" />
                <Skeleton className="h-7 w-32 rounded" />
              </div>
            </div>
          ))}
        </div>
      ) : uniqueAlarms.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">
          No alarms configured.
        </p>
      ) : (
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {groups.map((group, groupIdx, arr) => {
            // Defensive: skip if a group with this label was already rendered
            if (arr.findIndex((g) => g.label === group.label) !== groupIdx) return null;
            // Skip CloudFront — rendered with AppSync
            if (group.label === "CloudFront") return null;

            // Pair AppSync + CloudFront together
            const paired = group.label === "AppSync"
              ? [group, ...arr.filter((g) => g.label === "CloudFront")]
              : [group];

            return (
              <div key={group.label} className="space-y-3">
                {paired.map((g) => (
                <div key={g.label}>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      {g.icon}
                      <span className="text-[11px] font-semibold text-muted-foreground">
                        {g.label}
                      </span>
                    </div>
                    <div className={`grid gap-1.5 ${g.label === "Lambda" ? "grid-cols-2" : "grid-cols-1"}`}>
                      <TooltipProvider delayDuration={200}>
                        {sortByState(g.alarms).map((alarm, alarmIdx) => {
                          const info = getAlarmInfo(alarm.AlarmName ?? "");
                          return (
                            <Tooltip key={alarm.AlarmArn ?? `${alarm.AlarmName}-${alarmIdx}`}>
                              <TooltipTrigger asChild>
                                <div
                                  className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs cursor-default max-w-[200px] ${stateBadgeClasses(alarm.StateValue)}`}
                                >
                                  {stateIcon(alarm.StateValue)}
                                  <span className="truncate font-medium">
                                    {shortLabel(alarm.AlarmName)}
                                  </span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent
                                side="bottom"
                                className="max-w-[280px] space-y-1 text-xs"
                              >
                                <p className="font-semibold">{shortLabel(alarm.AlarmName)}</p>
                                <p>
                                  <span className="font-medium text-muted-foreground">Trigger: </span>
                                  {info.trigger}
                                </p>
                                <p>
                                  <span className="font-medium text-muted-foreground">What it means: </span>
                                  {info.meaning}
                                </p>
                                <p className="text-muted-foreground">
                                  State: {alarm.StateValue ?? "Unknown"}
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </TooltipProvider>
                    </div>
                </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
