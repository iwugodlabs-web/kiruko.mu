import { MaterialIcons } from '@expo/vector-icons';
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
import { BlurView } from 'expo-blur';
import { useRouter } from "expo-router";
import { ArrowLeft, Mail } from "lucide-react-native";
import { MotiView } from 'moti';
import React from "react";
import { Controller, useForm } from "react-hook-form";
import { Alert, Image, Pressable, StyleSheet, KeyboardAvoidingView, Platform, Dimensions } from "react-native";
import { useTranslation } from 'react-i18next';
import { z } from "zod";
import { StandardButton } from '../design-system';

// Assuming this API function exists in your services/api.ts
import { postRequestPasswordReset } from "@/services/api";

const { width } = Dimensions.get('window');

type EmailFormData = {
    email: string;
};

export default function ForgotPasswordScreen() {
    const router = useRouter();
    const { t } = useTranslation();

    const emailSchema = z.object({
        email: z.string().email(t('auth.emailInvalid')),
    });

    const {
        control,
        handleSubmit,
        formState: { errors, isSubmitting },
    } = useForm<EmailFormData>({
        resolver: zodResolver(emailSchema),
        mode: "onBlur",
    });

    const onSubmit = async (data: EmailFormData) => {
        try {
            const response = await postRequestPasswordReset(data.email);

            if (!("error" in response)) {
                Alert.alert(
                    t('auth.checkEmailTitle'),
                    t('auth.checkEmailBody')
                );
                router.push({
                    pathname: "/login/verify-otp",
                    params: { email: data.email },
                });
            } else {
                Alert.alert(t('auth.errorTitle'), response.error || t('auth.failedToSendOtp'));
            }
        } catch (error) {
            console.error("Forgot Password Error:", error);
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
                    style={[styles.blob, { backgroundColor: Palette.goldTint, top: '5%', left: '0%' }]}
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
                        <Pressable onPress={() => router.back()} style={styles.backButton}>
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
                            {/* Branding Entrance */}
                            <MotiView
                                from={{ opacity: 0, scale: 0.9, translateY: -20 }}
                                animate={{ opacity: 1, scale: 1, translateY: 0 }}
                                transition={{ type: 'spring', damping: 15 }}
                                style={{ alignItems: 'center', marginBottom: 20 }}
                            >
                                <Box style={styles.iconContainer}>
                                    <MaterialIcons name="lock-reset" size={48} color={Palette.gold} />
                                </Box>
                                <VStack space="xs" mt="$6" alignItems="center">
                                    <Heading size="xl" fontWeight="800" color={Palette.gray800} style={{ letterSpacing: -1 }}>{t('auth.forgotTitle')}</Heading>
                                    <Text size="sm" color="$textLight500" fontWeight="600" textAlign="center">
                                        {t('auth.forgotSubtitle')}
                                    </Text>
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
                                        <VStack space="xs">
                                            <Text size="xs" color="$textLight500" fontWeight="700" style={{ marginLeft: 12, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('auth.emailLabel')}</Text>
                                            <Controller
                                                control={control}
                                                name="email"
                                                render={({ field: { onChange, onBlur, value } }) => (
                                                    <Input size="xl" variant="rounded" bg="white" style={styles.inputShadow} borderColor={errors.email ? "$red500" : "$borderLight200"}>
                                                        <InputSlot pl="$4">
                                                            <InputIcon as={Mail} color="$textLight400" />
                                                        </InputSlot>
                                                        <InputField
                                                            placeholder={t('auth.emailPlaceholder')}
                                                            value={value}
                                                            onChangeText={onChange}
                                                            onBlur={onBlur}
                                                            autoCapitalize="none"
                                                            keyboardType="email-address"
                                                            fontSize="$sm"
                                                        />
                                                    </Input>
                                                )}
                                            />
                                            {errors.email && <Text color="$red600" size="xs" px="$2" fontWeight="600" mt="$1">{errors.email.message}</Text>}
                                        </VStack>

                                        <StandardButton.Primary
                                            mt="$4"
                                            onPress={handleSubmit(onSubmit)}
                                            isDisabled={isSubmitting}
                                            isLoading={isSubmitting}
                                        >
                                            {t('auth.sendResetCode')}
                                        </StandardButton.Primary>
                                    </VStack>
                                </BlurView>
                            </MotiView>

                            {/* Logo */}
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