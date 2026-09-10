import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { DEMO_ACCESS_COOKIE, getDemoAccessConfig, safeDemoNextPath } from "@/lib/demo-access";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const config = getDemoAccessConfig();
  if (!config.ready) {
    return NextResponse.json({ error: "Private preview access is temporarily unavailable" }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as { password?: unknown; next?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!safeEqual(password, config.password)) {
    return NextResponse.json({ error: "Incorrect access password" }, { status: 401 });
  }

  const next = safeDemoNextPath(body?.next);
  const response = NextResponse.json({ ok: true, next });
  response.cookies.set(DEMO_ACCESS_COOKIE, config.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  });
  return response;
}

function safeEqual(actual: string, expected: string) {
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
