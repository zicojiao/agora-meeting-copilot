"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createKanbanCard,
  deleteKanbanCard,
  getRoomState,
  roomEventsUrl,
  updateKanbanCard,
  type CreateKanbanCardInput,
  type KanbanActivity,
  type KanbanCard,
  type RoomSession,
  type RoomState,
  type UpdateKanbanCardInput
} from "@/lib/meeting-api";

export function useRoomBoard(roomId: string, session: RoomSession | null) {
  const [state, setState] = useState<RoomState | null>(null);
  const [loading, setLoading] = useState(Boolean(session));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      setState(await getRoomState(roomId, session.capability));
      setError(null);
    } catch (caught) {
      setError(message(caught));
    } finally {
      setLoading(false);
    }
  }, [roomId, session]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    let lastEventId = 0;
    const consume = async () => {
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(roomEventsUrl(roomId, lastEventId), {
            headers: { authorization: `Bearer ${session.capability}` },
            signal: controller.signal
          });
          if (!response.ok || !response.body) throw new Error(`Board updates returned ${response.status}`);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          while (!controller.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split("\n\n");
            buffer = blocks.pop() ?? "";
            for (const block of blocks) {
              const event = parseSseBlock(block);
              if (!event) continue;
              lastEventId = event.id || lastEventId;
              if (event.type !== "kanban.board.updated") continue;
              setState((current) => current ? {
                ...current,
                kanbanCards: Array.isArray(event.payload.cards) ? event.payload.cards as KanbanCard[] : current.kanbanCards,
                kanbanActivities: Array.isArray(event.payload.activities) ? event.payload.activities as KanbanActivity[] : current.kanbanActivities
              } : current);
            }
          }
        } catch (caught) {
          if (controller.signal.aborted) return;
          setError(message(caught));
          await new Promise((resolve) => window.setTimeout(resolve, 1_500));
        }
      }
    };
    void consume();
    return () => controller.abort();
  }, [roomId, session]);

  const run = useCallback(async (operation: () => Promise<unknown>) => {
    setError(null);
    try { await operation(); }
    catch (caught) { setError(message(caught)); throw caught; }
  }, []);

  return {
    state,
    loading,
    error,
    refresh,
    createCard: (input: CreateKanbanCardInput) => session ? run(() => createKanbanCard(roomId, session.capability, input)) : Promise.reject(new Error("Board session is unavailable")),
    updateCard: (cardId: string, input: UpdateKanbanCardInput) => session ? run(() => updateKanbanCard(roomId, session.capability, cardId, input)) : Promise.reject(new Error("Board session is unavailable")),
    deleteCard: (cardId: string) => session ? run(() => deleteKanbanCard(roomId, session.capability, cardId)) : Promise.reject(new Error("Board session is unavailable"))
  };
}

function parseSseBlock(block: string) {
  if (!block || block.startsWith(":")) return null;
  let id = 0;
  let type = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("id:")) id = Number(line.slice(3).trim()) || 0;
    else if (line.startsWith("event:")) type = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  return { id, type, payload: JSON.parse(data.join("\n")) as Record<string, unknown> };
}

function message(error: unknown) { return error instanceof Error ? error.message : "Board request failed"; }
