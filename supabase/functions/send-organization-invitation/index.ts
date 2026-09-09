import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://ref-assign.com",
  "https://www.ref-assign.com",
  "https://refassign-chi.vercel.app",
  "https://test.ref-assign.com",
]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requestOrigin = (request: Request) => {
  const origin = request.headers.get("Origin") ?? "";
  return allowedOrigins.has(origin) ? origin : "https://ref-assign.com";
};
const corsHeaders = (request: Request) => ({
  "Access-Control-Allow-Origin": requestOrigin(request),
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

const json = (request: Request, body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), "Content-Type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json(request, { error: "Sign in before inviting a teammate." }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const token = authorization.replace("Bearer ", "");
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return json(request, { error: "Your session expired. Please sign in again." }, 401);

    const body = await request.json();
    const organizationId = String(body.organizationId ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "");
    const viewerPermissions = Array.isArray(body.viewerPermissions) ? body.viewerPermissions.map(String) : [];
    const leagueIds = Array.isArray(body.leagueIds)
      ? body.leagueIds.map(String).filter((id) => uuidPattern.test(id))
      : [];
    if (!uuidPattern.test(organizationId)) return json(request, { error: "Select a valid organization." }, 400);
    if ((role === "assignor" || role === "viewer") && !leagueIds.length) {
      return json(request, { error: "Select at least one valid league." }, 400);
    }

    const { data: invitationId, error: invitationError } = await userClient.rpc("create_organization_invitation", {
      p_organization_id: organizationId,
      p_email: email,
      p_role: role,
      p_viewer_permissions: role === "viewer" ? viewerPermissions : [],
      p_league_ids: role === "assignor" || role === "viewer" ? leagueIds : [],
    });
    if (invitationError) return json(request, { error: invitationError.message }, 403);

    const origin = requestOrigin(request);
    const destination = origin === "https://test.ref-assign.com"
      ? "/tier-test"
      : "/workspace";
    const redirectTo = `${origin}/set-password?next=${encodeURIComponent(destination)}`;
    let existingAccount = false;
    let { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "invite",
      email,
      options: { redirectTo, data: { refassign_organization_id: organizationId, refassign_role: role } },
    });
    if (linkError && /already|registered|exists/i.test(linkError.message)) {
      existingAccount = true;
      ({ data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo: `${origin}${destination}` },
      }));
    }

    if (linkError || !linkData.properties?.action_link) {
      await userClient.rpc("revoke_organization_invitation", { p_invitation_id: invitationId });
      return json(request, { error: `The invitation link could not be created: ${linkError?.message ?? "unknown error"}` }, 400);
    }

    return json(request, { invitationId, existingAccount, actionLink: linkData.properties.action_link });
  } catch (error) {
    return json(request, { error: error instanceof Error ? error.message : "Unable to send invitation." }, 400);
  }
});
