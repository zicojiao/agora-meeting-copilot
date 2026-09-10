export const DEMO_ACCESS_COOKIE = "agora-demo-access";

export function getDemoAccessConfig() {
  const password = process.env.DEMO_ACCESS_PASSWORD?.trim() ?? "";
  const token = process.env.DEMO_ACCESS_TOKEN?.trim() ?? "";
  return {
    enabled: Boolean(password || token),
    ready: Boolean(password && token),
    password,
    token
  };
}

export function safeDemoNextPath(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://private-preview.local");
    if (url.origin !== "https://private-preview.local") return "/";
    if (url.pathname === "/access" || url.pathname.startsWith("/api/access")) return "/";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/";
  }
}
