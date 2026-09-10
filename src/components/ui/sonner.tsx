"use client";

import type { CSSProperties } from "react";
import { CircleCheck, Info, LoaderCircle, OctagonX, TriangleAlert } from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      containerAriaLabel="Meeting notifications"
      duration={4_500}
      expand={false}
      gap={8}
      icons={{
        error: <OctagonX className="size-4" />,
        info: <Info className="size-4" />,
        loading: <LoaderCircle className="size-4 animate-spin" />,
        success: <CircleCheck className="size-4" />,
        warning: <TriangleAlert className="size-4" />
      }}
      mobileOffset={{ left: 12, right: 12, top: 58 }}
      offset={{ top: 66 }}
      position="top-center"
      theme="dark"
      toastOptions={{
        classNames: {
          actionButton: "!rounded-[2px] !bg-agora !text-[#04151b]",
          content: "!gap-0.5",
          description: "!text-[11px] !leading-relaxed !text-meeting-muted",
          error: "!border-danger/45",
          icon: "!text-current",
          success: "!border-presence/45",
          title: "!text-xs !font-semibold",
          toast: "!gap-3 !rounded-[3px] !border !px-3 !py-2.5 !font-sans !shadow-2xl",
          warning: "!border-warning/45"
        }
      }}
      visibleToasts={2}
      style={{
        "--border-radius": "3px",
        "--normal-bg": "var(--color-panel-raised)",
        "--normal-border": "var(--color-line-strong)",
        "--normal-text": "var(--color-meeting)"
      } as CSSProperties}
      {...props}
    />
  );
}
