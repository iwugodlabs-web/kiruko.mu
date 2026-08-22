"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/services/apiClient";
import { CheckCircle2, Loader2, ShieldCheck, AlertTriangle } from "lucide-react";

function ClaimInner() {
  const params = useSearchParams();
  const token = params.get("token") || "";

  const [phase, setPhase] = useState<"loading" | "form" | "invalid" | "done">("loading");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Whether this account may use the web dashboard (owners/admins) or should be
  // sent to the mobile app (regular employees are blocked from web login).
  const [webAccess, setWebAccess] = useState(false);

  useEffect(() => {
    if (!token) { setPhase("invalid"); setErr("This link is missing its token."); return; }
    let cancelled = false;
    api.post("/account/claim/validate", { token })
      .then((r) => { if (cancelled) return; setName(r.data?.first_name || ""); setEmail(r.data?.email || ""); setPhase("form"); })
      .catch((e) => {
        if (cancelled) return;
        setErr(e?.response?.data?.detail || "This link is invalid or has expired.");
        setPhase("invalid");
      });
    return () => { cancelled = true; };
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pw.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (pw !== confirm) { setErr("Passwords don't match."); return; }
    setSubmitting(true);
    try {
      const r = await api.post("/account/claim/complete", { token, new_password: pw });
      setWebAccess(Boolean(r.data?.web_access));
      setPhase("done");
    } catch (e: unknown) {
      setErr((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || "Could not set your password.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-sm p-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="flex items-center justify-center gap-2 mb-5">
          <img src="/kiruko-mark.png" alt="Kiruko" className="w-9 h-9 object-contain" />
          <span className="text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-100">Kiruko</span>
        </div>

        {phase === "loading" && (
          <div className="flex items-center justify-center gap-2 py-8 text-zinc-500">
            <Loader2 className="h-5 w-5 animate-spin" /> Checking your link…
          </div>
        )}

        {phase === "invalid" && (
          <div className="text-center py-6">
            <AlertTriangle className="h-8 w-8 mx-auto text-amber-500" />
            <h1 className="mt-3 text-base font-semibold text-zinc-900 dark:text-zinc-100">Link not valid</h1>
            <p className="mt-1 text-sm text-zinc-500">{err}</p>
            <p className="mt-3 text-xs text-zinc-400">Ask your employer to send you a new set-up link.</p>
          </div>
        )}

        {phase === "form" && (
          <form onSubmit={submit}>
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
              <ShieldCheck className="h-5 w-5" />
              <span className="text-xs font-semibold uppercase tracking-wide">Set your password</span>
            </div>
            <h1 className="mt-2 text-lg font-bold text-zinc-900 dark:text-zinc-100">
              Welcome{name ? `, ${name}` : ""}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">Create a password to activate <span className="font-medium">{email}</span>.</p>

            <label className="block mt-4 text-xs font-medium text-zinc-600 dark:text-zinc-300">New password</label>
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password"
                   className="mt-1 w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-blue-500" />
            <label className="block mt-3 text-xs font-medium text-zinc-600 dark:text-zinc-300">Confirm password</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password"
                   className="mt-1 w-full rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-blue-500" />

            {err && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{err}</p>}

            <button type="submit" disabled={submitting}
                    className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {submitting ? "Setting…" : "Set password & activate"}
            </button>
            <p className="mt-2 text-[11px] text-zinc-400">At least 8 characters.</p>
          </form>
        )}

        {phase === "done" && (
          <div className="text-center py-6">
            <CheckCircle2 className="h-8 w-8 mx-auto text-emerald-500" />
            <h1 className="mt-3 text-base font-semibold text-zinc-900 dark:text-zinc-100">You&apos;re all set</h1>
            {webAccess ? (
              <>
                {/* Owner / admin — the web dashboard is theirs. */}
                <p className="mt-1 text-sm text-zinc-500">Your account is active. You can now log in.</p>
                <Link href="/" className="mt-4 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
                  Go to login
                </Link>
              </>
            ) : (
              <>
                {/* Regular employee — web is employer-only, so send them to the app. */}
                <p className="mt-1 text-sm text-zinc-500">
                  Your account is active. Open the <span className="font-medium text-zinc-700 dark:text-zinc-200">Kiruko</span> app on your phone and sign in
                  {email ? <> with <span className="font-medium">{email}</span></> : null} and your new password.
                </p>
                <div className="mt-4 rounded-md bg-zinc-50 dark:bg-zinc-800/60 px-4 py-3 text-xs text-zinc-500 dark:text-zinc-400">
                  Don&apos;t have the app yet? Ask your employer for the download link, or search &ldquo;Kiruko&rdquo; in your app store.
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ClaimPage() {
  return (
    <Suspense fallback={null}>
      <ClaimInner />
    </Suspense>
  );
}
