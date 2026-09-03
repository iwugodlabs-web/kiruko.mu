import { MaterialIcons } from "@expo/vector-icons";
import { Palette } from '@/app/constants/theme';
import {
    Box,
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
import { BlurView } from "expo-blur";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, ShieldCheck } from "lucide-react-native";
import { MotiView } from "moti";
import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Controller, useForm } from "react-hook-form";
import { Alert, Pressable, StyleSheet, KeyboardAvoidingView, Platform, Dimensions, Image } from "react-native";
import { z } from "zod";
import { StandardButton } from '../design-system';
import api from "@/services/apiClient";

const { width } = Dimensions.get('window');

type TFunc = (key: string) => string;
const makeOtpSchema = (t: TFunc) => z.object({
    otp: z.string().length(6, t("signup.vOtpLength")),
});

type OtpFormData = z.infer<ReturnType<typeof makeOtpSchema>>;

export default function VerifySignupScreen() {
    const router = useRouter();
    const { t } = useTranslation();
    const otpSchema = useMemo(() => makeOtpSchema(t), [t]);
    const { email } = useLocalSearchParams<{ email: string }>();
    const [resendTimer, setResendTimer] = useState(60);
    const [isResending, setIsResending] = useState(false);

    useEffect(() => {
        let interval: ReturnType<typeof setInterval>;
        if (resendTimer > 0) {
            interval = setInterval(() => {
                setResendTimer((prev) => prev - 1);
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [resendTimer]);

    const {
        control,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<OtpFormData>({
        resolver: zodResolver(otpSchema),
        mode: "onBlur",
    });

    const onSubmit = async (data: OtpFormData) => {
        if (!email) {
            Alert.alert(t("common.errorTitle"), t("signup.emailNotFoundRestart"));
            return;
        }
        try {
            const response = await api.post(`/verify/signup?email=${encodeURIComponent(email)}&otp=${data.otp}`);

            if (response.data?.status === "success") {
                Alert.alert(
                    t("signup.verifiedTitle"),
                    t("signup.verifiedBody"),
                    [{ text: t("signup.logIn"), onPress: () => router.replace("/login") }]
                );
            } else {
                Alert.alert(t("common.errorTitle"), response.data?.detail || t("signup.invalidCode"));
            }
        } catch (error: any) {
            console.error("Verify Signup Error:", error);
            Alert.alert(t("common.errorTitle"), error.response?.data?.detail || t("signup.unexpectedError"));
        }
    };

    const handleResend = async () => {
        if (resendTimer > 0 || isResending) return;

        setIsResending(true);
        try {
            const response = await api.post(`/verify/resend?email=${encodeURIComponent(email || "")}`);
            if (response.data?.status === "success") {
                setResendTimer(60);
                Alert.alert(t("signup.sentTitle"), t("signup.resendSuccess"));
            }
        } catch (error: any) {
            Alert.alert(t("common.errorTitle"), t("signup.resendFailed"));
        } finally {
            setIsResending(false);
        }
    };

    return (
        <Box flex={1} bg={Palette.gray50}>
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
                    <HStack alignItems="center" px="$6" py="$4" justifyContent="space-between">
                        <Pressable
                            onPress={() => router.canGoBack() ? router.back() : router.replace('/login')}
                            style={styles.backButton}
                        >
                            <ArrowLeft size={24} color={Palette.gray800} />
                        </Pressable>
                        <Box w={24} />
                    </HStack>

                    <ScrollView
                        contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, justifyContent: 'center', paddingBottom: 40 }}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                    >
                        <VStack space="xl" w="$full">
                            <MotiView
                                from={{ opacity: 0, scale: 0.9, translateY: -20 }}
                                animate={{ opacity: 1, scale: 1, translateY: 0 }}
                                transition={{ type: 'spring', damping: 15 }}
                                style={{ alignItems: 'center', marginBottom: 20 }}
                            >
                                <Box style={styles.iconContainer}>
                                    <MaterialIcons name="alternate-email" size={48} color={Palette.error} />
                                </Box>
                                <VStack space="xs" mt="$6" alignItems="center">
                                    <Heading size="xl" fontWeight="800" color={Palette.gray800} style={{ letterSpacing: -1 }}>{t("signup.verifyEmailTitle")}</Heading>
                                    <Text size="sm" color="$textLight500" fontWeight="600" textAlign="center">
                                        {t("signup.verifyEmailSub")}
                                    </Text>
                                </VStack>
                            </MotiView>

                            <MotiView
                                from={{ opacity: 0, translateY: 40 }}
                                animate={{ opacity: 1, translateY: 0 }}
                                transition={{ type: 'spring', delay: 150 }}
                            >
                                <BlurView intensity={80} tint="light" style={styles.glassCard}>
                                    <VStack space="lg">
                                        <VStack space="xs">
                                            <Text size="xs" color="$textLight500" fontWeight="700" style={{ marginLeft: 12, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t("signup.verificationCode")}</Text>
                                            <Controller
                                                control={control}
                                                name="otp"
                                                render={({ field: { onChange, onBlur, value } }) => (
                                                    <Input size="xl" variant="rounded" bg="white" style={styles.inputShadow} borderColor={errors.otp ? "$red500" : "$borderLight200"} minHeight={60}>
                                                        <InputSlot pl="$4">
                                                            <InputIcon as={ShieldCheck} color="$textLight400" />
                                                        </InputSlot>
                                                        <InputField
                                                            placeholder="123456"
                                                            value={value}
                                                            onChangeText={onChange}
                                                            onBlur={onBlur}
                                                            keyboardType="number-pad"
                                                            maxLength={6}
                                                            textAlign="center"
                                                            letterSpacing={10}
                                                            fontSize={20}
                                                            fontWeight="700"
                                                            color={Palette.gray800}
                                                        />
                                                    </Input>
                                                )}
                                            />
                                            {errors.otp && <Text color="$red600" size="xs" px="$2" fontWeight="600" mt="$1">{errors.otp.message}</Text>}
                                        </VStack>

                                        <Text size="xs" color="rgba(0,0,0,0.6)" textAlign="center" px="$2">
                                            {t("auth.codeSentTo")} <Text size="xs" color={Palette.error} fontWeight="700">{email}</Text>
                                        </Text>

                                        <StandardButton.Primary
                                            mt="$2"
                                            onPress={handleSubmit(onSubmit)}
                                            isDisabled={isSubmitting}
                                            isLoading={isSubmitting}
                                        >
                                            {t("signup.verifyActivate")}
                                        </StandardButton.Primary>

                                        <Pressable
                                            onPress={handleResend}
                                            disabled={resendTimer > 0 || isResending}
                                            style={{ opacity: (resendTimer > 0 || isResending) ? 0.5 : 1 }}
                                        >
                                            <Text size="sm" textAlign="center" color="$primary600" fontWeight="700">
                                                {resendTimer > 0 ? t("signup.resendIn", { seconds: resendTimer }) : t("signup.resendCode")}
                                            </Text>
                                        </Pressable>
                                    </VStack>
                                </BlurView>
                            </MotiView>

                            <MotiView
                                from={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                transition={{ type: 'timing', duration: 800, delay: 400 }}
                                style={{ alignItems: 'center', marginTop: 40 }}
                            >
                                <Image
                                    source={require("@/assets/images/kiruko-mark.png")}
                                    style={{ width: 48, height: 48, resizeMode: 'contain', opacity: 0.5 }}
                                />
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
    backButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(255, 255, 255, 0.8)',
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: Palette.black,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 5,
        elevation: 2,
    },
    iconContainer: {
        padding: 24,
        borderRadius: 32,
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        shadowColor: Palette.black,
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.05,
        shadowRadius: 20,
        elevation: 5,
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
