"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { RefAssignMark } from "../../components/BrandMarks";
import GamesManager from "../../components/SortableGamesManager";
import GameSetup from "../../components/GameSetup";
import AssignmentsManager from "../../components/AssignmentsManagerV2";
import OfficialsDirectory from "../../components/OfficialsDirectory";
import OrganizationTeamManager from "../../components/OrganizationTeamManager";
import AvailabilityCalendar from "../../components/AvailabilityCalendar";
import BlockRemovalRequests from "../../components/BlockRemovalRequests";
import DashboardGames from "../../components/DashboardGames";
import ContactsManager from "../../components/ContactsManager";
import AutoAssignManager from "../../components/AutoAssignManager";
import OfficialDashboard from "../../components/OfficialDashboard";
import OfficialProfile from "../../components/OfficialProfile";
import OfficialSchedule from "../../components/OfficialSchedule";
import SelfAssignBoard from "../../components/SelfAssignBoard";
import AuditHistoryManager from "../../components/AuditHistoryManager";
import UndoCenter from "../../components/UndoCenter";
import PayrollManager from "../../components/PayrollManager";
import MileageCoordinatesManager from "../../components/MileageCoordinatesManager";
import SportsRulesManager from "../../components/SportsRulesManager";
import RegistrarManager from "../../components/RegistrarManager";
import SuperAdminManager from "../../components/SuperAdminManager";
import IowaSoccerDevelopment from "../../components/IowaSoccerDevelopment";
import IowaSoccerDevelopmentAdmin from "../../components/IowaSoccerDevelopmentAdmin";
import IowaProgramReferees from "../../components/IowaProgramReferees";
import IowaDevelopmentMentors from "../../components/IowaDevelopmentMentors";
const setupNav = ["Leagues", "Levels", "Teams", "Locations"] as const;
type SetupView = (typeof setupNav)[number];
type Role =
  | "admin"
  | "assignor"
  | "league_admin"
  | "registrar"
  | "official"
  | "mentor"
  | "contact";
