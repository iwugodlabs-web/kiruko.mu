import { postSignUpCompany, getCompanyByBrn, getCountries, type Country } from "@/services/api";
import { Palette } from '@/app/constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import {
  Box,
  Button,
  ButtonText,
  Heading,
  HStack,
  Input,
  InputField,
  InputIcon,
  InputSlot,
  Modal,
  ModalBackdrop,
  ModalBody,
  ModalContent,
  ModalFooter,
  SafeAreaView,
  ScrollView,
  Text,
  VStack,
  Spinner
} from "@gluestack-ui/themed";
import { zodResolver } from "@hookform/resolvers/zod";
import * as Haptics from "expo-haptics";
import { BlurView } from 'expo-blur';
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  FileText,
  Globe,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  User,
  Lock,
  Eye,
  EyeOff,
  Building2,
  Briefcase,
  X,
} from "lucide-react-native";
import { MotiView, AnimatePresence } from 'moti';
import React, { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Controller, useForm } from "react-hook-form";
import { Alert, Image, Pressable, Dimensions, StyleSheet, KeyboardAvoidingView, Platform, KeyboardTypeOptions } from "react-native";
import { StandardButton } from "@/app/design-system";
import { z } from "zod";

const { width, height } = Dimensions.get('window');

// Genuinely stable, permanent data (ISO country facts) — not worth fetching
// from the backend or a migration for two entries. If the country list
// grows a lot, that's the trigger to move these onto the Country table.
const COUNTRY_FLAGS: Record<string, string> = { MU: '🇲🇺', TZ: '🇹🇿' };
const COUNTRY_CALLING_CODES: Record<string, string> = { MU: '230', TZ: '255' };

// Password schema
type TFunc = (key: string) => string;

const makePasswordRulesSchema = (t: TFunc) => z.string().refine((val) => {
  if (val.length === 0) return true;
  let score = 0;
  if (val.length >= 6) score++;
  if (/[A-Z]/.test(val)) score++;
  if (/[a-z]/.test(val)) score++;
  if (/\d/.test(val)) score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;
  return score >= 3;
}, {
  message: t("signup.vPasswordRule"),
});

const makeCompanySignupSchema = (t: TFunc) => z
  .object({
    userType: z.string(),
    companyName: z.string().trim().min(1, t("signup.vCompanyName")),
    brn: z.string().trim().min(1, t("signup.vBrn")),
    companyEmail: z.string().min(1, t("signup.vEmailRequired")).email(t("signup.vEmailInvalid")),
    companyPhone: z.string().min(1, t("signup.vPhoneShort")),
    companyAddress: z.string().min(1, t("signup.vAddress")),
    countryCode: z.string().min(1, "Please select a country"),
    vatNumber: z.string().optional(),
    contactPersonName: z.string().min(1, t("signup.vContactName")),
    password: makePasswordRulesSchema(t),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: t("signup.vPasswordsMatch"),
    path: ["confirmPassword"],
  });

type CompanySignupFormData = z.infer<ReturnType<typeof makeCompanySignupSchema>>;

const getPasswordStrength = (password: string) => {
  let score = 0;
  if (password.length >= 6) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (score <= 1) return "Weak";
  if (score === 2 || score === 3) return "Medium";
  return "Strong";
};

const isPasswordValid = (password: string) => {
  if (!password) return false;
  let score = 0;
  if (password.length >= 6) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return score >= 3;
};

// Shared Input Wrapper
const InputFieldWrapper = ({
  icon,
  placeholder,
  name,
  control,
  errors,
  type = "default",
  secureTextEntry = false,
  isDisabled = false,
  children,
}: {
  icon: any;
  placeholder: string;
  name: keyof CompanySignupFormData;
  control: any;
  errors: any;
  type?: KeyboardTypeOptions;
  secureTextEntry?: boolean;
  isDisabled?: boolean;
  children?: React.ReactNode;
}) => (
  <Box w="$full" mb="$4">
    <Controller
      control={control}
      name={name}
      render={({ field: { onChange, onBlur, value } }) => (
        <VStack space="xs">
          <Input
            size="xl"
            variant="rounded"
            bg={isDisabled ? "$backgroundLight50" : "white"}
            borderColor={errors[name] ? "$red500" : "$borderLight200"}
            isDisabled={isDisabled}
            style={styles.inputShadow}
          >
            <InputSlot pl="$4">
              <InputIcon as={icon} size="md" color="$textLight400" />
            </InputSlot>
            <InputField
              placeholder={placeholder}
              autoCapitalize={name.toLowerCase().includes("email") ? "none" : "words"}
              onChangeText={onChange}
              onBlur={onBlur}
              value={value}
              type={secureTextEntry ? "password" : "text"}
              keyboardType={type}
              fontSize="$sm"
              color="$textLight900"
            />
            {children}
          </Input>
          {errors[name] && (
            <Text color="$red600" size="xs" px="$2" fontWeight="$500">
              {errors[name]?.message as string}
            </Text>
          )}
        </VStack>
      )}
    />
  </Box>
);

