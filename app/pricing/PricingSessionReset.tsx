"use client";

import { useEffect } from "react";
import { createClient } from "../../lib/supabase/client";

export default function PricingSessionReset() {
  useEffect(() => {
    void createClient().auth.signOut({ scope: "local" });
  }, []);

  return null;
}
