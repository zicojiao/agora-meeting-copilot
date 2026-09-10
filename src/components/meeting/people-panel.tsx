"use client";

import type { IAgoraRTCRemoteUser } from "agora-rtc-sdk-ng";
import { Bot, Mic, MicOff, Search, UserRound } from "lucide-react";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import type { AgentStatus } from "@/lib/meeting-api";
import type { ParticipantProfile } from "@/lib/participant-profile";
import { copilotName } from "@/lib/product";
import { cn } from "@/lib/utils";

export function PeoplePanel({ aiStatus, displayName, isHost, localMuted, participantProfiles, remoteUsers }: {
  aiStatus: AgentStatus;
  displayName: string;
  isHost: boolean;
  localMuted: boolean;
  participantProfiles: Record<string, ParticipantProfile>;
  remoteUsers: IAgoraRTCRemoteUser[];
}) {
  const [query, setQuery] = useState("");
  const aiPresent = aiStatus !== "offline" && aiStatus !== "error";
  const people = useMemo(() => [
    { id: "local", icon: <UserRound />, muted: localMuted, name: `${displayName} (You)`, note: isHost ? "Host" : "Participant" },
    ...remoteUsers.map((user) => {
      const profile = participantProfiles[String(user.uid)];
      return { id: String(user.uid), icon: <UserRound />, muted: !user.hasAudio, name: profile?.displayName ?? "Joining...", note: profile?.role === "host" ? "Host" : "Participant" };
    }),
    ...(aiPresent ? [{ id: "copilot", icon: <Bot />, muted: aiStatus !== "speaking", name: copilotName, note: "Teammate" }] : [])
  ], [aiPresent, aiStatus, displayName, isHost, localMuted, participantProfiles, remoteUsers]);
  const visiblePeople = people.filter((person) => `${person.name} ${person.note}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="flex size-full min-h-0 flex-col overflow-hidden">
      <label className="people-search relative mx-4 mt-4"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-meeting-muted" size={16} aria-hidden="true" /><Input className="pl-9" aria-label="Search people" onChange={(event) => setQuery(event.target.value)} placeholder="Search people" value={query} /></label>
      <div className="people-count px-4 pb-2 pt-4 text-[10px] font-bold uppercase text-meeting-muted">In the room · {people.length}</div>
      <div className="people-list grid gap-0.5 overflow-y-auto px-2 pb-4">
        {visiblePeople.map((person) => <PersonRow icon={person.icon} key={person.id} muted={person.muted} name={person.name} note={person.note} />)}
        {!visiblePeople.length ? <div className="px-4 py-10 text-center text-xs text-meeting-muted">No matching people</div> : null}
      </div>
    </div>
  );
}

function PersonRow({ icon, muted, name, note }: { icon: React.ReactNode; muted: boolean; name: string; note: string }) {
  return (
    <div className="person-row grid grid-cols-[38px_minmax(0,1fr)_32px] items-center gap-2.5 rounded-[3px] p-2 hover:bg-panel-raised">
      <span className="person-avatar flex size-[38px] items-center justify-center rounded-full bg-panel-hover text-meeting-soft [&_svg]:size-[17px]">{icon}</span>
      <span className="person-copy grid min-w-0 gap-0.5"><strong className="truncate text-[13px]">{name}</strong><small className="text-[11px] capitalize text-meeting-muted">{note}</small></span>
      <span className={cn("person-media flex size-8 items-center justify-center", muted ? "is-muted text-meeting-muted" : "text-presence")} aria-label={muted ? "Muted" : "Microphone on"}>{muted ? <MicOff size={15} /> : <Mic size={15} />}</span>
    </div>
  );
}
