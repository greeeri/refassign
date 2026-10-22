const scopeHelpers = require("../../../tests/support/load-scope.cjs");
const { applyScopeFilter } = require("../../../tests/support/scope-query.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const json = (value) => JSON.parse(JSON.stringify(value));
function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports, Date, Error, Buffer,
    process: { env: { CRON_SECRET: "test", RESEND_API_KEY: "test" } },
    ...globals,
    require(name) {
      if (name === "next/server") return { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } };
      const mock = Object.entries(mocks).find(([suffix]) => name.endsWith(suffix));
      if (mock) return mock[1];
      if (name.endsWith("/server/organizationScope")) return scopeHelpers;
      if (name.endsWith("/supabase/readAll") || name.endsWith("/reportScope"))
        return load(path.resolve(path.dirname(file), name + ".ts"), mocks, globals);
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return module.exports;
}
function client(tables = {}, failures = {}) {
  const calls = [];
  const service = {
    calls,
    auth: { getUser: async () => ({ data: { user: { id: "user", email: "user@example.test" } } }) },
    from(table) {
      const call = { table, methods: [] };
      calls.push(call);
      const query = { then(resolve, reject) {
        const value = (row, key) => key.split(".").reduce((part, piece) => part?.[piece], row);
        let data = [...(tables[table] || [])];
        for (const [method, column, expected] of call.methods) {
          if (method === "or") data = data.filter((row) => applyScopeFilter(row,column,expected));
          if (method === "eq") data = data.filter((row) => value(row, column) === expected);
          if (method === "in") data = data.filter((row) => expected.includes(value(row, column)));
          if (method === "not" && expected === "is") data = data.filter((row) => value(row, column) != null);
        }
        const range = call.methods.findLast(([method]) => method === "range");
        if (range) data = data.slice(range[1], range[2] + 1);
        if (call.methods.some(([method]) => method === "maybeSingle" || method === "single")) data = data[0] || null;
        return Promise.resolve({ data, error: failures[table] || null }).then(resolve, reject);
      } };
      for (const method of ["select", "eq", "in", "not", "order", "range", "limit", "maybeSingle", "single", "update", "insert", "delete", "upsert", "gte", "lte", "or"])
        query[method] = (...args) => { call.methods.push([method, ...args]); return query; };
      return query;
    },
  };
  return service;
}
const helpers = load("app/api/reports/reportScope.ts");
const data = () => ({
  organizations: [{ id: "org", name: "Organization" }],
  refassign_subscriptions: [{ organization_id: "org", status: "active", reporting_access: "premium" }],
  official_league_eligibility: [{ official_id: "one", league_id: "league-a", location_id:"location-a" }, { official_id: "two", league_id: "league-b", location_id:"location-b" }, { official_id: "unlinked", league_id: "league-a", location_id:"location-a" }],
  organization_officials: ["one", "two", "historical"].map((official_id) => ({ organization_id: "org", official_id, active: true })),
  officials: [{ id: "one", auth_user_id: "user" }, { id: "two" }, { id: "historical" }],
  official_weekday_origins: ["one", "two", "historical", "stranger"].map((official_id) => ({ official_id, weekday: 0 })),
  games: [{ id: "game-a", organization_id: "org", league_id: "league-a", location_id:"location-a" }, { id: "game-b", organization_id: "org", league_id: "league-b", location_id:"location-b" }],
  assignments: [
    { id: "a", game_id: "game-a", official_id: "one", status: "accepted", games: { organization_id: "org", league_id: "league-a", location_id:"location-a" } },
    { id: "b", game_id: "game-b", official_id: "two", status: "accepted", games: { organization_id: "org", league_id: "league-b", location_id:"location-b" } },
    { id: "c", game_id: "game-b", official_id: "one", status: "confirmed", games: { organization_id: "org", league_id: "league-b", location_id:"location-b" } },
    { id: "d", game_id: "game-a", official_id: "historical", status: "accepted", games: { organization_id: "org", league_id: "league-a", location_id:"location-a" } },
  ],
});
function route(file, service, options = {}) {
  const scope = { service, session: service, user: { id: "user", email: "user@example.test" }, organizationId: "org", leagueIds: options.leagueIds ?? ["league-a"], fullOrganizationAccess: false, leagueAccess: (options.leagueIds ?? ["league-a"]).map(league_id => ({ league_id, all_locations:true, location_ids:[] })), ...options };
  return load(file, {
    "/supabase/admin": { createServiceClient: () => service },
    "/supabase/server": { createServerSupabaseClient: async () => service },
    "/server/organizationScope": { ...scopeHelpers, requireManagedOrganization: async () => scope, requireOrganizationOwner: async () => scope.fullOrganizationAccess ? scope : { error: { status: 403, body: { error: "Owner required" } } } },
  });
}
const request = (search = "scope=manager", body = {}) => ({ nextUrl: new URL(`https://example.test/api?organizationId=org&${search}`), json: async () => body });

