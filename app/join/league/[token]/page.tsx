"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "../../../../lib/supabase/client";

type LinkDetails = {
  organization_name: string;
  league_name: string;
  active: boolean;
};

type ClaimResult = {
  organization_id: string;
  organization_name: string;
  league_id: string;
  league_name: string;
  already_connected: boolean;
};

export default function LeagueConnectionPage() {
  const { token } = useParams<{ token: string }>();
  const supabase = useMemo(() => createClient(), []);
  const [details, setDetails] = useState<LinkDetails | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [result, setResult] = useState<ClaimResult | null>(null);
  const [error, setError] = useState("");

  const returnPath = `/join/league/${token}`;
  const loginPath = `/login?next=${encodeURIComponent(returnPath)}`;
  const signupPath = `/login?account=official&next=${encodeURIComponent(returnPath)}`;

  useEffect(() => {
    async function load() {
      // Let the browser client restore/refresh its session before deciding
      // whether this visitor can claim the link. Running getUser and the RPC
      // concurrently can race on mobile browsers opened from email: getUser
      // succeeds after refreshing the session while the RPC has already been
      // sent with the anon role.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setSignedIn(Boolean(session?.user));

      const { data, error: linkError } = await supabase.rpc(
        "get_league_connection_link",
        { p_token: token },
      );
      if (linkError) setError(linkError.message);
      else {
        const row = ((data || []) as LinkDetails[])[0];
        if (!row || !row.active)
          setError("This league connection link is invalid or no longer active.");
        else setDetails(row);
      }
      setLoading(false);
    }
    if (token) void load();
  }, [supabase, token]);

  async function connect() {
    setConnecting(true);
    setError("");

    const {
      data: { session: currentSession },
    } = await supabase.auth.getSession();
    let session = currentSession;
    const expiresSoon =
      !session?.expires_at || session.expires_at <= Date.now() / 1000 + 60;

    if (expiresSoon && session) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      session = refreshed.session;
    }

    if (!session?.access_token) {
      setSignedIn(false);
      setConnecting(false);
      window.location.assign(loginPath);
      return;
    }

    let { data, error: claimError } = await supabase.rpc(
      "claim_league_connection_link",
      { p_token: token },
    );

    // A browser resumed from the background can retain a stale auth display
    // while the first request reaches PostgREST without a usable JWT. Refresh
    // once and retry instead of exposing a database permission error.
    if (claimError?.message.includes("permission denied")) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      if (refreshed.session?.access_token) {
        ({ data, error: claimError } = await supabase.rpc(
          "claim_league_connection_link",
          { p_token: token },
        ));
      }
    }

    setConnecting(false);
    if (claimError?.message.includes("permission denied")) {
      setSignedIn(false);
      window.location.assign(loginPath);
    } else if (claimError) setError(claimError.message);
    else setResult(data as ClaimResult);
  }

  return (
    <main className="loginPage">
      <section className="loginCard" style={{ maxWidth: 560 }}>
        <div className="loginBrand">
          Ref Pro <span>Group</span>
        </div>
        <p>League Official Connection</p>
        {loading ? (
          <h1>Loading league…</h1>
        ) : result ? (
          <>
            <h1>You’re connected</h1>
            <p>
              Your official account is now connected to <b>{result.league_name}</b>{" "}
              through {result.organization_name}.
            </p>
            <Link className="primary loginButton" href={`/workspace?organization=${result.organization_id}`}>
              Open my workspace
            </Link>
          </>
        ) : details ? (
          <>
            <h1>Connect to {details.league_name}</h1>
            <p>
              <b>{details.organization_name}</b> invited you to connect your
              Ref Pro Group official account to this league.
            </p>
            <div className="loginMessage">
              Connecting adds you to the organization’s official directory and
              marks you eligible for {details.league_name}. It does not assign
              you to any games automatically.
            </div>
            {signedIn ? (
              <button
                className="primary loginButton"
                disabled={connecting}
                onClick={() => void connect()}
              >
                {connecting ? "Connecting…" : "Connect to this league"}
              </button>
            ) : (
              <>
                <Link className="primary loginButton" href={loginPath}>
                  Sign in to connect
                </Link>
                <Link className="secondary loginButton" href={signupPath}>
                  Create your free account
                </Link>
              </>
            )}
          </>
        ) : null}
        {error && <div className="errorBox">{error}</div>}
      </section>
    </main>
  );
}
