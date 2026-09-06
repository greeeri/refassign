import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://test.ref-assign.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Sign in before inviting a teammate." }, 401);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const token = authorization.replace("Bearer ", "");
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Your session expired. Please sign in again." }, 401);

    const body = await request.json();
    const organizationId = String(body.organizationId ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "");
    const viewerPermissions = Array.isArray(body.viewerPermissions) ? body.viewerPermissions.map(String) : [];

    const { data: invitationId, error: invitationError } = await userClient.rpc("create_organization_invitation", {
      p_organization_id: organizationId,
      p_email: email,
      p_role: role,
      p_viewer_permissions: role === "viewer" ? viewerPermissions : [],
    });
    if (invitationError) return json({ error: invitationError.message }, 403);

    const redirectTo = "https://test.ref-assign.com/tier-test";
    const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { refassign_organization_id: organizationId, refassign_role: role },
    });

    if (inviteError) {
      const alreadyRegistered = /already|registered|exists/i.test(inviteError.message);
      if (alreadyRegistered) {
        const publicClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
        const { error: linkError } = await publicClient.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false, emailRedirectTo: redirectTo },
        });
        if (!linkError) return json({ sent: true, invitationId, existingAccount: true });
      }
      await userClient.rpc("revoke_organization_invitation", { p_invitation_id: invitationId });
      return json({ error: `The invitation could not be emailed: ${inviteError.message}` }, 400);
    }

    return json({ sent: true, invitationId, existingAccount: false });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Unable to send invitation." }, 400);
  }
});
