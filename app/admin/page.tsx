import { createServerClient } from "@/lib/supabase";
import AdminClient from "./AdminClient";
import type { Race } from "@/lib/types";

export default async function AdminPage() {
  let races: Race[] = [];

  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("races")
      .select("slug, name, year, pcs_url, holdet_game_id, game_type, budget, profile")
      .order("year", { ascending: true });

    if (error) throw error;
    races = data ?? [];
  } catch (err) {
    console.error("Failed to load races:", err);
  }

  if (races.length === 0) {
    return (
      <main className="px-8 py-9">
        <h1 className="text-2xl font-bold text-gray-100">Admin</h1>
        <p className="mt-4 text-red-400 text-sm">
          Kunne ikke hente løb fra databasen. Tjek at Supabase-miljøvariablerne er sat
          korrekt og at SQL-migreringen er kørt.
        </p>
      </main>
    );
  }

  return <AdminClient races={races} />;
}
