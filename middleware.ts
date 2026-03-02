import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Paths that are always public (no auth required)
const PUBLIC_PREFIXES = ["/login", "/api/auth/login"];

async function computeExpectedToken(secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`cykelproanalytics:${secret}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow login page and login API through
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const toLogin = NextResponse.redirect(new URL("/login", request.url));

  // AUTH_SECRET must be configured — without it we cannot verify tokens
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return toLogin;
  }

  // Verify auth_token cookie value matches the server-computed token
  const token = request.cookies.get("auth_token")?.value;
  if (!token) {
    return toLogin;
  }

  try {
    const expected = await computeExpectedToken(secret);
    if (token === expected) {
      return NextResponse.next();
    }
  } catch {
    // crypto failure — deny access
  }

  return toLogin;
}

export const config = {
  // Match all paths except Next.js internals and static files
  matcher: ["/((?!_next/|favicon\\.ico).*)"],
};
