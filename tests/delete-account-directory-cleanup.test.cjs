const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");

test("deleting an account removes its official from organization directories", () => {
  const route = fs.readFileSync(
    path.join(root, "app/api/super-admin/accounts/route.ts"),
    "utf8",
  );

  assert.match(route, /from\("officials"\)\.select\("id"\)\.eq\("auth_user_id", id\)/);
  assert.match(route, /from\("organization_officials"\)[\s\S]*?\.delete\(\)[\s\S]*?\.in\("official_id", officialIds\)/);
  assert.match(route, /update\(\{ active: false \}\)/);
  assert.match(route, /details: \{ official_ids: officialIds \}/);
});
