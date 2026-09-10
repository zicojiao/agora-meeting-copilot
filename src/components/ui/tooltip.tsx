import type { ReactNode } from "react";

export function Tooltip({ children, label }: { children: ReactNode; label: string }) {
  return (
    <span className="group/tooltip relative inline-flex">
      {children}
      <span
        className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-90 hidden -translate-x-1/2 whitespace-nowrap rounded-[3px] border border-line bg-room-deep px-2 py-1 text-[10px] text-meeting-soft shadow-lg group-hover/tooltip:block group-focus-within/tooltip:block"
        role="tooltip"
      >
        {label}
      </span>
    </span>
  );
}
