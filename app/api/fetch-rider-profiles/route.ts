import { NextRequest, NextResponse } from "next/server";
import { runScript } from "@/lib/runScript";

// Scraping 60+ riders at 1.5s each can take up to ~2 min
export const maxDuration = 180;

export async function POST(req: NextRequest) {
  let body: { race?: string; force?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { race, force } = body;

  if (!race || typeof race !== "string") {
    return NextResponse.json({ error: "Missing required field: race" }, { status: 400 });
  }

  const args = ["--race", race];
  if (force) args.push("--force");

  const result = await runScript("fetch_rider_profiles.py", args);

  if (result.exitCode !== 0) {
    return NextResponse.json(
      { error: "Script failed", stderr: result.stderr, stdout: result.stdout },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, stdout: result.stdout, result: result.parsed });
}
