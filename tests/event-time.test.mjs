import assert from "node:assert/strict";
import test from "node:test";
import { eventLocalToIso, eventTimeParts } from "../lib/event-time.ts";

test("Iowa event imports use Central time regardless of uploader location", () => {
  const iso = eventLocalToIso("2026-09-26", "08:20", { state: "IA" });
  assert.equal(iso, "2026-09-26T13:20:00.000Z");
  assert.deepEqual(eventTimeParts(iso, { state: "IA" }), {
    date: "2026-09-26",
    time: "08:20",
  });
});

test("event time follows the venue state rather than the browser timezone", () => {
  const instant = "2026-09-26T13:20:00.000Z";
  assert.equal(eventTimeParts(instant, { state: "IA" }).time, "08:20");
  assert.equal(eventTimeParts(instant, { state: "GA" }).time, "09:20");
});