test("empty and missing grants fail closed; null owner scope is unfiltered", async () => {
  const service = client(data());
  assert.equal((await helpers.scopeReportLeagues(service.from("games").select("id"), { leagueAccess:[] })).data.length, 0);
  assert.equal((await helpers.scopeReportLeagues(service.from("games").select("id"), undefined)).data.length, 0);
  assert.equal((await helpers.scopeReportLeagues(service.from("games").select("id"), { fullOrganizationAccess:true })).data.length, 2);
  assert.ok((await helpers.readReportOfficialLinks({ service, organizationId: "org" })).error);
});

test("scoped roster contains eligible or assigned officials, never other leagues or unlinked officials", async () => {
  const result = await helpers.readReportOfficialLinks({ service: client(data()), organizationId: "org", leagueIds: ["league-a"], leagueAccess:[{ league_id:"league-a", all_locations:true, location_ids:[] }] });
  assert.deepEqual(json(result.data.map((row) => row.official_id).sort()), ["historical", "one"]);
});

test("manager official reports filter assignments, officials and every origin", async () => {
  const service = client(data());
  const result = await route("app/api/reports/officials/route.ts", service).GET(request());
  assert.equal(result.status, 200);
  assert.deepEqual(json(result.body.assignments.map((row) => row.id)), ["a", "d"]);
  assert.deepEqual(json(result.body.officials.map((row) => row.id).sort()), ["historical", "one"]);
  assert.deepEqual(json(result.body.weekdayOrigins.map((row) => row.official_id).sort()), ["historical", "one"]);
  for (const call of service.calls.filter((call) => call.table === "official_weekday_origins"))
    assert.ok(call.methods.some(([method, column]) => method === "in" && column === "official_id"));
});

test("manager cannot request an out-of-league official directly", async () => {
  const service = client(data());
  const result = await route("app/api/reports/officials/route.ts", service).GET(request("scope=manager&officialId=two"));
  assert.equal(result.status, 403);
  assert.equal(service.calls.some((call) => call.table === "official_weekday_origins"), false);
});

test("empty manager league scope returns no facts or origins", async () => {
  const result = await route("app/api/reports/officials/route.ts", client(data()), { leagueIds: [] }).GET(request());
  assert.equal(result.body.assignments.length, 0);
  assert.equal(result.body.officials.length, 0);
  assert.equal(result.body.weekdayOrigins.length, 0);
});

test("ordinary self reports retain own other-league assignments but no one else's identity or origins", async () => {
  const result = await route("app/api/reports/officials/route.ts", client(data())).GET(request(""));
  assert.equal(result.status, 200);
  assert.equal(result.body.canManage, false);
  assert.deepEqual(json(result.body.assignments.map((row) => row.id)), ["a", "c"]);
  assert.deepEqual(json(result.body.officials.map((row) => row.id)), ["one"]);
  assert.deepEqual(json(result.body.weekdayOrigins.map((row) => row.official_id)), ["one"]);
});

test("self report cannot switch to another official", async () => {
  const result = await route("app/api/reports/officials/route.ts", client(data())).GET(request("officialId=two"));
  assert.equal(result.status, 403);
});

test("session report filters dual-role access to only manager league games", async () => {
  const result = await route("app/api/reports/coverage/route.ts", client(data())).GET(request());
  assert.deepEqual(json(result.body.games.map((row) => row.id)), ["game-a"]);
  assert.deepEqual(json(result.body.assignments.map((row) => row.id)), ["a", "d"]);
});

test("service-role benchmark report filters games and roster", async () => {
  const result = await route("app/api/reports/benchmarks/route.ts", client(data())).GET(request());
  assert.deepEqual(json(result.body.games.map((row) => row.id)), ["game-a"]);
  assert.deepEqual(json(result.body.roster.map((row) => row.official_id).sort()), ["historical", "one"]);
});

test("current owner check ignores admin role, preserves owner among multiple roles and protected superadmin", async () => {
  const membership = (role) => ({ organization_id: "org", user_id: "user", role });
  assert.equal(await helpers.isCurrentReportOwner(client({ organization_memberships: [membership("admin")] }), "user", "org"), false);
  assert.equal(await helpers.isCurrentReportOwner(client({ organization_memberships: [membership("admin"), membership("owner")] }), "user", "org"), true);
  assert.equal(await helpers.isCurrentReportOwner(client({ protected_accounts: [{ user_id: "user" }] }), "user", "org"), true);
  await assert.rejects(helpers.isCurrentReportOwner(client({}, { protected_accounts: { message: "Unavailable" } }), "user", "org"), /verify/);
});

