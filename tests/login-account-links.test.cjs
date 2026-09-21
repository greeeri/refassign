const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const login = fs.readFileSync("app/login/page.tsx", "utf8");
const league = fs.readFileSync("app/join/league/[token]/page.tsx", "utf8");
const officialInvitations = fs.readFileSync(
  "app/api/tier-test/official-invitations/route.ts",
  "utf8",
);
const organizationInvitations = fs.readFileSync(
  "supabase/functions/send-organization-invitation/index.ts",
  "utf8",
);

test("ordinary login pages offer free official account creation", () => {
  assert.match(login, /Create your free account/);
  assert.match(login, /setCreatingOfficial\(\(value\) => !value\)/);
});

test("official account links preserve their requested destination", () => {
  assert.match(login, /query\.get\("next"\) \|\| "\/workspace"/);
  assert.match(login, /emailRedirectTo/);
  assert.match(login, /shouldCreateUser: true/);
  assert.match(login, /destination = officialInvitationId/);
});

test("league links provide sign-in and free-account paths back to the league", () => {
  assert.match(league, /const returnPath = `\/join\/league\/\$\{token\}`/);
  assert.match(league, /account=official&next=/);
  assert.match(league, /Create your free account/);
});

test("official and organization invitation emails target account-capable login flows", () => {
  assert.match(officialInvitations, /\/login\?official_invite=/);
  assert.match(organizationInvitations, /\/login\?team_invite=/);
  assert.match(login, /shouldCreateUser: true/g);
});
