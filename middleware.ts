import { NextRequest, NextResponse } from "next/server";
import { DEMO_ACCESS_COOKIE, getDemoAccessConfig, safeDemoNextPath } from "@/lib/demo-access";

const publicFiles = new Set([
  "/favicon.ico",
  "/favicon-16x16.png",
  "/favicon-32x32.png",
  "/apple-touch-icon.png",
  "/android-chrome-192x192.png",
  "/android-chrome-512x512.png",
  "/agora-logo-mark.svg"
]);

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/_next/") || publicFiles.has(pathname) || pathname === "/api/access") {
    return NextResponse.next();
  }

  const config = getDemoAccessConfig();
  if (!config.enabled) return NextResponse.next();

  const authenticated = config.ready && request.cookies.get(DEMO_ACCESS_COOKIE)?.value === config.token;
  if (pathname === "/access") {
    if (!authenticated) return NextResponse.next();
    return NextResponse.redirect(new URL(safeDemoNextPath(request.nextUrl.searchParams.get("next")), request.url));
  }
  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Private preview access is required" }, { status: 401 });
  }

  const accessUrl = new URL("/access", request.url);
  accessUrl.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(accessUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"]
};
