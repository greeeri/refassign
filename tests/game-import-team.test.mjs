import assert from "node:assert/strict";
import test from "node:test";

import { resolveImportTeam } from "../lib/game-import-team.ts";

const teams = [
  {
    id: "u17",
    name: "Sporting Iowa ECNL U17B",
    sport_id: "soccer",
    level_id: "u17",
  },
];

test("resolves a connected team playing in a different competition level", () => {
  assert.equal(
    resolveImportTeam(teams, "Sporting Iowa ECNL U17B", "soccer", "u18")?.id,
    "u17",
  );
});

test("normalizes case and surrounding whitespace", () => {
  assert.equal(
    resolveImportTeam(teams, "  sporting iowa ecnl u17b ", "soccer", "u18")?.id,
    "u17",
  );
});

test("does not guess when same-name teams are ambiguous", () => {
  const duplicate = { ...teams[0], id: "other", level_id: "u16" };
  assert.equal(
    resolveImportTeam([...teams, duplicate], teams[0].name, "soccer", "u18"),
    undefined,
  );
});

test("prefers the exact level when duplicate names exist", () => {
  const duplicate = { ...teams[0], id: "other", level_id: "u16" };
  assert.equal(
    resolveImportTeam([...teams, duplicate], teams[0].name, "soccer", "u17")
      ?.id,
    "u17",
  );
});
