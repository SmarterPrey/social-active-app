/**
 * MetricChart — renders a CloudWatch time-series metric as a Recharts
 * line / area chart inside a Card.
 */
import { useMemo } from "react";
import { format } from "date-fns";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MetricDataResult } from "@/lib/aws-clients";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Tailwind chart color palette (hsl values)
const COLORS = [
  "hsl(220 70% 50%)",   // blue
  "hsl(160 60% 45%)",   // green
  "hsl(30 80% 55%)",    // orange
  "hsl(280 65% 60%)",   // purple
  "hsl(350 65% 55%)",   // red
  "hsl(190 70% 50%)",   // cyan
];

export interface MetricChartProps {
  title: string;
  description?: string;
  results: MetricDataResult[];
  loading?: boolean;
  /** Height of the chart area in px (default: 160) */
  height?: number;
  /** Unit suffix for the Y-axis (e.g. "%", "ms", "count") */
  unit?: string;
  /** Custom Y-axis width in px (auto-calculated from unit length if omitted) */
  yAxisWidth?: number;
  /** When true, render without a wrapping Card (just title + chart) */
  bare?: boolean;
}

interface ChartPoint {
  time: number;
  label: string;
  [key: string]: number | string;
}

export function MetricChart({
  title,
  description,
  results,
  loading,
  height = 160,
  unit = "",
  yAxisWidth,
  bare = false,
}: MetricChartProps) {
  // Auto-size Y-axis: base 40px + extra room when a unit suffix is present
  const computedYAxisWidth = yAxisWidth ?? (unit.length > 2 ? 55 : 45);
  // Merge all MetricDataResults into a single time-aligned dataset
  const { chartData, seriesKeys } = useMemo(() => {
    const timeMap = new Map<number, ChartPoint>();
    const keys: string[] = [];

    for (const series of results) {
      const label = series.Label ?? series.Id ?? "metric";
      keys.push(label);
      const timestamps = series.Timestamps ?? [];
      const values = series.Values ?? [];
      for (let i = 0; i < timestamps.length; i++) {
        const ts = new Date(timestamps[i]).getTime();
        if (!timeMap.has(ts)) {
          timeMap.set(ts, {
            time: ts,
            label: format(new Date(ts), "HH:mm"),
          });
        }
        timeMap.get(ts)![label] = values[i];
      }
    }

    const sorted = Array.from(timeMap.values()).sort(
      (a, b) => a.time - b.time
    );
    return { chartData: sorted, seriesKeys: keys };
  }, [results]);

  const chartContent = loading ? (
    <Skeleton className="w-full rounded" style={{ height }} />
  ) : chartData.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center text-xs text-muted-foreground"
            style={{ height }}
          >
            <span>No data available</span>
            <span className="mt-1 opacity-50 text-[10px]">Metric data will appear once CloudWatch begins reporting</span>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <AreaChart data={chartData}>
              <defs>
                {seriesKeys.map((key, idx) => (
                  <linearGradient
                    key={key}
                    id={`fill-${idx}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor={COLORS[idx % COLORS.length]}
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor={COLORS[idx % COLORS.length]}
                      stopOpacity={0}
                    />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={computedYAxisWidth}
                tickFormatter={(v: number) =>
                  unit ? `${v}${unit}` : String(v)
                }
              />
              <Tooltip
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  border: "1px solid hsl(var(--border))",
                  background: "hsl(var(--popover))",
                  color: "hsl(var(--popover-foreground))",
                }}
                formatter={(value) => [
                  `${(Number(value) ?? 0).toFixed(2)}${unit ? ` ${unit}` : ""}`,
                ]}
              />
              {seriesKeys.map((key, idx) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={COLORS[idx % COLORS.length]}
                  fill={`url(#fill-${idx})`}
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        );

  if (bare) {
    return (
      <div className="rounded-md border p-2">
        <p className="mb-1 text-xs font-medium">{title}</p>
        {description && (
          <p className="mb-1 text-[10px] text-muted-foreground">{description}</p>
        )}
        {chartContent}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {description && (
          <CardDescription className="text-xs">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>{chartContent}</CardContent>
    </Card>
  );
}
