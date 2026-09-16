const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("account page uses a dedicated width-responsive layout", () => {
  const page = fs.readFileSync("app/workspace/page.tsx", "utf8");
  const css = fs.readFileSync("app/globals.css", "utf8");

  assert(page.includes('className="card accountCard"'));
  assert(page.includes('className="accountGrid"'));
  assert(page.includes('className="toolbar accountActions"'));
  assert(css.includes(".accountCard {\n  container-type: inline-size;"));
  assert(css.includes("@container (max-width: 620px)"));
  assert(css.includes("grid-template-columns: minmax(0, 1fr);"));
  assert(css.includes("overflow-wrap: anywhere;"));
});
