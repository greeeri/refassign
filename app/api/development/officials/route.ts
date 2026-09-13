import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "../../../../lib/supabase/admin";
import { createServerSupabaseClient } from "../../../../lib/supabase/server";

export async function POST(request: NextRequest) {
  const session = await createServerSupabaseClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    officialId?: string;
  };
  const officialId = body.officialId?.trim();
  if (!officialId) {
    return NextResponse.json(
      { error: "Select an official to add." },
      { status: 400 },
    );
  }

  const service = createServiceClient();
  const { data: program, error: programError } = await service
    .from("registration_programs")
    .select("id")
    .eq("slug", "iowa-soccer")
    .single();
  if (programError || !program) {
    return NextResponse.json(
      { error: programError?.message || "Iowa Soccer program was not found." },
      { status: 404 },
    );
  }

  const { data: allowed, error: accessError } = await session.rpc(
    "can_manage_registration_program",
    { p_program_id: program.id },
  );
  if (accessError || !allowed) {
    return NextResponse.json(
      { error: "Iowa Soccer admin or registrar access is required." },
      { status: 403 },
    );
  }

  const { data: official, error: officialError } = await service
    .from("officials")
    .select("id,active")
    .eq("id", officialId)
    .single();
  if (officialError || !official) {
    return NextResponse.json(
      { error: "The selected official could not be found." },
      { status: 404 },
    );
  }
  if (!official.active) {
    return NextResponse.json(
      { error: "Inactive officials cannot be added to the program." },
      { status: 400 },
    );
  }

  const { error: insertError } = await service
    .from("registration_program_officials")
    .upsert(
      {
        program_id: program.id,
        official_id: officialId,
        source: "registrar",
        added_by: user.id,
      },
      { onConflict: "program_id,official_id", ignoreDuplicates: true },
    );
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({ added: true });
}
