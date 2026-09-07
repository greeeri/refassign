"use client";

import { useEffect, useState } from "react";
import { createTierTestClient as createClient } from "../../lib/supabase/client";
import wizard from "./wizard.module.css";

type TeamAccess = {
  id: string;
  email: string;
  role: string;
  viewer_permissions: string[];
  status: string;
};
type TeamData = { members: TeamAccess[]; invitations: TeamAccess[] };
const roles = [
  ["assignor", "Assignor"],
  ["admin", "Organization administrator"],
  ["billing", "Billing manager"],
  ["viewer", "Read-only viewer"],
] as const;
const viewerSections = [
  ["overview", "Overview dashboard"],
  ["leagues", "Leagues and coverage"],
  ["games", "Games and schedules"],
  ["assignments", "Assignments"],
  ["officials", "Officials directory"],
  ["reporting", "Reporting"],
  ["analytics", "Analytics"],
  ["payroll", "Payroll summaries"],
  ["billing", "Billing information"],
  ["training_documents", "Training and documents"],
] as const;
const roleName = (role: string) =>
  roles.find(([code]) => code === role)?.[1] || role;

export default function OrganizationTeamSetup({
  organizationId,
  organization,
  onBack,
  onContinue,
}: {
  organizationId: string;
  organization: string;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("assignor");
  const [permissions, setPermissions] = useState<string[]>(["overview"]);
  const [team, setTeam] = useState<TeamData>({ members: [], invitations: [] });
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const loadTeam = async () => {
    const { data, error } = await createClient().rpc("get_organization_team", {
      p_organization_id: organizationId,
    });
    if (error) setMessage(error.message);
    else setTeam((data || { members: [], invitations: [] }) as TeamData);
  };
  useEffect(() => {
    void loadTeam();
  }, [organizationId]);
  const invite = async () => {
    if (!email.includes("@") || sending) return;
    setSending(true);
    setMessage("");
    const supabase = createClient();
    const { data, error } = await supabase.functions.invoke(
      "send-organization-invitation",
      {
        body: {
          organizationId,
          email,
          role,
          viewerPermissions: role === "viewer" ? permissions : [],
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
      setSending(false);
      return;
    }
    const {
      data: { session },
    } = await supabase.auth.getSession();
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
        roleLabel: roleName(role),
        actionLink: data.actionLink,
        invitationId: data.invitationId,
      }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    if (!response.ok) {
      setMessage(result.error || "The invitation email could not be sent.");
      setSending(false);
      await loadTeam();
      return;
    }
    setEmail("");
    setRole("assignor");
    setPermissions(["overview"]);
    await loadTeam();
    setMessage("Invitation sent and saved to this organization.");
    setSending(false);
  };
  const allAccess = [...team.members, ...team.invitations];
  const assigningTeamAdded = allAccess.some(
    (item) => item.role === "admin" || item.role === "assignor",
  );
  return (
    <div className={`${wizard.teamStep} ${wizard.review}`}>
      <div className={wizard.teamStepHeader}>
        <div>
          <span>Organization team</span>
          <h3>Add your team before opening operations</h3>
          <p>
            Invite administrators, assignors, billing managers, or read-only
            viewers for {organization}.
          </p>
        </div>
        <button type="button" onClick={onBack}>
          Back to review
        </button>
      </div>
      <div className={wizard.teamColumns}>
        <section className={wizard.teamCard}>
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="assignor@example.com"
            />
          </label>
          <label>
            Workspace role
            <select
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              {roles.map(([code, label]) => (
                <option value={code} key={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {role === "viewer" && (
            <fieldset className={wizard.viewerPermissions}>
              <legend>Viewer can see</legend>
              {viewerSections.map(([code, label]) => (
                <label key={code}>
                  <input
                    type="checkbox"
                    checked={permissions.includes(code)}
                    onChange={(event) =>
                      setPermissions(
                        event.target.checked
                          ? [...permissions, code]
                          : permissions.filter((item) => item !== code),
                      )
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
          )}
          <button
            className={wizard.teamInviteButton}
            type="button"
            disabled={
              sending ||
              !email.includes("@") ||
              (role === "viewer" && permissions.length === 0)
            }
            onClick={() => void invite()}
          >
            {sending ? "Sending invitation…" : "Send team invitation"}
          </button>
          {message && <p className={wizard.teamMessage}>{message}</p>}
        </section>
        <section className={wizard.teamCard}>
          <span>Team access</span>
          <h4>
            {team.members.length} active · {team.invitations.length} pending
          </h4>
          {allAccess.length === 0 ? (
            <p>No team members or invitations have been added yet.</p>
          ) : (
            <div className={wizard.teamList}>
              {allAccess.map((item) => (
                <div key={item.id}>
                  <div>
                    <b>{item.email}</b>
                    <small>{roleName(item.role)}</small>
                  </div>
                  <em>{item.status === "pending" ? "Pending" : "Active"}</em>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      {!assigningTeamAdded && (
        <div className={wizard.notice}>
          <b>Add an administrator or assignor to continue</b>
          <p>
            The operational workspace opens after an assigning team member has
            been invited.
          </p>
        </div>
      )}
      <button
        className={wizard.continueOperations}
        type="button"
        disabled={!assigningTeamAdded}
        onClick={onContinue}
      >
        Continue to operational workspace →
      </button>
    </div>
  );
}