test("direct custom and saved-view schedule submissions reject scoped admins", async () => {
  const custom = await route("app/api/reports/custom/route.ts", client(data())).POST(request("", { name: "Report", definition: { organizationIds: ["org"] }, scheduleEnabled: true }));
  const saved = await route("app/api/reports/saved-views/route.ts", client(data())).POST(request("", { reportKey: "coverage", scheduleEnabled: true }));
  const executive = await route("app/api/reports/executive/schedule/route.ts", client(data())).POST(request());
  assert.equal(custom.status, 403);
  assert.equal(saved.status, 403);
  assert.equal(executive.status, 403);
});

for (const [name, table, enabled] of [["custom-reports", "custom_report_templates", "schedule_enabled"], ["executive-reports", "executive_report_schedules", "enabled"], ["saved-report-views", "report_saved_views", "schedule_enabled"]]) {
  test(`${name} disables existing deliveries when creator is no longer owner before reading report data or sending`, async () => {
    const service = client({
      ...data(),
      organization_memberships: [{ organization_id: "org", user_id: "user", role: "admin" }],
      [table]: [{ id: "schedule", organization_id: "org", user_id: "user", [enabled]: true, name: "Report", definition: { organizationIds: ["org"] }, filters: {}, report_key: "coverage" }],
    });
    let sent = 0;
    const target = load(`app/api/cron/${name}/route.ts`, {
      "/supabase/admin": { createServiceClient: () => service },
      "/pdfCopyright": { addReportCopyright() {} },
      "jspdf": { jsPDF() { throw new Error("Report data must not be generated"); } },
      "jspdf-autotable": () => {},
      "/customReportBuilder": {},
      "/server/executiveSummary": { getExecutiveSummary() { throw new Error("Report data must not be read"); } },
    }, { fetch: async () => { sent++; return { ok: true }; } });
    const result = await target.GET({ nextUrl: new URL("https://example.test"), headers: { get: () => "Bearer test" } });
    assert.equal(result.body.sent, 0);
    assert.equal(sent, 0);
    assert.equal(service.calls.some((call) => call.table === "games" || call.table === "assignments"), false);
    assert.ok(service.calls.some((call) => call.table === table && call.methods.some(([method, payload]) => method === "update" && payload[enabled] === false)));
  });
}

test("report game/location pairs filter before pagination and do not include cross-pair games", async () => {
  const rows=data();
  rows.games=[...Array.from({length:1005},(_,i)=>({id:`excluded-${i}`,organization_id:"org",league_id:"league-a",location_id:"location-b"})),
    ...rows.games,{id:"cross-b",organization_id:"org",league_id:"league-b",location_id:"location-a"},{id:"null",organization_id:"org",league_id:"league-a",location_id:null}];
  const service=client(rows);
  const options={leagueIds:["league-a","league-b"],leagueAccess:[{league_id:"league-a",all_locations:false,location_ids:["location-a"]},{league_id:"league-b",all_locations:false,location_ids:["location-b"]}]};
  const result=await route("app/api/reports/coverage/route.ts",service,options).GET(request());
  assert.deepEqual(json(result.body.games.map(row=>row.id)),["game-a","game-b"]);
  const calls=service.calls.filter(call=>call.table==="games");
  assert.equal(calls.length,1);
  assert(calls[0].methods.some(([method])=>method==="or"));
});

test("restricted report roster requires a scoped assignment, never whole-league eligibility", async()=>{
  const rows=data();
  rows.official_league_eligibility.push({official_id:"eligible-only",league_id:"league-a"});
  rows.organization_officials.push({official_id:"eligible-only",organization_id:"org",active:true});
  const service=client(rows);
  const result=await helpers.readReportOfficialLinks({service,organizationId:"org",leagueIds:["league-a"],leagueAccess:[{league_id:"league-a",all_locations:false,location_ids:["location-a"]}]});
  assert.deepEqual(json(result.data.map(row=>row.official_id).sort()),["historical","one"]);
  const denied=await helpers.readReportOfficialLinks({service,organizationId:"org",leagueIds:["league-a"],leagueAccess:[{league_id:"league-a",all_locations:false,location_ids:[]}]});
  assert.deepEqual(json(denied.data),[]);
});
