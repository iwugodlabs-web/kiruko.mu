import React, { useState } from "react";
import { Palette } from '@/app/constants/theme';
import {
    Image,
    Linking,
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text as RNText,
    TouchableOpacity,
    View,
    useColorScheme,
} from "react-native";
import { Box, HStack, Text, VStack } from "@gluestack-ui/themed";
import { MaterialIcons } from "@expo/vector-icons";
import Animated, { FadeInUp } from '@/app/utils/animated';
import { useTranslation } from "react-i18next";
import { api } from "@/services/apiClient";

/**
 * Resolve a sponsored-content image URL to something React Native's <Image>
 * can actually fetch.
 *
 * Backend `LocalStorage` returns relative URLs like `/uploads/sponsored/.../foo.jpeg`
 * (S3/GCS return absolute https URLs). The mobile RN <Image> needs an
 * absolute URL — a relative path fails silently and triggers our
 * onError → hide-image fallback. Strip the trailing `/api/v1` from the
 * axios baseURL and prefix the relative path with that origin.
 */
function resolveImageUrl(url?: string | null): string | undefined {
    if (!url) return undefined;
    if (/^https?:\/\//i.test(url)) return url;
    const base = api.defaults.baseURL || "";
    const origin = base.replace(/\/api\/v\d+\/?$/, "");
    const sep = url.startsWith("/") ? "" : "/";
    return `${origin}${sep}${url}`;
}

/**
 * Sponsored card rendered on the private home feed (M6).
 *
 * One component, three sources of content:
 *  - `kind='employer'` : the viewer's company posting an announcement
 *  - `kind='ad'`       : a third-party paid advertiser (Phase 2; visually
 *                        distinguished with the "SPONSORED" pill)
 *  - `kind='house'`    : Kontokaz-wide platform fill
 *
 * The component knows nothing about the serve algorithm — it just renders
 * the payload returned by `/api/v1/sponsored/serve`. View/click/dismiss
 * tracking lives in the slot orchestrator (M7); this component only emits
 * `onView` / `onClickThrough` / `onDismiss` callbacks.
 */

export type SponsoredKind = "employer" | "ad" | "house";

export interface SponsoredCardProps {
    kind: SponsoredKind;
    /** Display name of the funder. Required for employer + ad; ignored for house. */
    fundingCompanyName?: string;
    /** kind='house' only — display name of an external advertiser (e.g.
     *  "Spar") when Kontokaz has sold this house slot to a third party.
     *  Null/undefined means Kontokaz first-party (renders "from Kontokaz"). */
    externalAdvertiserName?: string | null;
    title: string;
    body: string;
    imageUrl?: string | null;
    ctaLabel?: string | null;
    ctaUrl?: string | null;
    /** Called once on first paint of the card (use the M7 ref-guard pattern). */
    onView?: () => void;
    /** Called on CTA tap. Receives the cta_url so the parent can route through
     *  the server-side /clicks endpoint instead of opening directly. */
    onClickThrough?: (url: string) => void;
    /** Called when the user taps the × icon. Parent persists the 24h dismissal. */
    onDismiss?: () => void;
    /** Test seam: lets snapshot tests force the image-failure state. */
    forceImageFailed?: boolean;
}

/**
 * Animation delay matches the visual rhythm of adjacent home cards:
 *  - PaySummary uses SlideInRight @ delay 400
 *  - ClockHistory uses FadeInUp @ delay 600
 * Slotting between them at delay 500 keeps the staggered cascade tidy.
 */
const ENTRY = FadeInUp.duration(800).delay(500);

export default function SponsoredCard({
    kind,
    fundingCompanyName,
    externalAdvertiserName,
    title,
    body,
    imageUrl,
    ctaLabel,
    ctaUrl,
    onView,
    onClickThrough,
    onDismiss,
    forceImageFailed = false,
}: SponsoredCardProps) {
    const { t } = useTranslation();
    const colorScheme = useColorScheme();
    const isDark = colorScheme === "dark";
    const [imageFailed, setImageFailed] = useState(forceImageFailed);
    const [detailOpen, setDetailOpen] = useState(false);
    const viewedRef = React.useRef(false);

    function handleLayout() {
        // One-shot — first paint only. Repeated mounts within the same screen
        // session shouldn't double-count. The slot orchestrator (M7) ALSO
        // uses an idempotency token at the network layer, so worst-case is a
        // single extra HTTP call that the server dedupes.
        if (!viewedRef.current) {
            viewedRef.current = true;
            onView?.();
        }
    }

    function handleCtaPress() {
        if (!ctaUrl) return;
        if (onClickThrough) {
            onClickThrough(ctaUrl);
        } else {
            // Fallback for stories / preview screens — opens directly. The
            // M7 wiring passes a real handler that goes through /clicks.
            Linking.openURL(ctaUrl).catch(() => {});
        }
    }

    const sourceLabel =
        kind === "house"
            ? externalAdvertiserName
                ? t("sponsored.from", { name: externalAdvertiserName })
                : t("sponsored.fromKontokaz")
            : t("sponsored.from", { name: fundingCompanyName ?? "" });

    // Kind-aware type pill + left-edge accent stripe. Each surface gets a
    // distinct color so an employee scanning the home feed can tell at a
    // glance "this is HR talking to me" (employer, indigo) from "this is a
    // paid ad" (ad, amber) from "this is platform content" (house, green or
    // slate depending on whether Kontokaz sold the slot to a 3rd party).
    //
    // First-party house gets no pill — the "From Kontokaz" source label
    // already carries that signal and adding a redundant "FROM KONTOKAZ"
    // pill is noise. External-advertiser house gets a slate "PROMOTED"
    // pill — deliberately softer than the amber "SPONSORED" pill so users
    // don't confuse partner content with full paid-ad inventory.
    // NOTE: pillBg/pillFg use raw hex (not gluestack `$indigo100` etc.) — the
    // upstream gluestack-ui config ships indigo/amber/emerald palettes but
    // NOT slate, so a tokenized `$slate200` would silently render transparent.
    // Inline hex matches the same pattern the rest of this file uses for the
    // dark-mode palette (search "tokens don't resolve consistently" above).
    const variant: {
        pillLabel: string | null;
        pillBg: string;
        pillFg: string;
        stripe: string | null;
    } =
        kind === "ad"
            ? {
                  pillLabel: t("sponsored.sponsoredPill"),
                  pillBg: Palette.warningTint, // amber-100
                  pillFg: Palette.gold, // amber-700
                  stripe: Palette.warning, // amber-500
              }
            : kind === "employer"
            ? {
                  pillLabel: t("sponsored.announcementPill"),
                  pillBg: Palette.blueTint, // indigo-100
                  pillFg: Palette.blue, // indigo-700
                  stripe: Palette.blue, // indigo-500
              }
            : externalAdvertiserName
            ? {
                  pillLabel: t("sponsored.promotedPill"),
                  pillBg: Palette.gray200, // slate-200
                  pillFg: Palette.gray700, // slate-700
                  stripe: Palette.gray500, // slate-500
              }
            : {
                  pillLabel: null,
                  pillBg: Palette.successTint, // emerald-100
                  pillFg: Palette.teal, // emerald-700
                  stripe: Palette.teal, // Kontokaz brand green
              };

    // Dark mode: card surface + text colors flip. The "SPONSORED" pill
    // keeps its amber accent in both modes so it stays distinguishable from
    // the muted "From {company}" label of an employer card.
    //
    // We use CSS color strings (not `$gray800` / `$white` tokens) because
    // sibling home cards (EarningsVsExpenses etc.) do the same — tokens
    // don't resolve consistently in this gluestack version and tokenized
    // backgrounds were rendering transparent, leaving the card blended
    // into the page bg with no visible surface.
    const palette = isDark
        ? {
              card: Palette.gray800,       // gray-800
              text: Palette.gray50,       // gray-50
              subtext: Palette.gray400,    // gray-400
              divider: Palette.gray700,    // gray-700
              dismissColor: Palette.gray400,
          }
        : {
              card: "white",
              text: Palette.ink,       // gray-900
              subtext: Palette.gray500,    // gray-500
              divider: Palette.gray200,    // gray-200 — slightly stronger than gray-100 for visible boundary
              dismissColor: Palette.gray400,
          };

    const a11yLabel = variant.pillLabel
        ? `${variant.pillLabel} — ${sourceLabel}: ${title}`
        : `${sourceLabel}: ${title}`;

    // Hero-image variant (M14): image goes edge-to-edge at the top with
    // only top corners rounded; content sits below with padding. When no
    // image is present (or it failed to load), the header simply moves up
    // and the card stays compact.
    const showHero = !!imageUrl && !imageFailed;

    // Initial for the source avatar — first letter of the funder name
    // (or 'K' for Kontokaz house). Cheap identity cue without needing a
    // logo upload pipeline.
    const sourceInitial =
        kind === "house"
            ? (externalAdvertiserName?.trim()?.[0] ?? "K").toUpperCase()
            : (fundingCompanyName?.trim()?.[0] ?? "?").toUpperCase();

    // Deterministic color from the initial so two different companies don't
    // get the same avatar. Picked from a tasteful palette; same letter →
    // same color across renders.
    const AVATAR_PALETTE = [
        Palette.teal, // sky
        Palette.green, // green
        Palette.warning, // amber
        Palette.violet, // pink
        Palette.violet, // violet
        Palette.teal, // teal
        Palette.errorAlt, // red
        Palette.blue, // indigo
    ];
    const avatarBg =
        kind === "house" && !externalAdvertiserName
            ? Palette.teal // Kontokaz brand-leaning green
            : AVATAR_PALETTE[sourceInitial.charCodeAt(0) % AVATAR_PALETTE.length];

    return (
        <Animated.View entering={ENTRY} onLayout={handleLayout} style={{ marginBottom: 16 }}>
            {/* Outer Pressable — tapping anywhere on the card body opens the
                detail sheet with the full image + uncut body. The inner
                Pressables on × and CTA intercept their own taps before this
                handler fires, so dismiss + CTA keep their existing behavior. */}
            <Pressable
                onPress={() => setDetailOpen(true)}
                accessibilityRole="button"
                accessibilityLabel={`Open: ${a11yLabel}`}
                testID="sponsored-card-body"
            >
            <Box
                bg={palette.card}
                rounded="$2xl"
                borderWidth={isDark ? 0 : 1}
                borderColor={palette.divider}
                overflow="hidden"
                // Lift the card off the home background — matches the depth
                // of the adjacent EarningsVsExpenses card (same recipe).
                shadowColor={Palette.black}
                shadowOffset={{ width: 0, height: 4 }}
                shadowOpacity={isDark ? 0.4 : 0.12}
                shadowRadius={20}
                elevation={8}
                accessible
                accessibilityRole="summary"
                accessibilityLabel={a11yLabel}
            >
                {/* Kind-aware left-edge accent stripe — reinforces the type
                    signal beyond the pill, especially when the user has
                    scrolled and only the card's edge is on-screen. Color
                    matches the pill (see `variant` above). */}
                {variant.stripe && (
                    <Box
                        position="absolute"
                        left={0}
                        top={0}
                        bottom={0}
                        width={4}
                        style={{ backgroundColor: variant.stripe }}
                        zIndex={1}
                    />
                )}

                {/* Hero image — edge-to-edge, 16:9, only top corners rounded
                    (parent's overflow=hidden clips). Background tint shows
                    while the image is loading. */}
                {showHero && (
                    <Image
                        source={{ uri: resolveImageUrl(imageUrl)! }}
                        accessible
                        accessibilityLabel={t("sponsored.imageA11y")}
                        style={{
                            width: "100%",
                            aspectRatio: 16 / 9,
                            backgroundColor: isDark ? Palette.gray800 : Palette.white,
                        }}
                        resizeMode="contain"
                        onError={() => setImageFailed(true)}
                    />
                )}

                {/* Inset content area */}
                <Box p="$3">
                    {/* Source row: avatar + name + dismiss */}
                    <HStack alignItems="center" justifyContent="space-between" mb="$2.5">
                        <HStack alignItems="center" space="sm" flex={1}>
                            {/* Avatar circle with company initial */}
                            <Box
                                w={28}
                                h={28}
                                rounded="$full"
                                alignItems="center"
                                justifyContent="center"
                                style={{ backgroundColor: avatarBg }}
                            >
                                <Text
                                    fontSize="$xs"
                                    fontWeight="$bold"
                                    color="$white"
                                >
                                    {sourceInitial}
                                </Text>
                            </Box>

                            <VStack flex={1}>
                                {/* Type pill — sits above the source name so
                                    the eye finds the category before the
                                    funder. Skipped for first-party house
                                    (the "From Kontokaz" source label is
                                    already self-evident). */}
                                {variant.pillLabel && (
                                    <Box
                                        px="$1.5"
                                        py="$0.5"
                                        rounded="$sm"
                                        alignSelf="flex-start"
                                        mb={2}
                                        style={{ backgroundColor: variant.pillBg }}
                                    >
                                        <Text
                                            fontSize="$2xs"
                                            fontWeight="$bold"
                                            letterSpacing={0.5}
                                            style={{ color: variant.pillFg }}
                                        >
                                            {variant.pillLabel}
                                        </Text>
                                    </Box>
                                )}
                                <Text
                                    fontSize="$xs"
                                    fontWeight="$semibold"
                                    color={palette.subtext}
                                    numberOfLines={1}
                                >
                                    {sourceLabel}
                                </Text>
                            </VStack>
                        </HStack>

                        {/* HIG-compliant 44pt hitbox around the small × icon */}
                        <Pressable
                            onPress={onDismiss}
                            accessibilityRole="button"
                            accessibilityLabel={t("sponsored.dismiss")}
                            hitSlop={12}
                            style={{
                                width: 36,
                                height: 36,
                                alignItems: "center",
                                justifyContent: "center",
                            }}
                        >
                            <MaterialIcons
                                name="close"
                                size={20}
                                color={palette.dismissColor}
                            />
                        </Pressable>
                    </HStack>

                    {/* Title — larger, tighter line-height */}
                    <Text
                        fontSize="$lg"
                        fontWeight="$bold"
                        color={palette.text}
                        lineHeight="$xl"
                        mb="$1.5"
                    >
                        {title}
                    </Text>

                    {/* Body — relaxed line-height for readability */}
                    <Text
                        fontSize="$sm"
                        color={palette.subtext}
                        lineHeight="$md"
                    >
                        {body}
                    </Text>

                    {/* Full-width primary CTA — only when there's a URL to go
                        to. Label without URL is a misconfiguration; hiding
                        the button makes that obvious rather than producing a
                        silent no-op tap. */}
                    {ctaUrl && (
                        <Box flexDirection="row" mt="$3.5">
                        <Pressable
                            onPress={handleCtaPress}
                            accessibilityRole="link"
                            accessibilityLabel={ctaLabel || "Learn more"}
                            style={({ pressed }) => ({
                                opacity: pressed ? 0.85 : 1,
                            })}
                        >
                            <Box
                                bg={Palette.teal}
                                rounded="$full"
                                py="$2"
                                px="$5"
                                flexDirection="row"
                                alignItems="center"
                                justifyContent="center"
                            >
                                <Text
                                    fontSize="$sm"
                                    fontWeight="$semibold"
                                    color="$white"
                                    mr="$1"
                                >
                                    {ctaLabel || "Learn more"}
                                </Text>
                                <MaterialIcons
                                    name="arrow-forward"
                                    size={15}
                                    color={Palette.white}
                                />
                            </Box>
                        </Pressable>
                        </Box>
                    )}
                </Box>
            </Box>
            </Pressable>

            <DetailModal
                visible={detailOpen}
                onClose={() => setDetailOpen(false)}
                kind={kind}
                sourceLabel={sourceLabel}
                avatarBg={avatarBg}
                avatarInitial={sourceInitial}
                pillLabel={variant.pillLabel}
                pillBg={variant.pillBg}
                pillFg={variant.pillFg}
                title={title}
                body={body}
                imageUrl={imageUrl}
                imageFailed={imageFailed}
                ctaLabel={ctaLabel}
                ctaUrl={ctaUrl}
                isDark={isDark}
                onClickThrough={handleCtaPress}
                t={t}
            />
        </Animated.View>
    );
}


// ─────────────────────────────────────────────────────────────────────────
// Detail modal — opens when the user taps the card body. Standard "preview
// → detail" pattern (Instagram, news apps). Uses plain RN primitives, NOT
// gluestack, because RN's <Modal> renders into a separate native layer
// where gluestack design tokens don't resolve (same issue we hit on
// AdsConsentModal earlier — explicit StyleSheet styles are bulletproof).
// ─────────────────────────────────────────────────────────────────────────
interface DetailModalProps {
    visible: boolean;
    onClose: () => void;
    kind: SponsoredKind;
    sourceLabel: string;
    avatarBg: string;
    avatarInitial: string;
    /** Same variant the card preview uses — keeps the ANNOUNCEMENT /
     *  SPONSORED / PROMOTED type signal visible after the user expands. */
    pillLabel: string | null;
    pillBg: string;
    pillFg: string;
    title: string;
    body: string;
    imageUrl?: string | null;
    imageFailed: boolean;
    ctaLabel?: string | null;
    ctaUrl?: string | null;
    isDark: boolean;
    onClickThrough: () => void;
    t: (key: string, opts?: Record<string, unknown>) => string;
}

function DetailModal({
    visible,
    onClose,
    kind: _kind,
    sourceLabel,
    avatarBg,
    avatarInitial,
    pillLabel,
    pillBg,
    pillFg,
    title,
    body,
    imageUrl,
    imageFailed,
    ctaLabel,
    ctaUrl,
    isDark,
    onClickThrough,
    t,
}: DetailModalProps) {
    const showImage = !!imageUrl && !imageFailed;
    const bgColor = isDark ? Palette.ink : Palette.white;
    const textColor = isDark ? Palette.gray50 : Palette.ink;
    const subtextColor = isDark ? Palette.gray400 : Palette.gray500;

    return (
        <Modal
            visible={visible}
            animationType="slide"
            onRequestClose={onClose}
            statusBarTranslucent
        >
            <View style={[detailStyles.container, { backgroundColor: bgColor }]}>
                {/* Top bar with close button */}
                <View style={detailStyles.topBar}>
                    <TouchableOpacity
                        onPress={onClose}
                        style={detailStyles.closeBtn}
                        testID="sponsored-detail-close"
                        accessibilityRole="button"
                        accessibilityLabel={t("sponsored.dismiss")}
                    >
                        <MaterialIcons
                            name="close"
                            size={24}
                            color={isDark ? Palette.gray50 : Palette.ink}
                        />
                    </TouchableOpacity>
                </View>

                <ScrollView
                    contentContainerStyle={{ paddingBottom: ctaUrl ? 120 : 40 }}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Hero image — larger than on the card, capped at 320px
                        so very tall images don't push the body off-screen
                        on small phones. */}
                    {showImage && (
                        <Image
                            source={{ uri: resolveImageUrl(imageUrl)! }}
                            style={detailStyles.image}
                            resizeMode="cover"
                            accessibilityLabel={t("sponsored.imageA11y")}
                        />
                    )}

                    <View style={detailStyles.content}>
                        {/* Source row — same avatar + name pattern as the
                            card so the detail view feels like the same
                            object expanded, not a different surface. */}
                        <View style={detailStyles.sourceRow}>
                            <View
                                style={[
                                    detailStyles.avatar,
                                    { backgroundColor: avatarBg },
                                ]}
                            >
                                <RNText style={detailStyles.avatarText}>
                                    {avatarInitial}
                                </RNText>
                            </View>
                            <View style={{ flex: 1 }}>
                                {pillLabel && (
                                    <View
                                        style={[
                                            detailStyles.sponsoredPill,
                                            { backgroundColor: pillBg },
                                        ]}
                                    >
                                        <RNText
                                            style={[
                                                detailStyles.sponsoredPillText,
                                                { color: pillFg },
                                            ]}
                                        >
                                            {pillLabel}
                                        </RNText>
                                    </View>
                                )}
                                <RNText style={[detailStyles.sourceLabel, { color: subtextColor }]}>
                                    {sourceLabel}
                                </RNText>
                            </View>
                        </View>

                        <RNText style={[detailStyles.title, { color: textColor }]}>
                            {title}
                        </RNText>
                        <RNText style={[detailStyles.body, { color: subtextColor }]}>
                            {body}
                        </RNText>
                    </View>
                </ScrollView>

                {/* Sticky CTA bar at the bottom — only when there's a URL.
                    Closing the modal before invoking the parent handler
                    feels snappier than letting both run simultaneously. */}
                {ctaUrl && (
                    <View style={[detailStyles.ctaBar, { backgroundColor: bgColor }]}>
                        <TouchableOpacity
                            onPress={() => {
                                onClose();
                                onClickThrough();
                            }}
                            style={detailStyles.ctaBtn}
                            testID="sponsored-detail-cta"
                            accessibilityRole="link"
                            accessibilityLabel={ctaLabel || "Learn more"}
                            activeOpacity={0.85}
                        >
                            <RNText style={detailStyles.ctaText}>
                                {ctaLabel || "Learn more"}
                            </RNText>
                            <MaterialIcons
                                name="arrow-forward"
                                size={18}
                                color={Palette.white}
                                style={{ marginLeft: 6 }}
                            />
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        </Modal>
    );
}

const detailStyles = StyleSheet.create({
    container: { flex: 1 },
    topBar: {
        flexDirection: "row",
        justifyContent: "flex-end",
        paddingHorizontal: 12,
        paddingTop: 48, // clear the status bar without expo-status-bar dependency
        paddingBottom: 8,
    },
    closeBtn: {
        width: 44,
        height: 44,
        alignItems: "center",
        justifyContent: "center",
    },
    image: {
        width: "100%",
        height: 280,
        backgroundColor: Palette.gray100,
    },
    content: {
        paddingHorizontal: 20,
        paddingTop: 20,
    },
    sourceRow: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 16,
    },
    avatar: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: "center",
        justifyContent: "center",
        marginRight: 12,
    },
    avatarText: {
        color: Palette.white,
        fontWeight: "700",
        fontSize: 16,
    },
    sponsoredPill: {
        // Background color is supplied inline by the caller (varies by kind:
        // amber for SPONSORED, indigo for ANNOUNCEMENT, slate for PROMOTED).
        // See `variant` in SponsoredCard above.
        alignSelf: "flex-start",
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        marginBottom: 4,
    },
    sponsoredPillText: {
        // Color is supplied inline by the caller — see above.
        fontSize: 10,
        fontWeight: "700",
        letterSpacing: 0.5,
    },
    sourceLabel: {
        fontSize: 13,
        fontWeight: "600",
    },
    title: {
        fontSize: 22,
        fontWeight: "700",
        lineHeight: 28,
        marginBottom: 12,
    },
    body: {
        fontSize: 15,
        lineHeight: 22,
    },
    ctaBar: {
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        padding: 16,
        paddingBottom: 32, // home-indicator safe area
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: Palette.gray200,
    },
    ctaBtn: {
        backgroundColor: Palette.teal, // emerald-500
        paddingVertical: 14,
        borderRadius: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
    },
    ctaText: {
        color: Palette.white,
        fontSize: 16,
        fontWeight: "700",
    },
});
