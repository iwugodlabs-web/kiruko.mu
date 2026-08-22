/**
 * SponsoredCard (M6) — structural tests.
 *
 * Snapshot-style verification using react-test-renderer. GlueStack primitives
 * and reanimated are stubbed via <rootDir>/__mocks__/ (jest auto-applies them
 * when jest.mock(name) is called without a factory). Inline factories tripped
 * the nativewind/babel transform that injects `_ReactNativeCSSInterop`
 * references which jest then rejected as out-of-scope.
 *
 * Coverage matrix (the plan's "each kind × light/dark × image OK/fail"):
 *   - kind=employer → "From {company}", no SPONSORED pill
 *   - kind=ad       → "From {advertiser}" + SPONSORED pill
 *   - kind=house    → "From Kontokaz" (ignores fundingCompanyName), no pill
 *   - imageUrl set + forceImageFailed=false → image rendered
 *   - imageUrl set + forceImageFailed=true  → image hidden (fallback)
 *   - CTA pressing → onClickThrough fires with the URL
 *   - dismiss tap   → onDismiss fires
 *   - first onLayout → onView once (component-level idempotency)
 *   - dark mode renders the same content
 *   - ad accessibility label includes kind + source + title
 */

// Auto-mocked from <rootDir>/__mocks__/ — no factory body to avoid colliding
// with the nativewind babel transform.
jest.mock("react-native-reanimated");
jest.mock("@gluestack-ui/themed");
jest.mock("@expo/vector-icons");

// SponsoredCard imports `api` from services/apiClient to resolve relative
// image URLs against the API host. apiClient pulls in AsyncStorage which
// blows up under jest. Stub it with just the `defaults.baseURL` the
// resolver reads.
jest.mock("../../services/apiClient", () => ({
    api: { defaults: { baseURL: "https://test.example/api/v1" } },
}));

// i18next stub — small enough to inline. Uses only globals so the babel
// transform doesn't reach for `_ReactNativeCSSInterop` here.
jest.mock("react-i18next", () => ({
    useTranslation: () => ({
        t: (key: string, opts?: { name?: string }) => {
            switch (key) {
                case "sponsored.from":
                    return `From ${(opts && opts.name) || ""}`;
                case "sponsored.fromKontokaz":
                    return "From Kontokaz";
                case "sponsored.sponsoredPill":
                    return "SPONSORED";
                case "sponsored.dismiss":
                    return "Dismiss";
                case "sponsored.imageA11y":
                    return "Sponsored content image";
                default:
                    return key;
            }
        },
    }),
}));

// Override useColorScheme so we can flip light/dark per-test. The
// mock-prefixed name satisfies jest's hoist guard.
let mockColorSchemeValue: "light" | "dark" | null = "light";
jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
    __esModule: true,
    default: () => mockColorSchemeValue,
}));

import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Image } from "react-native";

import SponsoredCard from "../../components/SponsoredCard";

function findStringDescendant(
    tree: TestRenderer.ReactTestInstance,
    matcher: (s: string) => boolean,
): boolean {
    if (tree.children.some((c) => typeof c === "string" && matcher(c))) return true;
    return tree.children.some((c) =>
        typeof c === "object"
            ? findStringDescendant(c as TestRenderer.ReactTestInstance, matcher)
            : false,
    );
}
const hasText = (root: TestRenderer.ReactTestInstance, s: string) =>
    findStringDescendant(root, (x) => x === s);

function findAllByA11yLabel(
    root: TestRenderer.ReactTestInstance,
    label: string | RegExp,
): TestRenderer.ReactTestInstance[] {
    return root.findAll((node) => {
        const accLabel = node.props?.accessibilityLabel;
        if (!accLabel) return false;
        return typeof label === "string" ? accLabel === label : label.test(accLabel);
    });
}

// Returns the nodes that BOTH match the accessibility label AND carry the
// onPress handler — i.e. the actual Pressable. Avoids the mocked-Pressable
// confusion where a parent View also reports the same accessibilityLabel.
function findPressableByA11yLabel(
    root: TestRenderer.ReactTestInstance,
    label: string,
): TestRenderer.ReactTestInstance[] {
    return root.findAll(
        (node) =>
            node.props?.accessibilityLabel === label &&
            typeof node.props?.onPress === "function",
    );
}

