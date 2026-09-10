import { NextResponse } from "next/server";

const artifacts = {
  "transcript.md": { contentType: "text/markdown; charset=utf-8", filename: "meeting-transcript.md" },
  "notes.md": { contentType: "text/markdown; charset=utf-8", filename: "meeting-notes.md" },
  "all.zip": { contentType: "application/zip", filename: "meeting-artifacts.zip" }
} as const;

const orchestratorUrl = (process.env.ORCHESTRATOR_URL || process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "http://localhost:8787").replace(/\/$/, "");

export async function GET(_request: Request, context: { params: Promise<{ roomId: string; kind: string }> }) {
  const { roomId, kind } = await context.params;
  if (!(kind in artifacts)) return NextResponse.json({ error: "Meeting artifact not found" }, { status: 404 });

  const artifact = artifacts[kind as keyof typeof artifacts];
  const upstream = await fetch(`${orchestratorUrl}/rooms/${encodeURIComponent(roomId)}/artifacts/${kind}`, { cache: "no-store" });
  if (!upstream.ok) {
    const message = await upstream.text().catch(() => "");
    return NextResponse.json({ error: message || "Meeting artifact is not available" }, { status: upstream.status });
  }

  const headers = new Headers({
    "cache-control": "private, no-store",
    "content-disposition": upstream.headers.get("content-disposition") || `attachment; filename="${artifact.filename}"`,
    "content-type": upstream.headers.get("content-type") || artifact.contentType,
    "x-content-type-options": "nosniff"
  });
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers.set("content-length", contentLength);

  return new NextResponse(upstream.body, { status: 200, headers });
}
