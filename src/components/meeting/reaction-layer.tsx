import type { MeetingReaction } from "@/hooks/use-meeting-social";

export function ReactionLayer({ reactions }: { reactions: MeetingReaction[] }) {
  if (!reactions.length) return null;
  return (
    <div aria-label="Meeting reactions" aria-live="polite" className="pointer-events-none absolute bottom-5 left-4 z-30 grid max-w-[min(320px,70vw)] gap-1.5 max-sm:bottom-3 max-sm:left-2">
      {reactions.map((reaction) => (
        <div className="animate-reaction-in flex w-fit max-w-full items-center gap-2 rounded-full border border-white/15 bg-room/90 px-3 py-2 text-xs text-meeting shadow-2xl backdrop-blur" key={`${reaction.senderUid}-${reaction.emoji}`}>
          <span className="truncate font-semibold">{reaction.senderName}</span>
          <span className="text-lg leading-none" aria-hidden="true">{reaction.emoji}</span>
          {reaction.count > 1 ? <span className="font-mono text-[10px] text-meeting-soft">×{reaction.count}</span> : null}
        </div>
      ))}
    </div>
  );
}
