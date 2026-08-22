/**
 * Phase 2 — OTP login code-entry screen. Reached from the login screen's
 * "Get code on WhatsApp" link with the user's phone in route params.
 *
 * Visually mirrors the existing /signup/verify-otp screen so the UX
 * doesn't feel like a side branch. Different endpoint (/auth/otp/verify
 * → returns access tokens) and different success destination (straight
 * into the dashboard rather than the post-signup screen).
 */

import { requestLoginOtp, verifyLoginOtp } from "@/services/api";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, RefreshCw } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import useAuth from "../hooks/useAuth";

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_S = 30;

export default function VerifyOtpLogin() {
    const router = useRouter();
    const { phone: phoneParam } = useLocalSearchParams<{ phone?: string }>();
    const phone = (phoneParam || "").trim();
    const { login } = useAuth();

    const [code, setCode] = useState("");
    const [busy, setBusy] = useState(false);
    const [resending, setResending] = useState(false);
    const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S);

    useEffect(() => {
        if (cooldown <= 0) return;
        const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
        return () => clearTimeout(t);
    }, [cooldown]);

    const onVerify = useCallback(async (final: string) => {
        if (!phone) return;
        setBusy(true);
        const r = await verifyLoginOtp(phone, final);
        setBusy(false);
        if ("error" in r) {
            // Device-binding rejection from trusted_device_service. The
            // code is correct but this device isn't approved — usually
            // happens when a recycled phone number meets a passwordless
            // account, or when a user wipes their primary device.
            if (r.status === 403 && /new_device_requires_approval/i.test(r.error)) {
                Alert.alert(
                    "New device — needs approval",
                    "Your code was correct, but this device isn't on your trusted list yet. Sign in from a device you've used before, or contact your admin to approve this one.",
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
            Alert.alert("Verification failed", msg);
            setCode("");
            return;
        }
        if (r && "access_token" in r && r.data) {
            const user = r.data as any;
            await login(
                {
                    email: user.email,
                    user_id: user.user_id.toString(),
                    token: r.access_token,
                    isAuthenticated: true,
                    onboard_complete: user.onboard_complete,
                    user_type: user.user_type,
                    private_user_id: user.private_user_id?.toString() || "",
                    company: user.company,
                    user_name: user.user_name,
                    private_user: user.private_user,
                    company_onboarding_status: user.company_onboarding_status,
                    verification_note: user.verification_note,
                    company_roles: user.company_roles,
                    is_company_admin: user.is_company_admin,
                    company_permissions: user.company_permissions,
                    company_rbac_enabled: user.company_rbac_enabled,
                },
                r.access_token,
                r.refresh_token,
            );
            if (user.user_type === "company") {
                router.replace("/company_dashboard/home");
            } else {
                router.replace(user.onboard_complete ? "/private_dashboard/home" : "/private_dashboard/profile");
            }
        }
    }, [phone, login, router]);

    const onCodeChange = (next: string) => {
        const digits = next.replace(/\D+/g, "").slice(0, CODE_LENGTH);
        setCode(digits);
        if (digits.length === CODE_LENGTH) {
            // Defer so the last digit renders before we navigate away.
            setTimeout(() => onVerify(digits), 80);
        }
    };

    const onResend = async () => {
        if (cooldown > 0 || !phone) return;
        setResending(true);
        const r = await requestLoginOtp(phone);
        setResending(false);
        if ("error" in r) {
            Alert.alert("Resend failed", r.error || "Could not resend code");
            return;
        }
        setCooldown(RESEND_COOLDOWN_S);
        Alert.alert("Code sent", "Check WhatsApp for a fresh code.");
    };

    if (!phone) {
        // Direct-link / refresh-during-dev safety net.
        return (
            <SafeAreaView style={styles.safe}>
                <View style={styles.centered}>
                    <Text style={styles.title}>No phone number provided</Text>
                    <Pressable onPress={() => router.replace("/login")} style={styles.btn}>
                        <Text style={styles.btnText}>Back to login</Text>
                    </Pressable>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.safe}>
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                    <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
                        <ArrowLeft size={20} color="#475569" />
                        <Text style={styles.backText}>Back</Text>
                    </Pressable>

                    <View style={styles.iconWrap}>
                        <Image
                            source={require("@/assets/images/kiruko-mark.png")}
                            style={{ width: 56, height: 56, resizeMode: "contain" }}
                        />
                    </View>

                    <Text style={styles.title}>Enter the 6-digit code</Text>
                    <Text style={styles.sub}>
                        We sent it to <Text style={{ fontWeight: "700" }}>{phone}</Text> on WhatsApp.
                    </Text>

                    <TextInput
                        value={code}
                        onChangeText={onCodeChange}
                        placeholder="••••••"
                        placeholderTextColor="#cbd5e1"
                        keyboardType="number-pad"
                        autoFocus
                        maxLength={CODE_LENGTH}
                        editable={!busy}
                        style={styles.codeInput}
                    />

                    {busy && <ActivityIndicator color="#16a34a" style={{ marginTop: 16 }} />}

                    <Pressable
                        onPress={onResend}
                        disabled={cooldown > 0 || resending}
                        style={[styles.resendBtn, (cooldown > 0 || resending) && { opacity: 0.5 }]}
                    >
                        <RefreshCw size={14} color="#64748b" />
                        <Text style={styles.resendText}>
                            {cooldown > 0 ? `Resend in ${cooldown}s` : resending ? "Sending..." : "Resend code"}
                        </Text>
                    </Pressable>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safe: { flex: 1, backgroundColor: "#f8fafc" },
    scroll: { flexGrow: 1, padding: 24 },
    centered: { flex: 1, alignItems: "center", justifyContent: "center" },
    backBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
    backText: { color: "#475569", fontSize: 14 },
    iconWrap: { alignItems: "center", marginTop: 24, marginBottom: 16 },
    title: { color: "#0f172a", fontSize: 24, fontWeight: "800", textAlign: "center" },
    sub: { color: "#64748b", fontSize: 15, marginTop: 8, marginBottom: 32, textAlign: "center" },
    codeInput: {
        fontSize: 32,
        letterSpacing: 12,
        textAlign: "center",
        paddingVertical: 16,
        backgroundColor: "white",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "#e2e8f0",
        color: "#0f172a",
        fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    },
    resendBtn: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        marginTop: 32,
        paddingVertical: 12,
    },
    resendText: { color: "#64748b", fontSize: 13, fontWeight: "600" },
    btn: {
        backgroundColor: "#2563eb",
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 12,
        marginTop: 16,
    },
    btnText: { color: "white", fontWeight: "700" },
});
