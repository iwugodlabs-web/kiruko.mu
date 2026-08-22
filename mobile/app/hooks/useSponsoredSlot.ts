/**
 * useSponsoredSlot — orchestrates the home-screen sponsored card slot (M7).
 *
 * Responsibilities:
 *   1. Fire `GET /sponsored/serve?surface=home` on mount, in parallel with
 *      whatever else the screen is fetching. Never blocks render.
 *   2. Honour a 3h client-side dismissal via AsyncStorage so a dismissed
 *      card doesn't reappear immediately on the next render or remount.
 *   3. Provide a one-shot `recordView()` that's safe to call from the
 *      SponsoredCard's first `onLayout` even if React re-fires layout.
 *   4. Wire up the dismiss handler so a tap persists the 3h record AND
 *      tells the server (for the dismiss-rate quality signal).
 *
 * The hook intentionally does NOT handle CTA presses — that flow needs to
 * await the server-resolved URL and then call Linking.openURL, which the
 * consuming screen does in its own onClickThrough handler so the screen can
 * await/toast on failure.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
    fetchForSurface,
    logDismissal,
    logView,
    type ServedSponsoredContent,
} from "../../api/sponsored";

// 3h matches the in-app session cadence (clock in / lunch / clock out /
// evening glance). 24h was lifted from social-feed dismissal patterns but
// over-suppresses on a payroll app users open multiple times a day —
// especially for employer announcements where a same-day re-show is the
// expected behavior, not spam.
const DISMISS_TTL_MS = 3 * 60 * 60 * 1000; // 3h
const DISMISS_KEY_PREFIX = "sponsored:dismissed:"; // + sponsored_content_id

async function isDismissed(contentId: number): Promise<boolean> {
    try {
        const raw = await AsyncStorage.getItem(DISMISS_KEY_PREFIX + contentId);
        if (!raw) return false;
        const ts = parseInt(raw, 10);
        if (Number.isNaN(ts)) return false;
        if (Date.now() - ts > DISMISS_TTL_MS) {
            // Past the window — clean up the stale entry.
            AsyncStorage.removeItem(DISMISS_KEY_PREFIX + contentId).catch(() => {});
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

async function markDismissed(contentId: number): Promise<void> {
    try {
        await AsyncStorage.setItem(DISMISS_KEY_PREFIX + contentId, String(Date.now()));
    } catch {
        /* AsyncStorage unavailable — fall back to in-session dismissal only */
    }
}

export interface UseSponsoredSlot {
    /** Server-resolved card, or null. Updates from null → payload once the
     *  fetch resolves; flips back to null on dismiss. */
    content: ServedSponsoredContent | null;
    /** True until the first fetch attempt settles (success, miss, or error). */
    loading: boolean;
    /** Fire on the card's first onLayout. Idempotent at the hook level too. */
    recordView: () => void;
    /** Dismisses the card immediately + persists for 3h + reports to the server. */
    dismiss: () => void;
}

export function useSponsoredSlot(surface: string = "home"): UseSponsoredSlot {
    const [content, setContent] = useState<ServedSponsoredContent | null>(null);
    const [loading, setLoading] = useState(true);
    const viewLoggedRef = useRef<string | null>(null);

    // Fire-and-render on mount; cancel on unmount via the `cancelled` latch.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const payload = await fetchForSurface(surface);
            if (cancelled) return;
            if (!payload) {
                setContent(null);
                setLoading(false);
                return;
            }
            if (await isDismissed(payload.sponsored_content_id)) {
                // User already dismissed this card within the last 3h —
                // server's frequency cap will phase it out shortly; in the
                // meantime, just don't show it.
                setContent(null);
                setLoading(false);
                return;
            }
            setContent(payload);
            setLoading(false);
        })();
        return () => {
            cancelled = true;
        };
    }, [surface]);

    const recordView = useCallback(() => {
        if (!content) return;
        // Component-level idempotency is already in SponsoredCard.tsx, but the
        // hook-level ref guards against repeat onLayout fires across rapid
        // remounts (e.g. orientation change) that recreate the component.
        if (viewLoggedRef.current === content.view_token) return;
        viewLoggedRef.current = content.view_token;
        logView({
            sponsored_content_id: content.sponsored_content_id,
            version_id: content.version_id,
            view_token: content.view_token,
            surface,
        }).catch(() => {});
    }, [content, surface]);

    const dismiss = useCallback(() => {
        if (!content) return;
        const id = content.sponsored_content_id;
        setContent(null);
        markDismissed(id).catch(() => {});
        logDismissal({ sponsored_content_id: id, surface }).catch(() => {});
    }, [content, surface]);

    return { content, loading, recordView, dismiss };
}
