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

const { boundCalendarReview } = await import("../lib/game-status.ts");
test("Bound source status stays distinct from operational holds and review acknowledgment", () => {
  const held = { status: "suspended", venue_conflict_hold: true, bound_source_status: "CONFIRMED", bound_hold_reasons: ["source_overlap"] };
  const summary = boundCalendarReview(held);
  assert.equal(summary.sourceLabel, "Confirmed");
  assert.equal(summary.operationalLabel, "On Hold");
  assert.match(summary.recommendation, /actual field/);
  assert.match(summary.recommendation, /Keep on hold/);
  assert.deepEqual(boundCalendarReview({ ...held, calendar_needs_review: false }), summary);
  assert.equal(gameAcceptsAssignments(held), false);
});
test("Bound source cancellations and resolution candidates cannot recommend assignment", () => {
  const canceled = boundCalendarReview({ status: "canceled", bound_source_status: "CANCELLED", venue_conflict_hold: true });
  assert.equal(canceled.sourceLabel, "Cancelled");
  assert.equal(canceled.operationalLabel, "Cancelled");
  assert.match(canceled.recommendation, /do not assign/);
  const resolved = boundCalendarReview({ status: "suspended", bound_source_status: "CONFIRMED", bound_hold_resolution_candidate: true });
  assert.match(resolved.recommendation, /before manually releasing/);
});
test("Bound malformed duration and uncertain source remain explicit", () => {
  assert.match(boundCalendarReview({ status: "suspended", bound_source_status: "CONFIRMED", bound_hold_reasons: ["invalid_duration"] }).recommendation, /confirm the end time and duration/);
  assert.equal(boundCalendarReview({ status: "active" }), null);
  assert.equal(boundCalendarReview({ status: "suspended", bound_source_status: "UNKNOWN", bound_hold_reasons: ["source_status_unknown"] }).sourceLabel, "Unknown");
  assert.match(boundCalendarReview({ status: "canceled", bound_source_status: "CONFIRMED" }).recommendation, /before changing/);
});
