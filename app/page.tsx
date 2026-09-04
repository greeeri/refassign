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
import SelfAssignBoard from "../components/SelfAssignBoard";
import AuditHistoryManager from "../components/AuditHistoryManager";
import UndoCenter from "../components/UndoCenter";
import PayrollManager from "../components/PayrollManager";
import SportsRulesManager from "../components/SportsRulesManager";
import RegistrarManager from "../components/RegistrarManager";
import SuperAdminManager from "../components/SuperAdminManager";
import IowaSoccerDevelopment from "../components/IowaSoccerDevelopment";
import IowaSoccerDevelopmentAdmin from "../components/IowaSoccerDevelopmentAdmin";
import IowaProgramReferees from "../components/IowaProgramReferees";
import IowaDevelopmentMentors from "../components/IowaDevelopmentMentors";
const adminNav = [
  "Dashboard",
  "Games",
  "Audit History",
  "Contacts",
  "Sports & Rules",
];
const setupNav = ["Leagues", "Levels", "Teams", "Locations"] as const;
const gameSetupNav = ["Leagues", "Levels", "Teams", "Locations"] as const;
const assignmentsNav = [
  ["Assignments", "Assignment Center"],
  ["Auto Assign", "Auto Assign"],
  ["Payroll", "Payroll & Game Fees"],
] as const;
const officialsNav = [
  ["Officials", "Directory"],
  ["Blocks", "Blocks"],
  ["Block Removal Requests", "Block Removal Requests"],
] as const;
type SetupView = (typeof setupNav)[number];
type Role = "admin" | "assignor" | "league_admin" | "registrar" | "official" | "contact";
const labels: Record<Role, string> = {
  admin: "Admin",
  assignor: "Assignor",
  league_admin: "League Admin",
  registrar: "Registrar",
  official: "Official",
  contact: "Contact",
};
export default function Home() {
  const supabase = useMemo(() => createClient(), []);
  const [section, setSection] = useState("Dashboard"),
    [roles, setRoles] = useState<Role[]>([]),
    [viewRole, setViewRole] = useState<Role>("admin"),
    [isSuperAdmin, setIsSuperAdmin] = useState(false),
    [iowaDevelopmentAccess, setIowaDevelopmentAccess] = useState(false),
    [iowaDevelopmentStaff, setIowaDevelopmentStaff] = useState(false),
    [iowaMentorAccess, setIowaMentorAccess] = useState(false),
    [ready, setReady] = useState(false);
  useEffect(() => {
    async function loadRoles() {
      const [{ data }, { data: superAccess }, { data: developmentAccess }, { data: developmentStaff }, { data: mentorAccess }] = await Promise.all([
        supabase.rpc("current_user_roles"),
        supabase.rpc("is_super_admin"),
        supabase.rpc("has_iowa_soccer_development_access"),
        supabase.rpc("is_iowa_soccer_development_staff"),
        supabase.rpc("is_iowa_soccer_development_mentor"),
      ]);
      setIsSuperAdmin(Boolean(superAccess));
      setIowaDevelopmentAccess(Boolean(developmentAccess));
      setIowaDevelopmentStaff(Boolean(developmentStaff));
      setIowaMentorAccess(Boolean(mentorAccess));
      const found = (data || []) as Role[];
      setRoles(found);
      const saved = window.localStorage.getItem(
        "refassign-view-role",
      ) as Role | null;
      const initial =
        saved && found.includes(saved) ? saved : found[0] || "official";
      setViewRole(initial);
      setSection(
        initial === "official"
          ? "Official Dashboard"
          : initial === "registrar" || initial === "league_admin"
            ? "Registrar"
            : "Dashboard",
      );
      setReady(true);
    }
    void loadRoles();
  }, [supabase]);
  const isSetup = gameSetupNav.some((view) => view === section);
  const isCoreSetup = setupNav.includes(section as SetupView);
  const isOfficials = officialsNav.some(([view]) => view === section);
  const manager = viewRole === "admin" || viewRole === "assignor";
  const iowaPageName =
    section === "Registrar" && iowaDevelopmentStaff
      ? "Registration"
      : section === "Development Admin" && iowaDevelopmentStaff
        ? "Program Administration"
        : section === "Program Referees" && (iowaDevelopmentStaff || iowaMentorAccess)
          ? "Program Referees"
          : section === "Development Mentors" && iowaDevelopmentStaff
            ? "Development Mentors"
          : section === "Development Mentors" && iowaMentorAccess
            ? "Mentor Center"
        : section === "Iowa Soccer Development" && iowaDevelopmentAccess
          ? "Official Development"
          : null;
  function switchRole(role: Role) {
    setViewRole(role);
    window.localStorage.setItem("refassign-view-role", role);
    setSection(
      role === "official"
        ? "Official Dashboard"
        : role === "registrar" || role === "league_admin"
          ? "Registrar"
          : "Dashboard",
    );
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
                <div className="navParent">Assignments</div>
                {assignmentsNav.map(([view, label]) => (
                  <button
                    key={view}
                    className={`subNav ${section === view ? "active" : ""}`}
                    onClick={() => setSection(view)}
                  >
                    {label}
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
              {adminNav.slice(2).map((n) => (
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
                ...(iowaDevelopmentAccess ? ["Iowa Soccer Development"] : []),
                ...(iowaMentorAccess ? ["Program Referees"] : []),
                ...(iowaMentorAccess ? ["Development Mentors"] : []),
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
          {viewRole === "registrar" && (
            <button className={section === "Registrar" ? "active" : ""} onClick={() => setSection("Registrar")}>Registration</button>
          )}
          {viewRole === "league_admin" && (
            <button className={section === "Registrar" ? "active" : ""} onClick={() => setSection("Registrar")}>League Registration</button>
          )}
          {iowaDevelopmentStaff && viewRole !== "registrar" && viewRole !== "league_admin" && (
            <button className={section === "Registrar" ? "active" : ""} onClick={() => setSection("Registrar")}>Iowa Soccer Registration</button>
          )}
          {iowaDevelopmentStaff && viewRole !== "official" && (
            <><button className={section === "Development Admin" ? "active" : ""} onClick={() => setSection("Development Admin")}>Iowa Soccer Development</button><button className={section === "Program Referees" ? "active" : ""} onClick={() => setSection("Program Referees")}>Program Referees</button><button className={section === "Development Mentors" ? "active" : ""} onClick={() => setSection("Development Mentors")}>Mentors</button></>
          )}
          {isSuperAdmin && (
            <button className={section === "Super Admin" ? "active" : ""} onClick={() => setSection("Super Admin")}>Super Admin</button>
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
            <h1>
              {iowaPageName
                ? "Iowa Soccer Referee Development Program"
                : isSetup
                ? `Game Setup — ${section}`
                : isOfficials
                  ? `Officials — ${section === "Officials" ? "Directory" : section}`
                  : section}
            </h1>
            <p>
              {iowaPageName
                ? iowaPageName
                : viewRole === "official"
                ? "Official workspace"
                : viewRole === "registrar" || viewRole === "league_admin"
                  ? "Registrar workspace"
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
            {manager && !iowaPageName && (
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
        {manager && isCoreSetup && (
          <GameSetup view={section as SetupView} />
        )}{" "}
        {manager && section === "Officials" && <OfficialsDirectory />}
        {manager && section === "Assignments" && <AssignmentsManager />}
        {manager && section === "Audit History" && <AuditHistoryManager />}
        {manager && section === "Auto Assign" && <AutoAssignManager />}
        {manager && section === "Payroll" && <PayrollManager />}
        {manager && section === "Blocks" && (
          <AvailabilityCalendar managerView />
        )}
        {manager && section === "Block Removal Requests" && (
          <BlockRemovalRequests />
        )}
        {manager && section === "Contacts" && <ContactsManager />}
        {manager && section === "Sports & Rules" && <SportsRulesManager />}
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
        {viewRole === "official" && section === "Iowa Soccer Development" && iowaDevelopmentAccess && (
          <IowaSoccerDevelopment />
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
        {(viewRole === "registrar" || viewRole === "league_admin" || iowaDevelopmentStaff) && section === "Registrar" && (
          <RegistrarManager />
        )}
        {iowaDevelopmentStaff && section === "Development Admin" && (
          <IowaSoccerDevelopmentAdmin />
        )}
        {(iowaDevelopmentStaff || iowaMentorAccess) && section === "Program Referees" && (
          <IowaProgramReferees />
        )}
        {(iowaDevelopmentStaff || iowaMentorAccess) && section === "Development Mentors" && (
          <IowaDevelopmentMentors />
        )}
        {isSuperAdmin && section === "Super Admin" && <SuperAdminManager />}
        {manager && <UndoCenter />}
      </main>
    </div>
  );
}
