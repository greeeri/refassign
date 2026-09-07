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

  useEffect(() => {
    setTestMode(window.location.hostname === "test.ref-assign.com");
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
      router.replace("/workspace");
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
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            full_name: `${firstName.trim()} ${lastName.trim()}`.trim(),
          },
          emailRedirectTo: `${window.location.origin}/workspace`,
        },
      });
      if (error) return setMessage(error.message);
      if (data.session) {
        router.replace("/workspace");
        router.refresh();
      } else {
        setMessage("Account created. Open the confirmation email, then you will enter every organization that invited this email address.");
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to create the official account.");
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
          emailRedirectTo: `${window.location.origin}/workspace`,
          shouldCreateUser: true,
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
        <h1>{creatingOfficial ? "Create official account" : "Sign in"}</h1>
        <p>{creatingOfficial ? "Use the same email address your organization invited." : "Enter your email address and password."}</p>
        <form onSubmit={creatingOfficial ? createOfficialAccount : signIn}>
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
              placeholder="you@example.com"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
            autoComplete={creatingOfficial ? "new-password" : "current-password"}
            minLength={creatingOfficial ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
            />
          </label>
          <button className="primary loginButton" disabled={loading}>
            {loading ? "Please wait…" : creatingOfficial ? "Create official account" : "Sign in"}
          </button>
        </form>
        {testMode && <button type="button" className="secondary" style={{ marginTop: 10, width: "100%" }} onClick={() => { setCreatingOfficial((value) => !value); setMessage(""); }}>
          {creatingOfficial ? "Back to sign in" : "Invited official? Create test account"}
        </button>}
        <p style={{ textAlign: "center", marginTop: 16 }}>
          <a href="/register">New official? Start registration</a>
        </p>
        {!creatingOfficial && <button
          type="button"
          className="secondary"
          style={{ marginTop: 10, width: "100%" }}
          disabled={sendingLink || loading}
          onClick={() => void sendSignInLink()}
        >
          {sendingLink ? "Sending…" : "Email me a secure sign-in link"}
        </button>}
        {!creatingOfficial && <button
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
