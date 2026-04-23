import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  onCheckedChange?: (checked: boolean) => void;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, checked, onCheckedChange, ...props }, ref) => {
    return (
      <span
        className={cn(
          "relative inline-flex h-4 w-4 items-center justify-center rounded border border-input bg-background",
          checked && "border-primary bg-primary text-primary-foreground",
          className,
        )}
      >
        <input
          ref={ref}
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange?.(e.target.checked)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          {...props}
        />
        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
      </span>
    );
  },
);
Checkbox.displayName = "Checkbox";
