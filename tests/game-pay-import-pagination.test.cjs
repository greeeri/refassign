const { applyScopeFilter } = require("./support/scope-query.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");

function loadModule(path, mockRequire = require) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: mockRequire });
  return module.exports;
}

const paging = loadModule("lib/supabase/readAll.ts");
const scopeGuards = loadModule("lib/server/organizationScope.ts", (name) => {
  if (name === "next/server") return { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } };
  if (name.endsWith("/supabase/readAll")) return paging;
  if (name.endsWith("/supabase/admin") || name.endsWith("/supabase/server")) return {};
  throw new Error(`Unexpected dependency: ${name}`);
});
const copy = (value) => JSON.parse(JSON.stringify(value));
const gameId = (index) => `game-${String(index).padStart(3, "0")}`;
const positionId = (index) => `position-${String(index).padStart(2, "0")}`;

function setup({ gameCount = 100, assignmentsPerGame = 12, leagueIds = null, authorizationError = null, failPage = null } = {}) {
  const games = Array.from({ length: gameCount }, (_, index) => ({
    id: gameId(index), organization_id: "selected-org", sport_id: "sport", league_id: "allowed-league", officials_needed: 13,
  }));
  const positions = Array.from({ length: 13 }, (_, index) => ({
    id: positionId(index), sport_id: "sport", sort_order: index,
  }));
  const assignments = games.flatMap((game, gameIndex) => Array.from({ length: assignmentsPerGame }, (_, positionIndex) => ({
    id: `assignment-${String(gameIndex * assignmentsPerGame + positionIndex).padStart(5, "0")}`,
    game_id: game.id, position_id: positionId(positionIndex), game_fee: 50,
    payment_status: "approved", status: ["proposed", "accepted", "confirmed"][positionIndex % 3],
  }))).reverse(); // Storage order must not determine page membership.
  const tables = { games, sport_positions: positions, assignments };
  const reads = [];
  const rpcCalls = [];
  const authorizationCalls = [];
  const service = {
    from(table) {
      const call = { table, filters: [] };
      const query = {
        then(resolve, reject) {
          reads.push(call);
          if (failPage?.(call)) return Promise.resolve({ data: null, error: { message: "Protected assignments page failed" } }).then(resolve, reject);
          let rows = tables[table].slice();
          for (const [method, column, value] of call.filters) {
            if (method === "eq") rows = rows.filter((row) => row[column] === value);
            if (method === "or") rows = rows.filter((row) => applyScopeFilter(row,column,value));
            if (method === "in") rows = rows.filter((row) => value.includes(row[column]));
          }
          const orders = call.filters.filter(([method]) => method === "order");
          rows.sort((left, right) => {
            for (const [, column, options] of orders) {
              const difference = left[column] < right[column] ? -1 : left[column] > right[column] ? 1 : 0;
              if (difference) return options?.ascending === false ? -difference : difference;
            }
            return 0;
          });
          const range = call.filters.find(([method]) => method === "range");
          const from = range?.[1] || 0;
          const to = range?.[2] ?? 999;
          rows = rows.slice(from, Math.min(to + 1, from + 1000)); // Supabase's response cap.
          const columns = call.filters.find(([method]) => method === "select")[1].split(",");
          return Promise.resolve({ data: rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column]]))), error: null }).then(resolve, reject);
        },
      };
      for (const method of ["select", "eq", "in", "order", "range", "or"]) {
        query[method] = (...args) => { call.filters.push(copy([method, ...args])); return query; };
      }
      return query;
    },
    async rpc(name, parameters) {
      rpcCalls.push({ name, parameters: copy(parameters) });
      return { data: parameters.p_rows.length, error: null };
    },
  };
  const route = loadModule("app/api/games/pay/import/route.ts", (name) => {
    if (name === "next/server") return { NextResponse: { json: (body, options) => ({ body: copy(body), status: options?.status || 200 }) } };
    if (name.endsWith("/organizationScope")) return { requireGameScope: scopeGuards.requireGameScope, requireManagedOrganization: async (request, roles) => {
      authorizationCalls.push({ request, roles: Array.from(roles) });
      return authorizationError ? { error: authorizationError } : { service, organizationId: "selected-org", leagueIds, leagueAccess: leagueIds?.map(league_id => ({ league_id, all_locations:true, location_ids:[] })), fullOrganizationAccess: leagueIds === null };
    } };
    if (name.endsWith("/supabase/readAll")) return paging;
    throw new Error(`Unexpected dependency: ${name}`);
  });
  const rows = games.map((game, index) => ({ spreadsheetRow: index + 2, gameId: game.id, positionId: positionId(12), gameFee: 75 }));
  return {
    assignments, games, reads, rpcCalls, authorizationCalls, rows,
    run: (body = { rows }) => route.POST({ json: async () => body }),
  };
}

