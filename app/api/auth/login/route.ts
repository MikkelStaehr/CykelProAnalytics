import { NextResponse } from "next/server";

async function computeToken(): Promise<string> {
  const secret = process.env.AUTH_SECRET ?? "";
  const encoder = new TextEncoder();
  const data = encoder.encode(`cykelproanalytics:${secret}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function POST(request: Request) {
  let password: string;
  try {
    const body = await request.json();
    password = body.password ?? "";
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const expectedPassword = process.env.AUTH_PASSWORD ?? "";
  if (!expectedPassword) {
    return NextResponse.json(
      { error: "Server misconfiguration: AUTH_PASSWORD not set" },
      { status: 500 }
    );
  }

  if (password !== expectedPassword) {
    return NextResponse.json({ error: "Forkert adgangskode" }, { status: 401 });
  }

  const token = await computeToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set("auth_token", token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
