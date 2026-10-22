import { NextRequest, NextResponse } from "next/server";
import { requireManagedOrganization, requireOrganizationOwner, scopeGameQuery } from "../../../lib/server/organizationScope";
import { readAllPages, readAllForChunks } from "../../../lib/supabase/readAll";

type BillTo = { id: string; name: string; email: string | null; active: boolean; contact_name?: string | null; phone?: string | null; address?: string | null };
const viewRoles = ["owner", "admin", "assignor", "billing"];

export async function GET(request: NextRequest) {
  const context = await requireManagedOrganization(request, viewRoles);
  if (context.error) return context.error;
  const { service, organizationId, fullOrganizationAccess } = context;
  if (fullOrganizationAccess) {
    const result = await readAllPages<BillTo>((from, to) => service.from("bill_to_accounts")
      .select("id,name,contact_name,email,phone,address,active")
      .eq("organization_id", organizationId).eq("active", true).order("name").order("id").range(from, to));
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
    return NextResponse.json({ billTos: result.data || [], canManageBillTos: true });
  }
  // Preserve scoped payroll/game operations without exposing the organization directory.
  // Apply exact league/location pairs before pagination, then read only attached account IDs.
  const games = await readAllPages<{ bill_to_id: string | null }>((from, to) => scopeGameQuery(service.from("games")
    .select("bill_to_id").eq("organization_id", organizationId).not("bill_to_id", "is", null), context)
    .order("id").range(from, to));
  if (games.error) return NextResponse.json({ error: games.error.message }, { status: 500 });
  const ids = [...new Set((games.data || []).map((game) => game.bill_to_id).filter((id): id is string => Boolean(id)))];
  const result = await readAllForChunks<BillTo, string>(ids, (chunk, from, to) => service.from("bill_to_accounts")
    .select("id,name,email,active").eq("organization_id", organizationId).eq("active", true).in("id", chunk)
    .order("name").order("id").range(from, to));
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 });
  return NextResponse.json({ billTos: (result.data || []).sort((left, right) => left.name.localeCompare(right.name)), canManageBillTos: false });
}

export async function POST(request: NextRequest) {
  const context = await requireOrganizationOwner(request);
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

export async function PATCH(request: NextRequest) {
  const context = await requireOrganizationOwner(request);
  if (context.error) return context.error;
  const { service, organizationId } = context;
  const body = (await request.json()) as { id?: string; email?: string };
  const id = String(body.id || "").trim();
  const email = String(body.email || "")
    .trim()
    .toLowerCase();
  if (!id || !email || !email.includes("@"))
    return NextResponse.json(
      { error: "Bill To and a valid billing email are required." },
      { status: 400 },
    );
  const { data, error } = await service
    .from("bill_to_accounts")
    .update({ email })
    .eq("id", id)
    .eq("organization_id", organizationId)
    .select("id,name,contact_name,email,phone,address,active")
    .maybeSingle();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data)
    return NextResponse.json(
      { error: "Bill To was not found." },
      { status: 404 },
    );
  return NextResponse.json({ billTo: data });
}
