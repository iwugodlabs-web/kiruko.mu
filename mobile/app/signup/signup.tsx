import { postSignUpUser, getCompanyByBrn, checkEmailExists } from "@/services/api";
import { Palette } from '@/app/constants/theme';
import { Spinner } from "@gluestack-ui/themed";
import { Building2 } from "lucide-react-native";
import { useEffect } from "react";
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
  SafeAreaView,
  ScrollView,
  Text,
  VStack
} from "@gluestack-ui/themed";
import { zodResolver } from "@hookform/resolvers/zod";
import * as Haptics from "expo-haptics";
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Phone,
  User,
  X
} from "lucide-react-native";
import { MotiView, AnimatePresence } from "moti";
import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Controller, useForm } from "react-hook-form";
import { Alert, Image, Pressable, Dimensions, StyleSheet, KeyboardTypeOptions, KeyboardAvoidingView, Platform } from "react-native";
import { StandardButton } from "@/app/design-system";
import { z } from "zod";

const { width, height } = Dimensions.get('window');

// Validation schema
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

const makeSignupSchema = (t: TFunc) => z
  .object({
    userType: z.string(),
    email: z.string().min(1, t("signup.vEmailRequired")).email(t("signup.vEmailInvalid")),
    firstName: z.string().min(1, t("signup.vFirstName")),
    lastName: z.string().min(1, t("signup.vLastName")),
    phone: z.string().min(1, t("signup.vPhone")),
    companyName: z.string().min(1, t("signup.vCompanyName")),
    brn: z.string().min(1, t("signup.vBrn")),
    password: makePasswordRulesSchema(t),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: t("signup.vPasswordsMatch"),
    path: ["confirmPassword"],
  });

type SignupFormData = z.infer<ReturnType<typeof makeSignupSchema>>;

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
  name: keyof SignupFormData;
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
              autoCapitalize={name === "email" ? "none" : "words"}
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

