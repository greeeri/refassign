"use client";

import { useEffect, useMemo, useState } from "react";

type Organization = {
  id: string;
  name: string;
  official_count: number;
  game_count: number;
  member_count: number;
  subscription_status: string | null;
};

type Official = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  email: string | null;
  active: boolean;
  auth_user_id: string | null;
  protected: boolean;
};

export default function SuperAdminResourceManager() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [officials, setOfficials] = useState<Official[]>([]);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setError("");
    const response = await fetch("/api/super-admin/resources", {
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok)
      return setError(result.error || "Unable to load records.");
    setOrganizations(result.organizations || []);
    setOfficials(result.officials || []);
  }

  useEffect(() => {
    void load();
  }, []);

  const visibleOfficials = useMemo(() => {
    const value = query.trim().toLowerCase();
    return officials
      .filter(
        (official) =>
          !value ||
          `${official.first_name || ""} ${official.last_name || ""} ${official.full_name || ""} ${official.email || ""}`
            .toLowerCase()
            .includes(value),
      )
      .slice(0, 100);
  }, [officials, query]);

  async function remove(
    type: "official" | "organization",
    id: string,
    required: string,
  ) {
    const warning =
      type === "organization"
        ? "This permanently removes the organization, its games, memberships, settings, and organization-linked history. Officials remain in the master directory."
        : "This permanently removes the official and their assignment and development history. A linked login account is not deleted.";
    const confirmation = window.prompt(
      `${warning}\n\nType ${required} to continue:`,
    );
    if (confirmation === null) return;
    setBusyId(id);
    setError("");
    setNotice("");
    const response = await fetch("/api/super-admin/resources", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, id, confirmation }),
    });
    const result = await response.json();
    if (!response.ok) setError(result.error || "Delete failed.");
    else {
      setNotice(
        `${type === "organization" ? "Organization" : "Official"} deleted.`,
      );
      await load();
    }
    setBusyId("");
  }

  return (
    <>
      <section className="card">
        <div className="cardHead">
          <div>
            <h2>Organization Management</h2>
            <p>
              Permanent deletion is restricted to the protected Super Admin.
            </p>
          </div>
        </div>
        {error && <div className="errorBox">{error}</div>}
        {notice && <div className="loginMessage">{notice}</div>}
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Organization</th>
                <th>Users</th>
                <th>Officials</th>
                <th>Games</th>
                <th>Subscription</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {organizations.map((organization) => {
                const billingBlocked = [
                  "active",
                  "trialing",
                  "past_due",
                  "unpaid",
                  "incomplete",
                ].includes(
                  (organization.subscription_status || "").toLowerCase(),
                );
                return (
                  <tr key={organization.id}>
                    <td>
                      <b>{organization.name}</b>
                    </td>
                    <td>{organization.member_count}</td>
                    <td>{organization.official_count}</td>
                    <td>{organization.game_count}</td>
                    <td>{organization.subscription_status || "None"}</td>
                    <td>
                      <button
                        className="danger"
                        disabled={busyId === organization.id || billingBlocked}
                        title={
                          billingBlocked
                            ? "Cancel billing before deleting this organization."
                            : undefined
                        }
                        onClick={() =>
                          void remove(
                            "organization",
                            organization.id,
                            organization.name,
                          )
                        }
                      >
                        {busyId === organization.id
                          ? "Deleting…"
                          : "Delete Organization"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="cardHead">
          <div>
            <h2>Official Record Management</h2>
            <p>
              Search the complete master directory. The first 100 matches are
              shown.
            </p>
          </div>
          <span className="badge">{officials.length} total</span>
        </div>
        <label>
          Search officials
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name or email"
          />
        </label>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Official</th>
                <th>Login</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleOfficials.map((official) => {
                const name =
                  `${official.first_name || ""} ${official.last_name || ""}`.trim() ||
                  official.full_name ||
                  "Official";
                return (
                  <tr key={official.id}>
                    <td>
                      <b>{name}</b>
                      <small>{official.email || "No email"}</small>
                    </td>
                    <td>
                      {official.auth_user_id ? "Linked" : "Directory only"}
                    </td>
                    <td>{official.active ? "Active" : "Inactive"}</td>
                    <td>
                      <button
                        className="danger"
                        disabled={busyId === official.id || official.protected}
                        onClick={() =>
                          void remove(
                            "official",
                            official.id,
                            official.email || name,
                          )
                        }
                      >
                        {official.protected
                          ? "Protected"
                          : busyId === official.id
                            ? "Deleting…"
                            : "Delete Official"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
