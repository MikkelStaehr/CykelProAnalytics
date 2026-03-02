import { NextRequest, NextResponse } from "next/server";
import { runScript } from "@/lib/runScript";
import type { SnapshotType } from "@/lib/types";

// Python scripts can take up to 60s (login + 874 upserts)
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  let body: { race?: string; snapshot?: string; gameId?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { race, snapshot, gameId } = body;

  if (!race || typeof race !== "string") {
    return NextResponse.json({ error: "Missing required field: race" }, { status: 400 });
  }
  if (snapshot !== "before" && snapshot !== "after") {
    return NextResponse.json(
      { error: "snapshot must be 'before' or 'after'" },
      { status: 400 }
    );
  }

  const args = ["--race", race, "--snapshot", snapshot as SnapshotType];
  if (gameId) args.push("--game-id", String(gameId));

  const result = await runScript("fetch_holdet.py", args);

  if (result.exitCode !== 0) {
    return NextResponse.json(
      {
        error: "Script failed",
        stderr: result.stderr,
        stdout: result.stdout,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    stdout: result.stdout,
    result: result.parsed,
  });
}
