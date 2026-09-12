"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createClient,
  createPasswordRecoveryClient,
} from "../../lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [creatingOfficial, setCreatingOfficial] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [officialInvitationId, setOfficialInvitationId] = useState("");
  const [organizationSignup, setOrganizationSignup] = useState(false);
  const [nextPath, setNextPath] = useState("/workspace");

  useEffect(() => {
    setTestMode(window.location.hostname === "test.ref-assign.com");
    const query = new URLSearchParams(window.location.search);
    const requestedNext = query.get("next") || "/workspace";
    setNextPath(
      requestedNext.startsWith("/") && !requestedNext.startsWith("//")
        ? requestedNext
        : "/workspace",
    );
    setOrganizationSignup(query.get("signup") === "organization");
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const invitedEmail = hash.get("official");
    const invitationId = hash.get("official_invite");
    if (invitationId) {
      setOfficialInvitationId(invitationId);
      localStorage.setItem("refassign-official-invitation", invitationId);
    }
    if (invitedEmail) {
      setEmail(invitedEmail);
      setCreatingOfficial(true);
    }
  }, []);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setMessage(error.message);
        return;
      }
      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      setMessage(
        err instanceof Error
          ? err.message
          : "Unable to sign in. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function createOfficialAccount(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const supabase = createClient();
      const invitationQuery = officialInvitationId
        ? `?official_invite=${encodeURIComponent(officialInvitationId)}`
        : "";
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          data: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
            account_type: "official",
            official_invitation_id: officialInvitationId || undefined,
          },
          emailRedirectTo: `${window.location.origin}/workspace${invitationQuery}`,
          shouldCreateUser: true,
        },
      });
      if (error) return setMessage(error.message);
      setMessage(
        "Secure account link sent. Open the email to sign in and select your officiating organization.",
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to create the official account.");
    } finally {
      setLoading(false);
    }
  }

  async function createOrganizationAccount(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const supabase = createClient();
      const callback = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: callback,
          data: { account_type: "organization_owner" },
        },
      });
      if (error) return setMessage(error.message);
      if (data.user && (data.user.identities?.length ?? 0) === 0) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (!signInError) {
          router.replace(nextPath);
          router.refresh();
          return;
        }
        setOrganizationSignup(false);
        setMessage(
          "This email already has a RefAssign account. Sign in with your existing password, or use Forgot password below.",
        );
        return;
      }
      if (data.session) {
        router.replace(nextPath);
        router.refresh();
      } else {
        setMessage(
          "Account created. Confirm your email to continue organization setup.",
        );
      }
    } catch (err) {
      setMessage(
        err instanceof Error
          ? err.message
          : "Unable to create the organization account.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function forgotPassword() {
    if (!email) {
      setMessage(
        "Enter your email address first, then select Forgot password.",
      );
      return;
    }
    setResetting(true);
    setMessage("");
    try {
      const supabase = createPasswordRecoveryClient();
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      setMessage(
        error ? error.message : "Password reset email sent. Check your inbox.",
      );
    } catch (err) {
      setMessage(
        err instanceof Error
          ? err.message
          : "Unable to send password reset email.",
      );
    } finally {
      setResetting(false);
    }
  }

  async function sendSignInLink() {
    if (!email) {
      setMessage("Enter your email address first, then request a sign-in link.");
      return;
    }
    setSendingLink(true);
    setMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}${nextPath}`,
          shouldCreateUser: false,
        },
      });
      setMessage(
        error
          ? error.message
          : "Sign-in email sent. The secure link will open your RefAssign workspace.",
      );
    } catch (err) {
      setMessage(
        err instanceof Error ? err.message : "Unable to send a sign-in link.",
      );
    } finally {
      setSendingLink(false);
    }
  }

  return (
    <main className="loginPage">
      <section className="loginCard">
        <div className="loginBrand">
          Ref<span>Assign</span>
        </div>
        <p>Sports Officials Management</p>
        <h1>{creatingOfficial ? "Create official account" : organizationSignup ? "Create organization account" : "Sign in"}</h1>
        <p>{creatingOfficial ? "Use the same email address your organization invited." : organizationSignup ? "Create the owner login for your new RefAssign organization." : "Enter your email address and password."}</p>
        <form onSubmit={creatingOfficial ? createOfficialAccount : organizationSignup ? createOrganizationAccount : signIn}>
          {creatingOfficial && <>
            <label>First name<input required autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} /></label>
            <label>Last name<input required autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} /></label>
          </>}
          <label>
            Email address
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              readOnly={creatingOfficial && window.location.hash.includes("official=")}
              placeholder="you@example.com"
            />
          </label>
          {!creatingOfficial && <label>
            Password
            <input
              type="password"
              required
            autoComplete={organizationSignup ? "new-password" : "current-password"}
            minLength={organizationSignup ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
            />
          </label>}
          <button className="primary loginButton" disabled={loading}>
            {loading ? "Please wait…" : creatingOfficial ? "Email my secure account link" : organizationSignup ? "Create account and continue" : "Sign in"}
          </button>
        </form>
        {organizationSignup && <button type="button" className="secondary" style={{marginTop:10,width:"100%"}} onClick={()=>{setOrganizationSignup(false);setMessage("")}}>Already have an account? Sign in</button>}
        {testMode && <button type="button" className="secondary" style={{ marginTop: 10, width: "100%" }} onClick={() => { setCreatingOfficial((value) => !value); setMessage(""); }}>
          {creatingOfficial ? "Back to sign in" : "Invited official? Create test account"}
        </button>}
        <p style={{ textAlign: "center", marginTop: 16 }}>
          <a href="/register">New official? Start registration</a>
        </p>
        {!creatingOfficial && !organizationSignup && <button
          type="button"
          className="secondary"
          style={{ marginTop: 10, width: "100%" }}
          disabled={sendingLink || loading}
          onClick={() => void sendSignInLink()}
        >
          {sendingLink ? "Sending…" : "Email me a secure sign-in link"}
        </button>}
        {!creatingOfficial && !organizationSignup && <button
          type="button"
          className="secondary"
          style={{ marginTop: 10, width: "100%" }}
          disabled={resetting}
          onClick={() => void forgotPassword()}
        >
          {resetting ? "Sending…" : "Forgot password?"}
        </button>}
        {message && <div className="loginMessage">{message}</div>}
      </section>
    </main>
  );
}
