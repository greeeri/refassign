"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "../lib/supabase/client";
import GamesManager from "../components/SortableGamesManager";
import GameSetup from "../components/GameSetup";
import AssignmentsManager from "../components/AssignmentsManagerV2";
import OfficialsDirectory from "../components/OfficialsDirectory";
import AvailabilityCalendar from "../components/AvailabilityCalendar";
import BlockRemovalRequests from "../components/BlockRemovalRequests";
import DashboardGames from "../components/DashboardGames";
import ContactsManager from "../components/ContactsManager";
import AutoAssignManager from "../components/AutoAssignManager";
import OfficialDashboard from "../components/OfficialDashboard";
import OfficialProfile from "../components/OfficialProfile";
import OfficialSchedule from "../components/OfficialSchedule";
import PowerRankingsManager from "../components/PowerRankingsManager";
import SelfAssignBoard from "../components/SelfAssignBoard";
import AuditHistoryManager from "../components/AuditHistoryManager";
import CommunicationCenter from "../components/CommunicationCenter";
import UndoCenter from "../components/UndoCenter";
const adminNav = [
  "Dashboard",
  "Games",
  "Officials",
  "Assignments",
  "Communications",
  "Audit History",
  "Auto Assign",
  "Contacts",
  "Sports & Rules",
];
const setupNav = ["Leagues", "Levels", "Teams", "Locations"] as const;
const gameSetupNav = ["Leagues", "Levels", "Teams", "Power Rankings", "Locations"] as const;
const officialsNav = [
  ["Officials", "Directory"],
  ["Blocks", "Blocks"],
  ["Block Removal Requests", "Block Removal Requests"],
] as const;
type SetupView = (typeof setupNav)[number];
type Role = "admin" | "assignor" | "official" | "contact";
const labels: Record<Role, string> = {
  admin: "Admin",
  assignor: "Assignor",
  official: "Official",
  contact: "Contact",
};
export default function Home() {
  const supabase = useMemo(() => createClient(), []);
  const [section, setSection] = useState("Dashboard"),
    [roles, setRoles] = useState<Role[]>([]),
    [viewRole, setViewRole] = useState<Role>("admin"),
    [ready, setReady] = useState(false);
  useEffect(() => {
    async function loadRoles() {
      const { data } = await supabase.rpc("current_user_roles");
      const found = (data || []) as Role[];
      setRoles(found);
      const saved = window.localStorage.getItem(
        "refassign-view-role",
      ) as Role | null;
      const initial =
        saved && found.includes(saved) ? saved : found[0] || "official";
      setViewRole(initial);
      setSection(initial === "official" ? "Official Dashboard" : "Dashboard");
      setReady(true);
    }
    void loadRoles();
  }, [supabase]);
  const isSetup = gameSetupNav.some((view) => view === section);
  const isCoreSetup = setupNav.includes(section as SetupView);
  const isOfficials = officialsNav.some(([view]) => view === section);
  const manager = viewRole === "admin" || viewRole === "assignor";
  function switchRole(role: Role) {
    setViewRole(role);
    window.localStorage.setItem("refassign-view-role", role);
    setSection(role === "official" ? "Official Dashboard" : "Dashboard");
  }
  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }
  if (!ready)
    return (
      <div className="shell">
        <main>
          <section className="card">
            <p>Loading workspace…</p>
          </section>
        </main>
      </div>
    );
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          Ref<span>Assign</span>
        </div>
        <div className="tag">OFFICIALS MANAGEMENT</div>
        <nav>
          {manager && (
            <>
              {adminNav.slice(0, 2).map((n) => (
                <button
                  key={n}
                  className={section === n ? "active" : ""}
                  onClick={() => setSection(n)}
                >
                  {n}
                </button>
              ))}
              <div className="navGroup">
                <div className="navParent">Game Setup</div>
                {gameSetupNav.map((n) => (
                  <button
                    key={n}
                    className={`subNav ${section === n ? "active" : ""}`}
                    onClick={() => setSection(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="navGroup">
                <div className="navParent">Officials</div>
                {officialsNav.map(([view, label]) => (
                  <button
                    key={view}
                    className={`subNav ${section === view ? "active" : ""}`}
                    onClick={() => setSection(view)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {adminNav.slice(3).map((n) => (
                <button
                  key={n}
                  className={section === n ? "active" : ""}
                  onClick={() => setSection(n)}
                >
                  {n}
                </button>
              ))}
            </>
          )}
          {viewRole === "official" && (
            <>
              {[
                "Official Dashboard",
                "Self Assign",
                "My Schedule",
                "My Availability",
                "My Profile",
              ].map((n) => (
                <button
                  key={n}
                  className={section === n ? "active" : ""}
                  onClick={() => setSection(n)}
                >
                  {n}
                </button>
              ))}
            </>
          )}
          {viewRole === "contact" && (
            <>
              {["Dashboard", "Games"].map((n) => (
                <button
                  key={n}
                  className={section === n ? "active" : ""}
                  onClick={() => setSection(n)}
                >
                  {n}
                </button>
              ))}
            </>
          )}
        </nav>
        <div className="asideFoot">
          Built for soccer.
          <br />
          Ready for every sport.
          <br />
          <button className="signOutButton" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <h1>{isSetup ? `Game Setup — ${section}` : isOfficials ? `Officials — ${section === "Officials" ? "Directory" : section}` : section}</h1>
            <p>
              {viewRole === "official"
                ? "Official workspace"
                : viewRole === "contact"
                  ? "Contact workspace"
                  : "RefAssign scheduling workspace"}
            </p>
          </div>
          <div className="headerActions">
            <label style={{ fontSize: 12, fontWeight: 800 }}>
              Viewing as
              <select
                value={viewRole}
                onChange={(e) => switchRole(e.target.value as Role)}
                style={{ marginLeft: 8, width: "auto", minWidth: 130 }}
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {labels[r]}
                  </option>
                ))}
              </select>
            </label>
            {manager && (
              <>
                <button
                  className="secondary"
                  onClick={() => setSection("Games")}
                >
                  Import Games
                </button>
                <button
                  onClick={() => setSection("Auto Assign")}
                  style={{
                    background: "#16a34a",
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "10px 14px",
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                  }}
                >
                  <span
                    style={{ color: "#facc15", fontSize: 17, lineHeight: 1 }}
                  >
                    ⚡
                  </span>
                  AutoAssign
                </button>
                <button className="primary" onClick={() => setSection("Games")}>
                  + Add Game
                </button>
              </>
            )}
          </div>
        </header>
        {manager && section === "Dashboard" && <DashboardGames />}
        {manager && section === "Games" && <GamesManager />}
        {manager && isCoreSetup && <GameSetup view={section as SetupView} />}{" "}
        {manager && section === "Officials" && <OfficialsDirectory />}
        {manager && section === "Power Rankings" && <PowerRankingsManager />}
        {manager && section === "Assignments" && <AssignmentsManager />}
        {manager && section === "Communications" && <CommunicationCenter />}
        {manager && section === "Audit History" && <AuditHistoryManager />}
        {manager && section === "Auto Assign" && <AutoAssignManager />}
        {manager && section === "Blocks" && (
          <AvailabilityCalendar managerView />
        )}
        {manager && section === "Block Removal Requests" && (
          <BlockRemovalRequests />
        )}
        {manager && section === "Contacts" && <ContactsManager />}
        {manager && section === "Sports & Rules" && (
          <section className="card">
            <h2>Sport Assignment Rules</h2>
            <div className="rule">
              <div>
                <b>Soccer</b>
                <small>
                  Center Referee • AR1 • AR2 • optional 4th Official • optional
                  Mentor
                </small>
              </div>
              <span className="badge blue">3 required</span>
            </div>
          </section>
        )}
        {viewRole === "official" && section === "Official Dashboard" && (
          <OfficialDashboard onNavigate={setSection} />
        )}{" "}
        {viewRole === "official" && section === "My Schedule" && (
          <OfficialSchedule />
        )}
        {viewRole === "official" && section === "Self Assign" && (
          <SelfAssignBoard />
        )}
        {viewRole === "official" && section === "My Availability" && (
          <AvailabilityCalendar />
        )}
        {viewRole === "official" && section === "My Profile" && (
          <OfficialProfile />
        )}
        {viewRole === "contact" && section === "Dashboard" && (
          <section className="card">
            <h2>Contact Dashboard</h2>
            <p>
              Your authorized game information is available from the Games
              section.
            </p>
            <button className="primary" onClick={() => setSection("Games")}>
              View Games
            </button>
          </section>
        )}
        {viewRole === "contact" && section === "Games" && <DashboardGames />}
        {manager && <UndoCenter />}
      </main>
    </div>
  );
}
