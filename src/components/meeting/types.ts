import type { RoomSession } from "@/lib/meeting-api";

export type AppStep = "home" | "prejoin" | "room";

export type JoinConfig = {
  roomId: string;
  displayName: string;
  micOn: boolean;
  cameraOn: boolean;
  hostSecret?: string;
  session?: RoomSession;
};

export type MeetingPanel = "transcript" | "notes" | "board" | "chat" | "people" | null;