test("pay import sees approved and paid assignments beyond 1,000 rows in one game batch", async () => {
  const t = setup();
  t.assignments.find((row) => row.game_id === gameId(99) && row.position_id === positionId(11)).payment_status = "paid";
  t.rows.push(
    { gameId: gameId(99), positionId: positionId(10), gameFee: 75 },
    { gameId: gameId(99), positionId: positionId(11), gameFee: 75 },
  );
  const result = await t.run();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { updated: 101, splitGames: 0, skippedUnused: 0, skippedProtected: 1, correctionSuggestions: 1 });
  const pages = t.reads.filter((call) => call.table === "assignments");
  assert.deepEqual(pages.map((call) => call.filters.find(([method]) => method === "range").slice(1)), [[0, 999], [1000, 1999]]);
  for (const page of pages) {
    assert.deepEqual(page.filters.find(([method]) => method === "order"), ["order", "id"]);
    assert.equal(page.filters.find(([method, column]) => method === "in" && column === "game_id")[2].length, 100);
    assert.deepEqual(page.filters.find(([method, column]) => method === "in" && column === "payment_status")[2], ["approved", "paid"]);
    assert.deepEqual(page.filters.find(([method, column]) => method === "in" && column === "status")[2], ["proposed", "accepted", "confirmed"]);
  }
  assert.equal(t.rpcCalls.length, 1);
  assert.equal(t.rpcCalls[0].name, "import_game_position_pay");
  assert.equal(t.rpcCalls[0].parameters.p_organization_id, "selected-org");
  const imported = t.rpcCalls[0].parameters.p_rows;
  assert(!imported.some((row) => row.game_id === gameId(99) && row.position_id === positionId(10)));
  assert(imported.some((row) => row.game_id === gameId(99) && row.position_id === positionId(11) && row.amount === 75));
});

test("pay import refuses an all-approved import even when protection is on a later page", async () => {
  const t = setup();
  const result = await t.run({ rows: t.rows.map((row) => ({ ...row, positionId: positionId(0) })) });
  assert.equal(result.status, 409);
  assert.match(result.body.error, /All 100 game position fees belong to approved payroll/);
  assert.equal(t.rpcCalls.length, 0);
});

test("pay import fails closed on a later protected-assignment page", async () => {
  const t = setup({ failPage: (call) => call.table === "assignments" && call.filters.some(([method, from]) => method === "range" && from === 1000) });
  const result = await t.run();
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "Protected assignments page failed");
  assert.equal(t.reads.filter((call) => call.table === "assignments").length, 2);
  assert.equal(t.rpcCalls.length, 0);
});

test("pay import resets pagination for each 100-game batch, including a full final page", async () => {
  const t = setup({ gameCount: 101, assignmentsPerGame: 10 });
  const result = await t.run();
  assert.equal(result.status, 200);
  assert.equal(result.body.updated, 101);
  const pages = t.reads.filter((call) => call.table === "assignments");
  assert.deepEqual(pages.map((call) => ({
    gameIds: call.filters.find(([method, column]) => method === "in" && column === "game_id")[2],
    range: call.filters.find(([method]) => method === "range").slice(1),
  })), [
    { gameIds: t.games.slice(0, 100).map((game) => game.id), range: [0, 999] },
    { gameIds: t.games.slice(0, 100).map((game) => game.id), range: [1000, 1999] },
    { gameIds: [gameId(100)], range: [0, 999] },
  ]);
});

test("pay import still excludes inactive or unapproved assignments from protection", async () => {
  const t = setup({ gameCount: 1 });
  t.assignments.find((row) => row.position_id === positionId(0)).status = "declined";
  t.assignments.find((row) => row.position_id === positionId(1)).payment_status = "unpaid";
  const result = await t.run({ rows: [0, 1].map((index) => ({ gameId: gameId(0), positionId: positionId(index), gameFee: 75 })) });
  assert.equal(result.status, 200);
  assert.equal(result.body.updated, 2);
  assert.equal(result.body.skippedProtected, 0);
  assert.equal(result.body.correctionSuggestions, 0);
});

test("pay import keeps management authorization and organization/league checks before preflight or writes", async () => {
  for (const status of [401, 403, 402]) {
    const t = setup({ authorizationError: { status, body: { error: "Access denied" } } });
    assert.equal((await t.run()).status, status);
    assert.deepEqual(t.authorizationCalls[0].roles, ["owner", "admin", "assignor", "billing"]);
    assert.equal(t.reads.length, 0);
    assert.equal(t.rpcCalls.length, 0);
  }
  for (const kind of ["organization", "league"]) {
    const t = setup({ gameCount: 1, leagueIds: ["allowed-league"] });
    t.games[0][kind === "organization" ? "organization_id" : "league_id"] = "not-allowed";
    assert.equal((await t.run()).status, 403);
    assert(!t.reads.some((call) => call.table === "assignments"));
    assert.equal(t.rpcCalls.length, 0);
    assert(t.reads.find((call) => call.table === "games").filters.some(([method, column, value]) => method === "eq" && column === "organization_id" && value === "selected-org"));
  }
});
