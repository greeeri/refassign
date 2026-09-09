import assert from "node:assert/strict";
import test from "node:test";

import {
  gameAcceptsAssignments,
  inactiveGameStatusLabel,
  normalizeGameStatus,
} from "../lib/game-status.ts";

test("legacy open games remain assignable", () => {
  assert.equal(normalizeGameStatus("open"), "active");
  assert.equal(gameAcceptsAssignments({ status: "open" }), true);
  assert.equal(gameAcceptsAssignments({ status: "active" }), true);
});

test("inactive games remain blocked with clear labels", () => {
  assert.equal(gameAcceptsAssignments({ status: "suspended" }), false);
  assert.equal(gameAcceptsAssignments({ status: "canceled" }), false);
  assert.equal(gameAcceptsAssignments({ status: "rained_out" }), false);
  assert.equal(inactiveGameStatusLabel("suspended"), "On Hold");
  assert.equal(inactiveGameStatusLabel("canceled"), "Cancelled");
  assert.equal(inactiveGameStatusLabel("rained_out"), "Rain Out");
});