// Trigger field for the country picker — same visual shell as
// InputFieldWrapper's Input (border/shadow/sizing) so it sits consistently
// among the other fields, but opens a modal instead of a text keyboard.
const CountryPickerField = ({
  value,
  label,
  hasError,
  onPress,
}: {
  value: string | null;
  label: string;
  hasError: boolean;
  onPress: () => void;
}) => (
  <Box w="$full" mb="$4">
    <Pressable onPress={onPress}>
      <Input
        size="xl"
        variant="rounded"
        bg="white"
        borderColor={hasError ? "$red500" : "$borderLight200"}
        style={styles.inputShadow}
        pointerEvents="none"
      >
        <InputSlot pl="$4">
          <InputIcon as={Globe} size="md" color="$textLight400" />
        </InputSlot>
        <InputField
          editable={false}
          placeholder={label}
          value={value ?? ""}
          fontSize="$sm"
          color="$textLight900"
        />
        <InputSlot pr="$4">
          <InputIcon as={ChevronDown} size="sm" color="$textLight400" />
        </InputSlot>
      </Input>
    </Pressable>
  </Box>
);

export default function CompanySignupPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const companySignupSchema = useMemo(() => makeCompanySignupSchema(t), [t]);
  const strengthLabel = (s: string) =>
    s === "Strong" ? t("signup.strengthStrong") : s === "Medium" ? t("signup.strengthMedium") : t("signup.strengthWeak");
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 3;

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isBrnLoading, setIsBrnLoading] = useState(false);
  const [brnExists, setBrnExists] = useState(false);

  const [countries, setCountries] = useState<Country[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(true);
  const [countriesError, setCountriesError] = useState(false);
  const [showCountryModal, setShowCountryModal] = useState(false);

  const loadCountries = async () => {
    setCountriesLoading(true);
    setCountriesError(false);
    const result = await getCountries();
    if ("error" in result) {
      setCountriesError(true);
    } else {
      setCountries(result);
    }
    setCountriesLoading(false);
  };

  useEffect(() => {
    loadCountries();
  }, []);

  const {
    control,
    handleSubmit,
    watch,
    trigger,
    setValue,
    formState: { errors, isValid },
  } = useForm<CompanySignupFormData>({
    resolver: zodResolver(companySignupSchema),
    mode: "onTouched",
    defaultValues: {
      userType: "company",
      companyName: "",
      brn: "",
      companyEmail: "",
      companyPhone: "",
      companyAddress: "",
      countryCode: "",
      vatNumber: "",
      contactPersonName: "",
      password: "",
      confirmPassword: "",
    },
  });

  const watchedBrn = watch("brn");
  const watchedPassword = watch("password") || "";
  const watchedCountryCode = watch("countryCode");
  const watchedPhone = watch("companyPhone") || "";
  const selectedCountry = countries.find((c) => c.code === watchedCountryCode) ?? null;

  // Advisory only — never blocks submission. Only fires once both a country
  // is picked AND the phone was typed with an explicit international prefix
  // (+ or 00) — a bare local-format number is common and deliberately left
  // unchecked either way, rather than guessed at.
  const phoneCountryMismatch = useMemo(() => {
    if (!watchedCountryCode || !watchedPhone) return false;
    const expected = COUNTRY_CALLING_CODES[watchedCountryCode];
    if (!expected) return false;
    const trimmed = watchedPhone.trim();
    let digits: string | null = null;
    if (trimmed.startsWith("+")) digits = trimmed.slice(1);
    else if (trimmed.startsWith("00")) digits = trimmed.slice(2);
    if (digits === null) return false;
    return !digits.startsWith(expected);
  }, [watchedCountryCode, watchedPhone]);

  useEffect(() => {
    // Reset status whenever the BRN changes so stale feedback is cleared immediately
    setBrnExists(false);

    const trimmedBrn = watchedBrn?.trim() ?? '';
    if (!trimmedBrn || trimmedBrn.length < 3) return;

    const lookupBrn = async () => {
      setIsBrnLoading(true);
      try {
        const result: any = await getCompanyByBrn(trimmedBrn);
        if (result.status === "success" && result.data) {
          // Existing company — BRN is taken; auto-fill name so the user can see which company it is
          setValue("companyName", result.data.company_name ?? "");
          setBrnExists(true);
        } else if (result.status === 404) {
          // 404 = BRN not in the system → available to register
          setBrnExists(false);
        } else {
          // Any other non-success response (network issues etc.) — treat as unknown / not blocking
          setBrnExists(false);
        }
      } catch {
        setBrnExists(false);
      } finally {
        setIsBrnLoading(false);
      }
    };

    const timeoutId = setTimeout(lookupBrn, 500);
    return () => clearTimeout(timeoutId);
  }, [watchedBrn]);

  const nextStep = async () => {
    let fieldsToValidate: (keyof CompanySignupFormData)[] = [];
    if (currentStep === 1) fieldsToValidate = ["companyName", "brn", "companyAddress", "countryCode"];
    else if (currentStep === 2) fieldsToValidate = ["contactPersonName", "companyEmail", "companyPhone"];

    const isStepValid = await trigger(fieldsToValidate);
    if (isStepValid) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setCurrentStep(prev => Math.min(prev + 1, totalSteps));
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const prevStep = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCurrentStep(prev => Math.max(prev - 1, 1));
  };

  const onSubmit = async (data: CompanySignupFormData) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setIsSubmitting(true);
      setSubmitError(null);
      const form_data = {
        user_type: data.userType,
        first_name: data.contactPersonName,
        email: data.companyEmail,
        phone: data.companyPhone,
        password_hash: data.password,
        company_data: {
          company_name: data.companyName,
          brn: data.brn.trim(),
          email: data.companyEmail,
          phone: data.companyPhone,
          address: data.companyAddress,
          country_code: data.countryCode,
        },
      };
      const result = await postSignUpCompany(form_data);
      if (result.status === "success") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(t("signup.welcomeTitle"), t("signup.companyWelcomeBody"), [
          { text: t("auth.verifyNow"), onPress: () => router.push({ pathname: "/signup/verify-signup", params: { email: data.companyEmail } }) }
        ]);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        const errorMsg: string = (result as any).error || (result as any).message || t("signup.unableToCreate");
        // If the BRN is already taken, jump back to step 1 so the user can correct it
        if ((result as any).status === 409 || errorMsg.toLowerCase().includes('brn')) {
          setCurrentStep(1);
        }
        setSubmitError(errorMsg);
        Alert.alert(t("signup.signupFailed"), errorMsg);
      }
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      const msg = error.message || t("signup.unexpectedError");
      setSubmitError(msg);
      Alert.alert(t("common.errorTitle"), msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Box flex={1}>
      {/* Immersive Background Blobs */}
      <Box style={StyleSheet.absoluteFill} bg={Palette.gray50}>
        <MotiView
          from={{ opacity: 0.3, scale: 1, translateX: -50 }}
          animate={{ opacity: 0.6, scale: 1.5, translateX: 50 }}
          transition={{ loop: true, type: 'timing', duration: 10000, repeatReverse: true }}
          style={[styles.blob, { backgroundColor: Palette.errorTint, top: '10%', left: '5%' }]}
        />
        <MotiView
          from={{ opacity: 0.2, scale: 1.2, translateY: 50 }}
          animate={{ opacity: 0.5, scale: 1.8, translateY: -50 }}
          transition={{ loop: true, type: 'timing', duration: 12000, repeatReverse: true }}
          style={[styles.blob, { backgroundColor: Palette.blueTint, bottom: '15%', right: '10%' }]}
        />
      </Box>

      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
        >
          <Box px="$6" pt="$6" pb="$2">
            <Image
              source={require("@/assets/images/kiruko-mark.png")}
              style={{ width: 40, height: 40, alignSelf: 'center', resizeMode: 'contain', marginBottom: 12 }}
            />
            <HStack alignItems="center" justifyContent="space-between" mb="$8">
              <Pressable onPress={() => (currentStep > 1 ? prevStep() : router.back())}>
                <Box p="$2.5" bg="white" rounded="$full" style={styles.headerButtonShadow}>
                  <ArrowLeft size={20} color={Palette.gray800} />
                </Box>
              </Pressable>
              <VStack alignItems="center">
                <Heading size="md" fontWeight="800" color={Palette.gray800} style={{ letterSpacing: -0.5 }}>{t("signup.registerCompany")}</Heading>
                <Text size="xs" color="$textLight400" fontWeight="700" style={{ letterSpacing: 1, textTransform: 'uppercase' }}>{t("signup.stepOf", { current: currentStep, total: totalSteps })}</Text>
              </VStack>
              <Box w="$10" />
            </HStack>

            <HStack space="sm" px="$2" mb="$10">
              {[1, 2, 3].map(step => (
                <Box key={step} flex={1} h="$1.5" bg={step <= currentStep ? "$primary600" : "$backgroundLight100"} rounded="$full" />
              ))}
            </HStack>
          </Box>

          <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
            <BlurView intensity={80} tint="light" style={styles.glassCard}>
              <AnimatePresence exitBeforeEnter>
                {currentStep === 1 && (
                  <MotiView
                    key="company"
                    from={{ opacity: 0, scale: 0.98, translateX: -20 }}
                    animate={{ opacity: 1, scale: 1, translateX: 0 }}
                    exit={{ opacity: 0, scale: 0.98, translateX: 20 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 150 }}
                  >
                    <VStack space="lg" w="$full">
                      <VStack space="xs" mb="$4">
                        <Heading size="lg" color={Palette.gray800}>{t("signup.businessIdentity")}</Heading>
                        <Text size="sm" color="$textLight500">{t("signup.businessIdentitySub")}</Text>
                      </VStack>
                      <InputFieldWrapper icon={Briefcase} placeholder={t("signup.companyName")} name="companyName" control={control} errors={errors} />
                      <InputFieldWrapper icon={FileText} placeholder={t("signup.brnRegistration")} name="brn" control={control} errors={errors}>
                        <InputSlot pr="$4">
                          {isBrnLoading ? <Spinner size="small" color="$primary600" /> : brnExists ? <X size={18} color={Palette.errorAlt} /> : watchedBrn.length >= 3 ? <Check size={18} color={Palette.teal} /> : null}
                        </InputSlot>
                      </InputFieldWrapper>
                      {brnExists && (
                        <Text size="xs" color="$red600" px="$2" fontWeight="$500">
                          {t("signup.brnTaken")}
                        </Text>
                      )}
                      {!brnExists && !isBrnLoading && watchedBrn.length >= 3 && (
                        <Text size="xs" color="$green600" px="$2" fontWeight="$500">
                          {t("signup.brnAvailable")}
                        </Text>
                      )}
                      <InputFieldWrapper icon={MapPin} placeholder={t("signup.companyAddress")} name="companyAddress" control={control} errors={errors} />

                      {countriesError ? (
                        <Box w="$full" mb="$4">
                          <Pressable onPress={loadCountries}>
                            <HStack
                              space="sm"
                              alignItems="center"
                              justifyContent="center"
                              p="$3"
                              rounded="$xl"
                              borderWidth={1}
                              borderColor="$red200"
                              bg="$red50"
                            >
                              <RefreshCw size={16} color={Palette.errorAlt} />
                              <Text size="sm" color="$red700" fontWeight="$600">
                                Couldn't load countries — tap to retry
                              </Text>
                            </HStack>
                          </Pressable>
                        </Box>
                      ) : (
                        <CountryPickerField
                          value={selectedCountry ? `${COUNTRY_FLAGS[selectedCountry.code] ?? ''} ${selectedCountry.name}`.trim() : null}
                          label={countriesLoading ? "Loading countries…" : "Select country"}
                          hasError={!!errors.countryCode}
                          onPress={() => { if (!countriesLoading) setShowCountryModal(true); }}
                        />
                      )}
                      {errors.countryCode && (
                        <Text color="$red600" size="xs" px="$2" fontWeight="$500" mt={-12} mb="$3">
                          {errors.countryCode.message as string}
                        </Text>
                      )}

                      <StandardButton.Primary mt="$6" onPress={nextStep} isDisabled={brnExists}>
                        {t("signup.continue")}
                      </StandardButton.Primary>
                    </VStack>
                  </MotiView>
                )}

                {currentStep === 2 && (
                  <MotiView
                    key="contact"
                    from={{ opacity: 0, scale: 0.98, translateX: -20 }}
                    animate={{ opacity: 1, scale: 1, translateX: 0 }}
                    exit={{ opacity: 0, scale: 0.98, translateX: 20 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 150 }}
                  >
                    <VStack space="lg" w="$full">
                      <VStack space="xs" mb="$4">
                        <Heading size="lg" color={Palette.gray800}>{t("signup.contactLiaison")}</Heading>
                        <Text size="sm" color="$textLight500">{t("signup.contactLiaisonSub")}</Text>
                      </VStack>

                      <InputFieldWrapper icon={User} placeholder={t("signup.contactPersonName")} name="contactPersonName" control={control} errors={errors} />
                      <InputFieldWrapper icon={Mail} placeholder={t("signup.companyEmail")} name="companyEmail" type="email-address" control={control} errors={errors} />
                      <InputFieldWrapper icon={Phone} placeholder={t("signup.companyPhone")} name="companyPhone" type="phone-pad" control={control} errors={errors} />
                      {phoneCountryMismatch && selectedCountry && (
                        <Box mt={-12} mb="$4" px="$2">
                          <Text size="xs" color={Palette.gold} fontWeight="$500">
                            This doesn't look like a {selectedCountry.name} number — double-check before continuing.
                          </Text>
                        </Box>
                      )}
                      <InputFieldWrapper icon={FileText} placeholder={t("signup.vatNumber")} name="vatNumber" control={control} errors={errors} />

                      <HStack space="md" mt="$6">
                        <Box flex={1}>
                          <StandardButton.Secondary onPress={prevStep} w="$full">{t("signup.back")}</StandardButton.Secondary>
                        </Box>
                        <Box flex={2}>
                          <StandardButton.Primary onPress={nextStep} w="$full">{t("signup.continue")}</StandardButton.Primary>
                        </Box>
                      </HStack>
                    </VStack>
                  </MotiView>
                )}

                {currentStep === 3 && (
                  <MotiView
                    key="security"
                    from={{ opacity: 0, scale: 0.98, translateX: -20 }}
                    animate={{ opacity: 1, scale: 1, translateX: 0 }}
                    exit={{ opacity: 0, scale: 0.98, translateX: 20 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 150 }}
                  >
                    <VStack space="lg" w="$full">
                      <VStack space="xs" mb="$4">
                        <Heading size="lg" color={Palette.gray800}>{t("signup.accountShield")}</Heading>
                        <Text size="sm" color="$textLight500">{t("signup.accountShieldSub")}</Text>
                      </VStack>

                      <InputFieldWrapper
                        icon={Lock}
                        placeholder={t("signup.portalPassword")}
                        name="password"
                        control={control}
                        errors={errors}
                        secureTextEntry={!showPassword}
                      >
                        <InputSlot pr="$4" onPress={() => setShowPassword(!showPassword)}>
                          <InputIcon as={showPassword ? Eye : EyeOff} size="md" color="$textLight400" />
                        </InputSlot>
                      </InputFieldWrapper>

                      <InputFieldWrapper
                        icon={Lock}
                        placeholder={t("signup.confirmPassword")}
                        name="confirmPassword"
                        control={control}
                        errors={errors}
                        secureTextEntry={!showConfirmPassword}
                      >
                        <InputSlot pr="$4" onPress={() => setShowConfirmPassword(!showConfirmPassword)}>
                          <InputIcon as={showConfirmPassword ? Eye : EyeOff} size="md" color="$textLight400" />
                        </InputSlot>
                      </InputFieldWrapper>

                      {watchedPassword.length > 0 && (
                        <VStack space="xs" px="$2">
                          <HStack justifyContent="space-between">
                            <Text size="xs" color="$textLight500" fontWeight="600">{t("signup.passwordStrength")}</Text>
                            <Text size="xs" color={getPasswordStrength(watchedPassword) === "Strong" ? "$green600" : "$amber600"} fontWeight="700">{strengthLabel(getPasswordStrength(watchedPassword))}</Text>
                          </HStack>
                          <Box h="$1.5" bg="$backgroundLight100" rounded="$full" overflow="hidden">
                            <MotiView
                              animate={{ width: getPasswordStrength(watchedPassword) === "Strong" ? "100%" : "60%", backgroundColor: getPasswordStrength(watchedPassword) === "Strong" ? Palette.teal : Palette.warning }}
                              style={{ height: '100%' }}
                            />
                          </Box>
                        </VStack>
                      )}

                      <HStack space="md" mt="$6">
                        <Box flex={1}>
                          <StandardButton.Secondary onPress={prevStep} w="$full">{t("signup.back")}</StandardButton.Secondary>
                        </Box>
                        <Box flex={2}>
                          <StandardButton.Primary
                            onPress={handleSubmit(onSubmit)}
                            isDisabled={isSubmitting || !isPasswordValid(watchedPassword)}
                            isLoading={isSubmitting}
                            w="$full"
                          >
                            {t("signup.register")}
                          </StandardButton.Primary>
                        </Box>
                      </HStack>
                      {submitError && (
                        <Box mt="$3" p="$3" bg="$red50" rounded="$lg" borderWidth={1} borderColor="$red200">
                          <Text size="xs" color="$red700" fontWeight="$600">{submitError}</Text>
                        </Box>
                      )}
                    </VStack>
                  </MotiView>
                )}
              </AnimatePresence>
            </BlurView>

            <Pressable onPress={() => router.push("/login")} style={{ marginTop: 24 }}>
              <Text size="sm" textAlign="center" color="$textLight500" fontWeight="600">
                {t("signup.alreadyHaveAccount")} <Text color="$primary600" fontWeight="800">{t("signup.logIn")}</Text>
              </Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Country picker — mirrors the currency-picker modal pattern in
          private_dashboard/settings.tsx (flag + name, checkmark on selection). */}
      <Modal isOpen={showCountryModal} onClose={() => setShowCountryModal(false)}>
        <ModalBackdrop />
        <ModalContent maxHeight="85%" rounded="$3xl" overflow="hidden" my="$4" mx="$0" width="100%">
          <ModalBody px="$4" pt="$5" pb="$2">
            <VStack space="xs" mb="$3">
              <Heading size="lg" color={Palette.gray800}>Select Country</Heading>
              <Text size="sm" color="$textLight500">Determines tax rules, currency, and timezone for this company.</Text>
            </VStack>
            <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              <VStack space="sm" pb="$2">
                {countries.map((c) => (
                  <Pressable
                    key={c.code}
                    onPress={() => {
                      setValue("countryCode", c.code, { shouldValidate: true });
                      setShowCountryModal(false);
                    }}
                  >
                    <Box
                      p="$4"
                      rounded="$2xl"
                      bg={watchedCountryCode === c.code ? Palette.goldTint : Palette.white}
                      borderWidth={watchedCountryCode === c.code ? 2 : 1}
                      borderColor={watchedCountryCode === c.code ? Palette.gold : Palette.gray100}
                      style={styles.inputShadow}
                    >
                      <HStack justifyContent="space-between" alignItems="center">
                        <HStack space="md" alignItems="center" flex={1}>
                          <Text fontSize="$2xl">{COUNTRY_FLAGS[c.code] ?? '🌍'}</Text>
                          <VStack flex={1}>
                            <Text fontWeight="700" color={Palette.ink} numberOfLines={1}>{c.name}</Text>
                            <Text fontSize="$xs" color={Palette.gray500}>{c.code} · {c.currency}</Text>
                          </VStack>
                        </HStack>
                        {watchedCountryCode === c.code && (
                          <MaterialIcons name="check-circle" size={22} color={Palette.gold} />
                        )}
                      </HStack>
                    </Box>
                  </Pressable>
                ))}
              </VStack>
            </ScrollView>
          </ModalBody>
          <ModalFooter borderTopWidth={1} borderTopColor={Palette.gray100} px="$4" py="$3">
            <Button flex={1} onPress={() => setShowCountryModal(false)} variant="outline" borderColor={Palette.gold} rounded="$xl">
              <ButtonText color={Palette.gold} fontWeight="600">{t("common.close")}</ButtonText>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  );
}

const styles = StyleSheet.create({
  blob: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
  },
  headerButtonShadow: {
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
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
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.02,
    shadowRadius: 5,
    elevation: 1,
  }
});