describe("SponsoredCard", () => {
    beforeEach(() => {
        mockColorSchemeValue = "light";
    });

    it("renders an employer announcement with 'From {company}' label and no SPONSORED pill", () => {
        const r = TestRenderer.create(
            <SponsoredCard
                kind="employer"
                fundingCompanyName="Acme Co"
                title="Office closed Friday"
                body="Public holiday — back Monday."
            />,
        );
        expect(hasText(r.root, "From Acme Co")).toBe(true);
        expect(hasText(r.root, "Office closed Friday")).toBe(true);
        expect(hasText(r.root, "SPONSORED")).toBe(false);
    });

    it("renders an ad with SPONSORED pill and advertiser label", () => {
        const r = TestRenderer.create(
            <SponsoredCard
                kind="ad"
                fundingCompanyName="MyT Money"
                title="Earn 5% cashback"
                body="On groceries this month."
            />,
        );
        expect(hasText(r.root, "SPONSORED")).toBe(true);
        expect(hasText(r.root, "From MyT Money")).toBe(true);
    });

    it("renders a house card with 'From Kontokaz' (ignores fundingCompanyName)", () => {
        const r = TestRenderer.create(
            <SponsoredCard
                kind="house"
                fundingCompanyName="should-be-ignored"
                title="Try the new calculator"
                body="It's in Settings."
            />,
        );
        expect(hasText(r.root, "From Kontokaz")).toBe(true);
        expect(hasText(r.root, "should-be-ignored")).toBe(false);
        expect(hasText(r.root, "SPONSORED")).toBe(false);
    });

    it("renders an image when imageUrl is set and load did not fail", () => {
        const r = TestRenderer.create(
            <SponsoredCard
                kind="employer"
                fundingCompanyName="X"
                title="t"
                body="b"
                imageUrl="https://kontokaz.example/img.png"
            />,
        );
        const images = r.root.findAllByType(Image);
        expect(images).toHaveLength(1);
        expect(images[0].props.source.uri).toBe(
            "https://kontokaz.example/img.png",
        );
    });

    it("hides the image when forceImageFailed=true (fallback, no broken icon)", () => {
        const r = TestRenderer.create(
            <SponsoredCard
                kind="employer"
                fundingCompanyName="X"
                title="t"
                body="b"
                imageUrl="https://kontokaz.example/img.png"
                forceImageFailed
            />,
        );
        expect(r.root.findAllByType(Image)).toHaveLength(0);
    });

    it("calls onClickThrough with the CTA URL on press", () => {
        const onClickThrough = jest.fn();
        const r = TestRenderer.create(
            <SponsoredCard
                kind="employer"
                fundingCompanyName="X"
                title="t"
                body="b"
                ctaLabel="Open"
                ctaUrl="https://kontokaz.example/landing"
                onClickThrough={onClickThrough}
            />,
        );
        const ctas = findPressableByA11yLabel(r.root, "Open");
        // ≥1 match — when Pressable is mocked to View, react-test-renderer
        // reports both the composite component and its host fiber as
        // distinct instances even though they share props. The test asserts
        // the handler wires up, not the fiber graph shape.
        expect(ctas.length).toBeGreaterThanOrEqual(1);
        act(() => {
            ctas[0].props.onPress();
        });
        expect(onClickThrough).toHaveBeenCalledWith(
            "https://kontokaz.example/landing",
        );
    });

    it("calls onDismiss when the dismiss control is pressed", () => {
        const onDismiss = jest.fn();
        const r = TestRenderer.create(
            <SponsoredCard
                kind="house"
                title="t"
                body="b"
                onDismiss={onDismiss}
            />,
        );
        const dismissBtns = findPressableByA11yLabel(r.root, "Dismiss");
        expect(dismissBtns.length).toBeGreaterThanOrEqual(1);
        act(() => {
            dismissBtns[0].props.onPress();
        });
        // Composite + host fiber both forward the press to the same handler,
        // so a single tap still produces a single call.
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it("fires onView exactly once on first layout (idempotency at the component level)", () => {
        const onView = jest.fn();
        const r = TestRenderer.create(
            <SponsoredCard
                kind="employer"
                fundingCompanyName="X"
                title="t"
                body="b"
                onView={onView}
            />,
        );
        const layoutCarriers = r.root.findAll(
            (n) => n.props && typeof n.props.onLayout === "function",
        );
        expect(layoutCarriers.length).toBeGreaterThan(0);
        const layout = layoutCarriers[0].props.onLayout;
        act(() => {
            layout({});
            layout({}); // second fire should NOT bump the counter
        });
        expect(onView).toHaveBeenCalledTimes(1);
    });

    it("dark mode renders the same content (kind labels survive theme switch)", () => {
        mockColorSchemeValue = "dark";
        const r = TestRenderer.create(
            <SponsoredCard
                kind="employer"
                fundingCompanyName="Acme Co"
                title="HR notice"
                body="…"
            />,
        );
        expect(hasText(r.root, "From Acme Co")).toBe(true);
        expect(hasText(r.root, "HR notice")).toBe(true);
    });

    it("composes a useful accessibility label including kind + source + title", () => {
        const r = TestRenderer.create(
            <SponsoredCard
                kind="ad"
                fundingCompanyName="MyT"
                title="Earn cashback"
                body="…"
            />,
        );
        const matches = findAllByA11yLabel(r.root, /SPONSORED.*Earn cashback/);
        expect(matches.length).toBeGreaterThan(0);
    });

    it("opens a detail modal when the card body is pressed", () => {
        // Initially: modal Modal exists in the tree (always rendered) but
        // visible=false. After pressing the body Pressable, visible flips
        // to true.
        const r = TestRenderer.create(
            <SponsoredCard
                kind="employer"
                fundingCompanyName="Hands PLC"
                title="Town hall on Friday"
                body="The full agenda is in the calendar invite — please review beforehand."
                imageUrl="https://test.example/hero.jpg"
            />,
        );

        // Find the body Pressable via testID we added.
        const body = r.root.findAll(
            (n) =>
                n.props && n.props.testID === "sponsored-card-body" && typeof n.props.onPress === "function",
        )[0];
        expect(body).toBeDefined();

        // Find the RN Modal — should be visible=false before the tap.
        const { Modal } = require("react-native");
        const modalBefore = r.root.findAllByType(Modal)[0];
        expect(modalBefore).toBeDefined();
        expect(modalBefore.props.visible).toBe(false);

        // Tap the body.
        act(() => {
            body.props.onPress();
        });

        // Modal is now visible.
        const modalAfter = r.root.findAllByType(Modal)[0];
        expect(modalAfter.props.visible).toBe(true);

        // The close button inside the modal should exist with the testID we
        // attached. Pressing it must flip visible back to false.
        const closeBtn = r.root.findAll(
            (n) =>
                n.props &&
                n.props.testID === "sponsored-detail-close" &&
                typeof n.props.onPress === "function",
        )[0];
        expect(closeBtn).toBeDefined();
        act(() => {
            closeBtn.props.onPress();
        });
        const modalClosed = r.root.findAllByType(Modal)[0];
        expect(modalClosed.props.visible).toBe(false);
    });
});
