const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("billing managers receive a dedicated payroll workspace", () => {
  const source = fs.readFileSync("app/workspace/page.tsx", "utf8");
  assert(source.includes('| "billing"'));
  assert(source.includes('billing: "Billing Manager"'));
  assert(source.includes('role === "billing"'));
  assert(source.includes('billingManager &&'));
  assert(source.includes('(manager || billingManager) && section === "Payroll"'));
});

test("payroll requires an explicit payment method and uses guarded APIs", () => {
  const source = fs.readFileSync("components/PayrollManager.tsx", "utf8");
  assert(source.includes('Payment method'));
  assert(source.includes('<option value="stripe">Stripe</option>'));
  assert(source.includes('Continue to Stripe'));
  assert(source.includes('/api/payroll?organizationId='));
  assert(!source.includes('.from("assignments")\n      .update({'));
});

test("server payroll actions allow billing but remain organization scoped", () => {
  for (const path of [
    "app/api/payroll/route.ts",
    "app/api/payroll/process/route.ts",
    "app/api/payroll/confirm/route.ts",
    "app/api/payroll/batches/route.ts",
  ]) {
    const source = fs.readFileSync(path, "utf8");
    assert(source.includes('"billing"'), path);
    assert(source.includes("organizationId"), path);
  }
});
