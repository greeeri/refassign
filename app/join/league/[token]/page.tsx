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
      const [{ data: userData }, { data, error: linkError }] =
        await Promise.all([
          supabase.auth.getUser(),
          supabase.rpc("get_league_connection_link", { p_token: token }),
        ]);
      setSignedIn(Boolean(userData.user));
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
    const { data, error: claimError } = await supabase.rpc(
      "claim_league_connection_link",
      { p_token: token },
    );
    setConnecting(false);
    if (claimError) setError(claimError.message);
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
                  Create free official account
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
