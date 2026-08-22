import { postSignInUser, requestLoginOtp } from "@/services/api";
import { Palette } from '@/app/constants/theme';
import { qualifiesForModeChoice } from "@/services/entryMode";
import { MaterialIcons } from '@expo/vector-icons';
import {
    Box,
    ButtonText,
    Heading,
    HStack,
    Input,
    InputField,
    InputIcon,
    InputSlot,
    SafeAreaView,
    ScrollView,
    Text,
    VStack,
} from "@gluestack-ui/themed";
import { zodResolver } from "@hookform/resolvers/zod";
import { BlurView } from 'expo-blur';
import { useRouter } from "expo-router";
import { Eye, EyeOff, Lock, Mail, ArrowRight, Tablet, Phone, MessageCircle } from "lucide-react-native";
import { MotiView } from 'moti';
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Alert, Image, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Dimensions } from "react-native";
import { KIOSK_TABLET_MIN_WIDTH } from "../kiosk/constants";
import { useTranslation } from 'react-i18next';
import { z } from "zod";
import useAuth from "../hooks/useAuth";
import useOnBoard from "../hooks/useOnBoard";
import { StandardButton } from '../design-system';

const { width, height } = Dimensions.get('window');
// Captured once at module load — Login isn't a screen anyone rotates on,
// and the kiosk-setup affordance only needs to render for genuine tablets.
// 600dp covers every iPad at full screen and all 7"+ Android tablets;
// phones cap out around 430dp so they never surface it.
const IS_TABLET = width >= KIOSK_TABLET_MIN_WIDTH;

// WhatsApp/SMS OTP login is hidden until a provider is configured in prod
// (OTP_PROVIDER=whatsapp_meta + Meta template approval). Flip on by setting
// EXPO_PUBLIC_OTP_LOGIN=true in the build env once it's live — no code change.
const OTP_LOGIN_ENABLED = process.env.EXPO_PUBLIC_OTP_LOGIN === 'true';

type LoginFormData = {
    // Holds either an email or a phone, depending on the active tab.
    // Backend's `identifier` field accepts both; UI validates per-mode.
    identifier: string;
    password: string;
};

type LoginMode = "email" | "phone";
const LOGIN_MODE_KEY = "@kontokaz/last-login-mode";

