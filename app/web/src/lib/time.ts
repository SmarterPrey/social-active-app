// Tiny relative-time helper; no extra dependency.
const RTF = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const STEPS: [number, Intl.RelativeTimeFormatUnit][] = [
  [60, "second"],
  [60, "minute"],
  [24, "hour"],
  [7, "day"],
  [4.345, "week"],
  [12, "month"],
  [Number.POSITIVE_INFINITY, "year"],
];

export function formatDistanceToNow(iso: string): string {
  const diffSeconds = (Date.parse(iso) - Date.now()) / 1000;
  let value = diffSeconds;
  for (const [size, unit] of STEPS) {
    if (Math.abs(value) < size) {
      return RTF.format(Math.round(value), unit);
    }
    value /= size;
  }
  return RTF.format(Math.round(value), "year");
}

export function formatEventDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
