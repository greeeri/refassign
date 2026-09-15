"use client";

import { useEffect, useState } from "react";
import { createClient } from "../../../lib/supabase/client";

export default function AuthCompletePage() {
  const [message, setMessage] = useState("Securely signing you in…");

  useEffect(() => {
    let active = true;

    async function completeSignIn() {
      const query = new URLSearchParams(window.location.search);
      const requestedNext = query.get("next") || "/workspace";
      const next =
        requestedNext.startsWith("/") && !requestedNext.startsWith("//")
          ? requestedNext
          : "/workspace";

      try {
        const supabase = createClient();
        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession();

        if (sessionError) throw sessionError;

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !session || !user) {
          throw userError || new Error("The secure sign-in link could not create a session.");
        }

        console.info("[auth/complete] browser session established", {
          destination: next,
        });
        window.location.replace(next);
      } catch (error) {
        console.error("[auth/complete] sign-in failed", error);
        if (active) {
          setMessage(
            "This secure link could not sign you in. Return to the login page and request a new secure sign-in link in this browser.",
          );
        }
      }
    }

    void completeSignIn();
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="loginPage">
      <section className="loginCard">
        <div className="loginBrand">
          Ref Pro <span>Group</span>
        </div>
        <p>Sports Officials Management</p>
        <h1>Completing sign-in</h1>
        <p>{message}</p>
      </section>
    </main>
  );
}
