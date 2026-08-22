/**
 * Shared formatting + type-guard helpers for the payroll surface.
 *
 * Each payroll component used to declare its own copy of `isError` and
 * `formatMoney` (sometimes `formatPeriod` too). Centralizing keeps the
 * currency rounding, locale fallback, and error-shape detection in one
 * place so a change here propagates to every payroll screen.
 */

export function isError<T>(
  v: T | { error: string; status?: number },
): v is { error: string; status?: number } {
  return typeof v === "object" && v !== null && "error" in v;
}

export function formatMoney(
  amount: string | number,
  currency: string,
  opts?: { minimumFractionDigits?: number; maximumFractionDigits?: number; locale?: string },
): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (Number.isNaN(n)) return `${amount} ${currency}`;
  const locale = opts?.locale ?? "en-MU";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: opts?.minimumFractionDigits ?? 0,
      maximumFractionDigits: opts?.maximumFractionDigits ?? 0,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(opts?.maximumFractionDigits ?? 0)}`;
  }
}

export function formatPct(rate: string | number, fractionDigits = 2): string {
  const n = typeof rate === "number" ? rate : Number(rate);
  if (Number.isNaN(n)) return `${rate}`;
  return `${(n * 100).toFixed(fractionDigits)}%`;
}

export function formatPeriod(start: string, end: string, locale = "en-GB"): string {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: "short" };
  const ms = s.toLocaleDateString(locale, opts);
  const me = e.toLocaleDateString(locale, opts);
  if (s.getFullYear() === e.getFullYear() && ms === me) {
    return `${ms} ${s.getFullYear()}`;
  }
  return `${ms}–${me} ${e.getFullYear()}`;
}
