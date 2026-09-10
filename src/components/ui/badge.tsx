import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-[3px] border border-line bg-panel px-2 font-mono text-[10px] font-semibold uppercase text-meeting-muted",
        className
      )}
      {...props}
    />
  );
}
