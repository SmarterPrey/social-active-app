/**
 * React hooks for the monitoring dashboard.
 *
 * - useCloudWatchMetrics  — fetch time-series data from CloudWatch
 * - useCloudWatchAlarms   — list current alarm states
 * - useResourceStatus     — EC2 + Neptune live status
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getMetricData,
  describeAlarms,
  describeInstances,
  describeNeptuneClusters,
  type MetricDataQuery,
  type MetricDataResult,
  type MetricAlarm,
  type EC2InstanceInfo,
  type NeptuneClusterInfo,
} from "@/lib/aws-clients";

// ─── useCloudWatchMetrics ──────────────────────────────────────────────

export interface UseMetricsOptions {
  queries: MetricDataQuery[];
  /** Time window in hours (default: 3) */
  hours?: number;
  /** Auto-refresh interval in ms. 0 = off. (default: 60 000) */
  refreshInterval?: number;
  /** Skip the query entirely when true */
  skip?: boolean;
}

export interface UseMetricsResult {
  data: MetricDataResult[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useCloudWatchMetrics(opts: UseMetricsOptions): UseMetricsResult {
  const { queries, hours = 3, refreshInterval = 60_000, skip = false } = opts;
  const [data, setData] = useState<MetricDataResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);
  const hasFetched = useRef(false);

  // Store latest values in refs so fetchData callback is stable
  const queriesRef = useRef(queries);
  queriesRef.current = queries;
  const hoursRef = useRef(hours);
  hoursRef.current = hours;

  const fetchData = useCallback(async () => {
    if (skip || queriesRef.current.length === 0) return;
    const isInitial = !hasFetched.current;
    if (isInitial) setLoading(true);
    try {
      const end = new Date();
      const start = new Date(end.getTime() - hoursRef.current * 3600 * 1000);
      const results = await getMetricData(queriesRef.current, start, end);
      if (isMounted.current) {
        setData(results);
        setError(null);
        hasFetched.current = true;
      }
    } catch (e: any) {
      if (isMounted.current && !hasFetched.current) {
        setError(e.message ?? String(e));
      }
      console.warn("CloudWatch metrics fetch failed:", e);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, [skip]);

  useEffect(() => {
    isMounted.current = true;
    hasFetched.current = false;
    fetchData();
    if (refreshInterval > 0 && !skip) {
      const id = setInterval(fetchData, refreshInterval);
      return () => {
        isMounted.current = false;
        clearInterval(id);
      };
    }
    return () => {
      isMounted.current = false;
    };
  }, [fetchData, refreshInterval, skip]);

  return { data, loading, error, refresh: fetchData };
}

// ─── useCloudWatchAlarms ───────────────────────────────────────────────

export interface UseAlarmsResult {
  alarms: MetricAlarm[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useCloudWatchAlarms(
  refreshInterval = 60_000
): UseAlarmsResult {
  const [alarms, setAlarms] = useState<MetricAlarm[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  const hasFetched = useRef(false);

  const fetchAlarms = useCallback(async () => {
    const isInitial = !hasFetched.current;
    if (isInitial) setLoading(true);
    try {
      const result = await describeAlarms();
      if (isMounted.current) {
        setAlarms(result);
        setError(null);
        hasFetched.current = true;
      }
    } catch (e: any) {
      if (isMounted.current && !hasFetched.current) {
        setError(e.message ?? String(e));
      }
      console.warn("CloudWatch alarms fetch failed:", e);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    hasFetched.current = false;
    fetchAlarms();
    if (refreshInterval > 0) {
      const id = setInterval(fetchAlarms, refreshInterval);
      return () => {
        isMounted.current = false;
        clearInterval(id);
      };
    }
    return () => {
      isMounted.current = false;
    };
  }, [fetchAlarms, refreshInterval]);

  return { alarms, loading, error, refresh: fetchAlarms };
}

// ─── useResourceStatus ─────────────────────────────────────────────────

export interface ResourceStatus {
  ec2Instances: EC2InstanceInfo[];
  neptuneClusters: NeptuneClusterInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useResourceStatus(
  ec2InstanceIds: string[],
  neptuneClusterIds: string[],
  refreshInterval = 60_000
): ResourceStatus {
  const [ec2Instances, setEc2] = useState<EC2InstanceInfo[]>([]);
  const [neptuneClusters, setNeptune] = useState<NeptuneClusterInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  const hasFetched = useRef(false);

  // Store latest values in refs so fetchStatus callback is stable
  const ec2IdsRef = useRef(ec2InstanceIds);
  ec2IdsRef.current = ec2InstanceIds;
  const neptuneIdsRef = useRef(neptuneClusterIds);
  neptuneIdsRef.current = neptuneClusterIds;

  const fetchStatus = useCallback(async () => {
    const isInitial = !hasFetched.current;
    if (isInitial) setLoading(true);
    try {
      const [ec2, neptune] = await Promise.all([
        ec2IdsRef.current.length > 0
          ? describeInstances(ec2IdsRef.current)
          : Promise.resolve([]),
        neptuneIdsRef.current.length > 0
          ? describeNeptuneClusters(neptuneIdsRef.current)
          : Promise.resolve([]),
      ]);
      if (isMounted.current) {
        setEc2(ec2);
        setNeptune(neptune);
        setError(null);
        hasFetched.current = true;
      }
    } catch (e: any) {
      if (isMounted.current && !hasFetched.current) {
        setError(e.message ?? String(e));
      }
      console.warn("Resource status fetch failed:", e);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;
    hasFetched.current = false;
    fetchStatus();
    if (refreshInterval > 0) {
      const id = setInterval(fetchStatus, refreshInterval);
      return () => {
        isMounted.current = false;
        clearInterval(id);
      };
    }
    return () => {
      isMounted.current = false;
    };
  }, [fetchStatus, refreshInterval]);

  return { ec2Instances, neptuneClusters, loading, error, refresh: fetchStatus };
}
