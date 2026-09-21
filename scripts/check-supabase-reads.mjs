import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const roots = ["app", "components", "lib"];
const largeTables = new Set([
  "assignments", "audit_history", "official_communications",
  "official_availability_blocks", "official_development_progress",
  "official_level_eligibility", "official_rankings",
  "official_soccer_position_rankings", "officials",
  "organization_officials", "registration_program_officials", "undo_changes",
]);
const boundedMethods = new Set(["limit", "range", "single", "maybeSingle"]);
// Reviewed starting point for phase two. New entries are not added casually;
// this list is reduced as each legacy read moves to paging or a bounded API.
const reviewedBaseline = new Set([
  "app/api/assignments/broadcast/route.ts:assignments",
  "app/api/assignments/import-fees/route.ts:assignments",
  "app/api/assignments/publish/route.ts:assignments",
  "app/api/change-audit/route.ts:assignments",
  "app/api/communications/officials/send/route.ts:organization_officials",
  "app/api/communications/send/route.ts:assignments",
  "app/api/cron/assignment-reminders/route.ts:assignments",
  "app/api/development/communications/send/route.ts:registration_program_officials",
  "app/api/games/status/route.ts:assignments",
  "app/api/geocode/backfill/route.ts:organization_officials",
  "app/api/payroll/process/route.ts:assignments",
  "app/api/payroll/route.ts:assignments",
  "app/api/reports/development/route.ts:officials",
  "app/api/reports/officials/route.ts:officials",
  "app/api/reports/officials/route.ts:assignments",
  "app/api/super-admin/resources/route.ts:organization_officials",
  "components/AssignmentsManager.tsx:officials",
  "components/AssignmentsManager.tsx:assignments",
  "components/AssignmentsManager.tsx:official_level_eligibility",
  "components/AssignmentsManager.tsx:official_availability_blocks",
  "components/AssignmentsManagerV2.tsx:officials",
  "components/AssignmentsManagerV2.tsx:assignments",
  "components/AssignmentsManagerV2.tsx:audit_history",
  "components/AvailabilityCalendar.tsx:officials",
  "components/DashboardGames.tsx:organization_officials",
  "components/IowaSoccerDevelopment.tsx:official_development_progress",
  "components/IowaSoccerDevelopmentAdmin.tsx:registration_program_officials",
  "components/LinkedGamesManager.tsx:assignments",
  "components/MileageCoordinatesManager.tsx:organization_officials",
  "components/MileageCoordinatesManager.tsx:officials",
  "components/OfficialsDirectory.tsx:official_level_eligibility",
]);

function filesIn(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return filesIn(target);
    return /\.(ts|tsx)$/.test(entry.name) ? [target] : [];
  });
}
function methodName(call) {
  return ts.isPropertyAccessExpression(call.expression) ? call.expression.name.text : "";
}
function receiver(call) {
  return ts.isPropertyAccessExpression(call.expression) ? call.expression.expression : null;
}
function chainCalls(call) {
  const calls = [];
  let current = call;
  while (ts.isCallExpression(current)) {
    calls.push(current);
    const next = receiver(current);
    if (!next) break;
    current = next;
  }
  return calls;
}
function containingStatement(node) {
  let current = node;
  while (current && !ts.isExpressionStatement(current) && !ts.isVariableStatement(current)) current = current.parent;
  return current;
}

const failures = [];
for (const file of roots.flatMap(filesIn)) {
  const sourceText = fs.readFileSync(file, "utf8");
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  function visit(node) {
    if (ts.isCallExpression(node) && methodName(node) === "select") {
      let top = node;
      while (top.parent && ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top && top.parent.parent && ts.isCallExpression(top.parent.parent)) top = top.parent.parent;
      const calls = chainCalls(top),
        from = calls.find((call) => methodName(call) === "from"),
        tableArg = from?.arguments[0],
        table = tableArg && ts.isStringLiteral(tableArg) ? tableArg.text : "";
      if (largeTables.has(table)) {
        const bounded = calls.some((call) => boundedMethods.has(methodName(call))),
          statement = containingStatement(node),
          text = statement?.getFullText(source) || top.getFullText(source),
          explicitlyReviewed = text.includes("data-access: query-builder");
        const baselineKey = `${file}:${table}`;
        if (!bounded && !explicitlyReviewed && !reviewedBaseline.has(baselineKey)) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
          failures.push(`${file}:${line + 1} ${table}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}

if (failures.length) {
  console.error("Unbounded reads from growth-sensitive tables:\n" + failures.join("\n"));
  console.error("Add range/limit/single, use a paging helper, or annotate a reviewed query builder.");
  process.exit(1);
}
console.log("No new unreviewed growth-sensitive Supabase reads found.");
