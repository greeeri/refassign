import { NextRequest, NextResponse } from "next/server";
import { requireManagedOrganization } from "../../../lib/server/organizationScope";

const viewRoles = ["owner", "admin", "assignor", "billing"];
const editRoles = ["owner", "admin", "billing"];

export async function GET(request: NextRequest) {
  const context = await requireManagedOrganization(request, viewRoles);
  if (context.error) return context.error;
  const { service, organizationId, user } = context;
  const [{ data, error }, { data: editableMembership }, { data: superAdmin }] =
    await Promise.all([
      service
        .from("bill_to_accounts")
        .select("id,name,contact_name,email,phone,address,active")
        .eq("organization_id", organizationId)
        .eq("active", true)
        .order("name"),
      service
        .from("organization_memberships")
        .select("role")
        .eq("organization_id", organizationId)
        .eq("user_id", user.id)
        .in("role", editRoles)
        .limit(1)
        .maybeSingle(),
      service
        .from("protected_accounts")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle(),
    ]);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({
    billTos: data || [],
    canManageBillTos: Boolean(editableMembership || superAdmin),
  });
}

export async function POST(request: NextRequest) {
  const context = await requireManagedOrganization(request, editRoles);
  if (context.error) return context.error;
  const { service, organizationId } = context;
  const body = (await request.json()) as {
    name?: string;
    contactName?: string;
    email?: string;
    phone?: string;
    address?: string;
  };
  const name = String(body.name || "").trim();
  if (!name)
    return NextResponse.json(
      { error: "Bill To name is required." },
      { status: 400 },
    );
  const { data, error } = await service
    .from("bill_to_accounts")
    .insert({
      organization_id: organizationId,
      name,
      contact_name: String(body.contactName || "").trim() || null,
      email: String(body.email || "").trim() || null,
      phone: String(body.phone || "").trim() || null,
      address: String(body.address || "").trim() || null,
    })
    .select("id,name,contact_name,email,phone,address,active")
    .single();
  if (error)
    return NextResponse.json(
      {
        error:
          error.code === "23505"
            ? "That Bill To already exists."
            : error.message,
      },
      { status: 400 },
    );
  return NextResponse.json({ billTo: data });
}
