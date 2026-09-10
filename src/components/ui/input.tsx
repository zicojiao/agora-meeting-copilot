import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref
) {
  return (
    <input
      className={cn(
        "h-10 w-full min-w-0 rounded-[3px] border border-line bg-room-deep px-3 text-sm text-meeting outline-none placeholder:text-meeting-faint focus:border-agora/75 focus:ring-2 focus:ring-agora/15 disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-danger",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});