export default function SignupPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const signupSchema = useMemo(() => makeSignupSchema(t), [t]);
  const strengthLabel = (s: string) =>
    s === "Strong" ? t("signup.strengthStrong") : s === "Medium" ? t("signup.strengthMedium") : t("signup.strengthWeak");
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 3;

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBrnLoading, setIsBrnLoading] = useState(false);
  const [companyFound, setCompanyFound] = useState(false);
  const [emailExists, setEmailExists] = useState(false);
  const [isEmailChecking, setIsEmailChecking] = useState(false);

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    trigger,
    formState: { errors, isValid },
  } = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    mode: "onTouched",
    defaultValues: {
      userType: "private",
      firstName: "",
      lastName: "",
      phone: "",
      email: "",
      password: "",
      confirmPassword: "",
      companyName: "",
      brn: "",
    },
  });

  const watchedBrn = watch("brn");
  const watchedEmail = watch("email") || "";
  const watchedPassword = watch("password") || "";

  useEffect(() => {
    // Don't flip isBrnLoading true on every keystroke — that strobes the
    // spinner and produces visible flicker. Only flip true once the
    // debounce timer actually fires (i.e., user has paused typing).
    if (!watchedBrn || watchedBrn.length < 3) {
      setCompanyFound(false);
      setIsBrnLoading(false);
      return;
    }
    const timeoutId = setTimeout(async () => {
      setIsBrnLoading(true);
      try {
        const result: any = await getCompanyByBrn(watchedBrn);
        if (result.status === "success" && result.data) {
          setValue("companyName", result.data.company_name);
          setCompanyFound(true);
        } else {
          setCompanyFound(false);
        }
      } catch (error: any) {
        console.debug("BRN lookup miss:", error?.message);
        setCompanyFound(false);
      } finally {
        setIsBrnLoading(false);
      }
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [watchedBrn, setValue]);

  useEffect(() => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(watchedEmail)) {
      setEmailExists(false);
      setIsEmailChecking(false);
      return;
    }
    // Same anti-flicker pattern as BRN: spinner only after the debounce.
    const timer = setTimeout(async () => {
      setIsEmailChecking(true);
      try {
        const exists = await checkEmailExists(watchedEmail);
        setEmailExists(exists);
      } finally {
        setIsEmailChecking(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [watchedEmail]);

  const nextStep = async () => {
    let fieldsToValidate: (keyof SignupFormData)[] = [];
    if (currentStep === 1) fieldsToValidate = ["firstName", "lastName", "phone", "email"];
    else if (currentStep === 2) fieldsToValidate = ["brn", "companyName"];

    if (currentStep === 1 && emailExists) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }

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

  const onSubmit = async (data: SignupFormData) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setIsSubmitting(true);
      const user_data = {
        user_type: data.userType,
        first_name: data.firstName,
        last_name: data.lastName,
        email: data.email,
        phone: data.phone,
        password_hash: data.password,
        company_data: { company_name: data.companyName, brn: data.brn },
      };
      const result = await postSignUpUser(user_data);
      if (result.status === "success") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Alert.alert(t("signup.welcomeTitle"), t("signup.verifyEmailSent"), [
          { text: t("auth.verifyNow"), onPress: () => router.push({ pathname: "/signup/verify-signup", params: { email: data.email } }) }
        ]);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert(t("signup.signupFailed"), (result as any).message || t("signup.unableToCreate"));
      }
    } catch (error: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t("common.errorTitle"), error.message || t("signup.unexpectedError"));
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
                <Heading size="md" fontWeight="800" color={Palette.gray800} style={{ letterSpacing: -0.5 }}>{t("signup.joinBrand")}</Heading>
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
                    key="personal"
                    from={{ opacity: 0, scale: 0.98, translateX: -20 }}
                    animate={{ opacity: 1, scale: 1, translateX: 0 }}
                    exit={{ opacity: 0, scale: 0.98, translateX: 20 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 150 }}
                  >
                    <VStack space="lg" w="$full">
                      <VStack space="xs" mb="$4">
                        <Heading size="lg" color={Palette.gray800}>{t("signup.accountDetails")}</Heading>
                        <Text size="sm" color="$textLight500">{t("signup.accountDetailsSub")}</Text>
                      </VStack>
                      <InputFieldWrapper icon={User} placeholder={t("signup.firstName")} name="firstName" control={control} errors={errors} />
                      <InputFieldWrapper icon={User} placeholder={t("signup.lastName")} name="lastName" control={control} errors={errors} />
                      <InputFieldWrapper icon={Phone} placeholder={t("signup.phoneNumber")} name="phone" type="phone-pad" control={control} errors={errors} />
                      <InputFieldWrapper icon={Mail} placeholder={t("signup.email")} name="email" type="email-address" control={control} errors={errors}>
                        <InputSlot pr="$4">
                          {isEmailChecking ? <Spinner size="small" color="$primary600" /> : emailExists ? <X size={18} color={Palette.errorAlt} /> : watchedEmail.includes('@') && !emailExists ? <Check size={18} color={Palette.teal} /> : null}
                        </InputSlot>
                      </InputFieldWrapper>
                      {emailExists && (
                        <Box mt="-$2" mb="$2" px="$2">
                          <Text color="$red600" size="xs" fontWeight="$500">{t("signup.emailRegistered")}</Text>
                        </Box>
                      )}
                      <StandardButton.Primary mt="$6" onPress={nextStep}>
                        {t("signup.continue")}
                      </StandardButton.Primary>
                    </VStack>
                  </MotiView>
                )}

                {currentStep === 2 && (
                  <MotiView
                    key="work"
                    from={{ opacity: 0, scale: 0.98, translateX: -20 }}
                    animate={{ opacity: 1, scale: 1, translateX: 0 }}
                    exit={{ opacity: 0, scale: 0.98, translateX: 20 }}
                    transition={{ type: 'spring', damping: 20, stiffness: 150 }}
                  >
                    <VStack space="lg" w="$full">
                      <VStack space="xs" mb="$4">
                        <Heading size="lg" color={Palette.gray800}>{t("signup.workVerification")}</Heading>
                        <Text size="sm" color="$textLight500">{t("signup.workVerificationSub")}</Text>
                      </VStack>

                      <InputFieldWrapper icon={Building2} placeholder={t("signup.brnNumber")} name="brn" control={control} errors={errors}>
                        <InputSlot pr="$4">
                          {isBrnLoading ? <Spinner size="small" color="$primary600" /> : companyFound ? <Check size={18} color={Palette.teal} /> : null}
                        </InputSlot>
                      </InputFieldWrapper>

                      <InputFieldWrapper
                        icon={Building2}
                        placeholder={t("signup.companyName")}
                        name="companyName"
                        control={control}
                        errors={errors}
                        isDisabled={companyFound}
                      />

                      <HStack space="md" mt="$6">
                        <StandardButton.Secondary
                          flex={1}
                          onPress={prevStep}
                        >
                          {t("signup.back")}
                        </StandardButton.Secondary>
                        <StandardButton.Primary
                          flex={2}
                          onPress={nextStep}
                        >
                          {t("signup.continue")}
                        </StandardButton.Primary>
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
                        <Heading size="lg" color={Palette.gray800}>{t("signup.secureAccount")}</Heading>
                        <Text size="sm" color="$textLight500">{t("signup.secureAccountSub")}</Text>
                      </VStack>

                      <InputFieldWrapper
                        icon={Lock}
                        placeholder={t("signup.password")}
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
                          <StandardButton.Secondary
                            onPress={prevStep}
                            w="$full"
                          >
                            {t("signup.back")}
                          </StandardButton.Secondary>
                        </Box>
                        <Box flex={2}>
                          <StandardButton.Primary
                            onPress={handleSubmit(onSubmit)}
                            isDisabled={isSubmitting || !isPasswordValid(watchedPassword)}
                            w="$full"
                          >
                            {t("signup.register")}
                          </StandardButton.Primary>
                        </Box>
                      </HStack>
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