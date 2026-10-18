const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function loadRoute(file, dependencies) {
  const module = { exports: {} };
  const nextServer = {
    NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) },
  };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    module, exports: module.exports, AbortSignal, Date, Error,
    process: { env: { RESEND_API_KEY: "test-only" } },
    require(name) {
      if (name === "next/server") return nextServer;
      const dependency = Object.entries(dependencies).find(([suffix]) => name.endsWith(suffix));
      if (dependency) return dependency[1];
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return module.exports;
}

function mockService(resultFor) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, methods: [] };
      calls.push(call);
      const query = { then: (resolve, reject) => Promise.resolve(resultFor(call)).then(resolve, reject) };
      for (const method of ["select", "eq", "in", "limit", "maybeSingle", "single", "insert", "update", "delete"]) {
        query[method] = (...args) => { call.methods.push([method, ...args]); return query; };
      }
      return query;
    },
  };
}

function setupEmail({ scopeError, linkError } = {}) {
  const notifications = [];
  const service = mockService((call) => {
    if (call.table === "organization_officials") {
      if (linkError) return { data: null, error: linkError };
      const ids = call.methods.find(([method]) => method === "in")[2];
      const limit = call.methods.find(([method]) => method === "limit")?.[1] ?? 1000;
      return { data: ids.slice(0, limit).map((id) => ({
        official_id: id,
        officials: { id, first_name: "Test", last_name: id, email: `${id}@example.test` },
      })), error: null };
    }
    return { data: { id: "communication-log" }, error: null };
  });
  const route = loadRoute("app/api/communications/officials/email/route.ts", {
    "/server/organizationScope": {
      requireManagedOrganization: async () => scopeError ? { error: scopeError } : {
        service, user: { id: "manager" }, organizationId: "selected-org",
      },
    },
    "/communications/officialCc": {
      sendOfficialNotification: async (_service, id) => {
        notifications.push(id);
        return { ok: true, json: async () => ({ id: "provider-id" }) };
      },
    },
  });
  return {
    service, notifications,
    run: (officialIds) => route.POST({ json: async () => ({ officialIds, subject: "Update", message: "Hello" }) }),
  };
}

test("group email rejects 501 distinct selected officials before querying or sending", async () => {
  const state = setupEmail();
  const result = await state.run(Array.from({ length: 501 }, (_, id) => `official-${id}`));
  assert.equal(result.status, 400);
  assert.match(result.body.error, /500/);
  assert.equal(state.service.calls.length, 0);
  assert.equal(state.notifications.length, 0);
});

test("group email accepts all 500 officials and keeps organization and active filters", async () => {
  const ids = Array.from({ length: 500 }, (_, id) => `official-${id}`);
  const state = setupEmail();
  const result = await state.run(ids);
  assert.equal(result.status, 200);
  assert.equal(result.body.sent, 500);
  assert.deepEqual(state.notifications, ids);
  const lookup = state.service.calls.find((call) => call.table === "organization_officials");
  assert(lookup.methods.some(([method, key, value]) => method === "eq" && key === "organization_id" && value === "selected-org"));
  assert(lookup.methods.some(([method, key, value]) => method === "eq" && key === "active" && value === true));
  assert(lookup.methods.some(([method, value]) => method === "limit" && value === 500));
});

test("group email deduplicates before counting its cap without silently dropping recipients", async () => {
  const ids = Array.from({ length: 500 }, (_, id) => `official-${id}`);
  const state = setupEmail();
  const result = await state.run([...ids, ...ids]);
  assert.equal(result.status, 200);
  assert.equal(result.body.sent, 500);
  assert.deepEqual(state.notifications, ids);
});

test("group email preserves authorization and stops before writes on lookup error", async () => {
  const denied = setupEmail({ scopeError: { status: 403, body: { error: "Forbidden" } } });
  assert.equal((await denied.run(["official-1"])).status, 403);
  assert.equal(denied.service.calls.length, 0);
  const failed = setupEmail({ linkError: { message: "lookup failed" } });
  assert.equal((await failed.run(["official-1"])).body.error, "lookup failed");
  assert.equal(failed.service.calls.length, 1);
  assert.equal(failed.notifications.length, 0);
});

