"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "../lib/supabase/client";
import styles from "./OrganizationTeamManager.module.css";
import { LeagueGameAccess } from "./leagueGameScope";

type RoleCode =
  | "admin"
  | "assignor"
  | "official"
  | "mentor"
  | "registrar"
  | "iowa_development_admin"
  | "viewer"
  | "billing";
type TeamAccess = {
  id: string;
  user_id?: string;
  email: string;
  full_name?: string | null;
  roles: RoleCode[];
  viewer_permissions: string[];
  league_ids: string[];
  league_access?: LeagueGameAccess[];
  status: "active" | "pending";
  owner?: boolean;
};
type TeamData = { members: TeamAccess[]; invitations: TeamAccess[] };
type LeagueChoice = { id: string; name: string };
type LocationChoice = { id: string; name: string; city?: string | null };
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roleChoices: ReadonlyArray<[RoleCode, string, string]> = [
  ["admin", "Administrator", "Administration in selected leagues"],
  ["assignor", "Assignor", "Assign games in selected leagues"],
  ["official", "Official", "Official schedule, availability and profile"],
  ["mentor", "Mentor", "Read-only assignments in selected leagues"],
  ["registrar", "Registrar", "Registration access in selected leagues"],
  [
    "iowa_development_admin",
    "Iowa Soccer Development Administrator",
    "Program-wide Iowa Soccer development administration; no league access required",
  ],
  ["viewer", "Contact (read-only)", "Selected read-only workspace areas"],
  ["billing", "Billing manager", "Payroll access in selected leagues"],
];
const labels = Object.fromEntries(
  roleChoices.map(([code, label]) => [code, label]),
) as Record<RoleCode, string>;
const permissions = [
  ["overview", "Overview dashboard"],
  ["games", "Games and schedules"],
  ["assignments", "Assignments"],
  ["officials", "Officials directory"],
  ["reporting", "Reporting"],
  ["analytics", "Analytics"],
  ["payroll", "Payroll summaries"],
  ["training_documents", "Training and documents"],
] as const;
const leagueRoles: RoleCode[] = [
  "admin",
  "assignor",
  "mentor",
  "registrar",
  "viewer",
  "billing",
];
const needsLeagues = (roles: RoleCode[]) =>
  roles.some((role) => leagueRoles.includes(role));
