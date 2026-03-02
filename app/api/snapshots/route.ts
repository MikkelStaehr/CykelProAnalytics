// Read snapshots from Supabase — not yet implemented
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ error: "Not implemented yet" }, { status: 501 });
}
