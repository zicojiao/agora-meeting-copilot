import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function DialogBackdrop({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("fixed inset-0 z-80 flex items-center justify-center bg-black/75 p-5 max-sm:items-end max-sm:p-0", className)}
      {...props}
    />
  );
}

export function DialogSurface({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        "w-full max-w-[460px] rounded-[4px] border border-line-strong bg-panel p-6 shadow-2xl max-sm:rounded-b-none max-sm:border-x-0 max-sm:border-b-0 max-sm:px-5 max-sm:pb-[calc(20px+env(safe-area-inset-bottom))]",
        className
      )}
      {...props}
    />
  );
}
