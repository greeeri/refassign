import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../supabase/admin";
import { createServerSupabaseClient } from "../supabase/server";

const managerRoles = ["owner", "admin", "assignor"];

export async function requireManagedOrganization(request: NextRequest) {
  const session = await createServerSupabaseClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user)
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };

  const organizationId = request.nextUrl.searchParams.get("organizationId");
  if (!organizationId)
    return {
      error: NextResponse.json(
        { error: "Select an organization." },
        { status: 400 },
      ),
    };

  const service = createServiceClient();
  const { data: membership, error: membershipError } = await service
    .from("organization_memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user.id)
    .in("role", managerRoles)
    .limit(1)
    .maybeSingle();
  if (membershipError || !membership)
    return {
      error: NextResponse.json(
        { error: "You do not manage this organization." },
        { status: 403 },
      ),
    };

  return { session, service, user, organizationId };
}
