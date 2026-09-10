"use client";

import { ArrowRight, KeyRound, LoaderCircle, LockKeyhole, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AccessGate() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlock = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, next: searchParams.get("next") || "/" })
      });
      const result = await response.json().catch(() => ({})) as { error?: string; next?: string };
      if (!response.ok) throw new Error(result.error || "Private preview access is unavailable");
      router.replace(result.next || "/");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Private preview access is unavailable");
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-room px-5 py-10 text-meeting">
      <div className="pointer-events-none absolute inset-0 opacity-80 [background-image:linear-gradient(rgba(0,194,255,.035)_1px,transparent_1px),linear-gradient(90deg,rgba(0,194,255,.035)_1px,transparent_1px)] [background-size:32px_32px]" />
      <div className="pointer-events-none absolute left-1/2 top-1/2 size-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-agora/5 blur-[100px]" />

      <section aria-labelledby="private-preview-title" className="relative w-full max-w-[430px] overflow-hidden rounded-[5px] border border-line-strong bg-panel shadow-[0_28px_90px_rgba(0,0,0,.48)]">
        <div className="flex items-center justify-between border-b border-line bg-room-deep/55 px-5 py-3.5">
          <span className="inline-flex items-center gap-2 font-mono text-[9px] font-semibold uppercase tracking-[0.15em] text-agora">
            <ShieldCheck size={13} />Private preview
          </span>
          <span className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase text-meeting-faint"><i className="size-1.5 rounded-full bg-warning" />Restricted</span>
        </div>

        <div className="p-6 sm:p-7">
          <div className="flex size-11 items-center justify-center rounded-[4px] border border-agora/30 bg-agora/10 text-agora"><LockKeyhole size={20} /></div>
          <p className="mt-5 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-meeting-faint">Agora Meeting Copilot</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-[-0.025em]" id="private-preview-title">Enter the private preview</h1>
          <p className="mt-2 text-sm leading-relaxed text-meeting-muted">This unreleased build is restricted to the project team. Enter the shared password to continue.</p>

          <form className="mt-6" onSubmit={unlock}>
            <label className="text-xs font-semibold text-meeting-soft" htmlFor="access-password">Access password</label>
            <div className="relative mt-2">
              <KeyRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-meeting-faint" size={15} />
              <Input
                aria-describedby={error ? "access-error" : undefined}
                aria-invalid={Boolean(error)}
                autoComplete="current-password"
                autoFocus
                className="h-11 pl-9"
                disabled={submitting}
                id="access-password"
                onChange={(event) => { setPassword(event.target.value); if (error) setError(null); }}
                placeholder="Enter password"
                type="password"
                value={password}
              />
            </div>
            {error ? <p className="mt-2.5 text-xs text-danger" id="access-error" role="alert">{error}</p> : null}
            <Button className="mt-4" disabled={!password || submitting} fullWidth size="lg" type="submit" variant="primary">
              {submitting ? <LoaderCircle className="animate-spin" size={16} /> : <ArrowRight size={16} />}
              {submitting ? "Checking access…" : "Unlock preview"}
            </Button>
          </form>
        </div>

        <div className="border-t border-line bg-room-deep/35 px-6 py-3 font-mono text-[9px] leading-relaxed text-meeting-faint">Access lasts for this browser session only.</div>
      </section>
    </main>
  );
}
