import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Info,
  ExternalLink,
  Clock,
  Rss,
} from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  AwsServiceHealth,
  AwsServiceStatus,
  AwsServiceEvent,
} from "@/hooks/useAwsHealth";

// ─── Category color mapping ─────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  compute:     "border-l-blue-500",
  database:    "border-l-purple-500",
  network:     "border-l-cyan-500",
  security:    "border-l-amber-500",
  ai:          "border-l-pink-500",
  storage:     "border-l-emerald-500",
  integration: "border-l-indigo-500",
  monitoring:  "border-l-orange-500",
};

// ─── Status indicator ────────────────────────────────────────────────

function HealthIndicator({ health }: { health: AwsServiceHealth }) {
  switch (health) {
    case "operational":
      return (
        <span className="h-3 w-3 rounded-full bg-green-500 flex items-center justify-center">
          <CheckCircle2 className="h-2 w-2 text-white" />
        </span>
      );
    case "informational":
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-blue-500 flex items-center justify-center">
            <Info className="h-2 w-2 text-white" />
          </span>
          <span className="text-xs text-blue-700 dark:text-blue-400">
            Informational
          </span>
        </span>
      );
    case "degraded":
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-yellow-500 flex items-center justify-center">
            <AlertTriangle className="h-2 w-2 text-white" />
          </span>
          <span className="text-xs text-yellow-700 dark:text-yellow-400">
            Degraded
          </span>
        </span>
      );
    case "disrupted":
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-red-500 flex items-center justify-center">
            <XCircle className="h-2 w-2 text-white" />
          </span>
          <span className="text-xs text-red-700 dark:text-red-400">
            Disrupted
          </span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-gray-400 flex items-center justify-center">
            <HelpCircle className="h-2 w-2 text-white" />
          </span>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            Unknown
          </span>
        </span>
      );
  }
}

// ─── Event row ───────────────────────────────────────────────────────

function EventItem({ event }: { event: AwsServiceEvent }) {
  const date = event.pubDate
    ? new Date(event.pubDate).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  // Strip HTML tags from description for clean display
  const cleanDesc = event.description.replace(/<[^>]*>/g, "").slice(0, 200);

  return (
    <div className="rounded border bg-muted/30 p-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium leading-tight">{event.title}</p>
        {date && (
          <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            {date}
          </span>
        )}
      </div>
      {cleanDesc && (
        <p className="mt-1 text-[11px] text-muted-foreground leading-snug line-clamp-2">
          {cleanDesc}
        </p>
      )}
    </div>
  );
}

// ─── Summary banner ──────────────────────────────────────────────────

function HealthSummary({ statuses }: { statuses: AwsServiceStatus[] }) {
  const disrupted = statuses.filter((s) => s.health === "disrupted").length;
  const degraded = statuses.filter((s) => s.health === "degraded").length;
  const unknown = statuses.filter((s) => s.health === "unknown").length;
  const total = statuses.length;
  const operational = total - disrupted - degraded - unknown;

  if (disrupted > 0) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-800 dark:bg-red-900/20 dark:text-red-400">
        <XCircle className="h-4 w-4" />
        {disrupted} service{disrupted > 1 ? "s" : ""} disrupted
      </div>
    );
  }
  if (degraded > 0) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-yellow-50 px-3 py-2 text-sm font-medium text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400">
        <AlertTriangle className="h-4 w-4" />
        {degraded} service{degraded > 1 ? "s" : ""} degraded — {operational} operational
      </div>
    );
  }
  if (unknown === total) {
    return null; // Error banner handles this
  }
  return (
    <div className="flex items-center gap-2 rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-800 dark:bg-green-900/20 dark:text-green-400">
      <CheckCircle2 className="h-4 w-4" />
      All {operational} services operational in us-east-1
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────

interface AwsHealthStatusProps {
  statuses: AwsServiceStatus[];
  loading: boolean;
  error: string | null;
}

export function AwsHealthStatus({ statuses, loading, error }: AwsHealthStatusProps) {
  // Separate services with events from those without
  const withEvents = statuses.filter((s) => s.events.length > 0);

  if (loading && statuses.length === 0) {
    return (
      <div className="grid gap-3">
        <Skeleton className="h-10 rounded" />
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 15 }).map((_, i) => (
            <Skeleton key={i} className="h-10 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {/* Error banner */}
      {error && (
        <div className="flex items-center justify-between rounded-md bg-yellow-50 px-3 py-2 dark:bg-yellow-900/20">
          <p className="text-xs text-yellow-800 dark:text-yellow-400">{error}</p>
          <a
            href="https://health.aws.amazon.com/health/status"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-yellow-700 underline dark:text-yellow-300"
          >
            Check manually <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      {/* Summary */}
      {statuses.length > 0 && <HealthSummary statuses={statuses} />}

      {/* Service grid */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
        {statuses.map((s) => (
          <a
            key={s.service.feedId}
            href={s.rssUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`group flex items-center justify-between gap-3 rounded-md border border-l-4 px-3 py-2 transition-colors hover:bg-muted/50 ${CATEGORY_COLORS[s.service.category] ?? "border-l-gray-400"}`}
            title={`View RSS feed for ${s.service.label}`}
          >
            <span className="text-sm font-medium min-w-0 truncate">{s.service.label}</span>
            <span className="shrink-0"><HealthIndicator health={s.health} /></span>
          </a>
        ))}
      </div>

      {/* Recent events (if any) */}
      {withEvents.length > 0 && (
        <>
          <Separator />
          <h4 className="flex items-center gap-2 text-sm font-semibold text-yellow-700 dark:text-yellow-400">
            <Rss className="h-4 w-4" />
            Recent Service Events (last 7 days)
          </h4>
          <div className="grid gap-3">
            {withEvents.map((s) => (
              <Card
                key={s.service.feedId}
                className="border-yellow-300 dark:border-yellow-700"
              >
                <CardContent className="p-4 grid gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">
                      {s.service.label}
                    </span>
                    <HealthIndicator health={s.health} />
                  </div>
                  <div className="grid gap-2">
                    {s.events.slice(0, 3).map((ev, idx) => (
                      <EventItem key={idx} event={ev} />
                    ))}
                    {s.events.length > 3 && (
                      <a
                        href={s.rssUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-muted-foreground underline"
                      >
                        +{s.events.length - 3} more events →
                      </a>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* Category legend */}
      <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
        {[
          { cat: "compute", label: "Compute" },
          { cat: "database", label: "Database" },
          { cat: "network", label: "Network/CDN" },
          { cat: "storage", label: "Storage" },
          { cat: "integration", label: "Integration" },
          { cat: "security", label: "Security" },
          { cat: "ai", label: "AI/ML" },
          { cat: "monitoring", label: "Monitoring" },
        ].map(({ cat, label }) => (
          <span key={cat} className="inline-flex items-center gap-1">
            <span
              className={`h-2 w-2 rounded-sm ${CATEGORY_COLORS[cat]?.replace("border-l-", "bg-") ?? "bg-gray-400"}`}
            />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
