"use client";

/**
 * M28 / v1.6 — Kiosk PIN panel for the employee detail view.
 *
 * v1.6 redesign: admin no longer types a PIN — the server generates a
 * random 4-digit code on demand. The digits are shown ONCE in a modal
 * so the admin can read them aloud / print them / share via whatever
 * channel works for the company. The employee then changes the PIN
 * to one they'll remember on first kiosk use (via the kiosk's
 * change-PIN flow).
 *
 * Why this beats free-typed PINs:
 *   * No "0000 for everyone" anti-pattern (admins lazy-typing the same
 *     PIN for every employee = zero security).
 *   * No PIN handed back to the admin who could then impersonate the
 *     employee — the digits exist for ONE moment, in transit only.
 *   * Cryptographically random (secrets.randbelow) — uniform 4-digit
 *     space; no admin bias.
 *
 * Reset = same flow — admin clicks "Generate new PIN", the previous
 * one stops working.
 */

import { useState } from "react";
import { Copy, Key, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import Modal from "@/components/Modal";
import { kioskAdmin } from "@/services/kioskAdminApi";


interface KioskPinPanelProps {
  privateUserId: number;
  /**
   * Initial PIN state from the employee fetch. The detail page may not
   * have it (the existing API doesn't return kiosk_pin_hash) — leave
   * undefined and the UI will say "manage" rather than confirming
   * whether one is set.
   */
  hasPin?: boolean;
}


export default function KioskPinPanel({ privateUserId, hasPin }: KioskPinPanelProps) {
  const [submitting, setSubmitting] = useState(false);
  const [generatedPin, setGeneratedPin] = useState<string | null>(null);

  const handleGenerate = async () => {
    setSubmitting(true);
    const r = await kioskAdmin.generateEmployeePin(privateUserId);
    setSubmitting(false);
    if (typeof r === "object" && r !== null && "error" in (r as object)) {
      toast.error((r as { error: string }).error ?? "Failed to generate PIN");
      return;
    }
    setGeneratedPin((r as { pin: string }).pin);
  };

  const handleCopy = async () => {
    if (!generatedPin) return;
    try {
      await navigator.clipboard.writeText(generatedPin);
      toast.success("PIN copied to clipboard");
    } catch {
      toast.error("Couldn't copy — read the digits to the employee instead");
    }
  };

  return (
    <>
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500">
            <Key size={15} />
          </div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Kiosk PIN</h3>
        </div>
        <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700">
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            {hasPin === true
              ? "Generate a new PIN — the previous one stops working immediately."
              : "Generate a temporary 4-digit PIN. Share it with the employee; they'll change it on first kiosk use."}
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={submitting}
          className="w-full py-2.5 bg-gray-900 hover:bg-black text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Generating…
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" /> {hasPin === true ? "Generate new PIN" : "Generate PIN"}
            </>
          )}
        </button>
      </div>

      {/* One-time-display modal — only path the digits ever take outside
          the DB. Closing this dismisses them forever; only a fresh
          generate brings them back (as a NEW PIN). */}
      <Modal isOpen={generatedPin !== null} onClose={() => setGeneratedPin(null)} title="New kiosk PIN" size="sm">
        <div className="p-6 space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Share these 4 digits with the employee. They&apos;ll enter them at the kiosk and immediately change to a PIN they&apos;ll remember.
          </p>

          {generatedPin && (
            <div className="flex items-center justify-center gap-3 py-4 px-6 bg-gray-50 dark:bg-gray-800 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl">
              <div className="font-mono text-4xl font-bold tracking-[0.5em] text-gray-900 dark:text-white pl-[0.5em]">
                {generatedPin}
              </div>
              <button
                type="button"
                onClick={handleCopy}
                className="ml-2 p-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
                title="Copy"
              >
                <Copy className="h-4 w-4 text-gray-500" />
              </button>
            </div>
          )}

          <div className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            <strong>This PIN will not be shown again.</strong> If the employee doesn&apos;t change it, you can re-generate a new one anytime.
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
            <button
              type="button"
              onClick={() => setGeneratedPin(null)}
              className="px-4 py-2 bg-gray-900 hover:bg-black text-white rounded-lg text-sm"
            >
              Done
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
