import { NextResponse } from "next/server";
import { requireSuperAdmin } from "../../../../../lib/supabase/admin";
import { downloadJuscGames, JUSC_BUCKET, upcomingJuscHomeGames } from "../../../../../lib/server/playmetrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  try {
    await requireSuperAdmin();
    const games = await downloadJuscGames();
    const upcoming = upcomingJuscHomeGames(games);
    return NextResponse.json({ bucket: JUSC_BUCKET, total: games.length, upcoming: upcoming.length,
      upcoming_cancelled: upcoming.filter(game => game.cancelled).length, sample: upcoming.slice(0, 10),
      scope: "JUSC home games dated today or later", writes_applied: false, required_before_sync: ["Confirm source time zone", "Map teams, fields, levels and durations"] },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PlayMetrics preview failed.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 502;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
