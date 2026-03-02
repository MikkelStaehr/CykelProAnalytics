import { NextRequest, NextResponse } from "next/server";
import { runScript } from "@/lib/runScript";

// PCS scraping + Supabase upsert can take up to 30s
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: { race?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { race } = body;

  if (!race || typeof race !== "string") {
    return NextResponse.json({ error: "Missing required field: race" }, { status: 400 });
  }

  const result = await runScript("parse_pcs.py", ["--race", race]);

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
