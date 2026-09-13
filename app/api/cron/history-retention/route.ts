import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";

export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  )
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createServiceClient();
  const { data, error } = await service.rpc(
    "cleanup_expired_operational_history",
  );
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data || {
    undo_deleted: 0,
    audit_deleted: 0,
    audit_retention_years: 3,
  });
}
