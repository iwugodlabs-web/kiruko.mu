import { updateCompanyProfile } from '@/services/api';
import { Palette, Type } from '@/app/constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import {
  Box,
  Button,
  ButtonText,
  FormControl,
  FormControlLabel,
  FormControlLabelText,
  HStack,
  Input,
  InputField,
  Text,
  VStack,
} from '@gluestack-ui/themed';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Controller, useForm } from 'react-hook-form';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  SlideInRight,
  SlideOutLeft,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from '@/app/utils/animated';
import { z } from 'zod';
import useAuth from '../hooks/useAuth';
import { PremiumHeader } from '@/components/PremiumHeader';

// ─── Schema ────────────────────────────────────────────────────────────────────

const makeCompanyProfileSchema = (t: (k: string) => string) =>
  z.object({
    company_name: z.string().trim().min(1, t('companyProfile.vCompanyName')),
    brn: z.string().trim().min(1, t('companyProfile.vBrn')),
    email: z.string().email(t('companyProfile.vEmail')).or(z.literal('')).optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    vat: z.string().optional(),
    annual_leave_budget: z
      .string()
      .optional()
      .refine((v) => !v || !isNaN(Number(v)), t('companyProfile.vNumber')),
  });

type CompanyProfileForm = z.infer<ReturnType<typeof makeCompanyProfileSchema>>;

// ─── Component ─────────────────────────────────────────────────────────────────

