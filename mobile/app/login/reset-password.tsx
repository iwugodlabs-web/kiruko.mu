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
import { ArrowLeft, Eye, EyeOff, Lock, Shield } from "lucide-react-native";
import { MotiView } from "moti";
import React, { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Alert, Pressable, StyleSheet, KeyboardAvoidingView, Platform, Dimensions, Image } from "react-native";
import { useTranslation } from 'react-i18next';
import { z } from "zod";
import { StandardButton } from '../design-system';

// Assuming this API function exists in your services/api.ts
import { postResetPassword } from "@/services/api";

const { width } = Dimensions.get('window');

type PasswordFormData = {
  password: string;
  confirmPassword: string;
};

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { email, token } = useLocalSearchParams<{ email: string; token: string }>();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const passwordSchema = z
    .object({
      password: z.string().min(8, t('auth.passwordMin')),
      confirmPassword: z.string(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t('auth.passwordsDoNotMatch'),
      path: ["confirmPassword"],
    });

  const {
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    mode: "onBlur",
  });

  const onSubmit = async (data: PasswordFormData) => {
    if (!email || !token) {
      Alert.alert(t('auth.errorTitle'), t('auth.sessionExpiredReset'));
      router.replace("/login");
      return;
    }
    try {
      const response = await postResetPassword(token, data.password);

      if (response.status === "success") {
        Alert.alert(
          t('auth.resetSuccessTitle'),
          t('auth.resetSuccessBody'),
          [{ text: t('common.ok'), onPress: () => router.replace("/login") }]
        );
      } else {
        Alert.alert(t('auth.errorTitle'), response.error || t('auth.failedToReset'));
      }
    } catch (error) {
      console.error("Reset Password Error:", error);
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
                  <MaterialIcons name="lock" size={48} color={Palette.gold} />
                </Box>
                <VStack space="xs" mt="$6" alignItems="center">
                  <Heading size="xl" fontWeight="800" color={Palette.gray800} style={{ letterSpacing: -1 }}>{t('auth.resetTitle')}</Heading>
                  <Text size="sm" color="$textLight500" fontWeight="600" textAlign="center">
                    {t('auth.resetSubtitle')}
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
                      <Text size="xs" color="$textLight500" fontWeight="700" style={{ marginLeft: 12, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('auth.newPasswordLabel')}</Text>
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

                    <VStack space="xs">
                      <Text size="xs" color="$textLight500" fontWeight="700" style={{ marginLeft: 12, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('auth.confirmPasswordLabel')}</Text>
                      <Controller
                        control={control}
                        name="confirmPassword"
                        render={({ field: { onChange, onBlur, value } }) => (
                          <Input size="xl" variant="rounded" bg="white" style={styles.inputShadow} borderColor={errors.confirmPassword ? "$red500" : "$borderLight200"}>
                            <InputSlot pl="$4">
                              <InputIcon as={Shield} color="$textLight400" />
                            </InputSlot>
                            <InputField
                              placeholder={t('auth.passwordPlaceholder')}
                              value={value}
                              onChangeText={onChange}
                              onBlur={onBlur}
                              secureTextEntry={!showConfirmPassword}
                              fontSize="$sm"
                            />
                            <InputSlot pr="$4" onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                              <InputIcon as={showConfirmPassword ? Eye : EyeOff} color="$textLight400" />
                            </InputSlot>
                          </Input>
                        )}
                      />
                      {errors.confirmPassword && <Text color="$red600" size="xs" px="$2" fontWeight="600" mt="$1">{errors.confirmPassword.message}</Text>}
                    </VStack>

                    <StandardButton.Primary
                      mt="$4"
                      onPress={handleSubmit(onSubmit)}
                      isDisabled={isSubmitting}
                      isLoading={isSubmitting}
                    >
                      {t('auth.resetPassword')}
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