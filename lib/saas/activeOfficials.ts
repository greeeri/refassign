export type OfficialActivity = {
  lastSignedInAt: Date | string | null;
  lastAssignmentResponseAt: Date | string | null;
  lastAssignmentResponse: "accepted" | "declined" | null;
};

function sixMonthsBefore(referenceDate: Date): Date {
  const cutoff = new Date(referenceDate);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - 6);
  return cutoff;
}

function onOrAfter(value: Date | string | null, cutoff: Date): boolean {
  if (value === null) return false;
  const date = value instanceof Date ? value : new Date(value);
  return !Number.isNaN(date.getTime()) && date >= cutoff;
}

export function isActiveOfficial(
  activity: OfficialActivity,
  referenceDate = new Date(),
): boolean {
  const cutoff = sixMonthsBefore(referenceDate);
  return (
    onOrAfter(activity.lastSignedInAt, cutoff) &&
    onOrAfter(activity.lastAssignmentResponseAt, cutoff) &&
    (activity.lastAssignmentResponse === "accepted" ||
      activity.lastAssignmentResponse === "declined")
  );
}