export default function CompanyProfilePage() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user, checkAuth } = useAuth();
  const [currentStep, setCurrentStep] = useState(0);
  const [isSaving, setIsSaving] = useState(false);

  const companyProfileSchema = useMemo(() => makeCompanyProfileSchema(t), [t]);
  const steps = useMemo(
    () => [
      { title: t('companyProfile.stepIdentity'), icon: 'business' },
      { title: t('companyProfile.stepContact'), icon: 'contacts' },
    ],
    [t]
  );

  const stepperLineStyle = useAnimatedStyle(() => {
    const progress = (currentStep / (steps.length - 1)) * 80;
    return { width: withTiming(`${progress}%`) };
  });

  const {
    control,
    handleSubmit,
    reset,
    trigger,
    formState: { errors },
  } = useForm<CompanyProfileForm>({
    resolver: zodResolver(companyProfileSchema),
    mode: 'onChange',
    defaultValues: {
      company_name: '',
      brn: '',
      email: '',
      phone: '',
      address: '',
      vat: '',
      annual_leave_budget: '',
    },
  });

  // Pre-populate from current user
  useEffect(() => {
    const c = user?.company;
    if (c) {
      reset({
        company_name: c.company_name ?? '',
        brn: c.brn ?? '',
        email: c.email ?? '',
        phone: c.phone ?? '',
        address: c.address ?? '',
        vat: (c as any).vat ?? '',
        annual_leave_budget: c.annual_leave_budget != null ? String(c.annual_leave_budget) : '',
      });
    }
  }, [user?.company?.company_id]);

  const nextStep = async () => {
    const step0Fields: (keyof CompanyProfileForm)[] = ['company_name'];
    const valid = await trigger(currentStep === 0 ? step0Fields : undefined);
    if (valid) setCurrentStep((s) => s + 1);
  };

  const prevStep = () => setCurrentStep((s) => Math.max(0, s - 1));

  const onSubmit = async (data: CompanyProfileForm) => {
    const companyId = user?.company?.company_id ?? (user as any)?.private_user?.company_id;
    if (!companyId) {
      Alert.alert(t('common.errorTitle'), t('companyProfile.errCompanyNotFound'));
      return;
    }

    setIsSaving(true);
    try {
      const result = await updateCompanyProfile(companyId, {
        company_name: data.company_name,
        brn: data.brn.trim(),
        email: data.email || undefined,
        phone: data.phone || undefined,
        address: data.address || undefined,
        vat: data.vat || undefined,
        annual_leave_budget: data.annual_leave_budget
          ? Number(data.annual_leave_budget)
          : undefined,
      });

      if ('error' in result) {
        Alert.alert(t('companyProfile.updateFailed'), result.error);
        return;
      }

      // Refresh auth state silently
      try { await checkAuth(); } catch { /* ignore */ }

      Alert.alert(t('companyProfile.successTitle'), t('companyProfile.successBody'), [
        { text: t('common.ok'), onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert(t('common.errorTitle'), e?.message || t('companyProfile.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  // Backend (PUT /company/{company_id}, api/v1/company.py:238) already
  // rejects this write for anyone but the literal company owner — RBAC
  // permissions/roles don't factor in, by design (there's no
  // "edit_company_profile" permission; company legal/identity details are
  // owner-only, not delegable). This mirrors that same check client-side so
  // a delegated role holder (HR, manager, admin — any role) who switched
  // into employer mode sees a clear message here instead of filling out the
  // whole form and only discovering they're blocked via a raw 403 on save.
  const isOwner = user?.user_type === 'company';

  if (!isOwner) {
    return (
      <LinearGradient colors={[Palette.blueTint, Palette.gray100, Palette.white]} style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }}>
          <PremiumHeader
            title={t('companyProfile.headerTitle')}
            onBack={() => router.replace('/company_dashboard/settings')}
          />
          <Box flex={1} justifyContent="center" alignItems="center" px="$8">
            <VStack space="md" alignItems="center">
              <Box bg={Palette.gray100} p="$6" rounded="$full">
                <MaterialIcons name="lock" size={40} color={Palette.gray400} />
              </Box>
              <Text fontSize={Type.title} fontWeight="700" color={Palette.ink} textAlign="center">
                {t('companyProfile.ownerOnlyTitle')}
              </Text>
              <Text fontSize={Type.body} color={Palette.gray500} textAlign="center">
                {t('companyProfile.ownerOnlyBody')}
              </Text>
            </VStack>
          </Box>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={[Palette.blueTint, Palette.gray100, Palette.white]} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <PremiumHeader
          title={t('companyProfile.headerTitle')}
          onBack={() => router.replace('/company_dashboard/settings')}
        />

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 160 }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Step label */}
            <VStack space="xs" mb="$6" px="$2">
              <Text fontSize={Type.body} color={Palette.gray500} fontWeight="700">
                {t('companyProfile.stepLabel', { current: currentStep + 1, total: steps.length, title: steps[currentStep].title })}
              </Text>
            </VStack>

            {/* Stepper */}
            <Box mb="$8" px="$2">
              <HStack justifyContent="space-between" alignItems="center" position="relative">
                <Box
                  position="absolute"
                  top="40%"
                  left="20%"
                  right="20%"
                  h={2}
                  bg={Palette.gray200}
                  zIndex={-1}
                />
                <Animated.View
                  style={[
                    {
                      position: 'absolute',
                      top: '40%',
                      left: '20%',
                      height: 2,
                      backgroundColor: Palette.blue,
                      zIndex: -1,
                    },
                    stepperLineStyle,
                  ]}
                />
                {steps.map((step, idx) => {
                  const active = idx <= currentStep;
                  return (
                    <VStack key={idx} alignItems="center" space="xs" flex={1}>
                      <Box
                        w={40}
                        h={40}
                        rounded="$full"
                        bg={active ? Palette.blue : Palette.white}
                        borderWidth={2}
                        borderColor={active ? Palette.blue : Palette.gray300}
                        justifyContent="center"
                        alignItems="center"
                      >
                        <MaterialIcons
                          name={step.icon as any}
                          size={20}
                          color={active ? Palette.white : Palette.gray400}
                        />
                      </Box>
                      <Text
                        fontSize={Type.tiny}
                        fontWeight={active ? '700' : '500'}
                        color={active ? Palette.ink : Palette.gray400}
                      >
                        {step.title}
                      </Text>
                    </VStack>
                  );
                })}
              </HStack>
            </Box>

            {/* ── Step 0: Company Identity ───────────────────────────────── */}
            {currentStep === 0 && (
              <View>
                <Box
                  bg={Palette.white}
                  borderRadius={18}
                  p="$4"
                  borderWidth={1}
                  borderColor={Palette.gray100}
                  shadowColor={Palette.black}
                  shadowOffset={{ width: 0, height: 2 }}
                  shadowOpacity={0.04}
                  shadowRadius={8}
                  elevation={2}
                >
                  <HStack space="md" alignItems="center" mb="$6">
                    <Box style={{ backgroundColor: Palette.blue, borderRadius: 10, padding: 7 }}>
                      <MaterialIcons name="business" size={16} color={Palette.white} />
                    </Box>
                    <Text fontSize={Type.h3} fontWeight="800" color={Palette.ink} letterSpacing={-0.5}>
                      {t('companyProfile.companyIdentity')}
                    </Text>
                  </HStack>

                  <VStack space="lg">
                    <FormControl isInvalid={!!errors.company_name}>
                      <FormControlLabel>
                        <FormControlLabelText>{t('companyProfile.companyName')}</FormControlLabelText>
                      </FormControlLabel>
                      <Controller
                        control={control}
                        name="company_name"
                        render={({ field: { onChange, value } }) => (
                          <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}>
                            <InputField
                              placeholder={t('companyProfile.companyNamePlaceholder')}
                              value={value}
                              onChangeText={onChange}
                            />
                          </Input>
                        )}
                      />
                      {errors.company_name && (
                        <Text fontSize={Type.small} color={Palette.error} mt="$1">
                          {errors.company_name.message}
                        </Text>
                      )}
                    </FormControl>

                    <FormControl isInvalid={!!errors.brn}>
                      <FormControlLabel>
                        <FormControlLabelText>{t('companyProfile.brnLabel')}</FormControlLabelText>
                      </FormControlLabel>
                      <Controller
                        control={control}
                        name="brn"
                        render={({ field: { value } }) => (
                          <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray200} isDisabled>
                            <InputField
                              placeholder={t('companyProfile.brnPlaceholder')}
                              value={value}
                              editable={false}
                              autoCapitalize="characters"
                              style={{ color: Palette.gray500 }}
                            />
                            <Box pr="$3" justifyContent="center">
                              <MaterialIcons name="lock" size={16} color={Palette.gray400} />
                            </Box>
                          </Input>
                        )}
                      />
                      <Text fontSize={Type.caption} color={Palette.gray400} mt="$1">
                        {t('companyProfile.brnNote')}
                      </Text>
                    </FormControl>
                  </VStack>
                </Box>
              </View>
            )}

            {/* ── Step 1: Contact & Operations ──────────────────────────── */}
            {currentStep === 1 && (
              <View>
                <Box
                  bg={Palette.white}
                  borderRadius={18}
                  p="$4"
                  borderWidth={1}
                  borderColor={Palette.gray100}
                  shadowColor={Palette.black}
                  shadowOffset={{ width: 0, height: 2 }}
                  shadowOpacity={0.04}
                  shadowRadius={8}
                  elevation={2}
                >
                  <HStack space="md" alignItems="center" mb="$6">
                    <Box style={{ backgroundColor: Palette.green, borderRadius: 10, padding: 7 }}>
                      <MaterialIcons name="contacts" size={16} color={Palette.white} />
                    </Box>
                    <Text fontSize={Type.h3} fontWeight="800" color={Palette.ink} letterSpacing={-0.5}>
                      {t('companyProfile.contactOps')}
                    </Text>
                  </HStack>

                  <VStack space="lg">
                    <FormControl isInvalid={!!errors.email}>
                      <FormControlLabel>
                        <FormControlLabelText>{t('companyProfile.businessEmail')}</FormControlLabelText>
                      </FormControlLabel>
                      <Controller
                        control={control}
                        name="email"
                        render={({ field: { onChange, value } }) => (
                          <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}>
                            <InputField
                              keyboardType="email-address"
                              autoCapitalize="none"
                              placeholder={t('companyProfile.emailPlaceholder')}
                              value={value}
                              onChangeText={onChange}
                            />
                          </Input>
                        )}
                      />
                      {errors.email && (
                        <Text fontSize={Type.small} color={Palette.error} mt="$1">
                          {errors.email.message}
                        </Text>
                      )}
                    </FormControl>

                    <FormControl>
                      <FormControlLabel>
                        <FormControlLabelText>{t('companyProfile.phoneNumber')}</FormControlLabelText>
                      </FormControlLabel>
                      <Controller
                        control={control}
                        name="phone"
                        render={({ field: { onChange, value } }) => (
                          <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}>
                            <InputField
                              keyboardType="phone-pad"
                              placeholder={t('companyProfile.phonePlaceholder')}
                              value={value}
                              onChangeText={onChange}
                            />
                          </Input>
                        )}
                      />
                    </FormControl>

                    <FormControl>
                      <FormControlLabel>
                        <FormControlLabelText>{t('companyProfile.businessAddress')}</FormControlLabelText>
                      </FormControlLabel>
                      <Controller
                        control={control}
                        name="address"
                        render={({ field: { onChange, value } }) => (
                          <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}>
                            <InputField
                              placeholder={t('companyProfile.addressPlaceholder')}
                              value={value}
                              onChangeText={onChange}
                            />
                          </Input>
                        )}
                      />
                    </FormControl>

                    <FormControl>
                      <FormControlLabel>
                        <FormControlLabelText>{t('companyProfile.vatLabel')} <Text fontSize={Type.caption} color={Palette.gray400}>{t('companyProfile.optional')}</Text></FormControlLabelText>
                      </FormControlLabel>
                      <Controller
                        control={control}
                        name="vat"
                        render={({ field: { onChange, value } }) => (
                          <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}>
                            <InputField
                              placeholder={t('companyProfile.vatPlaceholder')}
                              autoCapitalize="characters"
                              value={value}
                              onChangeText={onChange}
                            />
                          </Input>
                        )}
                      />
                      <Text fontSize={Type.caption} color={Palette.gray400} mt="$1">
                        {t('companyProfile.vatNote')}
                      </Text>
                    </FormControl>

                    <FormControl isInvalid={!!errors.annual_leave_budget}>
                      <FormControlLabel>
                        <FormControlLabelText>{t('companyProfile.leaveBudgetLabel')}</FormControlLabelText>
                      </FormControlLabel>
                      <Controller
                        control={control}
                        name="annual_leave_budget"
                        render={({ field: { onChange, value } }) => (
                          <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}>
                            <InputField
                              keyboardType="numeric"
                              placeholder={t('companyProfile.leaveBudgetPlaceholder')}
                              value={value}
                              onChangeText={onChange}
                            />
                          </Input>
                        )}
                      />
                      {errors.annual_leave_budget && (
                        <Text fontSize={Type.small} color={Palette.error} mt="$1">
                          {errors.annual_leave_budget.message}
                        </Text>
                      )}
                      <Text fontSize={Type.small} color={Palette.gray500} mt="$1">
                        {t('companyProfile.leaveBudgetNote')}
                      </Text>
                    </FormControl>
                  </VStack>
                </Box>
              </View>
            )}

            {/* ── Navigation Buttons ────────────────────────────────────── */}
            <HStack space="md" mt="$8" px="$2">
              {currentStep > 0 && (
                <Button
                  flex={1}
                  variant="outline"
                  borderColor={Palette.gray200}
                  rounded="$2xl"
                  h="$16"
                  onPress={prevStep}
                  isDisabled={isSaving}
                >
                  <ButtonText color={Palette.gray600} fontWeight="700">{t('companyProfile.back')}</ButtonText>
                </Button>
              )}

              {currentStep < steps.length - 1 ? (
                <Button
                  flex={2}
                  bg={Palette.blue}
                  rounded="$2xl"
                  h="$16"
                  onPress={nextStep}
                  shadowColor={Palette.blue}
                  shadowOffset={{ width: 0, height: 4 }}
                  shadowOpacity={0.2}
                  shadowRadius={8}
                  elevation={6}
                >
                  <HStack space="md" alignItems="center">
                    <ButtonText color={Palette.white} fontWeight="700">{t('companyProfile.continue')}</ButtonText>
                    <MaterialIcons name="arrow-forward" size={20} color={Palette.white} />
                  </HStack>
                </Button>
              ) : (
                <Button
                  flex={2}
                  bg={Palette.blue}
                  rounded="$2xl"
                  h="$16"
                  onPress={handleSubmit(onSubmit, () => {
                    Alert.alert(t('companyProfile.incompleteTitle'), t('companyProfile.incompleteBody'));
                  })}
                  isDisabled={isSaving}
                  shadowColor={Palette.blue}
                  shadowOffset={{ width: 0, height: 4 }}
                  shadowOpacity={0.2}
                  shadowRadius={8}
                  elevation={6}
                >
                  <HStack space="md" alignItems="center">
                    {isSaving ? (
                      <ActivityIndicator size="small" color={Palette.white} />
                    ) : (
                      <MaterialIcons name="check-circle" size={20} color={Palette.white} />
                    )}
                    <ButtonText color={Palette.white} fontWeight="700">
                      {isSaving ? t('companyProfile.saving') : t('companyProfile.saveProfile')}
                    </ButtonText>
                  </HStack>
                </Button>
              )}
            </HStack>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}
