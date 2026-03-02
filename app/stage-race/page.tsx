import { createServerClient } from "@/lib/supabase";
import StageRaceClient from "./StageRaceClient";
import type { Race } from "@/lib/types";

export default async function StageRacePage() {
  const supabase = createServerClient();

  const { data: races, error } = await supabase
    .from("races")
    .select("slug, name, year, profile, budget, game_type, distance_km, elevation_m")
    .eq("game_type", "stage_race")
    .order("name");

  if (error) {
    return (
      <div className="px-8 py-9 text-sm" style={{ color: "var(--c-red)" }}>
        Databasefejl: {error.message}
      </div>
    );
  }

  if (!races || races.length === 0) {
    return (
      <div className="px-8 py-9 space-y-4">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "var(--c-text)" }}>
          Stage Race
        </h1>
        <p className="text-sm" style={{ color: "var(--c-muted)" }}>
          Ingen etapeløb fundet. Tilføj et etapeløb i Supabase med{" "}
          <code className="text-xs px-1 rounded" style={{ backgroundColor: "var(--c-border)", color: "var(--c-text)" }}>
            game_type = &apos;stage_race&apos;
          </code>
          .
        </p>
      </div>
    );
  }

  return <StageRaceClient races={races as Race[]} />;
}
