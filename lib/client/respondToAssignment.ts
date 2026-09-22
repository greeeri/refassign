export async function respondToAssignment(input: {
  token: string;
  response: "accepted" | "declined";
  declineReason?: string | null;
}) {
  const response = await fetch("/api/assignments/respond", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
    notificationWarning?: string;
  };
  if (!response.ok)
    throw new Error(
      result.error || "The assignment response could not be saved.",
    );
  return result;
}
