import { cn } from "@/lib/utils"

function Skeleton({
  className,
  style,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-md bg-muted animate-shimmer",
        className
      )}
      style={{
        backgroundImage:
          "linear-gradient(90deg, transparent 0%, hsl(var(--muted-foreground) / 0.06) 50%, transparent 100%)",
        backgroundSize: "200% 100%",
        ...style,
      }}
      {...props}
    />
  )
}

export { Skeleton }
