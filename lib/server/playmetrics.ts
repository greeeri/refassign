import { createSign } from "node:crypto";
import * as XLSX from "xlsx";

export const JUSC_BUCKET = "club367-reports-playmetrics-prod";
const EMAIL = "club367-referee-reporting@playmetrics-prod.iam.gserviceaccount.com";
export type PlayMetricsGame = { id: string; date: string; time: string; field: string; home: string; away: string; cancelled: boolean };

export function parsePlayMetricsGames(csv: string): PlayMetricsGame[] {
  const workbook = XLSX.read(csv.replace(/^\uFEFF/, ""), { type: "string", raw: true });
  const grid = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "", raw: true });
  const headers = (grid[0] || []).map(String);
  const required = ["id", "Date", "Time", "Field", "Home", "Away", "Game Status"];
  if (required.some(key => !headers.includes(key))) throw new Error("PlayMetrics game report is missing required columns.");
  const seen = new Set<string>();
  return grid.slice(1).filter(row => row.some(value => String(value).trim())).map(row => {
    const value = (key: string) => String(row[headers.indexOf(key)] ?? "").trim();
    const id = value("id");
    if (!id || seen.has(id)) throw new Error("PlayMetrics report contains missing or duplicate game IDs.");
    seen.add(id);
    const match = value("Date").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) throw new Error("PlayMetrics report contains an invalid date.");
    const [, month, day, year] = match;
    const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const check = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 10) !== date) throw new Error("PlayMetrics report contains an invalid date.");
    const time = value("Time");
    if (!/^(?:0?[1-9]|1[0-2]):[0-5]\d\s(?:AM|PM)$/i.test(time)) throw new Error("PlayMetrics report contains an invalid time.");
    const status = value("Game Status").toLowerCase();
    if (status && status !== "canceled" && status !== "cancelled") throw new Error("PlayMetrics report contains an unsupported game status.");
    const field = value("Field"), home = value("Home"), away = value("Away");
    if (!field || !home || !away) throw new Error("PlayMetrics report contains incomplete game details.");
    return { id, date, time, field, home, away, cancelled: Boolean(status) };
  });
}

export async function downloadJuscGames() {
  const raw = process.env.JUSC_GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("JUSC_GOOGLE_SERVICE_ACCOUNT_JSON is not configured.");
  let credentials: { client_email?: string; private_key?: string };
  try { credentials = JSON.parse(raw); } catch { throw new Error("JUSC credential must be valid JSON."); }
  if (credentials.client_email !== EMAIL || !credentials.private_key) throw new Error("JUSC credential does not match the expected service account.");
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: EMAIL, scope: "https://www.googleapis.com/auth/devstorage.read_only", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  let signature: string;
  try { signature = createSign("RSA-SHA256").update(unsigned).sign(credentials.private_key, "base64url"); }
  catch { throw new Error("JUSC credential contains an invalid private key."); }
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
    cache: "no-store", signal: AbortSignal.timeout(30000),
  });
  if (!tokenResponse.ok) throw new Error(`Google service-account authentication failed (HTTP ${tokenResponse.status}).`);
  const token = await tokenResponse.json();
  if (typeof token.access_token !== "string") throw new Error("Google did not return an access token.");
  const response = await fetch(`https://storage.googleapis.com/storage/v1/b/${JUSC_BUCKET}/o/all_games.csv?alt=media`, {
    headers: { Authorization: `Bearer ${token.access_token}` }, cache: "no-store", signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`JUSC game download failed (HTTP ${response.status}).`);
  return parsePlayMetricsGames(await response.text());
}
