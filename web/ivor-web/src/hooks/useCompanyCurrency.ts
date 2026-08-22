"use client";

import { useAuth } from "@/contexts/AuthContext";
import { formatMoney } from "@/utils/payrollFormat";

/**
 * The logged-in company's operating currency, derived server-side from its
 * country (see ShowCompanyBasic.currency). This is the single source of truth
 * for money display on the company dashboard — do NOT hardcode "Rs"/MUR, which
 * is silently wrong for every non-MU company.
 *
 * Resolves from the owner row (`user.company`) or a delegated employee's company
 * (`user.private_user.company`). Falls back to "MUR" only when neither is
 * present (an honest last resort, matching the backend model default).
 *
 * Returns both the code and a bound `format(amount, opts)` helper so callers get
 * consistent locale/rounding without re-plumbing the currency each time.
 */
export function useCompanyCurrency() {
  const { user } = useAuth();
  const currency =
    user?.company?.currency ||
    user?.private_user?.company?.currency ||
    "MUR";

  const format = (
    amount: string | number,
    opts?: { minimumFractionDigits?: number; maximumFractionDigits?: number },
  ) => formatMoney(amount, currency, opts);

  return { currency, format };
}
