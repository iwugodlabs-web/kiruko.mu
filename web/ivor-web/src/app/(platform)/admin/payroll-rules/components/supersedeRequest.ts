/**
 * Shared helper for the four rule-supersede dialogs. Encapsulates:
 *   - Idempotency-Key, X-Step-Up-Token, X-Expected-Latest-Version headers
 *   - distinguishing a 409 version_conflict from other 409s
 *
 * The conflict path triggers `onConflict()` so the parent timeline can
 * close the dialog and refresh, while regular errors fall through to the
 * caller's error display.
 */

import { toast } from "sonner";

interface Args {
  url: string;
  payload: unknown;
  stepUpToken: string;
  expectedLatestVersion: number;
  onConflict: () => void;
}

export interface SupersedeResult {
  ok: boolean;
  message?: string;
}

export async function postSupersede({
  url, payload, stepUpToken, expectedLatestVersion, onConflict,
}: Args): Promise<SupersedeResult> {
  const { api } = await import("@/services/apiClient");
  try {
    await api.post(url, payload, {
      headers: {
        "Idempotency-Key": crypto.randomUUID(),
        "X-Step-Up-Token": stepUpToken,
        "X-Expected-Latest-Version": String(expectedLatestVersion),
      },
    });
    return { ok: true };
  } catch (err: unknown) {
    const e = err as {
      response?: { status?: number; data?: unknown };
      message?: string;
    };
    const data = e.response?.data;
    // FastAPI wraps HTTPException(detail=...) as { detail }; bare body
    // can also come through as a plain string or object. Unwrap once.
    const detail: unknown =
      data && typeof data === "object" && "detail" in data
        ? (data as { detail: unknown }).detail
        : data;
    if (
      e.response?.status === 409 &&
      detail && typeof detail === "object" &&
      (detail as { code?: unknown }).code === "version_conflict"
    ) {
      const conflictMsg = (detail as { message?: string }).message ?? "Version conflict";
      toast.error("This rule was changed by another admin. Refreshing the list.");
      onConflict();
      return { ok: false, message: conflictMsg };
    }
    let message: string;
    if (typeof detail === "string") {
      message = detail;
    } else if (
      detail && typeof detail === "object" &&
      typeof (detail as { message?: unknown }).message === "string"
    ) {
      message = (detail as { message: string }).message;
    } else {
      message = e.message ?? "Save failed";
    }
    return { ok: false, message };
  }
}
