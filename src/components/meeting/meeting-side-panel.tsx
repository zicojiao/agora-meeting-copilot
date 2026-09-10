"use client";

import { Captions, Columns3, MessageSquare, NotebookTabs, UsersRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MeetingPanel } from "./types";

const tabs: Array<{ id: Exclude<MeetingPanel, null>; label: string; icon: React.ReactNode }> = [
  { id: "transcript", label: "Transcript", icon: <Captions size={15} /> },
  { id: "notes", label: "Notes", icon: <NotebookTabs size={15} /> },
  { id: "board", label: "Board", icon: <Columns3 size={15} /> },
  { id: "chat", label: "Chat", icon: <MessageSquare size={15} /> },
  { id: "people", label: "People", icon: <UsersRound size={15} /> }
];

export function MeetingSidePanel({ activePanel, children, onClose, onSelect, wide = false }: {
  activePanel: Exclude<MeetingPanel, null>;
  children: React.ReactNode;
  onClose: () => void;
  onSelect: (panel: Exclude<MeetingPanel, null>) => void;
  wide?: boolean;
}) {
  const active = tabs.find((tab) => tab.id === activePanel)!;
  return (
    <aside
      aria-label={`${active.label} panel`}
      className={cn(
        "meeting-side-panel flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-line bg-panel max-[1100px]:absolute max-[1100px]:bottom-2.5 max-[1100px]:right-2.5 max-[1100px]:top-2.5 max-[1100px]:z-30 max-[1100px]:rounded-[4px] max-[1100px]:border max-[1100px]:shadow-2xl max-sm:inset-0 max-sm:w-full max-sm:rounded-none max-sm:border-0",
        wide ? "max-[1100px]:w-[min(640px,calc(100%-20px))]" : "max-[1100px]:w-[360px]"
      )}
    >
      <header className="flex min-h-14 items-center gap-2 border-b border-line px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 rounded-[5px] bg-room-deep/55 p-1" role="tablist" aria-label="Meeting information">
          {tabs.map((tab) => (
            <button
              aria-selected={tab.id === activePanel}
              className={cn(
                "relative flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-[4px] px-1 text-[10px] font-semibold text-meeting-muted transition-colors hover:bg-panel-raised hover:text-meeting",
                tab.id === activePanel ? "flex-[1.45] bg-panel-raised text-meeting shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]" : "flex-1"
              )}
              key={tab.id}
              onClick={() => onSelect(tab.id)}
              role="tab"
              type="button"
            >
              <span className={cn("shrink-0", tab.id === activePanel && "text-agora")}>{tab.icon}</span>
              <span className="truncate whitespace-nowrap max-[370px]:hidden">{tab.label}</span>
              {tab.id === activePanel ? <i className="absolute inset-x-2 -bottom-1 h-0.5 rounded-full bg-agora" aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
        <Button aria-label={`Close ${active.label} panel`} className="size-9 rounded-full border-0 p-0" onClick={onClose} title="Close panel" variant="ghost"><X size={17} /></Button>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </aside>
  );
}
