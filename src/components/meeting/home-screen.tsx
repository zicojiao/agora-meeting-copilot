"use client";

import { ArrowRight, Bot, Plus, Radio } from "lucide-react";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { buildRoomCode, isValidRoomCode, normalizeRoomCodeSuffix, roomCodeExample, roomCodePrefix } from "@/lib/room-code";
import { engineLabel } from "@/lib/product";
import { AiTeammateGrid } from "./ai-teammate-grid";
import { Brand } from "./brand";

export function HomeScreen({
  initialRoomId,
  error,
  loading,
  onCreate,
  onJoin
}: {
  initialRoomId: string;
  error: string | null;
  loading: boolean;
  onCreate: () => void;
  onJoin: (roomId: string) => void;
}) {
  const [roomSuffix, setRoomSuffix] = useState(normalizeRoomCodeSuffix(initialRoomId));
  const normalizedRoomId = buildRoomCode(roomSuffix);
  const roomCodeInvalid = roomSuffix.length > 0 && !isValidRoomCode(normalizedRoomId);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isValidRoomCode(normalizedRoomId)) onJoin(normalizedRoomId);
  };

  return (
    <div className="relative grid h-dvh min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden bg-room px-7 max-sm:px-5">
      <AiTeammateGrid />
      <header className="relative z-10 mx-auto flex min-h-[58px] w-full max-w-[1240px] animate-home-enter items-center justify-between border-b border-line">
        <Brand />
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-meeting-soft max-sm:text-[0px]">
          <span className="size-2 rounded-full bg-presence shadow-[0_0_0_4px_rgba(56,211,159,0.12)]" />
          <span>Agora RTC ready</span>
        </div>
      </header>

      <main className="pointer-events-none relative z-10 mx-auto grid min-h-0 w-full max-w-[1240px] grid-cols-[minmax(0,1fr)_390px] items-center gap-20 overflow-hidden py-14 max-[1050px]:gap-10 max-[820px]:grid-cols-1 max-[820px]:justify-items-center max-[820px]:py-10 max-sm:gap-7 max-sm:py-7 [@media(max-height:560px)_and_(orientation:landscape)]:grid-cols-[minmax(0,1fr)_370px] [@media(max-height:560px)_and_(orientation:landscape)]:gap-7 [@media(max-height:560px)_and_(orientation:landscape)]:py-3">
        <section className="max-w-[680px] animate-home-enter [animation-delay:100ms] max-[820px]:max-w-[620px] max-[820px]:text-center [@media(max-height:560px)_and_(orientation:landscape)]:text-left">
          <div className="inline-flex items-center gap-2 font-mono text-[11px] font-bold uppercase text-agora max-[820px]:justify-center [@media(max-height:560px)_and_(orientation:landscape)]:justify-start">
            <Radio size={15} aria-hidden="true" />
            AI teammate for meetings
          </div>
          <h1
            aria-label="Bring an AI teammate that can ask, answer, summarize, and act in every meeting."
            className="mt-5 max-w-[680px] text-[58px] font-semibold leading-[1.02] text-meeting max-[1100px]:text-[50px] max-[820px]:mx-auto max-[820px]:text-[45px] max-sm:mt-4 max-sm:text-[38px] [@media(max-height:560px)_and_(orientation:landscape)]:mt-3 [@media(max-height:560px)_and_(orientation:landscape)]:text-[36px]"
          >
            <span className="block">Bring an AI teammate</span>
            <span className="block">that can <RotatingVerb /></span>
            <span className="block">in every meeting.</span>
          </h1>
          <p className="mt-6 max-w-[570px] text-[17px] leading-relaxed text-meeting-soft max-[820px]:mx-auto max-sm:mt-4 max-sm:text-[15px] [@media(max-height:560px)_and_(orientation:landscape)]:mt-3 [@media(max-height:560px)_and_(orientation:landscape)]:text-sm">
            Real-time collaboration powered by Agora and OpenAI GPT Live.
          </p>
        </section>

        <Panel className="pointer-events-auto w-full animate-home-enter bg-panel/95 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.42)] backdrop-blur-md [animation-delay:180ms] max-[820px]:max-w-[470px] max-sm:p-4 [@media(max-height:560px)_and_(orientation:landscape)]:p-4" aria-label="Start or join a meeting">
          <div className="mb-4 flex items-center justify-between font-mono text-[9px] font-semibold uppercase text-meeting-muted">
            <span>Meeting lobby</span>
            <span className="inline-flex items-center gap-1.5 text-meeting-soft"><i className="size-1.5 rounded-full bg-presence" />Ready</span>
          </div>
          <Button disabled={loading} fullWidth onClick={onCreate} size="lg" variant="primary">
            <Plus size={20} aria-hidden="true" />
            {loading ? "Creating meeting..." : "Start meeting"}
          </Button>

          <div className="my-5 flex items-center gap-3 text-[10px] uppercase text-meeting-faint before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line [@media(max-height:560px)_and_(orientation:landscape)]:my-3"><span>or join with a room code</span></div>

          <form onSubmit={submit}>
            <label className="grid gap-2 text-xs font-semibold text-meeting-soft" htmlFor="room-code">Room code</label>
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_40px] gap-2">
              <div className="flex h-10 min-w-0 items-center rounded-[3px] border border-line bg-room-deep px-3 text-sm outline-none focus-within:border-agora/75 focus-within:ring-2 focus-within:ring-agora/15 has-[:invalid]:border-danger">
                <Radio className="mr-2 shrink-0 text-meeting-muted" size={16} aria-hidden="true" />
                <span className="select-none font-mono text-meeting-soft" aria-hidden="true">{roomCodePrefix}</span>
                <input
                  aria-describedby={roomCodeInvalid ? "room-code-error" : undefined}
                  aria-invalid={roomCodeInvalid}
                  className="h-full min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-meeting outline-none placeholder:text-meeting-faint"
                  id="room-code"
                  onChange={(event) => setRoomSuffix(normalizeRoomCodeSuffix(event.target.value))}
                  placeholder={roomCodeExample}
                  spellCheck={false}
                  value={roomSuffix}
                />
              </div>
              <Button aria-label="Join room" disabled={!isValidRoomCode(normalizedRoomId)} size="icon" type="submit" variant="active">
                <ArrowRight size={19} aria-hidden="true" />
              </Button>
            </div>
            {roomCodeInvalid ? <p className="mt-2 text-xs text-danger" id="room-code-error" role="alert">Use 3–32 letters, numbers, or hyphens.</p> : null}
          </form>

          <div className="mt-5 border-t border-line pt-4 text-[11px] text-meeting-muted [@media(max-height:560px)_and_(orientation:landscape)]:hidden">
            <span className="flex items-center gap-2"><Bot className="text-agora" size={15} />AI joins your meeting as a teammate.</span>
          </div>
          {error ? <p className="mt-3 text-xs text-danger" role="alert">{error}</p> : null}
        </Panel>
      </main>

      <footer className="relative z-10 mx-auto flex min-h-14 w-full max-w-[1240px] animate-home-enter items-center justify-between border-t border-line text-[11px] text-meeting-faint [animation-delay:260ms] max-sm:grid max-sm:justify-center max-sm:gap-0.5 max-sm:text-center">
        <span>Realtime media by Agora</span>
        <span>{engineLabel}</span>
      </footer>
    </div>
  );
}

const rotatingVerbs = [
  { word: "ask", delay: "[animation-delay:-0.2s]" },
  { word: "answer", delay: "[animation-delay:1.8s]" },
  { word: "summarize", delay: "[animation-delay:3.8s]" },
  { word: "act", delay: "[animation-delay:5.8s]" }
] as const;

function RotatingVerb() {
  return (
    <span className="relative inline-grid min-w-[9.2ch] overflow-hidden align-baseline text-agora" aria-hidden="true" data-testid="rotating-verb">
      {rotatingVerbs.map(({ word, delay }) => (
        <span
          className={`col-start-1 row-start-1 animate-verb-cycle opacity-0 ${delay} motion-reduce:animate-none motion-reduce:opacity-0 last:motion-reduce:opacity-100`}
          data-word={word}
          key={word}
        >
          {word}
        </span>
      ))}
    </span>
  );
}
