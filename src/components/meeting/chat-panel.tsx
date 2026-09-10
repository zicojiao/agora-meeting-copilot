"use client";

import { MessageSquare, Send } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { MeetingChatMessage } from "@/hooks/use-meeting-social";
import { cn } from "@/lib/utils";

export function ChatPanel({ messages, onSend }: { messages: MeetingChatMessage[]; onSend: (text: string) => Promise<void> }) {
  const [value, setValue] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = value.trim();
    if (!text) return;
    setValue("");
    try {
      await onSend(text);
    } catch {
      toast.error("Message not sent", { description: "Chat is reconnecting. Try again in a moment.", id: "meeting-chat-error" });
    }
  };

  return (
    <div className="flex size-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" ref={listRef}>
        {!messages.length ? (
          <div className="flex min-h-full flex-col items-center justify-center px-8 text-center text-meeting-muted">
            <MessageSquare className="mb-3 text-agora" size={22} />
            <strong className="text-sm text-meeting-soft">Start the conversation</strong>
            <p className="mt-1.5 text-xs leading-relaxed">Messages are visible to people in this room and disappear when the meeting ends.</p>
          </div>
        ) : (
          <div aria-live="polite" className="grid gap-3 p-4">
            {messages.map((message) => (
              <article className={cn("max-w-[90%]", message.self && "ml-auto text-right")} key={message.id}>
                <div className={cn("mb-1 flex items-center gap-2 text-[10px] text-meeting-muted", message.self && "justify-end")}>
                  <strong className="text-meeting-soft">{message.self ? "You" : message.senderName}</strong>
                  <time className="font-mono text-[9px]">{formatTime(message.sentAt)}</time>
                </div>
                <p className={cn(
                  "inline-block rounded-[4px] border border-line bg-panel-raised px-3 py-2 text-left text-[13px] leading-relaxed text-meeting-soft",
                  message.self && "border-agora/30 bg-agora/10",
                  message.status === "failed" && "border-danger/40 text-danger"
                )}>{message.text}</p>
                {message.status !== "sent" ? <div className={cn("mt-1 text-[9px]", message.status === "failed" ? "text-danger" : "text-meeting-faint")}>{message.status === "failed" ? "Not sent" : "Sending…"}</div> : null}
              </article>
            ))}
          </div>
        )}
      </div>
      <form className="flex items-end gap-2 border-t border-line p-3" onSubmit={submit}>
        <label className="sr-only" htmlFor="meeting-chat-message">Send a message</label>
        <textarea
          className="max-h-28 min-h-10 min-w-0 flex-1 resize-none rounded-[3px] border border-line-strong bg-room-deep px-3 py-2.5 text-[13px] text-meeting outline-none placeholder:text-meeting-faint focus:border-agora/60 focus:ring-2 focus:ring-agora/20"
          id="meeting-chat-message"
          maxLength={500}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Message everyone"
          rows={1}
          value={value}
        />
        <Button aria-label="Send message" disabled={!value.trim()} size="icon" title="Send message" type="submit" variant="primary"><Send size={17} /></Button>
      </form>
    </div>
  );
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
