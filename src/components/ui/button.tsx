import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-[3px] border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agora/45 focus-visible:ring-offset-2 focus-visible:ring-offset-room disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        primary: "border-agora bg-agora text-[#04151b] hover:bg-[#36cff7]",
        secondary: "border-line-strong bg-panel-raised text-meeting hover:bg-panel-hover",
        ghost: "border-transparent bg-transparent text-meeting-soft hover:bg-panel-raised hover:text-meeting",
        danger: "border-danger bg-danger text-white hover:bg-[#ff6c6c]",
        active: "border-agora/70 bg-agora/15 text-agora hover:bg-agora/20"
      },
      size: {
        sm: "h-9 px-3 text-xs",
        md: "h-10 px-4",
        lg: "h-11 px-5",
        icon: "size-10 p-0",
        "icon-sm": "size-9 p-0"
      },
      fullWidth: {
        true: "w-full"
      }
    },
    defaultVariants: {
      variant: "secondary",
      size: "md"
    }
  }
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, fullWidth, size, type = "button", variant, ...props },
  ref
) {
  return (
    <button
      className={cn(buttonVariants({ className, fullWidth, size, variant }))}
      ref={ref}
      type={type}
      {...props}
    />
  );
});
