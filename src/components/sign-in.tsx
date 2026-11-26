"use client";

import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { researchClient, researchConfigured } from "../lib/research";
import { routes, workspaceDestination } from "../lib/routes";
import { AppErrorDialog } from "./app-error-dialog";
import { useResearchSession } from "./research-session";
import { WorkspaceBrand } from "./workspace-brand";

export function SignIn() {
  const router = useRouter();
  const { session, loading } = useResearchSession();
  const [submitting, setSubmitting] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [error, setError] = useState("");
  const passwordField = useRef<HTMLInputElement>(null);
  const signedIn = Boolean(session && !session.user.is_anonymous);

  useEffect(() => {
    if (!researchConfigured) {
      router.replace(routes.search);
    } else if (signedIn) {
      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(workspaceDestination(next));
    }
  }, [router, signedIn]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const fields = new FormData(event.currentTarget);
    setSubmitting(true);
    try {
      const { error } = await researchClient().auth.signInWithPassword({
        email: String(fields.get("email")).trim(),
        password: String(fields.get("password")),
      });
      if (error) {
        setError(error.code === "invalid_credentials" ? "Email or password is incorrect." :
          error.code === "email_not_confirmed" ? "Confirm your email before signing in." :
            "Check your details and try again.");
      }
    } catch {
      setError("Could not connect to the workspace. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const opening = loading || signedIn || !researchConfigured;
  const PasswordIcon = passwordVisible ? EyeOff : Eye;

  return (
    <main className="sign-in-page">
      <div className="sign-in-content">
        <WorkspaceBrand />
        {opening ? (
          <p className="action-card sign-in-card" role="status">Opening workspace…</p>
        ) : (
          <form className="action-card sign-in-card" aria-labelledby="sign-in-title" method="post" onSubmit={submit}>
            <h1 id="sign-in-title">Sign in</h1>
            <div className="form-field">
              <label htmlFor="sign-in-email">Email</label>
              <input id="sign-in-email" name="email" type="email" autoComplete="username" spellCheck={false} required />
            </div>
            <div className="form-field">
              <label htmlFor="sign-in-password">Password</label>
              <div className="sign-in-password">
                <input ref={passwordField} id="sign-in-password" name="password" type={passwordVisible ? "text" : "password"} autoComplete="current-password" spellCheck={false} autoCapitalize="none" required />
                <button className="icon-button" type="button" aria-label={passwordVisible ? "Hide password" : "Show password"} aria-controls="sign-in-password" onClick={() => setPasswordVisible(!passwordVisible)}>
                  <PasswordIcon size={17} aria-hidden="true" />
                </button>
              </div>
            </div>
            <button className="button button-primary" type="submit" disabled={submitting}>
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>
        )}
      </div>
      <AppErrorDialog title="Couldn’t sign in" message={error} onClose={() => setError("")} returnFocus={passwordField} />
    </main>
  );
}
