"use client";

import { useState } from "react";
import { stepUp, type StepUpPurpose } from "@/services/payroll-api";
import { toast } from "sonner";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";


function isError<T>(v: T | { error: string; status?: number }): v is { error: string; status?: number } {
  return typeof v === "object" && v !== null && "error" in v;
}


interface Props {
  /** Purpose for the OTP. For rule supersedes use "rule_supersede". */
  purpose: StepUpPurpose;
  /** Body label rendered below the step-up panel — what the user is about to do. */
  description: string;
  /** Called with a fresh single-use step-up token after OTP verification. The
   * caller is expected to immediately POST a supersede with this token. */
  onSubmit: (stepUpToken: string) => Promise<{ ok: boolean; message?: string }>;
  /** Whether the submit button is disabled even after a token is acquired. */
  disabled?: boolean;
}


/**
 * Inline step-up panel: "Send OTP" → 6-digit input → "Verify and submit".
 * Self-contained — drop into any add-version dialog and provide an `onSubmit`.
 */
export default function AddVersionStepUpFlow({ purpose, description, onSubmit, disabled }: Props) {
  const [otpRequested, setOtpRequested] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleRequest() {
    setLoading(true);
    const r = await stepUp.request(purpose);
    setLoading(false);
    if (isError(r)) {
      toast.error(r.error);
      return;
    }
    setOtpRequested(true);
    toast.success("OTP sent. Check your email.");
  }

  async function handleVerifyAndSubmit() {
    if (!otpCode.match(/^\d{6}$/)) {
      toast.error("Enter the 6-digit OTP from your email");
      return;
    }
    setLoading(true);
    const verifyResp = await stepUp.verify(purpose, otpCode);
    if (isError(verifyResp)) {
      setLoading(false);
      toast.error(verifyResp.error);
      return;
    }
    const submitResp = await onSubmit(verifyResp.token);
    setLoading(false);
    if (!submitResp.ok) {
      toast.error(submitResp.message ?? "Submission failed");
      return;
    }
    toast.success("Saved");
    setOtpRequested(false);
    setOtpCode("");
  }

  return (
    <div className="rounded-md border border-zinc-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-blue-600" />
        <h4 className="text-sm font-medium text-zinc-900 dark:text-white">2-step confirmation</h4>
      </div>
      <p className="text-sm text-zinc-600 dark:text-gray-400">{description}</p>
      {!otpRequested ? (
        <button
          onClick={handleRequest}
          disabled={loading || disabled}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          Send OTP to my email
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-4 w-4" />
            OTP sent. Expires in 5 minutes.
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              pattern="\d{6}"
              maxLength={6}
              placeholder="6-digit code"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-40 rounded-md border border-zinc-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-500 px-3 py-2 text-center text-lg tracking-[0.5em] tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleVerifyAndSubmit}
              disabled={loading || otpCode.length !== 6 || disabled}
              className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Verify and save
            </button>
            <button
              onClick={handleRequest}
              disabled={loading}
              className="text-xs text-blue-600 hover:underline disabled:opacity-50"
            >
              Resend
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
