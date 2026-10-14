import { NextResponse } from "next/server";
import { requireSuperAdmin } from "../../../../../lib/supabase/admin";
import { downloadJuscGames, JUSC_BUCKET } from "../../../../../lib/server/playmetrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  try {
    await requireSuperAdmin();
    const games = await downloadJuscGames();
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const upcoming = games.filter(game => game.date >= today);
    return NextResponse.json({ bucket: JUSC_BUCKET, total: games.length, upcoming: upcoming.length,
      upcoming_cancelled: upcoming.filter(game => game.cancelled).length, sample: upcoming.slice(0, 10),
      writes_applied: false, required_before_sync: ["Confirm source time zone", "Map teams, fields, levels and durations"] },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "PlayMetrics preview failed.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "FORBIDDEN" ? 403 : 502;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