function accessForLeague(leagueId: string, access: LeagueGameAccess[]): LeagueGameAccess {
  const grant = access.find((item) => item.league_id === leagueId);
  return {
    league_id: leagueId,
    all_locations: grant?.all_locations === true,
    location_ids: Array.isArray(grant?.location_ids) ? [...new Set(grant.location_ids)] : [],
  };
}
function selectedLeagueAccess(leagueIds: string[], access: LeagueGameAccess[], locations: LocationChoice[]): LeagueGameAccess[] {
  const validLocations = new Set(locations.map((location) => location.id));
  return leagueIds.map((leagueId) => {
    const grant = accessForLeague(leagueId, access);
    return { ...grant, location_ids: grant.location_ids.filter((id) => validLocations.has(id)) };
  });
}
const withTimeout = async <T,>(request: PromiseLike<T>, milliseconds = 12000) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(request),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("The save request timed out. Please try again.")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export default function OrganizationTeamManager({
  organizationId,
  organization,
  canManage,
  leagues,
}: {
  organizationId: string;
  organization: string;
  canManage: boolean;
  leagues: LeagueChoice[];
}) {
  const accessScopeKey = JSON.stringify([organizationId, canManage]);
  const activeScope = useRef<string | null>(accessScopeKey);
  activeScope.current = accessScopeKey;
  const loadVersion = useRef(0);
  const [loadedScopeKey, setLoadedScopeKey] = useState("");
  const isCurrentScope = () => activeScope.current === accessScopeKey;
  const supabase = useMemo(() => createClient(), []),
    [leagueChoices, setLeagueChoices] = useState(leagues),
    validLeagues = leagueChoices.filter((x) => uuidPattern.test(x.id)),
    allLeagueIds = validLeagues.map((x) => x.id);
  const [team, setTeam] = useState<TeamData>({ members: [], invitations: [] }),
    [email, setEmail] = useState(""),
    [search, setSearch] = useState(""),
    [roles, setRoles] = useState<RoleCode[]>(["assignor"]),
    [viewerPermissions, setViewerPermissions] = useState<string[]>([
      "overview",
    ]),
    [leagueIds, setLeagueIds] = useState<string[]>([]),
    [leagueAccess, setLeagueAccess] = useState<LeagueGameAccess[]>([]),
    [locations, setLocations] = useState<LocationChoice[]>([]),
    [busy, setBusy] = useState(""),
    [message, setMessage] = useState("");
  const people = [...team.members, ...team.invitations];
  const searchTerms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matchingPeople = people.filter((item) => {
    const searchable = [item.full_name, item.email,
      ...(item.roles || []).flatMap((role) => [role, labels[role]]),
      item.owner ? "Organization owner" : "",
    ].filter(Boolean).join(" ").toLocaleLowerCase();
    return searchTerms.every((term) => searchable.includes(term));
  });
  const load = async () => {
    if (!isCurrentScope() || !organizationId || !canManage) return;
    const request = ++loadVersion.current;
    const [a, b, c] = await Promise.all([
      supabase.rpc("get_organization_team", {
        p_organization_id: organizationId,
      }),
      supabase.rpc("get_organization_setup_directory", {
        p_organization_id: organizationId,
      }),
      supabase.rpc("get_organization_locations", {
        p_organization_id: organizationId,
      }),
    ]);
    if (!isCurrentScope() || request !== loadVersion.current) return;
    if (a.error || b.error || c.error) {
      setLoadedScopeKey("");
      setTeam({ members: [], invitations: [] });
      setMessage(
        a.error?.message ||
          b.error?.message ||
          c.error?.message ||
          "Could not load organization access.",
      );
      return;
    }
    setLoadedScopeKey(accessScopeKey);
    setLocations(((c.data || []) as LocationChoice[]).filter((item) => uuidPattern.test(item.id)).map(({ id, name, city }) => ({ id, name, city })));
    setTeam((a.data || { members: [], invitations: [] }) as TeamData);
    setLeagueChoices(
      (b.data as { leagues?: LeagueChoice[] } | null)?.leagues || leagues,
    );
  };
  useEffect(() => {
    activeScope.current = accessScopeKey;
    setLoadedScopeKey("");
    setTeam({ members: [], invitations: [] });
    setLeagueChoices(leagues);
    setLeagueIds([]); setLeagueAccess([]); setLocations([]);
    setEmail(""); setSearch(""); setRoles(["assignor"]); setViewerPermissions(["overview"]);
    setBusy(""); setMessage("");
    void load();
    return () => { activeScope.current = null; loadVersion.current += 1; };
  }, [accessScopeKey]);
  useEffect(
    () => setLeagueChoices(leagues),
    [organizationId, leagues.map((x) => x.id).join("|")],
  );
  const validate = (r: RoleCode[], l: string[], p: string[], owner = false) =>
    !r.length
      ? "Select at least one role."
      : !owner && needsLeagues(r) && !l.length
        ? "Select at least one league."
        : r.includes("viewer") && !p.length
          ? "Select at least one area this contact can view."
          : "";
  const invite = async () => {
    if (!isCurrentScope() || loadedScopeKey !== accessScopeKey) return;
    const validIds = leagueIds.filter((id) => allLeagueIds.includes(id)),
      problem = !email.includes("@")
        ? "Enter a valid email address."
        : !canManage
          ? "Only the organization owner can invite team members."
          : validate(roles, validIds, viewerPermissions);
    if (problem) {
      setMessage(problem);
      return;
    }
    const grants = needsLeagues(roles) ? selectedLeagueAccess(validIds, leagueAccess, locations) : [];
    setBusy("invite");
    setMessage("");
    const primary = roles.includes("admin")
      ? "admin"
      : roles.includes("iowa_development_admin")
        ? "admin"
      : roles.includes("assignor")
        ? "assignor"
        : roles.includes("viewer")
          ? "viewer"
          : "billing";
    const { data, error } = await supabase.functions.invoke(
      "send-organization-invitation",
      {
        body: {
          organizationId,
          email,
          role: primary,
          viewerPermissions: roles.includes("viewer") ? viewerPermissions : [],
          leagueIds: needsLeagues(roles) ? validIds : [],
          leagueAccess: grants,
        },
      },
    );
    if (!isCurrentScope()) return;
    if (error) {
      let detail = error.message;
      try {
        const body = await error.context?.json();
        if (body?.error) detail = body.error;
      } catch {}
      if (!isCurrentScope()) return;
      setMessage(detail);
      setBusy("");
      return;
    }
    const updated = await supabase.rpc("set_organization_invitation_roles", {
      p_invitation_id: data.invitationId,
      p_roles: roles,
      p_viewer_permissions: roles.includes("viewer") ? viewerPermissions : [],
      p_league_ids: needsLeagues(roles) ? validIds : [],
      p_league_access: grants,
    });
    if (!isCurrentScope()) return;
    if (updated.error) {
      await supabase.rpc("revoke_organization_invitation", {
        p_invitation_id: data.invitationId,
      });
      if (!isCurrentScope()) return;
      setMessage(updated.error.message);
      setBusy("");
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!isCurrentScope()) return;
    const response = await fetch("/api/tier-test/team-invitation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token || ""}`,
        },
        body: JSON.stringify({
          organizationId,
          organization,
          email,
          roleLabel: roles.map((r) => labels[r]).join(", "),
          actionLink: data.actionLink,
          invitationId: data.invitationId,
        }),
      }),
      result = (await response.json().catch(() => ({}))) as { error?: string };
    if (!isCurrentScope()) return;
    if (!response.ok)
      setMessage(result.error || "The invitation email could not be sent.");
    else {
      setEmail("");
      setRoles(["assignor"]);
      setLeagueIds([]);
      setLeagueAccess([]);
      setMessage("Invitation sent.");
    }
    await load();
    if (isCurrentScope()) setBusy("");
  };
  const save = async (
    item: TeamAccess,
    r: RoleCode[],
    p: string[],
    l: string[],
    access: LeagueGameAccess[],
  ) => {
    if (!canManage || !isCurrentScope() || loadedScopeKey !== accessScopeKey) return;
    const validIds = l.filter((id) => allLeagueIds.includes(id));
    const problem = validate(r, validIds, p, item.owner);
    if (problem) {
      setMessage(problem);
      return;
    }
    setBusy(item.id);
    const releaseBusy = window.setTimeout(() => {
      if (isCurrentScope()) setBusy((current) => (current === item.id ? "" : current));
    }, 2000);
    setMessage("");
    try {
      const args = {
        p_roles: r,
        p_viewer_permissions: r.includes("viewer") ? p : [],
        p_league_ids: !item.owner && needsLeagues(r) ? validIds : [],
        p_league_access: !item.owner && needsLeagues(r) ? selectedLeagueAccess(validIds, access, locations) : [],
      };
      const request =
        item.status === "pending"
          ? supabase.rpc("set_organization_invitation_roles", {
              p_invitation_id: item.id,
              ...args,
            })
          : supabase.rpc("set_organization_user_roles", {
              p_organization_id: organizationId,
              p_user_id: item.user_id,
              ...args,
            });
      const { error } = await withTimeout(
        request as PromiseLike<{ error: { message: string } | null }>,
      );
      if (!isCurrentScope()) return;
      if (error) {
        setMessage(error.message);
        return;
      }
      setMessage("Team access updated.");
      setBusy("");
      void load();
    } catch (error) {
      if (!isCurrentScope()) return;
      setMessage(
        error instanceof Error ? error.message : "Could not update team access.",
      );
    } finally {
      window.clearTimeout(releaseBusy);
      if (isCurrentScope()) setBusy("");
    }
  };
  if (!canManage || loadedScopeKey !== accessScopeKey) return (
    <section className={styles.notice}>
      {canManage ? message || "Loading organization access…" : "Only the organization owner can manage team access."}
    </section>
  );
  return (
    <div className={styles.wrap}>
      <section className={styles.heading}>
        <div>
          <p>Organization workspace</p>
          <h2>Team &amp; roles</h2>
          <span>Each person can hold multiple roles at the same time.</span>
        </div>
      </section>
      <section className={styles.list}>
        <div className={styles.listHead}>
          <h3>Organization access</h3>
          <b>
            {team.members.length} active · {team.invitations.length} pending
          </b>
        </div>
        <label>
          Search contacts by name, email or role
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, email or role" autoComplete="off" />
        </label>
        <p className={styles.empty} role="status">
          {search.trim() ? `${matchingPeople.length} of ${people.length} contacts found` : `${people.length} contacts`}
        </p>
        {matchingPeople.length === 0 && <p className={styles.empty}>
          {search.trim() ? "No contacts match your search." : "No team members or pending invitations yet."}
        </p>}
        {matchingPeople.map((item) => (
          <MemberCard
            key={item.id}
            item={item}
            leagues={validLeagues}
            locations={locations}
            disabled={!canManage || busy === item.id}
            saving={busy === item.id}
            onSave={save}
          />
        ))}
      </section>
      {!canManage && (
        <section className={styles.notice}>
          Only the organization owner can change team access.
        </section>
      )}
      {canManage && (
        <section className={styles.invite}>
          <h3>Invite a team member</h3>
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="team@example.com"
            />
          </label>
          <RolePicker selected={roles} onChange={setRoles} />
          {needsLeagues(roles) && (
            <LeaguePicker
              leagues={validLeagues}
              selected={leagueIds}
              onChange={setLeagueIds}
              locations={locations}
              access={leagueAccess}
              onAccessChange={setLeagueAccess}
              disabled={busy === "invite"}
            />
          )}{" "}
          {roles.includes("viewer") && (
            <PermissionPicker
              selected={viewerPermissions}
              onChange={setViewerPermissions}
            />
          )}
          <button
            className="primary"
            disabled={busy === "invite"}
            onClick={() => void invite()}
          >
            {busy === "invite" ? "Sending…" : "Send invitation"}
          </button>
        </section>
      )}
      {message && (
        <p className={styles.message} role="status">
          {message}
        </p>
      )}

    </div>
  );
}
function RolePicker({
  selected,
  onChange,
  owner = false,
}: {
  selected: RoleCode[];
  onChange: (next: RoleCode[]) => void;
  owner?: boolean;
}) {
  return (
    <fieldset className={styles.permissions}>
      <legend>Roles — select all that apply</legend>
      {owner && (
        <label>
          <input type="checkbox" checked disabled />
          <span>Organization owner</span>
        </label>
      )}
      {roleChoices.map(([code, label, description]) => (
        <label key={code}>
          <input
            type="checkbox"
            checked={selected.includes(code)}
            onChange={() =>
              onChange(
                selected.includes(code)
                  ? selected.filter((x) => x !== code)
                  : [...selected, code],
              )
            }
          />
          <span>
            {label}
            <small>{description}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
function PermissionPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className={styles.permissions}>
      <legend>Contact can see</legend>
      {permissions.map(([code, label]) => (
        <label key={code}>
          <input
            type="checkbox"
            checked={selected.includes(code)}
            onChange={() =>
              onChange(
                selected.includes(code)
                  ? selected.filter((x) => x !== code)
                  : [...selected, code],
              )
            }
          />
          <span>{label}</span>
        </label>
      ))}
    </fieldset>
  );
}
function LeaguePicker({
  leagues,
  selected,
  onChange,
  locations,
  access,
  onAccessChange,
  disabled = false,
}: {
  leagues: LeagueChoice[];
  selected: string[];
  onChange: (next: string[]) => void;
  locations: LocationChoice[];
  access: LeagueGameAccess[];
  onAccessChange: (next: LeagueGameAccess[]) => void;
  disabled?: boolean;
}) {
  const updateAccess = (grant: LeagueGameAccess) => onAccessChange([
    ...access.filter((item) => item.league_id !== grant.league_id), grant,
  ]);
  return (
    <fieldset className={styles.permissions} disabled={disabled}>
      <legend>League and location access</legend>
      {leagues.map((league) => {
        const grant = accessForLeague(league.id, access);
        return <div key={league.id} style={{ gridColumn: "1 / -1" }}>
          <label>
            <input
              type="checkbox"
              aria-label={`League access for ${league.name}`}
              checked={selected.includes(league.id)}
              onChange={() => onChange(selected.includes(league.id)
                ? selected.filter((id) => id !== league.id) : [...selected, league.id])}
            />
            <span>{league.name}</span>
          </label>
          {selected.includes(league.id) && <fieldset className={styles.permissions} style={{ marginLeft: 30 }}>
            <legend>{league.name} game locations</legend>
            <label style={{ gridColumn: "1 / -1" }}>
              <input type="checkbox" aria-label={`All locations for ${league.name}`}
                checked={grant.all_locations}
                onChange={(event) => updateAccess({ ...grant, all_locations: event.target.checked })} />
              <span>All locations<small>Includes every current and future location in this league.</small></span>
            </label>
            <p style={{ gridColumn: "1 / -1", margin: 0 }}>
              {grant.all_locations ? "All locations are allowed. Uncheck All locations to limit access below." : "Only games at the selected locations below are allowed in this league."}
            </p>
            {locations.map((location) => <label key={location.id}>
              <input type="checkbox" aria-label={`${location.name} in ${league.name}`}
                checked={grant.all_locations || grant.location_ids.includes(location.id)}
                disabled={grant.all_locations || disabled}
                onChange={(event) => updateAccess({ ...grant, all_locations: false,
                  location_ids: event.target.checked ? [...new Set([...grant.location_ids, location.id])] : grant.location_ids.filter((id) => id !== location.id),
                })} />
              <span>{location.name}{location.city && <small>{location.city}</small>}</span>
            </label>)}
            {!locations.length && <p style={{ gridColumn: "1 / -1" }}>No active organization locations are available.</p>}
            {!grant.all_locations && !grant.location_ids.some((id) => locations.some((location) => location.id === id)) &&
              <p role="status" className={styles.validationMessage} style={{ gridColumn: "1 / -1" }}>No locations selected. This person will have no game access in this league.</p>}
          </fieldset>}
        </div>;
      })}
    </fieldset>
  );
}
function MemberCard({
  item,
  leagues,
  locations,
  disabled,
  saving,
  onSave,
}: {
  item: TeamAccess;
  leagues: LeagueChoice[];
  locations: LocationChoice[];
  disabled: boolean;
  saving: boolean;
  onSave: (
    item: TeamAccess,
    roles: RoleCode[],
    permissions: string[],
    leagueIds: string[],
    leagueAccess: LeagueGameAccess[],
  ) => Promise<void>;
}) {
  const [roles, setRoles] = useState(item.roles || []),
    [permissions, setPermissions] = useState(item.viewer_permissions || []),
    [leagueIds, setLeagueIds] = useState(item.league_ids || []),
    [leagueAccess, setLeagueAccess] = useState<LeagueGameAccess[]>(item.league_access || []),
    [validationMessage, setValidationMessage] = useState("");
  useEffect(() => {
    setRoles(item.roles || []);
    setPermissions(item.viewer_permissions || []);
    setLeagueIds(item.league_ids || []);
    setLeagueAccess(item.league_access || []);
    setValidationMessage("");
  }, [item.roles, item.viewer_permissions, item.league_ids, item.league_access]);
  const saveChanges = async () => {
    if (disabled) return;
    const problem = !roles.length
      ? "Select at least one role."
      : !item.owner && needsLeagues(roles) && !leagueIds.length
        ? "Select at least one league for the Administrator, Billing Manager, Registrar, Assignor, Mentor, or Contact role, or uncheck that role."
        : roles.includes("viewer") && !permissions.length
          ? "Select at least one area this contact can view."
          : "";
    if (problem) {
      setValidationMessage(problem);
      return;
    }
    setValidationMessage("");
    await onSave(item, roles, permissions, leagueIds, leagueAccess);
  };
  return (
    <article className={styles.member}>
      <div className={styles.identity}>
        <span>{item.email[0].toUpperCase()}</span>
        <div>
          <strong>{item.full_name || item.email}</strong>
          {item.full_name && <small>{item.email}</small>}
          <small>
            {[
              ...(item.owner ? ["Organization owner"] : []),
              ...roles.map((r) => labels[r]),
            ].join(" · ")}
          </small>
        </div>
        <em>{item.status === "pending" ? "Pending" : "Active"}</em>
      </div>
      <RolePicker selected={roles} onChange={setRoles} owner={item.owner} />
      {!item.owner && needsLeagues(roles) && (
        <LeaguePicker
          leagues={leagues}
          selected={leagueIds}
          onChange={setLeagueIds}
          locations={locations}
          access={leagueAccess}
          onAccessChange={setLeagueAccess}
          disabled={disabled}
        />
      )}{" "}
      {roles.includes("viewer") && (
        <PermissionPicker selected={permissions} onChange={setPermissions} />
      )}
      <button
        className="primary"
        disabled={disabled}
        onClick={() => void saveChanges()}
      >
        {saving ? "Saving…" : "Save changes"}
      </button>
      {validationMessage && (
        <p className={styles.validationMessage} role="alert">
          {validationMessage}
        </p>
      )}
    </article>
  );
}
