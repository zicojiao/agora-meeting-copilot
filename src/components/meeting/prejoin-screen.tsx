"use client";

import { ArrowLeft, Camera, CameraOff, Mic, MicOff, Radio, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMediaPreview } from "@/hooks/use-media-preview";
import { isValidRoomCode } from "@/lib/room-code";
import { cn } from "@/lib/utils";
import { Brand } from "./brand";
import type { JoinConfig } from "./types";

export function PrejoinScreen({
  value,
  error,
  loading,
  onBack,
  onChange,
  onJoin
}: {
  value: JoinConfig;
  error: string | null;
  loading: boolean;
  onBack: () => void;
  onChange: (value: JoinConfig) => void;
  onJoin: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { stream, error: mediaError } = useMediaPreview({ cameraOn: value.cameraOn, micOn: value.micOn });
  const roomCodeInvalid = value.roomId.trim().length > 0 && !isValidRoomCode(value.roomId);
  const canJoin = isValidRoomCode(value.roomId) && value.displayName.trim().length > 0;

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = stream;
    if (stream) void videoRef.current.play().catch(() => undefined);
  }, [stream]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (canJoin) onJoin();
  };

  return (
    <div className="relative grid h-dvh min-h-0 grid-rows-[58px_minmax(0,1fr)] overflow-hidden bg-room text-meeting">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-80 [background-image:linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] [background-size:48px_48px] max-sm:opacity-45"
        data-testid="prejoin-grid"
      />
      <header className="relative z-10 grid grid-cols-[1fr_auto_1fr] items-center border-b border-line bg-room/90 px-7 backdrop-blur-sm max-sm:px-4">
        <Button className="justify-self-start px-2 max-sm:size-9 max-sm:p-0" onClick={onBack} size="sm" variant="ghost">
          <ArrowLeft size={18} aria-hidden="true" />
          <span className="max-sm:hidden">Back to home</span>
        </Button>
        <Brand className="justify-self-center" compact hideCopyOnMobile />
        <span aria-hidden="true" />
      </header>

      <main className="relative z-10 flex min-h-0 items-center justify-center overflow-y-auto px-7 py-8 max-[880px]:items-start max-[880px]:py-6 max-sm:px-4 max-sm:py-5 [@media(max-height:560px)_and_(orientation:landscape)]:items-center [@media(max-height:560px)_and_(orientation:landscape)]:px-4 [@media(max-height:560px)_and_(orientation:landscape)]:py-3">
        <div className="grid w-full max-w-[1120px] grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)] items-center gap-12 max-[1040px]:gap-8 max-[880px]:mx-auto max-[880px]:max-w-[720px] max-[880px]:grid-cols-1 max-[880px]:gap-6 [@media(max-height:560px)_and_(orientation:landscape)]:max-w-[980px] [@media(max-height:560px)_and_(orientation:landscape)]:grid-cols-[minmax(0,1.4fr)_minmax(270px,0.8fr)] [@media(max-height:560px)_and_(orientation:landscape)]:gap-5" data-testid="prejoin-stage">
        <section className="min-w-0" aria-label="Camera preview">
          <div className="preview-frame relative aspect-video overflow-hidden rounded-[4px] border border-line-strong bg-tile-deep">
            {value.cameraOn && stream ? (
              <video className="absolute inset-0 size-full object-cover" aria-label="Your camera preview" autoPlay muted playsInline ref={videoRef} />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-meeting-muted">
                <span className="flex size-20 items-center justify-center rounded-full bg-panel-hover text-2xl font-bold text-meeting-soft max-sm:size-16 max-sm:text-xl">{initials(value.displayName)}</span>
                <p className="text-xs">{value.cameraOn ? "Starting camera..." : "Camera is off"}</p>
              </div>
            )}
            <div className="absolute bottom-3 left-3 rounded-[3px] bg-room/80 px-2.5 py-1.5 text-xs font-semibold backdrop-blur">{value.displayName || "You"}</div>
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2" role="toolbar" aria-label="Preview controls">
              <Button
                aria-label={value.micOn ? "Turn microphone off" : "Turn microphone on"}
                aria-pressed={value.micOn}
                className={cn(
                  "size-12 rounded-full backdrop-blur transition duration-150 hover:-translate-y-0.5 max-sm:size-11",
                  value.micOn
                    ? "border-line-strong bg-room/85 text-meeting hover:bg-panel-hover"
                    : "border-danger bg-danger text-white shadow-[0_0_0_3px_rgba(239,91,91,0.16),0_8px_24px_rgba(239,91,91,0.22)] hover:bg-[#ff6969]"
                )}
                onClick={() => onChange({ ...value, micOn: !value.micOn })}
                size="icon"
                title={value.micOn ? "Turn microphone off" : "Turn microphone on"}
                variant={value.micOn ? "secondary" : "danger"}
              >
                {value.micOn ? <Mic size={20} /> : <MicOff size={20} />}
              </Button>
              <Button
                aria-label={value.cameraOn ? "Turn camera off" : "Turn camera on"}
                aria-pressed={value.cameraOn}
                className={cn(
                  "size-12 rounded-full backdrop-blur transition duration-150 hover:-translate-y-0.5 max-sm:size-11",
                  value.cameraOn
                    ? "border-line-strong bg-room/85 text-meeting hover:bg-panel-hover"
                    : "border-danger bg-danger text-white shadow-[0_0_0_3px_rgba(239,91,91,0.16),0_8px_24px_rgba(239,91,91,0.22)] hover:bg-[#ff6969]"
                )}
                onClick={() => onChange({ ...value, cameraOn: !value.cameraOn })}
                size="icon"
                title={value.cameraOn ? "Turn camera off" : "Turn camera on"}
                variant={value.cameraOn ? "secondary" : "danger"}
              >
                {value.cameraOn ? <Camera size={20} /> : <CameraOff size={20} />}
              </Button>
            </div>
          </div>
          {mediaError ? <p className="mt-2 text-xs text-warning">Camera preview unavailable. You can still join with media off.</p> : null}
        </section>

        <form className="grid content-start rounded-[4px] border border-line bg-panel/80 p-7 shadow-[0_20px_60px_rgba(0,0,0,0.28)] backdrop-blur-sm max-[880px]:mx-auto max-[880px]:w-full max-[880px]:max-w-[620px] max-sm:p-5 [@media(max-height:560px)_and_(orientation:landscape)]:p-4" onSubmit={submit}>
          <div className="mb-5 border-b border-line pb-4 [@media(max-height:560px)_and_(orientation:landscape)]:mb-3 [@media(max-height:560px)_and_(orientation:landscape)]:pb-3">
            <span className="inline-flex items-center gap-2 font-mono text-[10px] font-bold uppercase text-agora"><Radio size={15} />Agora meeting</span>
            <strong className="mt-2 block truncate font-mono text-sm text-meeting">{value.roomId}</strong>
          </div>
          <div>
            <h1 className="text-[30px] font-semibold leading-tight [@media(max-height:560px)_and_(orientation:landscape)]:text-2xl">Join the meeting</h1>
            <p className="mt-2 text-sm leading-relaxed text-meeting-muted [@media(max-height:560px)_and_(orientation:landscape)]:hidden">Check your name, camera, and microphone before entering the Agora room.</p>
          </div>
          <label className="mt-5 grid gap-2 text-xs font-semibold text-meeting-soft [@media(max-height:560px)_and_(orientation:landscape)]:mt-3" htmlFor="display-name">
            Your name
            <Input
              autoComplete="name"
              autoFocus
              id="display-name"
              maxLength={60}
              onChange={(event) => onChange({ ...value, displayName: event.target.value })}
              placeholder="Your name"
              required
              value={value.displayName}
            />
          </label>
          {roomCodeInvalid ? <p className="mt-2 text-xs text-danger" role="alert">This meeting link has an invalid room code.</p> : null}
          <Button className="mt-5 [@media(max-height:560px)_and_(orientation:landscape)]:mt-3" disabled={!canJoin || loading} fullWidth size="lg" type="submit" variant="primary">
            {loading ? "Joining..." : "Join meeting"}
          </Button>
          {error ? <p className="mt-3 text-xs text-danger" role="alert">{error}</p> : null}
          <div className="mt-4 flex items-center gap-2 text-xs text-meeting-muted [@media(max-height:560px)_and_(orientation:landscape)]:hidden">
            <ShieldCheck className="text-presence" size={16} aria-hidden="true" />
            Camera and microphone stay in the Agora room.
          </div>
        </form>
        </div>
      </main>
    </div>
  );
}

function initials(name: string) {
  const value = name.trim() || "You";
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