export default function LoginPage() {
    const router = useRouter();
    const { t } = useTranslation();
    const { login } = useAuth();
    const [showPassword, setShowPassword] = useState(false);
    // Tab state — defaults to email but rehydrates the user's previous
    // choice on mount so a phone-first user doesn't see the email tab
    // every launch.
    const [mode, setMode] = useState<LoginMode>("email");
    const [otpBusy, setOtpBusy] = useState(false);

    useEffect(() => {
        AsyncStorage.getItem(LOGIN_MODE_KEY)
            .then((v) => { if (v === "phone" || v === "email") setMode(v); })
            .catch(() => undefined);
    }, []);

    const setModeAndPersist = useCallback((next: LoginMode) => {
        setMode(next);
        AsyncStorage.setItem(LOGIN_MODE_KEY, next).catch(() => undefined);
    }, []);

    // Schema flips with the mode — phone has a digit-count check; email
    // uses zod's RFC validator. Recreating on each render is cheap and
    // keeps the validator in sync with the active tab.
    const loginSchema = z.object({
        identifier:
            mode === "phone"
                ? z.string().min(7, t('auth.phoneInvalid', 'Enter a valid phone number'))
                      .regex(/^[+0-9\s\-()]+$/, t('auth.phoneInvalid', 'Enter a valid phone number'))
                : z.string().email(t('auth.emailInvalid')),
        password: z.string().min(1, t('auth.passwordRequired')),
    });

    const {
        control,
        handleSubmit,
        getValues,
        formState: { errors, isSubmitting },
    } = useForm<LoginFormData>({
        resolver: zodResolver(loginSchema),
        mode: "onBlur",
        // Reset validation when mode changes — otherwise an old "email
        // invalid" error sticks around when the user flips to phone.
        values: undefined,
    });

    const onSubmit = async (data: LoginFormData) => {
        try {
            const response = await postSignInUser({
                identifier: data.identifier,
                password: data.password,
            });

            if (response && "access_token" in response && response.data) {
                const user = response.data;
                await login(
                    {
                        email: user.email,
                        user_id: user.user_id.toString(),
                        token: response.access_token,
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
                    response.access_token,
                    response.refresh_token
                );

                // Dual-identity users (owner/admin/manager who are also employees) pick
                // which side to enter; everyone else routes straight through.
                if (qualifiesForModeChoice(user) && (user.user_type === "company" || user.onboard_complete)) {
                    router.replace("/choose-mode");
                } else if (user.user_type === "company") {
                    router.replace("/company_dashboard/home");
                } else if (user.user_type === "private") {
                    router.replace(user.onboard_complete ? "/private_dashboard/home" : "/private_dashboard/profile");
                }
            } else if ('status' in response && response.status === 403 && (response as any).error === 'EMAIL_NOT_VERIFIED') {
                Alert.alert(
                    t('auth.emailNotVerifiedTitle'),
                    t('auth.emailNotVerifiedBody'),
                    [{
                        text: t('auth.verifyNow'),
                        onPress: () => router.replace(`/signup/verify-signup?email=${encodeURIComponent(data.identifier)}`)
                    }]
                );
            } else {
                const errorMessage = 'error' in response ? response.error : t('auth.invalidCredentials');
                Alert.alert(t('auth.loginFailedTitle'), errorMessage);
            }
        } catch (error) {
            console.error("Login Error:", error);
            Alert.alert(t('auth.errorTitle'), t('auth.unexpectedError'));
        }
    };

    return (
        <Box flex={1} bg={Palette.gray50}>
            {/* Immersive Background Blobs */}
            <Box style={StyleSheet.absoluteFill}>
                <MotiView
                    from={{ opacity: 0.3, scale: 1, translateX: -50 }}
                    animate={{ opacity: 0.6, scale: 1.5, translateX: 50 }}
                    transition={{ loop: true, type: 'timing', duration: 10000, repeatReverse: true }}
                    style={[styles.blob, { backgroundColor: Palette.errorTint, top: '5%', left: '0%' }]}
                />
                <MotiView
                    from={{ opacity: 0.2, scale: 1.2, translateY: 50 }}
                    animate={{ opacity: 0.5, scale: 1.8, translateY: -50 }}
                    transition={{ loop: true, type: 'timing', duration: 12000, repeatReverse: true }}
                    style={[styles.blob, { backgroundColor: Palette.blueTint, bottom: '10%', right: '-10%' }]}
                />
            </Box>

            <SafeAreaView style={{ flex: 1 }}>
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    style={{ flex: 1 }}
                >
                    <ScrollView
                        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, justifyContent: 'center', paddingBottom: 40 }}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                    >
                        <VStack space="xl" w="$full">
                            {/* Branding Entrance */}
                            <MotiView
                                from={{ opacity: 0, scale: 0.9, translateY: -20 }}
                                animate={{ opacity: 1, scale: 1, translateY: 0 }}
                                transition={{ type: 'spring', damping: 15 }}
                                style={{ alignItems: 'center', marginBottom: 20 }}
                            >
                                <Box style={styles.logoContainer}>
                                    <Image
                                        source={require("@/assets/images/kiruko-mark.png")}
                                        style={styles.logo}
                                    />
                                </Box>
                                <VStack space="xs" mt="$6" alignItems="center">
                                    <Heading size="xl" fontWeight="800" color={Palette.gray800} style={{ letterSpacing: -1 }}>{t('auth.loginWelcome')}</Heading>
                                    <Text size="sm" color="$textLight500" fontWeight="600">{t('auth.loginSubtitle')}</Text>
                                </VStack>
                            </MotiView>

                            {/* Form Card */}
                            <MotiView
                                from={{ opacity: 0, translateY: 40 }}
                                animate={{ opacity: 1, translateY: 0 }}
                                transition={{ type: 'spring', delay: 150 }}
                            >
                                <BlurView intensity={80} tint="light" style={styles.glassCard}>
                                    <VStack space="lg">
                                        {/* Email | Phone tab toggle. Each tab swaps the field
                                            schema, keyboard, and placeholder; submission always
                                            posts `identifier` so the backend's phone-or-email
                                            router does the right thing. */}
                                        <HStack space="xs" style={styles.modeTabs}>
                                            <Pressable
                                                onPress={() => setModeAndPersist("email")}
                                                style={[styles.modeTab, mode === "email" && styles.modeTabActive]}
                                            >
                                                <HStack space="xs" alignItems="center" justifyContent="center">
                                                    <Mail size={14} color={mode === "email" ? "#0f172a" : "#94a3b8"} />
                                                    <Text size="xs" fontWeight="700" color={mode === "email" ? "#0f172a" : "#94a3b8"}>
                                                        {t('auth.emailLabel', 'Email')}
                                                    </Text>
                                                </HStack>
                                            </Pressable>
                                            <Pressable
                                                onPress={() => setModeAndPersist("phone")}
                                                style={[styles.modeTab, mode === "phone" && styles.modeTabActive]}
                                            >
                                                <HStack space="xs" alignItems="center" justifyContent="center">
                                                    <Phone size={14} color={mode === "phone" ? "#0f172a" : "#94a3b8"} />
                                                    <Text size="xs" fontWeight="700" color={mode === "phone" ? "#0f172a" : "#94a3b8"}>
                                                        {t('auth.phoneLabel', 'Phone')}
                                                    </Text>
                                                </HStack>
                                            </Pressable>
                                        </HStack>

                                        <VStack space="xs">
                                            <Text size="xs" color="$textLight500" fontWeight="700" style={{ marginLeft: 12, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                                {mode === "phone"
                                                    ? t('auth.phoneLabel', 'Phone')
                                                    : t('auth.emailLabel', 'Email')}
                                            </Text>
                                            <Controller
                                                control={control}
                                                name="identifier"
                                                render={({ field: { onChange, onBlur, value } }) => (
                                                    <Input size="xl" variant="rounded" bg="white" style={styles.inputShadow} borderColor={errors.identifier ? "$red500" : "$borderLight200"}>
                                                        <InputSlot pl="$4">
                                                            <InputIcon as={mode === "phone" ? Phone : Mail} color="$textLight400" />
                                                        </InputSlot>
                                                        <InputField
                                                            placeholder={mode === "phone"
                                                                ? t('auth.phonePlaceholder', '+230 5712 3456')
                                                                : t('auth.emailPlaceholder')}
                                                            value={value}
                                                            onChangeText={onChange}
                                                            onBlur={onBlur}
                                                            autoCapitalize="none"
                                                            keyboardType={mode === "phone" ? "phone-pad" : "email-address"}
                                                            fontSize="$sm"
                                                        />
                                                    </Input>
                                                )}
                                            />
                                            {errors.identifier && <Text color="$red600" size="xs" px="$2" fontWeight="600" mt="$1">{errors.identifier.message}</Text>}
                                        </VStack>

                                        <VStack space="xs">
                                            <HStack justifyContent="space-between" alignItems="center" px="$2">
                                                <Text size="xs" color="$textLight500" fontWeight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('auth.passwordLabel')}</Text>
                                                <Pressable onPress={() => router.push('/login/forgot-password')}>
                                                    <Text color="$primary600" size="xs" fontWeight="700">{t('auth.forgot')}</Text>
                                                </Pressable>
                                            </HStack>
                                            <Controller
                                                control={control}
                                                name="password"
                                                render={({ field: { onChange, onBlur, value } }) => (
                                                    <Input size="xl" variant="rounded" bg="white" style={styles.inputShadow} borderColor={errors.password ? "$red500" : "$borderLight200"}>
                                                        <InputSlot pl="$4">
                                                            <InputIcon as={Lock} color="$textLight400" />
                                                        </InputSlot>
                                                        <InputField
                                                            placeholder={t('auth.passwordPlaceholder')}
                                                            value={value}
                                                            onChangeText={onChange}
                                                            onBlur={onBlur}
                                                            secureTextEntry={!showPassword}
                                                            fontSize="$sm"
                                                        />
                                                        <InputSlot pr="$4" onPress={() => setShowPassword(!showPassword)}>
                                                            <InputIcon as={showPassword ? Eye : EyeOff} color="$textLight400" />
                                                        </InputSlot>
                                                    </Input>
                                                )}
                                            />
                                            {errors.password && <Text color="$red600" size="xs" px="$2" fontWeight="600" mt="$1">{errors.password.message}</Text>}
                                        </VStack>

                                        <StandardButton.Primary
                                            mt="$4"
                                            onPress={handleSubmit(onSubmit)}
                                            isDisabled={isSubmitting}
                                            isLoading={isSubmitting}
                                        >
                                            {t('auth.signIn')}
                                        </StandardButton.Primary>

                                        {/* WhatsApp OTP entry — only on the Phone tab, and only
                                            when a provider is configured (EXPO_PUBLIC_OTP_LOGIN).
                                            Hidden by default so reviewers/testers never hit a
                                            dead "Get code on WhatsApp" before WhatsApp is live. */}
                                        {mode === "phone" && OTP_LOGIN_ENABLED && (
                                            <Pressable
                                                onPress={async () => {
                                                    const phone = (getValues("identifier") || "").trim();
                                                    if (phone.length < 7) {
                                                        Alert.alert(
                                                            t('auth.phoneInvalid', 'Enter a valid phone number'),
                                                            t('auth.phoneRequiredForOtp', 'Type your phone first, then tap "Get code on WhatsApp".'),
                                                        );
                                                        return;
                                                    }
                                                    setOtpBusy(true);
                                                    const r = await requestLoginOtp(phone);
                                                    setOtpBusy(false);
                                                    if ("error" in r) {
                                                        const msg =
                                                            r.status === 429
                                                                ? t('auth.otpRateLimited', 'Too many code requests. Try again later.')
                                                                : r.error || t('auth.unexpectedError');
                                                        Alert.alert(t('auth.errorTitle'), msg);
                                                        return;
                                                    }
                                                    router.push({
                                                        pathname: '/login/verify-otp-login' as never,
                                                        params: { phone },
                                                    });
                                                }}
                                                style={styles.otpLink}
                                                disabled={otpBusy}
                                            >
                                                <HStack space="xs" alignItems="center" justifyContent="center">
                                                    <MessageCircle size={16} color="#16a34a" />
                                                    <Text size="sm" color="#16a34a" fontWeight="700">
                                                        {otpBusy
                                                            ? t('auth.sendingCode', 'Sending code...')
                                                            : t('auth.useWhatsappCode', 'Get code on WhatsApp')}
                                                    </Text>
                                                </HStack>
                                            </Pressable>
                                        )}
                                    </VStack>
                                </BlurView>
                            </MotiView>

                            {/* Footer Options */}
                            <MotiView
                                from={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ type: 'timing', duration: 800, delay: 400 }}
                            >
                                <VStack space="md" mt="$4">
                                    <HStack space="md" justifyContent="center" alignItems="center" px="$10">
                                        <Box h="$px" bg="$backgroundLight200" flex={1} />
                                        <Text size="xs" color="$textLight400" fontWeight="700">{t('auth.newHere')}</Text>
                                        <Box h="$px" bg="$backgroundLight200" flex={1} />
                                    </HStack>

                                    <HStack space="md">
                                        <Box flex={1}>
                                            <StandardButton.Secondary onPress={() => router.push("/signup/signup")}>
                                                {t('auth.personal')}
                                            </StandardButton.Secondary>
                                        </Box>
                                        <Box flex={1}>
                                            <StandardButton.Secondary onPress={() => router.push("/signup/signup_company")}>
                                                {t('auth.company')}
                                            </StandardButton.Secondary>
                                        </Box>
                                    </HStack>

                                    {/* Tablet-only affordance — provisions this device as a clock-in
                                        kiosk. Hidden on phones; the route itself is reachable on any
                                        device for admins, but surfacing it here keeps the discovery
                                        flow obvious to the person physically setting up the tablet. */}
                                    {IS_TABLET && (
                                        <Pressable
                                            onPress={() => router.push("/kiosk/setup" as never)}
                                            style={styles.kioskSetupBtn}
                                        >
                                            <HStack space="sm" alignItems="center" justifyContent="center">
                                                <Tablet size={16} color="#475569" />
                                                <Text size="sm" color="#475569" fontWeight="600">
                                                    {t('kiosk.setupAsTablet', 'Set up this tablet as a kiosk')}
                                                </Text>
                                            </HStack>
                                        </Pressable>
                                    )}
                                    {/* DEV-ONLY: peek at the kiosk UI without provisioning a token.
                                        Stripped from production builds (__DEV__ is false there). */}
                                    {__DEV__ && (
                                        <Pressable
                                            onPress={() => router.push("/kiosk/clock-in" as never)}
                                            style={styles.kioskSetupBtn}
                                        >
                                            <HStack space="sm" alignItems="center" justifyContent="center">
                                                <Tablet size={16} color="#475569" />
                                                <Text size="sm" color="#475569" fontWeight="600">
                                                    🔧 Preview kiosk (dev)
                                                </Text>
                                            </HStack>
                                        </Pressable>
                                    )}
                                </VStack>
                            </MotiView>
                        </VStack>
                    </ScrollView>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </Box>
    );
}

const styles = StyleSheet.create({
    blob: {
        position: 'absolute',
        width: 350,
        height: 350,
        borderRadius: 175,
    },
    modeTabs: {
        backgroundColor: '#f1f5f9',
        borderRadius: 12,
        padding: 4,
        gap: 4,
    },
    modeTab: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: 8,
    },
    modeTabActive: {
        backgroundColor: 'white',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 2,
        elevation: 1,
    },
    otpLink: {
        paddingVertical: 12,
        marginTop: 4,
    },
    kioskSetupBtn: {
        marginTop: 12,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        backgroundColor: 'rgba(255,255,255,0.6)',
    },
    logoContainer: {
        padding: 20,
        borderRadius: 32,
        shadowColor: Palette.black,
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.05,
        shadowRadius: 20,
        elevation: 5,
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
    },
    logo: {
        width: 72,
        height: 72,
        resizeMode: "contain",
    },
    glassCard: {
        padding: 24,
        borderRadius: 32,
        borderWidth: 1,
        borderColor: 'rgba(255, 255, 255, 0.5)',
        overflow: 'hidden',
    },
    inputShadow: {
        shadowColor: Palette.black,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.02,
        shadowRadius: 10,
        elevation: 1,
    }
});