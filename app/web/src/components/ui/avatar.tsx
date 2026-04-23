import * as React from "react";
import { cn } from "@/lib/utils";

function initials(name?: string | null) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  name?: string | null;
  src?: string | null;
  size?: "sm" | "md" | "lg";
}

const sizeClass = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-base",
};

export function Avatar({ name, src, size = "md", className, ...props }: AvatarProps) {
  return (
    <div
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold text-foreground/80 ring-1 ring-border overflow-hidden",
        sizeClass[size],
        className,
      )}
      aria-label={name ?? undefined}
      {...props}
    >
      {src ? (
        <img src={src} alt={name ?? ""} className="h-full w-full object-cover" />
      ) : (
        <span>{initials(name)}</span>
      )}
    </div>
  );
}
