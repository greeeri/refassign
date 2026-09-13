"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import styles from "./OrganizationTeamManager.module.css";

type RoleCode =
  | "admin"
  | "assignor"
  | "official"
  | "mentor"
  | "registrar"
  | "viewer"
  | "billing";
type TeamAccess = {
  id: string;
  user_id?: string;
  email: string;
  roles: RoleCode[];
  viewer_permissions: string[];
  league_ids: string[];
  status: "active" | "pending";
  owner?: boolean;
};
type TeamData = { members: TeamAccess[]; invitations: TeamAccess[] };
type LeagueChoice = { id: string; name: string };
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roleChoices: ReadonlyArray<[RoleCode, string, string]> = [
  ["admin", "Administrator", "Full organization access"],
  ["assignor", "Assignor", "Assign games in selected leagues"],
  ["official", "Official", "Official schedule, availability and profile"],
  ["mentor", "Mentor", "Read-only assignments in selected leagues"],
  ["registrar", "Registrar", "Registration access in selected leagues"],
  ["viewer", "Contact (read-only)", "Selected read-only workspace areas"],
  ["billing", "Billing manager", "Billing and subscription access"],
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
const leagueRoles: RoleCode[] = ["assignor", "mentor", "registrar", "viewer"];
const needsLeagues = (roles: RoleCode[]) =>
  roles.some((role) => leagueRoles.includes(role));

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
  const supabase = useMemo(() => createClient(), []),
    [leagueChoices, setLeagueChoices] = useState(leagues),
    validLeagues = leagueChoices.filter((x) => uuidPattern.test(x.id)),
    allLeagueIds = validLeagues.map((x) => x.id);
  const [team, setTeam] = useState<TeamData>({ members: [], invitations: [] }),
    [email, setEmail] = useState(""),
    [roles, setRoles] = useState<RoleCode[]>(["assignor"]),
    [viewerPermissions, setViewerPermissions] = useState<string[]>([
      "overview",
    ]),
    [leagueIds, setLeagueIds] = useState<string[]>(allLeagueIds),
    [busy, setBusy] = useState(""),
    [message, setMessage] = useState("");
  const load = async () => {
    const [a, b] = await Promise.all([
      supabase.rpc("get_organization_team", {
        p_organization_id: organizationId,
      }),
      supabase.rpc("get_organization_setup_directory", {
        p_organization_id: organizationId,
      }),
    ]);
    if (a.error || b.error) {
      setMessage(
        a.error?.message ||
          b.error?.message ||
          "Could not load organization access.",
      );
      return;
    }
    setTeam((a.data || { members: [], invitations: [] }) as TeamData);
    setLeagueChoices(
      (b.data as { leagues?: LeagueChoice[] } | null)?.leagues || leagues,
    );
  };
  useEffect(() => {
    if (organizationId) void load();
  }, [organizationId]);
  useEffect(
    () => setLeagueChoices(leagues),
    [organizationId, leagues.map((x) => x.id).join("|")],
  );
  useEffect(
    () => setLeagueIds(allLeagueIds),
    [organizationId, allLeagueIds.join("|")],
  );
  const validate = (r: RoleCode[], l: string[], p: string[]) =>
    !r.length
      ? "Select at least one role."
      : needsLeagues(r) && !l.length
        ? "Select at least one league."
        : r.includes("viewer") && !p.length
          ? "Select at least one area this contact can view."
          : "";
  const invite = async () => {
    const validIds = leagueIds.filter((id) => uuidPattern.test(id)),
      problem = !email.includes("@")
        ? "Enter a valid email address."
        : !canManage
          ? "Only the organization owner or an administrator can invite team members."
          : validate(roles, validIds, viewerPermissions);
    if (problem) {
      setMessage(problem);
      return;
    }
    setBusy("invite");
    setMessage("");
    const primary = roles.includes("admin")
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
        },
      },
    );
    if (error) {
      let detail = error.message;
      try {
        const body = await error.context?.json();
        if (body?.error) detail = body.error;
      } catch {}
      setMessage(detail);
      setBusy("");
      return;
    }
    const updated = await supabase.rpc("set_organization_invitation_roles", {
      p_invitation_id: data.invitationId,
      p_roles: roles,
      p_viewer_permissions: roles.includes("viewer") ? viewerPermissions : [],
      p_league_ids: needsLeagues(roles) ? validIds : [],
    });
    if (updated.error) {
      await supabase.rpc("revoke_organization_invitation", {
        p_invitation_id: data.invitationId,
      });
      setMessage(updated.error.message);
      setBusy("");
      return;
    }
    const {
        data: { session },
      } = await supabase.auth.getSession(),
      response = await fetch("/api/tier-test/team-invitation", {
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
    if (!response.ok)
      setMessage(result.error || "The invitation email could not be sent.");
    else {
      setEmail("");
      setRoles(["assignor"]);
      setLeagueIds(allLeagueIds);
      setMessage("Invitation sent.");
    }
    await load();
    setBusy("");
  };
  const save = async (
    item: TeamAccess,
    r: RoleCode[],
    p: string[],
    l: string[],
  ) => {
    const problem = validate(r, l, p);
    if (problem) {
      setMessage(problem);
      return;
    }
    setBusy(item.id);
    setMessage("");
    const args = {
        p_roles: r,
        p_viewer_permissions: r.includes("viewer") ? p : [],
        p_league_ids: needsLeagues(r) ? l : [],
      },
      { error } =
        item.status === "pending"
          ? await supabase.rpc("set_organization_invitation_roles", {
              p_invitation_id: item.id,
              ...args,
            })
          : await supabase.rpc("set_organization_user_roles", {
              p_organization_id: organizationId,
              p_user_id: item.user_id,
              ...args,
            });
    setMessage(error ? error.message : "Team access updated.");
    await load();
    setBusy("");
  };
  return (
    <div className={styles.wrap}>
      <section className={styles.heading}>
        <div>
          <p>Organization workspace</p>
          <h2>Team &amp; roles</h2>
          <span>Each person can hold multiple roles at the same time.</span>
        </div>
      </section>
      {!canManage && (
        <section className={styles.notice}>
          Only the organization owner or an administrator can change team
          access.
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
      <section className={styles.list}>
        <div className={styles.listHead}>
          <h3>Organization access</h3>
          <b>
            {team.members.length} active · {team.invitations.length} pending
          </b>
        </div>
        {[...team.members, ...team.invitations].map((item) => (
          <MemberCard
            key={item.id}
            item={item}
            leagues={validLeagues}
            disabled={!canManage || busy === item.id}
            onSave={save}
          />
        ))}
      </section>
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
}: {
  leagues: LeagueChoice[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <fieldset className={styles.permissions}>
      <legend>League access</legend>
      {leagues.map((x) => (
        <label key={x.id}>
          <input
            type="checkbox"
            checked={selected.includes(x.id)}
            onChange={() =>
              onChange(
                selected.includes(x.id)
                  ? selected.filter((id) => id !== x.id)
                  : [...selected, x.id],
              )
            }
          />
          <span>{x.name}</span>
        </label>
      ))}
    </fieldset>
  );
}
function MemberCard({
  item,
  leagues,
  disabled,
  onSave,
}: {
  item: TeamAccess;
  leagues: LeagueChoice[];
  disabled: boolean;
  onSave: (
    item: TeamAccess,
    roles: RoleCode[],
    permissions: string[],
    leagueIds: string[],
  ) => Promise<void>;
}) {
  const [roles, setRoles] = useState(item.roles || []),
    [permissions, setPermissions] = useState(item.viewer_permissions || []),
    [leagueIds, setLeagueIds] = useState(item.league_ids || []);
  useEffect(() => {
    setRoles(item.roles || []);
    setPermissions(item.viewer_permissions || []);
    setLeagueIds(item.league_ids || []);
  }, [item.roles, item.viewer_permissions, item.league_ids]);
  return (
    <article className={styles.member}>
      <div className={styles.identity}>
        <span>{item.email[0].toUpperCase()}</span>
        <div>
          <strong>{item.email}</strong>
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
      {needsLeagues(roles) && (
        <LeaguePicker
          leagues={leagues}
          selected={leagueIds}
          onChange={setLeagueIds}
        />
      )}{" "}
      {roles.includes("viewer") && (
        <PermissionPicker selected={permissions} onChange={setPermissions} />
      )}
      <button
        className="primary"
        disabled={
          disabled ||
          !roles.length ||
          (needsLeagues(roles) && !leagueIds.length) ||
          (roles.includes("viewer") && !permissions.length)
        }
        onClick={() => void onSave(item, roles, permissions, leagueIds)}
      >
        {disabled ? "Saving…" : "Save changes"}
      </button>
    </article>
  );
}
