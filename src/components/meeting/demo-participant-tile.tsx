"use client";

import Image from "next/image";
import { Mic, MicOff } from "lucide-react";
import { cn } from "@/lib/utils";

export type DemoParticipant = {
  id: string;
  name: string;
  image: string;
  muted?: boolean;
};

export function DemoParticipantTile({ active, participant }: { active: boolean; participant: DemoParticipant }) {
  return (
    <article
      className={cn(
        "participant-tile relative min-h-0 min-w-0 overflow-hidden rounded-[4px] border border-white/10 bg-tile transition-[border-color,box-shadow] duration-200",
        active && "is-speaking border-agora/80 shadow-[0_0_0_1px_rgba(0,194,255,0.35),0_0_24px_rgba(0,194,255,0.12)]"
      )}
      data-demo-participant={participant.id}
    >
      <Image
        alt={`${participant.name} in a video meeting`}
        className="object-cover"
        fill
        priority
        sizes="(max-width: 700px) 100vw, (max-width: 1100px) 50vw, 28vw"
        src={participant.image}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_58%,rgba(4,8,10,0.4)_100%)]" />
      <div className="participant-label absolute inset-x-2 bottom-2 flex min-h-7 items-center justify-between gap-3 rounded-[3px] bg-room/80 px-2.5 text-[11px] backdrop-blur">
        <span className="truncate">{participant.name}</span>
        <span className={participant.muted ? "text-meeting-muted" : "text-presence"} aria-label={participant.muted ? "Muted" : "Microphone on"}>
          {participant.muted ? <MicOff size={15} /> : <Mic size={15} />}
        </span>
      </div>
    </article>
  );
}
