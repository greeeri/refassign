export type ReportActionTarget =
  | { section: "Assignments"; gameId: string }
  | { section: "Payroll"; assignmentId: string }
  | { section: "Officials"; officialId: string };
