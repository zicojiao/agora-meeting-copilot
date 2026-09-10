import type { Metadata } from "next";
import { Suspense } from "react";
import { AccessGate } from "@/components/access/access-gate";

export const metadata: Metadata = {
  title: "Private preview · Agora Meeting Copilot"
};

export default function AccessPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-room" />}>
      <AccessGate />
    </Suspense>
  );
}
