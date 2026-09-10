"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RtmClientLike, RtmMessageEvent } from "./use-agora-room";

export type MeetingChatMessage = {
  id: string;
  senderUid: string;
  senderName: string;
  text: string;
  sentAt: string;
  self: boolean;
  status: "sending" | "sent" | "failed";
};

export type MeetingReaction = {
  id: string;
  senderUid: string;
  senderName: string;
  emoji: string;
  count: number;
};

type SocialPayload = {
  type?: string;
  id?: string;
  uid?: string | number;
  name?: string;
  text?: string;
  emoji?: string;
  sentAt?: string;
};

export const meetingReactions = ["❤️", "👍", "🎉", "👏", "😂", "😮", "😢", "🤔", "👎"] as const;

export function useMeetingSocial({
  channel,
  displayName,
  isChatOpen,
  rtmClient,
  uid
}: {
  channel: string;
  displayName: string;
  isChatOpen: boolean;
  rtmClient: RtmClientLike | null;
  uid: number;
}) {
  const [messages, setMessages] = useState<MeetingChatMessage[]>([]);
  const [reactions, setReactions] = useState<MeetingReaction[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const reactionTimers = useRef(new Map<string, number>());
  const seenMessages = useRef(new Set<string>());
  const chatOpenRef = useRef(isChatOpen);
  chatOpenRef.current = isChatOpen;

  useEffect(() => {
    if (isChatOpen) setUnreadCount(0);
  }, [isChatOpen]);

  const showReaction = useCallback((payload: Required<Pick<SocialPayload, "id" | "uid" | "name" | "emoji">>) => {
    const senderUid = String(payload.uid);
    const burstKey = `${senderUid}:${payload.emoji}`;
    setReactions((current) => {
      const existing = current.find((reaction) => `${reaction.senderUid}:${reaction.emoji}` === burstKey);
      const next = existing
        ? current.map((reaction) => reaction === existing ? { ...reaction, id: payload.id, count: reaction.count + 1 } : reaction)
        : [...current, { id: payload.id, senderUid, senderName: payload.name, emoji: payload.emoji, count: 1 }];
      return next.slice(-4);
    });
    const currentTimer = reactionTimers.current.get(burstKey);
    if (currentTimer) window.clearTimeout(currentTimer);
    reactionTimers.current.set(burstKey, window.setTimeout(() => {
      reactionTimers.current.delete(burstKey);
      setReactions((current) => current.filter((reaction) => `${reaction.senderUid}:${reaction.emoji}` !== burstKey));
    }, 3_600));
  }, []);

  useEffect(() => {
    if (!rtmClient) return;
    const onMessage = (incoming: RtmMessageEvent) => {
      try {
        const text = typeof incoming.message === "string" ? incoming.message : new TextDecoder().decode(incoming.message);
        const payload = JSON.parse(text) as SocialPayload;
        if (!payload.id || !payload.uid || !payload.name) return;
        const senderUid = String(payload.uid);
        if (payload.type === "meeting.chat" && payload.text) {
          if (seenMessages.current.has(payload.id)) return;
          seenMessages.current.add(payload.id);
          setMessages((current) => [...current, {
            id: payload.id!,
            senderUid,
            senderName: payload.name!,
            text: payload.text!.slice(0, 500),
            sentAt: payload.sentAt || new Date().toISOString(),
            self: senderUid === String(uid),
            status: "sent" as const
          }].slice(-100));
          if (senderUid !== String(uid) && !chatOpenRef.current) setUnreadCount((count) => Math.min(count + 1, 99));
        }
        if (payload.type === "meeting.reaction" && payload.emoji) {
          if (senderUid === String(uid)) return;
          showReaction({ id: payload.id, uid: senderUid, name: payload.name, emoji: payload.emoji });
        }
      } catch {
        // Other meeting and Copilot RTM payloads are consumed by their own hooks.
      }
    };
    rtmClient.addEventListener("message", onMessage as (event: never) => void);
    return () => rtmClient.removeEventListener("message", onMessage as (event: never) => void);
  }, [rtmClient, showReaction, uid]);

  useEffect(() => () => {
    for (const timer of reactionTimers.current.values()) window.clearTimeout(timer);
    reactionTimers.current.clear();
  }, []);

  const sendMessage = useCallback(async (value: string) => {
    const text = value.trim().slice(0, 500);
    if (!text) return;
    const id = createId();
    const sentAt = new Date().toISOString();
    seenMessages.current.add(id);
    setMessages((current) => [...current, { id, senderUid: String(uid), senderName: displayName, text, sentAt, self: true, status: "sending" as const }].slice(-100));
    if (!rtmClient) {
      setMessages((current) => current.map((message) => message.id === id ? { ...message, status: "failed" } : message));
      throw new Error("Chat is reconnecting. Try again in a moment.");
    }
    try {
      await rtmClient.publish(channel, JSON.stringify({ type: "meeting.chat", id, uid, name: displayName, text, sentAt }));
      setMessages((current) => current.map((message) => message.id === id ? { ...message, status: "sent" } : message));
    } catch (error) {
      setMessages((current) => current.map((message) => message.id === id ? { ...message, status: "failed" } : message));
      throw error;
    }
  }, [channel, displayName, rtmClient, uid]);

  const sendReaction = useCallback(async (emoji: string) => {
    const id = createId();
    showReaction({ id, uid: String(uid), name: displayName, emoji });
    if (!rtmClient) return;
    await rtmClient.publish(channel, JSON.stringify({ type: "meeting.reaction", id, uid, name: displayName, emoji, sentAt: new Date().toISOString() }));
  }, [channel, displayName, rtmClient, showReaction, uid]);

  return { messages, reactions, sendMessage, sendReaction, unreadCount };
}

function createId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
