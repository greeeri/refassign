"use client";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { LeagueTeamSetting, selectionFromRows } from "../lib/league-teams";
type Choice = { id: string; name: string };
export default function LeagueTeamSelection({ organizationId, leagues, teams, onScopeChange }: {
  organizationId: string; leagues: Choice[]; teams: Choice[];
  onScopeChange: (scope: { leagueId: string; teamIds: string[] } | null) => void;
}) {
  const sb = useMemo(() => createClient(), []);
  const [settings, setSettings] = useState<LeagueTeamSetting[]>([]);
  const [leagueId, setLeagueId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<{ ids: string[]; changes: number } | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    let current = true;
    setReady(false); setLeagueId(""); setPreview(null); setError(""); setMessage("");
    sb.rpc("get_organization_league_teams", { p_organization_id: organizationId }).then(({data,error: loadError}) => {
      if (!current) return;
      if (loadError) { setError(loadError.message); return; }
      setSettings((data || []) as LeagueTeamSetting[]); setReady(true);
    });
    return () => { current = false; };
  }, [sb, organizationId]);
  useEffect(() => {
    const ids = settings.find((item) => item.league_id === leagueId)?.team_ids.filter((id) => teams.some((team) => team.id === id)) ?? teams.map((team) => team.id);
    setSelected(ids); setPreview(null);
    onScopeChange(leagueId ? { leagueId, teamIds: ids } : null);
  }, [leagueId, settings, teams, onScopeChange]);
  async function save(ids: string[] = selected) {
    if (!ready || !leagueId || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const { error: saveError } = await sb.rpc("save_organization_league_teams", {
        p_organization_id: organizationId, p_league_id: leagueId, p_team_ids: ids,
      });
      if (saveError) throw saveError;
      setSettings((current) => [...current.filter((item) => item.league_id !== leagueId), { league_id: leagueId, team_ids: ids }]);
      setPreview(null); setMessage("League teams saved.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : (reason as {message?: string})?.message || "Unable to save league teams."); }
    finally { setBusy(false); }
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file || !leagueId) return;
    setBusy(true); setError(""); setMessage(""); setPreview(null);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "", raw: false });
      const league = leagues.find((item) => item.id === leagueId)!;
      setPreview(selectionFromRows(rows, league, teams, selected));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to read selection file."); }
    finally { setBusy(false); }
  }
  function download() {
    const league = leagues.find((item) => item.id === leagueId);
    if (!league) return;
    const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = [["league_id", "league", "team_id", "team", "selected"], ...teams.map((team) => [league.id, league.name, team.id, team.name, selected.includes(team.id) ? "true" : "false"])];
    const url = URL.createObjectURL(new Blob(["\uFEFF" + rows.map((row) => row.map(escape).join(",")).join("\r\n")], {type: "text/csv;charset=utf-8"}));
    const link = document.createElement("a"); link.href = url; link.download = `league-teams-${league.name.replace(/[^a-zA-Z0-9]+/g,"-")}.csv`; link.click(); URL.revokeObjectURL(url);
  }
  return <div className="card">
    <label>League <select aria-label="Select league for teams" value={leagueId} disabled={!ready || busy}
      onChange={(event) => {setLeagueId(event.target.value); setQuery(""); setError(""); setMessage("");}}>
      <option value="">All leagues / all teams</option>
      {leagues.map((league) => <option key={league.id} value={league.id}>{league.name}</option>)}
    </select></label>
    {leagueId && <>
      <p>The team list below shows this league’s saved teams.</p>
      <details><summary>Choose teams available in this league</summary>
        <div className="toolbar">
          <button type="button" className="secondary" disabled={busy} onClick={() => {setSelected(teams.map((team) => team.id));setPreview(null);setMessage("");}}>Select All Teams</button>
          <button type="button" className="secondary" disabled={busy} onClick={() => {setSelected([]);setPreview(null);setMessage("");}}>Clear All Teams</button>
          <span>{selected.filter((id) => teams.some((team) => team.id === id)).length} of {teams.length} teams selected</span>
          <button type="button" className="primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save League Teams"}</button>
        </div>
        <label>Search teams <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Team name" /></label>
        <div style={{maxHeight: 320, overflowY: "auto", display: "grid", gap: 8}}>
          {teams.filter((team) => team.name.toLowerCase().includes(query.trim().toLowerCase())).map((team) => <label key={team.id} style={{display:"flex", alignItems:"center",gap:8}}>
            <input type="checkbox" checked={selected.includes(team.id)} disabled={busy} onChange={(event) => {
              setSelected((current) => event.target.checked ? [...current,team.id] : current.filter((id) => id !== team.id)); setPreview(null); setMessage("");
            }} />{team.name}
          </label>)}
        </div>
      </details>
      <div className="toolbar">
        <button type="button" className="secondary" disabled={busy} onClick={download}>Export League Teams</button>
        <label>Import League Teams <input type="file" accept=".csv,.xlsx,.xls" disabled={busy} onChange={(event) => void upload(event)} /></label>
      </div>
      <p>Export, edit the selected column to true or false, then import. Omitted teams keep their current selection. Team details and power ratings use the existing Team Import / Export button.</p>
      {preview && <div><p>{preview.changes} selection changes. {preview.ids.length} teams will be selected.</p>
        <div className="tableWrap"><table><thead><tr><th>Team</th><th>Available in league after import</th></tr></thead><tbody>
          {teams.filter((team) => selected.includes(team.id) !== preview.ids.includes(team.id)).map((team) => <tr key={team.id}><td>{team.name}</td><td>{preview.ids.includes(team.id) ? "Yes" : "No"}</td></tr>)}
        </tbody></table></div>
        <button type="button" className="primary" disabled={busy} onClick={() => void save(preview.ids)}>Apply Imported Selections</button>{" "}
        <button type="button" className="secondary" disabled={busy} onClick={() => setPreview(null)}>Cancel Import</button>
      </div>}
    </>}
    {error && <div className="errorBox" role="alert">{error}</div>}
    {message && <p role="status">{message}</p>}
  </div>;
}
