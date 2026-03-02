import { createServerClient } from "@/lib/supabase";
import ProfilClient from "./ProfilClient";
import type { Race } from "@/lib/types";

export default async function ProfilPage() {
  let races: Race[] = [];

  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("races")
      .select("slug, name, year, pcs_url, holdet_game_id, profile, distance_km, elevation_m, profile_score")
      .order("year", { ascending: true });

    if (error) throw error;
    races = (data ?? []) as Race[];
  } catch (err) {
    console.error("Failed to load races:", err);
  }

  if (races.length === 0) {
    return (
      <main className="px-6 py-10 max-w-2xl">
        <h1 className="text-2xl font-bold" style={{ color: "var(--c-text)" }}>Løbsprofil</h1>
        <p className="mt-4 text-sm" style={{ color: "var(--c-red)" }}>
          Kunne ikke hente løb fra databasen. Tjek at Supabase-miljøvariablerne er korrekte.
        </p>
      </main>
    );
  }

  return <ProfilClient races={races} />;
}
