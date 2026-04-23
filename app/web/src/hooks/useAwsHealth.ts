import { useState, useEffect, useCallback, useRef } from "react";

// ─── AWS Service → RSS feed mapping ─────────────────────────────────
// Feed IDs sourced from https://health.aws.amazon.com/health/status
// RSS URL pattern: https://status.aws.amazon.com/rss/{feedId}.rss

export interface AwsServiceDef {
  /** Human-readable service name */
  label: string;
  /** RSS feed identifier (without .rss) */
  feedId: string;
  /** Optional icon hint for the UI */
  category: "compute" | "database" | "network" | "security" | "ai" | "storage" | "integration" | "monitoring";
}

/**
 * Every AWS service this application depends on in us-east-1.
 * Order mirrors the infrastructure dependency graph (network → compute → data → edge).
 */
export const AWS_SERVICES: AwsServiceDef[] = [
  { label: "VPC",             feedId: "vpc-us-east-1",              category: "network" },
  { label: "EC2",             feedId: "ec2-us-east-1",              category: "compute" },
  { label: "Lambda",          feedId: "lambda-us-east-1",           category: "compute" },
  { label: "Neptune",         feedId: "neptune-db-us-east-1",       category: "database" },
  { label: "S3",              feedId: "s3-us-east-1",               category: "storage" },
  { label: "CloudFront",      feedId: "cloudfront",                 category: "network" },
  { label: "AppSync",         feedId: "appsync-us-east-1",          category: "integration" },
  { label: "Cognito",         feedId: "cognito-us-east-1",          category: "security" },
  { label: "Bedrock",         feedId: "bedrock-us-east-1",          category: "ai" },
  { label: "CloudWatch",      feedId: "cloudwatch-us-east-1",       category: "monitoring" },
  { label: "EventBridge",     feedId: "events-us-east-1",           category: "integration" },
  { label: "SNS",             feedId: "sns-us-east-1",              category: "integration" },
  { label: "WAF",             feedId: "awswaf-us-east-1",           category: "security" },
  { label: "KMS",             feedId: "kms-us-east-1",              category: "security" },
  { label: "CloudFormation",  feedId: "cloudformation-us-east-1",   category: "integration" },
];

// ─── Types ───────────────────────────────────────────────────────────

export type AwsServiceHealth = "operational" | "informational" | "degraded" | "disrupted" | "unknown";

export interface AwsServiceEvent {
  title: string;
  description: string;
  pubDate: string;
}

export interface AwsServiceStatus {
  service: AwsServiceDef;
  health: AwsServiceHealth;
  events: AwsServiceEvent[];
  rssUrl: string;
}

// ─── RSS parsing helpers ─────────────────────────────────────────────

const RSS_BASE = "https://status.aws.amazon.com/rss";

function textContent(el: Element | null): string {
  if (!el) return "";
  // Handle CDATA sections
  return el.textContent?.trim() ?? "";
}

/**
 * Classify an RSS item title/description into a health level.
 * AWS uses keywords like "Informational message", "Service disruption", etc.
 */
function classifyEvent(title: string, description: string): AwsServiceHealth {
  const combined = `${title} ${description}`.toLowerCase();
  if (combined.includes("disruption") || combined.includes("disrupted"))
    return "disrupted";
  if (combined.includes("degraded") || combined.includes("degradation") || combined.includes("increased error") || combined.includes("elevated error"))
    return "degraded";
  if (combined.includes("informational") || combined.includes("resolved") || combined.includes("operating normally"))
    return "informational";
  // Default to degraded for any active item that doesn't match
  return "degraded";
}

/**
 * Parse an RSS XML string into a list of events.
 * Returns events from the last 7 days only.
 */
function parseRssFeed(xml: string): AwsServiceEvent[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const items = doc.querySelectorAll("item");
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000; // 7 days
  const events: AwsServiceEvent[] = [];

  items.forEach((item) => {
    const pubDateStr = textContent(item.querySelector("pubDate"));
    const pubDate = pubDateStr ? new Date(pubDateStr) : new Date(0);
    if (pubDate.getTime() >= cutoff) {
      events.push({
        title: textContent(item.querySelector("title")),
        description: textContent(item.querySelector("description")),
        pubDate: pubDateStr,
      });
    }
  });

  return events;
}

/**
 * Derive the overall health from a list of recent events.
 * Worst status wins.
 */
function deriveHealth(events: AwsServiceEvent[]): AwsServiceHealth {
  if (events.length === 0) return "operational";

  let worst: AwsServiceHealth = "informational";
  for (const ev of events) {
    const level = classifyEvent(ev.title, ev.description);
    if (level === "disrupted") return "disrupted";
    if (level === "degraded") worst = "degraded";
  }
  return worst;
}

// ─── Hook ────────────────────────────────────────────────────────────

interface UseAwsHealthReturn {
  statuses: AwsServiceStatus[];
  loading: boolean;
  error: string | null;
  lastChecked: string | null;
  refresh: () => void;
}

/**
 * Fetches AWS Health RSS feeds for all tracked services and returns
 * parsed status information.
 *
 * @param refreshInterval  Auto-refresh interval in ms (default: 5 min)
 */
export function useAwsHealth(refreshInterval = 300_000): UseAwsHealthReturn {
  const [statuses, setStatuses] = useState<AwsServiceStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const hasFetched = useRef(false);

  const fetchAll = useCallback(async () => {
    const isInitial = !hasFetched.current;
    if (isInitial) setLoading(true);

    try {
      const results = await Promise.allSettled(
        AWS_SERVICES.map(async (svc) => {
          const rssUrl = `${RSS_BASE}/${svc.feedId}.rss`;
          const res = await fetch(rssUrl);
          if (!res.ok)
            throw new Error(`HTTP ${res.status} for ${svc.feedId}`);
          const xml = await res.text();
          const events = parseRssFeed(xml);
          const health = deriveHealth(events);
          return { service: svc, health, events, rssUrl } as AwsServiceStatus;
        })
      );

      const resolved: AwsServiceStatus[] = results.map((r, idx) => {
        if (r.status === "fulfilled") return r.value;
        // Feed fetch failed (likely CORS) — mark unknown
        const svc = AWS_SERVICES[idx];
        return {
          service: svc,
          health: "unknown" as AwsServiceHealth,
          events: [],
          rssUrl: `${RSS_BASE}/${svc.feedId}.rss`,
        };
      });

      // Check if ALL failed (likely CORS)
      const allUnknown = resolved.every((s) => s.health === "unknown");
      if (allUnknown && !hasFetched.current) {
        setError(
          "Unable to reach AWS Status feeds (CORS). Check status manually."
        );
      } else if (!allUnknown) {
        setError(null);
      }

      setStatuses(resolved);
      setLastChecked(new Date().toLocaleTimeString());
      hasFetched.current = true;
    } catch (err: any) {
      if (!hasFetched.current) {
        setError(err.message ?? "Failed to fetch AWS health data");
      }
      console.warn("AWS health fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    hasFetched.current = false;
    fetchAll();
    if (refreshInterval > 0) {
      const id = setInterval(fetchAll, refreshInterval);
      return () => clearInterval(id);
    }
  }, [fetchAll, refreshInterval]);

  return { statuses, loading, error, lastChecked, refresh: fetchAll };
}