function setupDeletion({ linkedOfficial = { id: "official-1" }, officialError, locked = false, authorizationError } = {}) {
  const authDeletes = [];
  const service = mockService((call) => {
    if (call.table === "protected_accounts") return { data: locked ? { user_id: "account-1" } : null, error: null };
    if (call.table === "officials" && call.methods.some(([method]) => method === "select")) {
      return { data: linkedOfficial, error: officialError || null };
    }
    return { data: null, error: null };
  });
  service.auth = { admin: { deleteUser: async (id) => { authDeletes.push(id); return { error: null }; } } };
  const route = loadRoute("app/api/super-admin/accounts/route.ts", {
    "/supabase/admin": { requireSuperAdmin: async () => {
      if (authorizationError) throw new Error(authorizationError);
      return { service, user: { id: "super-admin" } };
    } },
  });
  return { service, authDeletes, run: () => route.DELETE({ json: async () => ({ id: "account-1" }) }) };
}

test("account deletion looks up one unique official and preserves directory cleanup", async () => {
  const state = setupDeletion();
  const result = await state.run();
  assert.equal(result.status, 200);
  assert.equal(result.body.removed_from_directories, 1);
  assert.deepEqual(state.authDeletes, ["account-1"]);
  const lookup = state.service.calls.find((call) => call.table === "officials");
  assert(lookup.methods.some(([method, key, value]) => method === "eq" && key === "auth_user_id" && value === "account-1"));
  assert(lookup.methods.some(([method]) => method === "maybeSingle"));
  const directory = state.service.calls.find((call) => call.table === "organization_officials");
  assert(directory.methods.some(([method]) => method === "delete"));
  assert.deepEqual(Array.from(directory.methods.find(([method]) => method === "in")[2]), ["official-1"]);
  const inactive = state.service.calls.find((call) => call.table === "officials" && call.methods.some(([method]) => method === "update"));
  assert.equal(inactive.methods.find(([method]) => method === "update")[1].active, false);
  const audit = state.service.calls.find((call) => call.table === "super_admin_audit");
  assert.deepEqual(Array.from(audit.methods[0][1].details.official_ids), ["official-1"]);
});

test("account deletion permits an account with no linked official", async () => {
  const state = setupDeletion({ linkedOfficial: null });
  const result = await state.run();
  assert.equal(result.status, 200);
  assert.equal(result.body.removed_from_directories, 0);
  assert.deepEqual(state.authDeletes, ["account-1"]);
  assert(!state.service.calls.some((call) => call.table === "organization_officials"));
  assert(!state.service.calls.some((call) => call.methods.some(([method]) => method === "update")));
});

test("account deletion stops on permission, protected-account or unique-lookup errors", async () => {
  for (const [options, status] of [
    [{ authorizationError: "UNAUTHORIZED" }, 401],
    [{ authorizationError: "FORBIDDEN" }, 403],
    [{ locked: true }, 400],
    [{ officialError: new Error("multiple rows or database failure") }, 400],
  ]) {
    const state = setupDeletion(options);
    assert.equal((await state.run()).status, status);
    assert.equal(state.authDeletes.length, 0);
    assert(!state.service.calls.some((call) => call.methods.some(([method]) => ["insert", "delete", "update"].includes(method))));
  }
});

test("the explicit route bounds are supported by unique schema constraints", () => {
  const officialSchema = fs.readFileSync("supabase/migrations/003_officials_directory.sql", "utf8");
  assert.match(officialSchema, /auth_user_id uuid unique/i);
  const organizationSchema = fs.readFileSync("supabase/migrations/20260907130554_shared_official_location_directory.sql", "utf8");
  assert.match(organizationSchema, /primary key\s*\(organization_id,\s*official_id\)/i);
});
