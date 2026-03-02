import { createClient } from "@supabase/supabase-js";
import type { Rider, Snapshot, StartlistEntry, Race } from "./types";

// Database type map used by the Supabase client for type inference.
export interface Database {
  public: {
    Tables: {
      riders: {
        Row: Rider;
        Insert: Omit<Rider, never>;
        Update: Partial<Rider>;
      };
      snapshots: {
        Row: Snapshot;
        Insert: Omit<Snapshot, "id" | "fetched_at">;
        Update: Partial<Omit<Snapshot, "id">>;
      };
      startlists: {
        Row: StartlistEntry;
        Insert: StartlistEntry;
        Update: Partial<StartlistEntry>;
      };
      races: {
        Row: Race;
        Insert: Race;
        Update: Partial<Race>;
      };
    };
  };
}

function getEnvVar(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Server-side client — uses service key, full read/write access.
// Only instantiate inside API routes or server components.
export function createServerClient() {
  return createClient<Database>(
    getEnvVar("SUPABASE_URL"),
    getEnvVar("SUPABASE_SERVICE_KEY")
  );
}

// Client-side client — uses anon key, read-only access enforced by RLS.
// Safe to use in client components.
export function createBrowserClient() {
  return createClient<Database>(
    getEnvVar("NEXT_PUBLIC_SUPABASE_URL"),
    getEnvVar("NEXT_PUBLIC_SUPABASE_ANON_KEY")
  );
}
