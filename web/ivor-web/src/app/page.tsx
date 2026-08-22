"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../contexts/AuthContext";
import { requestLoginOtp, verifyLoginOtp } from "../services/api";

type Mode = "email" | "phone";
type Step = "credentials" | "otp_sent";
const LAST_MODE_KEY = "kontokaz.lastLoginMode";

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>("email");
  const [step, setStep] = useState<Step>("credentials");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const router = useRouter();
  const { login, loginWithOtpResult, loading } = useAuth();

  // Rehydrate the user's prior mode so phone-first users don't see the
  // email tab every visit. localStorage is fine here — the value is
  // purely a UI preference, not security-sensitive.
  useEffect(() => {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(LAST_MODE_KEY) : null;
    if (v === "phone" || v === "email") setMode(v);
  }, []);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = window.setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendCooldown]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setErrorMsg(null);
    setStep("credentials");
    setCode("");
    if (typeof window !== "undefined") window.localStorage.setItem(LAST_MODE_KEY, next);
  };

  const routeAfterLogin = (result: boolean | { isPlatformAdmin: boolean }) => {
    if (!result) return;
    // Honor a ?next= return URL (e.g. an invite: /?next=%2Finvite%3Ftoken%3D...)
    // so the user lands back where they came from instead of always /dashboard.
    // Only allow same-site relative paths to avoid an open-redirect.
    try {
      const next = new URLSearchParams(window.location.search).get("next");
      if (next && next.startsWith("/") && !next.startsWith("//")) {
        router.push(next);
        return;
      }
    } catch {
      // fall through to default routing
    }
    const isAdmin = typeof result === "object" && result.isPlatformAdmin;
    router.push(isAdmin ? "/admin" : "/dashboard");
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    try {
      const result = await login(identifier, password);
      if (result) {
        routeAfterLogin(result);
      } else {
        setErrorMsg("Login failed. Please check your credentials.");
      }
    } catch (error: any) {
      const errorMessage = error?.message || error?.error || "Login failed. Please try again.";
      setErrorMsg(errorMessage);
    }
  };

  const handleSendOtp = async () => {
    setErrorMsg(null);
    if (identifier.trim().length < 7) {
      setErrorMsg("Enter a valid phone number first.");
      return;
    }
    setOtpBusy(true);
    const r = await requestLoginOtp(identifier.trim());
    setOtpBusy(false);
    if ("error" in r) {
      setErrorMsg(
        r.status === 429
          ? "Too many code requests. Try again in a few minutes."
          : r.error || "Couldn't send code.",
      );
      return;
    }
    setStep("otp_sent");
    setResendCooldown(30);
  };

  const handleVerifyOtp = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setErrorMsg(null);
    if (code.length < 4) {
      setErrorMsg("Enter the 6-digit code from WhatsApp.");
      return;
    }
    setOtpVerifying(true);
    const r = await verifyLoginOtp(identifier.trim(), code);
    setOtpVerifying(false);
    if ("error" in r) {
      // Device-binding rejection — code is correct but this browser
      // isn't approved. Usually a recycled-number + passwordless
      // account scenario, or a cache wipe on the primary device.
      if (r.status === 403 && /new_device_requires_approval/i.test(r.error)) {
        setErrorMsg(
          "Your code was correct, but this browser isn't on your trusted list. Sign in from a device you've used before, or contact your admin to approve this one.",
        );
        setCode("");
        return;
      }
      const msg =
        r.status === 400 && /expired/i.test(r.error)
          ? "That code expired. Request a fresh one."
          : r.status === 400
            ? "Invalid code. Check it and try again."
            : r.error || "Couldn't verify";
      setErrorMsg(msg);
      setCode("");
      return;
    }
    try {
      // r mirrors the password-login response shape. AuthContext.loginWithOtpResult
      // performs the same employee-block + state-derivation step as login().
      const result = loginWithOtpResult({ data: (r as any).data });
      routeAfterLogin(result);
    } catch (err: any) {
      setErrorMsg(err?.message || "Couldn't complete sign-in");
    }
  };

  // Auto-submit when the OTP reaches the 6-digit length — avoids a second
  // tap on a flow that's already two steps long.
  useEffect(() => {
    if (step !== "otp_sent" || code.length !== 6 || otpVerifying) return;
    handleVerifyOtp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, step]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="relative w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center mb-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/kiruko-mark.png" alt="Kiruko" className="w-14 h-14 object-contain" />
            </div>
            <h1 className="font-display text-2xl font-bold text-gray-900 mb-1">Kiruko</h1>
            <p className="text-gray-500 text-sm">
              {step === "otp_sent" ? "Enter the code from WhatsApp" : "Sign in to your dashboard"}
            </p>
          </div>

          {/* Error Message */}
          {errorMsg && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-red-400 mt-0.5 mr-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-red-700">{errorMsg}</p>
              </div>
            </div>
          )}

          {step === "credentials" && (
            <>
              {/* Email | Phone tab toggle — each tab swaps the identifier field
                  type. Submission always posts `identifier`; backend's looks_like_phone
                  decides which lookup to run. */}
              <div className="mb-6 grid grid-cols-2 gap-1 p-1 bg-gray-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => switchMode("email")}
                  className={`py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                    mode === "email" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
                  }`}
                >
                  Email
                </button>
                <button
                  type="button"
                  onClick={() => switchMode("phone")}
                  className={`py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                    mode === "phone" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
                  }`}
                >
                  Phone
                </button>
              </div>

              <form onSubmit={handlePasswordLogin} className="space-y-6" noValidate>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-gray-700">
                    {mode === "phone" ? "Phone Number" : "Email Address"}
                  </label>
                  <input
                    type={mode === "phone" ? "tel" : "email"}
                    placeholder={mode === "phone" ? "+230 5712 3456" : "Enter your email"}
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                    className="w-full h-12 px-4 bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 text-gray-800 placeholder-gray-400"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-semibold text-gray-700">Password</label>
                  <input
                    type="password"
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full h-12 px-4 bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 text-gray-800 placeholder-gray-400"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className={`w-full h-12 bg-gray-900 hover:bg-gray-800 text-white font-medium rounded-lg transition-colors flex items-center justify-center space-x-2 ${loading ? "opacity-75 cursor-not-allowed" : ""}`}
                >
                  {loading ? "Signing in..." : "Sign In"}
                </button>

                {/* WhatsApp OTP affordance — only on the phone tab. Same field
                    feeds both flows so the user doesn't re-type their number. */}
                {mode === "phone" && (
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={otpBusy}
                    className="w-full h-11 flex items-center justify-center gap-2 text-green-700 hover:text-green-800 font-semibold text-sm disabled:opacity-50"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2z" />
                    </svg>
                    {otpBusy ? "Sending code..." : "Get code on WhatsApp"}
                  </button>
                )}
              </form>
            </>
          )}

          {step === "otp_sent" && (
            <form onSubmit={handleVerifyOtp} className="space-y-6">
              <p className="text-sm text-gray-600 text-center">
                Code sent to <span className="font-semibold">{identifier}</span> on WhatsApp.
              </p>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d*"
                maxLength={6}
                placeholder="••••••"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D+/g, "").slice(0, 6))}
                autoFocus
                className="w-full h-16 text-center text-3xl tracking-[0.5em] font-mono bg-white border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 text-gray-800 placeholder-gray-300"
              />
              <button
                type="submit"
                disabled={otpVerifying || code.length < 4}
                className="w-full h-12 bg-gray-900 hover:bg-gray-800 text-white font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {otpVerifying ? "Verifying..." : "Verify & sign in"}
              </button>

              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  onClick={() => { setStep("credentials"); setCode(""); setErrorMsg(null); }}
                  className="text-gray-500 hover:text-gray-700"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={resendCooldown > 0 || otpBusy}
                  className="text-green-700 hover:text-green-800 font-semibold disabled:opacity-50"
                >
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : otpBusy ? "Sending..." : "Resend code"}
                </button>
              </div>
            </form>
          )}
        </div>

        <div className="text-center mt-8">
          <p className="text-xs text-gray-400">
            By signing in you agree to our{" "}
            <Link href="/terms" className="font-medium text-gray-600 underline underline-offset-2 hover:text-gray-800">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="font-medium text-gray-600 underline underline-offset-2 hover:text-gray-800">
              Privacy Policy
            </Link>
            .
          </p>
          <p className="text-gray-500 text-sm mt-3">© 2026 Kiruko. All rights reserved.</p>
          <p className="text-gray-400 text-xs mt-1">Powered by Zilwa Eklere Ltd</p>
        </div>
      </div>
    </div>
  );
}
