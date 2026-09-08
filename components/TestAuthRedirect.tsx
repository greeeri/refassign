"use client";

import { useEffect } from "react";
import { createTierTestClient } from "../lib/supabase/client";

export default function TestAuthRedirect() {
  useEffect(() => {
    if (window.location.hostname !== "test.ref-assign.com") return;

    const params = new URLSearchParams(window.location.search);
    const returningFromAuth =
      window.location.hash.includes("access_token=") ||
      window.location.hash.includes("error=") ||
      params.has("code") ||
      params.has("token_hash");
    if (!returningFromAuth) return;

    const supabase = createTierTestClient();
    const goToWorkspace = () => window.location.replace("/workspace");
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && ["SIGNED_IN", "INITIAL_SESSION", "TOKEN_REFRESHED"].includes(event))
        goToWorkspace();
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) goToWorkspace();
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  return null;
}
