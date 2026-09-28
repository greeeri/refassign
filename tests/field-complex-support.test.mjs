import assert from "node:assert/strict";
import test from "node:test";
import { fieldComplexRpcMissing } from "../lib/field-complex-support.ts";

test("an older database can load assignment and location screens", () => {
  assert.equal(fieldComplexRpcMissing({
    code: "PGRST202",
    message: "Could not find the function public.get_organization_field_complexes(p_organization_id) in the schema cache",
  }), true);
  assert.equal(fieldComplexRpcMissing({
    code: "42883",
    message: "function public.get_organization_field_complexes(uuid) does not exist",
  }), true);
});

test("permission and unrelated errors remain visible", () => {
  assert.equal(fieldComplexRpcMissing({ code: "42501", message: "No access to field complexes" }), false);
  assert.equal(fieldComplexRpcMissing({ code: "PGRST202", message: "Could not find a different function" }), false);
  assert.equal(fieldComplexRpcMissing(null), false);
});
