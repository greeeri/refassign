import { downloadJuscGames } from "../lib/server/playmetrics.ts";
if (process.env.VERCEL_ENV !== "preview") throw new Error("This connection check is restricted to Preview.");
try {
  const games = await downloadJuscGames();
  const parts = new Intl.DateTimeFormat("en-US", {timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
  const part = (type) => parts.find(p => p.type === type).value;
  const today = `${part("year")}-${part("month")}-${part("day")}`;
  const upcoming = games.filter(game => game.date >= today);
  console.log("JUSC_FEED_TEST " + JSON.stringify({ok:true,cutoff:today,timeZone:"America/Chicago",gamesTodayAndFuture:upcoming.length,canceled:upcoming.filter(game=>game.cancelled).length,other:upcoming.filter(game=>!game.cancelled).length,pastGamesExcluded:games.length-upcoming.length,databaseWrites:0}));
} catch (error) {
  console.error("JUSC_FEED_TEST failed: " + (error instanceof Error ? error.message : "Unknown error"));
  process.exitCode = 1;
}
