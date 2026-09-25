"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import { readAllPages } from "../lib/supabase/readAll";

type Choice = { id: string; name: string };
type OfficialRow = {
  id: string;
  first_name: string;
  last_name: string;
  organization_active: boolean;
};
type Link = { team_id: string; official_id: string };

export default function TeamOfficialLinks({
  organizationId,
  teamId,
  officialId,
  teams,
}: {
  organizationId: string;
  teamId?: string;
  officialId?: string;
  teams?: Choice[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [choices, setChoices] = useState<Choice[]>([]);
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const isTeamView = Boolean(teamId);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    setSelectedId("");
    setSearch("");
    async function load() {
      const [directory, links] = await Promise.all([
        teamId
          ? readAllPages<OfficialRow>((from, to) =>
              supabase.rpc("get_organization_official_directory", {
                p_organization_id: organizationId,
              }).range(from, to),
            )
          : teams
            ? Promise.resolve({ data: teams, error: null })
            : supabase.rpc("get_organization_setup_directory", {
                p_organization_id: organizationId,
              }),
        readAllPages<Link>((from, to) => {
          let query = supabase.from("team_quick_assign_officials")
            .select("team_id,official_id")
            .eq("organization_id", organizationId);
          query = teamId ? query.eq("team_id", teamId) : query.eq("official_id", officialId!);
          return query.order("team_id").order("official_id").range(from, to);
        }),
      ]);
      if (!current) return;
      if (directory.error || links.error) {
        setError(directory.error?.message || links.error?.message || "Could not load team links.");
      } else {
        const options = teamId
          ? ((directory.data || []) as OfficialRow[])
              .filter((row) => row.organization_active)
              .map((row) => ({ id: row.id, name: `${row.first_name} ${row.last_name}`.trim() }))
          : teams || ((directory.data as { teams?: Choice[] } | null)?.teams || []);
        setChoices(options.sort((a, b) => a.name.localeCompare(b.name)));
        setLinkedIds((links.data || []).map((link) => teamId ? link.official_id : link.team_id));
      }
      setLoading(false);
    }
    void load();
    return () => { current = false; };
  }, [organizationId, teamId, officialId, supabase, teams]);

  async function change(id: string, remove: boolean) {
    const linkedTeamId = teamId || id;
    const linkedOfficialId = officialId || id;
    setWorking(true);
    setError("");
    setMessage("");
    const query = supabase.from("team_quick_assign_officials");
    const { error: saveError } = remove
      ? await query.delete().eq("organization_id", organizationId)
          .eq("team_id", linkedTeamId).eq("official_id", linkedOfficialId)
      : await query.insert({ organization_id: organizationId, team_id: linkedTeamId, official_id: linkedOfficialId });
    if (saveError) setError(saveError.message);
    else {
      setLinkedIds((current) => remove ? current.filter((item) => item !== id) : [...current, id]);
      setSelectedId("");
      setSearch("");
      setMessage(remove ? "Quick assign link removed." : "Quick assign link saved.");
    }
    setWorking(false);
  }

  const available = choices.filter((choice) =>
    !linkedIds.includes(choice.id) && choice.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <section style={{ padding: 16, border: "1px solid #d6dce5", borderRadius: 8, margin: "12px 0" }}>
      <h4 style={{ margin: "0 0 6px" }}>Quick assign {isTeamView ? "officials" : "teams"}</h4>
      <p style={{ margin: "0 0 12px" }}>
        {isTeamView
          ? "Linked officials appear first when assigning this team's games."
          : "This official will appear first as a quick assign option on these teams' games."}
        {" "}Availability, eligibility, and conflicts still apply.
      </p>
      {loading ? <p>Loading links…</p> : <>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {linkedIds.filter((id) => choices.some((choice) => choice.id === id)).length === 0 && <span>None linked yet.</span>}
          {linkedIds.filter((id) => choices.some((choice) => choice.id === id)).map((id) => (
            <span key={id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {choices.find((choice) => choice.id === id)?.name}
              <button type="button" className="secondary" disabled={working}
                aria-label={`Remove ${choices.find((choice) => choice.id === id)?.name} from quick assign`}
                onClick={() => void change(id, true)}>Remove</button>
            </span>
          ))}
        </div>
        <label style={{ display: "block", marginBottom: 8 }}>
          Search {isTeamView ? "officials" : "teams"}
          <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setSelectedId(""); }}
            placeholder={isTeamView ? "Search by official name" : "Search by team name"} />
        </label>
        <div style={{ display: "flex", alignItems: "end", flexWrap: "wrap", gap: 8 }}>
          <label>
            {isTeamView ? "Official" : "Team"}
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              <option value="">Select {isTeamView ? "official" : "team"}</option>
              {available.map((choice) => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
            </select>
          </label>
          <button type="button" className="primary" disabled={!selectedId || working}
            onClick={() => void change(selectedId, false)}>{working ? "Saving…" : "Link for quick assign"}</button>
        </div>
      </>}
      {error && <p className="errorBox" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