type TestWorkspace = {
  organization_id: string;
  name: string;
  role: "owner" | "admin" | "assignor" | "billing" | "viewer" | "official";
  viewer_permissions: string[];
};
const labels: Record<Role, string> = {
  admin: "Admin",
  assignor: "Assignor",
  league_admin: "League Admin",
  registrar: "Registrar",
  official: "Official",
  mentor: "Mentor",
  contact: "Contact",
};
const Icon = ({ children }: { children: string }) => (
  <span className="sideNavIcon" aria-hidden="true">
    {children}
  </span>
);
export default function Workspace() {
  const supabase = useMemo(() => createClient(), []);
  const [section, setSection] = useState("Dashboard"),
    [roles, setRoles] = useState<Role[]>([]),
    [viewRole, setViewRole] = useState<Role>("admin"),
    [isSuperAdmin, setIsSuperAdmin] = useState(false),
    [iowaDevelopmentAccess, setIowaDevelopmentAccess] = useState(false),
    [iowaDevelopmentStaff, setIowaDevelopmentStaff] = useState(false),
    [iowaMentorAccess, setIowaMentorAccess] = useState(false),
    [mobileNavOpen, setMobileNavOpen] = useState(false),
    [ready, setReady] = useState(false),
    [openNav, setOpenNav] = useState<string | null>(null),
    [testMode, setTestMode] = useState(false),
    [testOfficialAccount, setTestOfficialAccount] = useState(false),
    [testWorkspaces, setTestWorkspaces] = useState<TestWorkspace[]>([]),
    [testWorkspace, setTestWorkspace] = useState<TestWorkspace | null>(null),
    [invitationClaimError, setInvitationClaimError] = useState("");
  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        window.location.replace("/login");
        return;
      }
      if (window.location.hostname === "test.ref-assign.com") {
        setTestMode(true);
        setTestOfficialAccount(Boolean(user.user_metadata?.account_type === "official" || user.user_metadata?.first_name));
        const hashInvitation = new URLSearchParams(
          window.location.hash.slice(1),
        ).get("official_invite");
        const invitationId =
          hashInvitation ||
          localStorage.getItem("refassign-official-invitation") ||
          (typeof user.user_metadata?.official_invitation_id === "string"
            ? user.user_metadata.official_invitation_id
            : "");
        if (invitationId) {
          const { error: claimError } = await supabase.rpc(
            "claim_official_invitation",
            { p_invitation_id: invitationId },
          );
          if (claimError) setInvitationClaimError(claimError.message);
          else {
            localStorage.removeItem("refassign-official-invitation");
            if (hashInvitation)
              window.history.replaceState(null, "", window.location.pathname);
          }
        }
        await Promise.all([
          supabase.rpc("accept_my_organization_invitations"),
          supabase.rpc("accept_my_official_invitations"),
        ]);
        const { data, error } = await supabase.rpc("get_my_test_workspaces");
        if (error) {
          console.error(error);
          setReady(true);
          return;
        }
        const available = (data || []) as TestWorkspace[];
        const requested = new URLSearchParams(window.location.search).get(
          "organization",
        );
        const stored = localStorage.getItem("refassign-last-test-workspace");
        const selected =
          available.find(
            (item) => item.organization_id === (requested || stored),
          ) ||
          available[0] ||
          null;
        setTestWorkspaces(available);
        setTestWorkspace(selected);
        if (selected)
          localStorage.setItem(
            "refassign-last-test-workspace",
            selected.organization_id,
          );
        const mapped: Role =
          selected?.role === "official"
            ? "official"
            : selected?.role === "assignor"
            ? "assignor"
            : selected?.role === "viewer" || selected?.role === "billing"
              ? "contact"
              : "admin";
        setRoles([mapped]);
        setViewRole(mapped);
        setSection(mapped === "official" ? "Official Dashboard" : "Dashboard");
        setReady(true);
        return;
      }
      const [
        { data },
        { data: superAccess },
        { data: dev },
        { data: staff },
        { data: mentor },
      ] = await Promise.all([
        supabase.rpc("current_user_roles"),
        supabase.rpc("is_super_admin"),
        supabase.rpc("has_iowa_soccer_development_access"),
        supabase.rpc("is_iowa_soccer_development_staff"),
        supabase.rpc("is_iowa_soccer_development_mentor"),
      ]);
      setIsSuperAdmin(Boolean(superAccess));
      setIowaDevelopmentAccess(Boolean(dev));
      setIowaDevelopmentStaff(Boolean(staff));
      setIowaMentorAccess(Boolean(mentor));
      const found = (data || []) as Role[],
        available =
          Boolean(mentor) && !found.includes("mentor")
            ? [...found, "mentor" as Role]
            : found;
      setRoles(available);
      const saved = localStorage.getItem("refassign-view-role") as Role | null,
        initial =
          saved && available.includes(saved)
            ? saved
            : available[0] || "official";
      setViewRole(initial);
      setSection(
        initial === "official"
          ? "Official Dashboard"
          : initial === "mentor"
            ? "Development Mentors"
            : initial === "registrar" || initial === "league_admin"
              ? "Registrar"
              : "Dashboard",
      );
      setReady(true);
    }
    void load();
  }, [supabase]);
  const manager = viewRole === "admin" || viewRole === "assignor",
    isSetup = setupNav.includes(section as SetupView),
    isOfficials = ["Officials", "Blocks", "Block Removal Requests"].includes(
      section,
    ),
    officialIowaSections = ["Registrar", "Iowa Soccer Development"],
    officialIowaMode =
      viewRole === "official" && officialIowaSections.includes(section),
    iowaAdminView = viewRole === "admin";
  function nav(view: string) {
    setSection(view);
    setMobileNavOpen(false);
  }
  function switchRole(role: Role) {
    setViewRole(role);
    localStorage.setItem("refassign-view-role", role);
    setSection(
      role === "official"
        ? "Official Dashboard"
        : role === "mentor"
          ? "Development Mentors"
          : role === "registrar" || role === "league_admin"
            ? "Registrar"
            : "Dashboard",
    );
  }
  async function signOut() {
    await supabase.auth.signOut();
    location.href = "/login";
  }
  function switchTestWorkspace(organizationId: string) {
    const next = testWorkspaces.find(
      (item) => item.organization_id === organizationId,
    );
    if (!next) return;
    localStorage.setItem("refassign-last-test-workspace", next.organization_id);
    window.location.assign(`/workspace?organization=${next.organization_id}`);
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
  const group = (
    name: string,
    icon: string,
    views: { view: string; label: string }[],
  ) => {
    const active = views.some((x) => x.view === section),
      open = openNav === name || active;
    return (
      <div className="collapsibleNavGroup">
        <button
          className={`navGroupButton ${active ? "active" : ""}`}
          onClick={() => setOpenNav(openNav === name ? null : name)}
        >
          <Icon>{icon}</Icon>
          <span>{name}</span>
          <b>{open ? "⌄" : "›"}</b>
        </button>
        {open && (
          <div className="navChildren">
            {views.map((x) => (
              <button
                key={x.view}
                className={section === x.view ? "active childActive" : ""}
                onClick={() => nav(x.view)}
              >
                {x.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };
  const iowaViews: { view: string; label: string }[] = [];
  if (
    viewRole === "registrar" ||
    viewRole === "league_admin" ||
    iowaDevelopmentStaff
  )
    iowaViews.push({ view: "Registrar", label: "Registration" });
  if (iowaDevelopmentStaff)
    iowaViews.push({ view: "Development Admin", label: "Training" });
  if (iowaAdminView)
    iowaViews.push({ view: "Program Referees", label: "Program Referees" });
  if (viewRole === "mentor" && iowaMentorAccess)
    iowaViews.push(
      { view: "Program Referees", label: "Program Referees" },
      { view: "Development Mentors", label: "🧠 Mentors" },
    );
  const iowaGroup = () => {
    if (!iowaViews.length) return null;
    const active = iowaViews.some((x) => x.view === section),
      open = openNav === "Iowa Soccer" || active;
    return (
      <div className="collapsibleNavGroup iowaSoccerNavGroup">
        <button
          className={`navGroupButton iowaSoccerNavButton ${active ? "active" : ""}`}
          onClick={() =>
            setOpenNav(openNav === "Iowa Soccer" ? null : "Iowa Soccer")
          }
        >
          <span>Iowa Soccer</span>
          <b>{open ? "⌄" : "›"}</b>
        </button>
        {open && (
          <div className="navChildren">
            {iowaViews.map((x) => (
              <button
                key={x.view}
                className={section === x.view ? "active childActive" : ""}
                onClick={() => nav(x.view)}
              >
                {x.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };
  if (testMode && !testWorkspace)
    return (
      <div className="shell refAssignBranded">
        <main>
          <section className="card">
            <h1>{testOfficialAccount ? "No officiating organizations connected" : "No organization workspace"}</h1>
            <p>{testOfficialAccount ? invitationClaimError || "This account is valid, but it has not claimed an organization invitation yet. Ask the organization to resend the invitation, then open the new email link while signed in." : "Create an organization or accept an invitation before entering RefAssign."}</p>
            {testOfficialAccount ? <button className="primary" onClick={signOut}>Sign out and use invitation</button> : <a className="primary" href="/tier-test">Open organization setup</a>}
          </section>
        </main>
      </div>
    );
  return (
    <div className="shell refAssignBranded">
      {mobileNavOpen && (
        <button
          className="mobileNavBackdrop"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside
        id="primary-navigation"
        className={mobileNavOpen ? "mobileNavOpen" : ""}
      >
        <div className="workspaceBrand">
          <RefAssignMark className="workspaceBrandMark" />
          <div>
            <div className="brand">
              REF<span>ASSIGN</span>
            </div>
            <div className="tag">ASSIGN • DEVELOP • MANAGE</div>
          </div>
        </div>
        <nav>
          {manager && (
            <>
              <button
                className={`topNavButton ${section === "Dashboard" ? "active" : ""}`}
                onClick={() => nav("Dashboard")}
              >
                <Icon>⌂</Icon>
                <span>Dashboard</span>
              </button>
              {group("Games", "▣", [
                { view: "Games", label: "Game List / Import" },
                { view: "Leagues", label: "Leagues" },
                { view: "Levels", label: "Levels" },
                { view: "Teams", label: "Teams" },
                { view: "Locations", label: "Locations" },
              ])}
              {group("Assignments", "✓", [
                { view: "Assignments", label: "Assignment Center" },
                { view: "Auto Assign", label: "AutoAssign" },
                { view: "Payroll", label: "Payroll & Game Fees" },
              ])}
              {group("Officials", "♟", [
                { view: "Officials", label: "Official Directory" },
                { view: "Blocks", label: "Availability / Blocks" },
                {
                  view: "Block Removal Requests",
                  label: "Block Removal Requests",
                },
              ])}
              {testMode && testWorkspace && (
                <button
                  className={`topNavButton ${section === "Team & Roles" ? "active" : ""}`}
                  onClick={() => nav("Team & Roles")}
                >
                  <Icon>♙</Icon>
                  <span>Team &amp; Roles</span>
                </button>
              )}
              {iowaGroup()}
              <button
                className={`topNavButton ${section === "Audit History" ? "active" : ""}`}
                onClick={() => nav("Audit History")}
              >
                <Icon>▤</Icon>
                <span>Audit History</span>
              </button>
              <button
                className={`topNavButton ${section === "Contacts" ? "active" : ""}`}
                onClick={() => nav("Contacts")}
              >
                <Icon>✉</Icon>
                <span>Contacts</span>
              </button>
              <button
                className={`topNavButton ${section === "Sports & Rules" ? "active" : ""}`}
                onClick={() => nav("Sports & Rules")}
              >
                <Icon>⚙</Icon>
                <span>Sports & Rules</span>
              </button>
            </>
          )}
          {viewRole === "official" && (
            <>
              {officialIowaMode ? (
                <>
                  <button
                    className={`topNavButton ${section === "Registrar" ? "active" : ""}`}
                    onClick={() => nav("Registrar")}
                  >
                    Registration
                  </button>
                  <button
                    className={`topNavButton ${section === "Iowa Soccer Development" ? "active" : ""}`}
                    onClick={() => nav("Iowa Soccer Development")}
                  >
                    Training
                  </button>
                </>
              ) : (
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
                      className={`topNavButton ${section === n ? "active" : ""}`}
                      onClick={() => nav(n)}
                    >
                      {n}
                    </button>
                  ))}
                  {iowaDevelopmentAccess && (
                    <button
                      className={`topNavButton ${section === "Iowa Soccer Development" ? "active" : ""}`}
                      onClick={() => nav("Iowa Soccer Development")}
                    >
                      <span>Iowa Soccer Development</span>
                    </button>
                  )}
                </>
              )}
            </>
          )}
          {viewRole === "contact" &&
            ["Dashboard", "Games"].map((n) => (
              <button
                key={n}
                className={`topNavButton ${section === n ? "active" : ""}`}
                onClick={() => nav(n)}
              >
                {n}
              </button>
            ))}
          {!manager &&
            viewRole !== "official" &&
            viewRole !== "contact" &&
            iowaGroup()}
          {isSuperAdmin && !officialIowaMode && (
            <button
              className={`topNavButton ${section === "Super Admin" ? "active" : ""}`}
              onClick={() => nav("Super Admin")}
            >
              Super Admin
            </button>
          )}
        </nav>
        <div className="asideFoot">
          <span className="workspaceParentBrand">REF PRO GROUP</span>
          <br />
          Powering Better Officiating
          <br />
          <a
            href="/privacy"
            style={{
              display: "inline-block",
              marginTop: 8,
              color: "inherit",
              textDecoration: "underline",
            }}
          >
            Privacy Policy
          </a>{" "}
          <span>•</span>{" "}
          <a
            href="/terms"
            style={{ color: "inherit", textDecoration: "underline" }}
          >
            Terms &amp; Conditions
          </a>
          <br />
          <button className="signOutButton" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>
      <main className={manager ? "assignorWorkspace" : ""}>
        <header>
          {manager && (
            <button
              className="mobileMenuButton"
              aria-label="Open navigation"
              onClick={() => setMobileNavOpen(true)}
            >
              ☰
            </button>
          )}
          <div>
            <h1>
              {isSetup
                ? `Games — ${section}`
                : isOfficials
                  ? `Officials — ${section === "Officials" ? "Directory" : section}`
                  : section}
            </h1>
            <p>
              {viewRole === "official"
                ? "Official workspace"
                : manager
                  ? "RefAssign scheduling workspace"
                  : "RefAssign workspace"}
            </p>
          </div>
          <div className="headerActions">
            {testMode && (
              <button className="secondary" onClick={signOut}>
                Sign out / switch account
              </button>
            )}
            {testMode && testWorkspace && (
              <label style={{ fontSize: 12, fontWeight: 800 }}>
                Organization
                <select
                  value={testWorkspace.organization_id}
                  onChange={(event) => switchTestWorkspace(event.target.value)}
                  style={{ marginLeft: 8, width: "auto", minWidth: 150 }}
                >
                  {testWorkspaces.map((item) => (
                    <option
                      key={item.organization_id}
                      value={item.organization_id}
                    >
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
          </div>
        </header>
        {manager && section === "Dashboard" && (
          <DashboardGames onNavigate={setSection} />
        )}{" "}
        {manager && section === "Games" && <GamesManager />}
        {manager && isSetup && (
          <GameSetup
            view={section as SetupView}
            organizationId={testWorkspace?.organization_id}
          />
        )}{" "}
        {manager && section === "Officials" && (
          <OfficialsDirectory organizationId={testWorkspace?.organization_id} />
        )}
        {manager && testWorkspace && section === "Team & Roles" && (
          <OrganizationTeamManager
            organizationId={testWorkspace.organization_id}
            organization={testWorkspace.name}
            canManage={testWorkspace.role === "owner" || testWorkspace.role === "admin"}
          />
        )}
        {manager && section === "Assignments" && <AssignmentsManager />}
        {manager && section === "Audit History" && <AuditHistoryManager />}
        {manager && section === "Auto Assign" && <AutoAssignManager />}
        {manager && section === "Payroll" && (
          <>
            <PayrollManager />
            <MileageCoordinatesManager />
          </>
        )}
        {manager && section === "Blocks" && (
          <AvailabilityCalendar managerView />
        )}
        {manager && section === "Block Removal Requests" && (
          <BlockRemovalRequests />
        )}
        {manager && section === "Contacts" && <ContactsManager />}
        {manager && section === "Sports & Rules" && <SportsRulesManager />}
        {viewRole === "official" && section === "Official Dashboard" && (
          <>
            {testMode && testWorkspace && (
              <section className="card officialOrganizationsCard">
                <div>
                  <p className="eyebrow">My organizations</p>
                  <h2>Officiating organizations</h2>
                  <p>
                    Select an organization to view its games, assignments,
                    availability, and schedule.
                  </p>
                </div>
                <div className="officialOrganizationChoices">
                  {testWorkspaces.map((item) => (
                    <button
                      type="button"
                      key={item.organization_id}
                      className={
                        item.organization_id === testWorkspace.organization_id
                          ? "officialOrganizationChoice active"
                          : "officialOrganizationChoice"
                      }
                      onClick={() =>
                        switchTestWorkspace(item.organization_id)
                      }
                    >
                      <span>{item.name}</span>
                      <small>
                        {item.organization_id === testWorkspace.organization_id
                          ? "Currently viewing"
                          : "Open organization"}
                      </small>
                    </button>
                  ))}
                </div>
                {testWorkspaces.length === 1 && (
                  <p className="officialOrganizationHint">
                    One organization is currently connected. Additional
                    organizations will appear here after you accept their
                    invitations.
                  </p>
                )}
              </section>
            )}
            <OfficialDashboard onNavigate={setSection} />
          </>
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
        {viewRole === "official" && section === "Iowa Soccer Development" && (
          <IowaSoccerDevelopment />
        )}
        {viewRole === "contact" && section === "Dashboard" && (
          <section className="card">
            <h2>Contact Dashboard</h2>
            <button className="primary" onClick={() => nav("Games")}>
              View Games
            </button>
          </section>
        )}
        {viewRole === "contact" && section === "Games" && <DashboardGames />}
        {(viewRole === "registrar" ||
          viewRole === "league_admin" ||
          iowaDevelopmentStaff) &&
          section === "Registrar" && <RegistrarManager />}
        {iowaDevelopmentStaff && section === "Development Admin" && (
          <IowaSoccerDevelopmentAdmin />
        )}
        {iowaAdminView && section === "Program Referees" && (
          <IowaProgramReferees canManage />
        )}
        {viewRole === "mentor" &&
          iowaMentorAccess &&
          section === "Program Referees" && <IowaProgramReferees />}
        {viewRole === "mentor" &&
          iowaMentorAccess &&
          section === "Development Mentors" && <IowaDevelopmentMentors />}
        {isSuperAdmin && section === "Super Admin" && <SuperAdminManager />}
        {manager && <UndoCenter />}
      </main>
      {manager && (
        <nav className="assignorMobileNav">
          {[
            ["Dashboard", "Dashboard", "⌂"],
            ["Games", "Games", "▣"],
            ["Assignments", "Assign", "✓"],
            ["Officials", "Officials", "♟"],
          ].map(([v, l, i]) => (
            <button
              key={v}
              className={section === v ? "active" : ""}
              onClick={() => nav(v)}
            >
              <span>{i}</span>
              {l}
            </button>
          ))}
          <button onClick={() => setMobileNavOpen(true)}>
            <span>☰</span>More
          </button>
        </nav>
      )}
    </div>
  );
}
