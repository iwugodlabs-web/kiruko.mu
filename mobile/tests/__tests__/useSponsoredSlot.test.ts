/**
 * useSponsoredSlot — slot orchestrator tests (M7).
 *
 * Plan's Mobile testing section called for "Slot orchestrator dismiss state".
 * This file exercises:
 *   - fetch on mount → exposes content
 *   - fetch returns null → content stays null
 *   - dismiss() clears content, persists to AsyncStorage, posts to server
 *   - re-mount within the 3h TTL of a dismiss → content suppressed
 *   - re-mount after the 3h TTL → content shown again
 *   - recordView() is hook-level idempotent across multiple calls
 *
 * No `@testing-library/react-native` dependency — uses a tiny harness
 * component that calls the hook and exposes the result via a captured ref.
 * Renders with `react-test-renderer.act` so effects flush deterministically.
 */

jest.mock("@react-native-async-storage/async-storage", () => {
    let store: Record<string, string> = {};
    const mock = {
        getItem: jest.fn(async (k: string) => (k in store ? store[k] : null)),
        setItem: jest.fn(async (k: string, v: string) => {
            store[k] = v;
        }),
        removeItem: jest.fn(async (k: string) => {
            delete store[k];
        }),
        __reset: () => {
            store = {};
            mock.getItem.mockClear();
            mock.setItem.mockClear();
            mock.removeItem.mockClear();
        },
    };
    return { __esModule: true, default: mock };
});

jest.mock("../../api/sponsored", () => ({
    fetchForSurface: jest.fn(),
    logView: jest.fn(async () => undefined),
    logDismissal: jest.fn(async () => undefined),
}));

import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { useSponsoredSlot, type UseSponsoredSlot } from "../../app/hooks/useSponsoredSlot";
import * as sponsoredApi from "../../api/sponsored";

const SAMPLE_PAYLOAD = {
    sponsored_content_id: 42,
    version_id: 7,
    kind: "employer" as const,
    funding_company_id: 1,
    funding_company_name: "Acme",
    title: "HR notice",
    body: "Office closed Friday",
    image_url: null,
    cta_label: null,
    cta_url: null,
    view_token: "view-token-42",
    click_token: "click-token-42",
    surface: "home",
};

interface HarnessHandle {
    latest: UseSponsoredSlot;
}

function renderHookViaHarness(surface: string = "home"): HarnessHandle {
    const handle: HarnessHandle = { latest: null as unknown as UseSponsoredSlot };
    function Harness() {
        const slot = useSponsoredSlot(surface);
        handle.latest = slot;
        return null;
    }
    // Render synchronously inside act() so the initial effect kicks off.
    act(() => {
        TestRenderer.create(React.createElement(Harness));
    });
    return handle;
}

// Drain pending microtasks (the hook's async effect → setState resolution).
const flushAsync = () =>
    new Promise<void>((resolve) => setImmediate(() => resolve()));

beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AsyncStorage as any).__reset();
});

describe("useSponsoredSlot", () => {
    it("fetches on mount and exposes the payload", async () => {
        (sponsoredApi.fetchForSurface as jest.Mock).mockResolvedValueOnce(SAMPLE_PAYLOAD);
        const h = renderHookViaHarness();
        await act(async () => {
            await flushAsync();
        });
        expect(h.latest.loading).toBe(false);
        expect(h.latest.content?.sponsored_content_id).toBe(42);
        expect(sponsoredApi.fetchForSurface).toHaveBeenCalledWith("home");
    });

    it("renders nothing when /serve returns null", async () => {
        (sponsoredApi.fetchForSurface as jest.Mock).mockResolvedValueOnce(null);
        const h = renderHookViaHarness();
        await act(async () => {
            await flushAsync();
        });
        expect(h.latest.loading).toBe(false);
        expect(h.latest.content).toBeNull();
    });

    it("dismiss() clears content, persists to AsyncStorage, and posts to server", async () => {
        (sponsoredApi.fetchForSurface as jest.Mock).mockResolvedValueOnce(SAMPLE_PAYLOAD);
        const h = renderHookViaHarness();
        await act(async () => {
            await flushAsync();
        });
        expect(h.latest.content).not.toBeNull();

        await act(async () => {
            h.latest.dismiss();
            await flushAsync();
        });

        expect(h.latest.content).toBeNull();
        expect(AsyncStorage.setItem).toHaveBeenCalledWith(
            "sponsored:dismissed:42",
            expect.any(String),
        );
        expect(sponsoredApi.logDismissal).toHaveBeenCalledWith({
            sponsored_content_id: 42,
            surface: "home",
        });
    });

    it("a fresh mount within the 3h TTL suppresses the previously dismissed card", async () => {
        const tenMinAgo = Date.now() - 10 * 60 * 1000;
        await AsyncStorage.setItem("sponsored:dismissed:42", String(tenMinAgo));
        (sponsoredApi.fetchForSurface as jest.Mock).mockResolvedValueOnce(SAMPLE_PAYLOAD);

        const h = renderHookViaHarness();
        await act(async () => {
            await flushAsync();
        });

        expect(h.latest.loading).toBe(false);
        expect(h.latest.content).toBeNull();
    });

    it("a fresh mount AFTER the 3h TTL allows the card again and cleans up the stale entry", async () => {
        const tooOld = Date.now() - 4 * 60 * 60 * 1000;
        await AsyncStorage.setItem("sponsored:dismissed:42", String(tooOld));
        (sponsoredApi.fetchForSurface as jest.Mock).mockResolvedValueOnce(SAMPLE_PAYLOAD);

        const h = renderHookViaHarness();
        await act(async () => {
            await flushAsync();
            await flushAsync(); // give the cleanup .catch(...) a tick too
        });

        expect(h.latest.content?.sponsored_content_id).toBe(42);
        expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
            "sponsored:dismissed:42",
        );
    });

    it("recordView fires once per view_token even when called repeatedly", async () => {
        (sponsoredApi.fetchForSurface as jest.Mock).mockResolvedValueOnce(SAMPLE_PAYLOAD);
        const h = renderHookViaHarness();
        await act(async () => {
            await flushAsync();
        });
        await act(async () => {
            h.latest.recordView();
            h.latest.recordView();
            h.latest.recordView();
            await flushAsync();
        });

        expect(sponsoredApi.logView).toHaveBeenCalledTimes(1);
        expect(sponsoredApi.logView).toHaveBeenCalledWith({
            sponsored_content_id: 42,
            version_id: 7,
            view_token: "view-token-42",
            surface: "home",
        });
    });
});
