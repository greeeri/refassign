import { redirect } from "next/navigation";
import TournamentArTraining from "../../../components/TournamentArTraining";
import { createServiceClient } from "../../../lib/supabase/admin";
import { createServerSupabaseClient } from "../../../lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function TournamentArTrainingPage() {
  const session = await createServerSupabaseClient();
  const { data: { user } } = await session.auth.getUser();
  if (!user)
    redirect("/login?account=official&next=%2Ftraining%2Ftournament-ar");

  const service = createServiceClient();
  const metadata = user.user_metadata || {};
  const email = String(user.email || "").trim().toLowerCase();
  let { data: official } = await service
    .from("officials")
    .select("id,first_name,last_name,email")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (!official && email) {
    const { data: matchingOfficial } = await service
      .from("officials")
      .select("id,first_name,last_name,email")
      .ilike("email", email)
      .maybeSingle();
    if (matchingOfficial) {
      await service.from("officials").update({ auth_user_id: user.id, active: true }).eq("id", matchingOfficial.id);
      official = matchingOfficial;
    }
  }

  if (!official) {
    const firstName = String(metadata.first_name || "").trim();
    const lastName = String(metadata.last_name || "").trim();
    const { data: createdOfficial } = await service
      .from("officials")
      .insert({
        auth_user_id: user.id,
        email,
        first_name: firstName,
        last_name: lastName,
        full_name: `${firstName} ${lastName}`.trim(),
        active: true,
      })
      .select("id,first_name,last_name,email")
      .single();
    official = createdOfficial;
  }

  if (!official)
    return <main className="tournamentArPage"><section className="tournamentArCard"><h1>Tournament AR Training</h1><div className="errorBox">We could not create your free official training profile. Please contact support.</div></section></main>;

  await service.from("tournament_ar_training_access").insert({
    user_id: user.id,
    official_id: official.id,
    email: email || official.email,
    first_name: official.first_name,
    last_name: official.last_name,
  });

  const { data: module } = await service
    .from("development_modules")
    .select("id,title,description,category,resource_url")
    .eq("level_key", "tournament_ar")
    .eq("active", true)
    .order("sort_order")
    .limit(1)
    .maybeSingle();

  if (!module)
    return <main className="tournamentArPage"><section className="tournamentArCard"><h1>Tournament AR Training</h1><div className="errorBox">This training is not currently available.</div></section></main>;

  return <TournamentArTraining module={module} />;
}
