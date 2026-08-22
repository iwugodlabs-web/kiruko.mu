import { getUserDetail } from '@/services/api';
import { Palette, Type } from '@/app/constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import { Box, Button, ButtonText, Checkbox, CheckboxIcon, CheckboxIndicator, CheckboxLabel, FormControl, FormControlError, FormControlErrorIcon, FormControlErrorText, FormControlLabel, FormControlLabelText, HStack, Heading, Input, InputField, Select, SelectBackdrop, SelectContent, SelectInput, SelectItem, SelectPortal, SelectTrigger, Text, Textarea, TextareaInput, VStack } from '@gluestack-ui/themed';
import { zodResolver } from '@hookform/resolvers/zod';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ActivityIndicator } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Check } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { Alert, TouchableOpacity as RNTouchableOpacity, ScrollView, StyleSheet, Platform, Modal, View, Pressable, KeyboardAvoidingView } from 'react-native';
import Animated, { FadeInUp, FadeIn, FadeOut, SlideInRight, SlideOutLeft, useSharedValue, useAnimatedStyle, withTiming } from '@/app/utils/animated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import { submitUserRightReport, getUsersByCompany, getCompanyManagers } from '../../services/api';
import useAuth from '../hooks/useAuth';
import { PremiumHeader } from '@/components/PremiumHeader';
import { useTranslation } from 'react-i18next';

// Zod schema for rights report form

const KnowYourRightSchema = z.object({
  title: z.string({ required_error: 'Title is required' }).nonempty({ message: 'Title is required' }).min(5, { message: 'Title must be at least 5 characters' }),
  category: z.string({ required_error: 'Category is required' }).nonempty({ message: 'Category is required' }),
  description: z.string().optional(),
  otherDescription: z.string().optional(),
  preferredContact: z.enum(['email', 'phone', 'in-app'], { required_error: 'Preferred contact method is required' }),
  consentTerms: z.boolean().refine(val => val === true, { message: 'You must agree to the terms and conditions.' }),
  acknowledgeAccuracy: z.boolean().refine(val => val === true, { message: 'You must acknowledge the information is accurate.' }),
  incidentDate: z.string({ required_error: 'Date of incident is required' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.'),
  incidentTime: z.string({ required_error: 'Time of incident is required' }).regex(/^\d{2}:\d{2}$/, 'Time must be in HH:MM format.'),
  previousOccurrence: z.enum(['yes', 'no'], { required_error: 'Please indicate if this has occurred before.' }),
  previousDetails: z.string().optional(),
  urgency: z.enum(['low', 'medium', 'high'], { required_error: 'Please select urgency level.' }),
  resolutionMethod: z.enum(['email', 'phone', 'in-app'], { required_error: 'Preferred resolution method is required.' }),
  consentFollowUp: z.boolean().refine(val => val === true, { message: 'You must consent to follow-up.' }),
  expectedOutcome: z.string().min(5, { message: 'Expected outcome is required and must be at least 5 characters.' }),
  // Plan Phase 11 Step 4 — when true, route this report to an external
  // compliance officer; the employer never sees the content. Defaults to
  // false so the standard "tell my employer" flow is unchanged.
  fileExternally: z.boolean().optional().default(false),
  // Plan Phase 11 Step 6 — when true, mask employee identity on company-side
  // reads. Compliance officers + platform admins still see identity.
  isAnonymous: z.boolean().optional().default(false),
  // M4 — admins/employees implicated in this report. If any named party is a
  // company admin, the backend auto-escalates the case to Kiruko Compliance.
  // Capped at 5; UI also enforces this.
  namedParties: z.array(z.object({ user_id: z.number(), label: z.string() })).max(5).optional(),
  // #6 — managers/HR (from the company role page) to route this report to.
  sendTo: z.array(z.object({ user_id: z.number(), label: z.string() })).max(5).optional(),
})
  .superRefine((data, ctx) => {
    if (data.category === 'other' && (!data.otherDescription || data.otherDescription.length < 10)) {
      ctx.addIssue({ code: 'custom', message: 'Please specify your issue (at least 10 characters).', path: ['otherDescription'] });
    }
    if (data.previousOccurrence === 'yes') {
      if (!data.previousDetails || data.previousDetails.length < 5) {
        ctx.addIssue({ code: 'custom', message: 'Please provide details of previous occurrences (at least 5 characters).', path: ['previousDetails'] });
      }
    }
  });


type KnowYourRightFormData = z.infer<typeof KnowYourRightSchema>;

// A taggable colleague / manager, enriched for the inline profile-preview card.
type Person = {
  user_id: number;
  label: string;
  role?: string;
  department?: string;
  initials: string;
};

const KnowYourRight = () => {
  const [currentStep, setCurrentStep] = useState(0);
  // Loading state for user details (similar to home.tsx)
  const [isLoading, setIsLoading] = useState(true);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const { user } = useAuth();
  const router = useRouter();
  // Optional prefill (e.g. "Raise a query" from a payslip seeds title/category/
  // description so the employee lands on a partly-filled concern form).
  const prefill = useLocalSearchParams<{ prefillTitle?: string; prefillCategory?: string; prefillDescription?: string; prefillRunId?: string; prefillPayslipId?: string }>();
  const asStr = (v: unknown) => (typeof v === 'string' ? v : '');
  const { t } = useTranslation();
  useEffect(() => {
    const loadUserDetails = async () => {
      setIsLoading(true);
      if (!user?.user_id) {
        setIsLoading(false);
        return;
      }
      const userInfo = await getUserDetail(user?.user_id);
      setUserDetails(userInfo);
      setIsLoading(false);
    };
    loadUserDetails();
  }, [user]);
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [userDetails, setUserDetails] = useState<any>(null);
  // M4 — company users for the named_parties picker
  const [companyUsers, setCompanyUsers] = useState<Person[]>([]);
  // Managers / HR / admins (from the company role page) the worker can route the report to.
  const [companyManagers, setCompanyManagers] = useState<Person[]>([]);
  // Inline profile preview card (tap a person's ⓘ) — no navigation, employee
  // app has no view-other-profile route. Shows name / role / department.
  const [previewUser, setPreviewUser] = useState<Person | null>(null);

  useEffect(() => {
    // Resolve company_id from user / userDetails and fetch the user lists once.
    const companyId =
      (user as any)?.company?.company_id ??
      (user as any)?.private_user?.company_id ??
      (userDetails as any)?.company?.company_id ??
      undefined;
    if (!companyId) return;
    const mapUsers = (res: any): Person[] =>
      Array.isArray(res)
        ? res
            .map((u: any): Person => {
              const first = u?.private_user?.first_name || '';
              const last = u?.private_user?.last_name || '';
              const label = `${first} ${last}`.trim() || u?.email || `User #${u?.user_id}`;
              // Role: prefer the company role label, then job title, then legacy scalar.
              const role =
                u?.company_roles?.[0] ||
                u?.private_user?.jobs?.[0]?.job_title ||
                u?.private_user?.role ||
                undefined;
              const department = u?.private_user?.department?.name || undefined;
              const initials =
                `${first.charAt(0)}${last.charAt(0)}`.trim().toUpperCase() ||
                label.charAt(0).toUpperCase();
              return { user_id: Number(u?.user_id), label, role, department, initials };
            })
            .filter((u) => !!u.user_id)
        : [];
    (async () => {
      setCompanyUsers(mapUsers(await getUsersByCompany(Number(companyId))));
      setCompanyManagers(mapUsers(await getCompanyManagers(Number(companyId))));
    })();
  }, [user, userDetails]);

  const form = useForm<KnowYourRightFormData>({
    resolver: zodResolver(KnowYourRightSchema) as any,
    mode: 'onChange',
    defaultValues: {
      title: asStr(prefill.prefillTitle),
      category: asStr(prefill.prefillCategory),
      description: asStr(prefill.prefillDescription),
      otherDescription: '',
      preferredContact: undefined,
      consentTerms: false,
      acknowledgeAccuracy: false,
      incidentDate: '',
      incidentTime: '',
      previousOccurrence: undefined,
      previousDetails: '',
      urgency: undefined,
      resolutionMethod: undefined,
      consentFollowUp: false,
      expectedOutcome: '',
      fileExternally: false,
      isAnonymous: false,
      namedParties: [],
      sendTo: [],
    }
  });
  const { control, reset, handleSubmit, formState: { errors, isValid, isSubmitting }, watch, setValue, trigger } = form;
  const category = watch('category');
  const previousOccurrence = watch('previousOccurrence');

  const nextStep = async () => {
    let fieldsToValidate: any[] = [];
    if (currentStep === 0) fieldsToValidate = ['title', 'category', 'description', 'otherDescription', 'expectedOutcome'];
    if (currentStep === 1) fieldsToValidate = ['incidentDate', 'incidentTime', 'previousOccurrence', 'previousDetails'];
    if (currentStep === 2) fieldsToValidate = ['urgency', 'preferredContact', 'resolutionMethod'];

    const isStepValid = await trigger(fieldsToValidate as any);
    if (isStepValid) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setCurrentStep((prev) => prev + 1);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const prevStep = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCurrentStep((prev) => prev - 1);
  };

  // Tap a step in the header to jump there (like the profile screen). Going back
  // to a visited/current step is free; advancing one step runs the same
  // validation as the Next button; skipping further ahead is ignored (the
  // intermediate steps can't be validated yet).
  const goToStep = (index: number) => {
    if (index === currentStep) return;
    if (index < currentStep) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setCurrentStep(index);
    } else if (index === currentStep + 1) {
      nextStep();
    }
  };


  // Mock API call for rights report submission
  const submitRightsReport = async (data: KnowYourRightFormData) => {
    console.log('Submitting rights report:', { data, file });

    const privateUserId = user?.private_user_id ? Number(user.private_user_id) : 0;
    if (privateUserId <= 0) {
      Alert.alert('Error', 'User ID is missing. Please log in again or contact support.');
      return;
    }

    try {
      const formData = new FormData();

      // NOTE: The `submitUserComplaint` function in `services/api.ts` must be adapted
      // to send this `formData` with a 'multipart/form-data' header.
      formData.append('private_user_id', String(privateUserId));
      formData.append('title', data.title);
      formData.append('category', data.category);
      formData.append('issue_description', data.description || data.otherDescription || '');
      formData.append('contact_method', data.preferredContact);
      formData.append('previous_occurence', String(data.previousOccurrence === 'yes'));
      formData.append('date_of_occurrence', data.incidentDate);
      formData.append('time', data.incidentTime);
      formData.append('occurrence_description', data.previousDetails || '');
      formData.append('urgency_level', data.urgency);
      formData.append('resolution_method', data.resolutionMethod);
      formData.append('accept_terms_and_conditions', String(data.consentTerms));
      formData.append('acknowledge_information', String(data.acknowledgeAccuracy));
      formData.append('agreed_to_be_contacted', String(data.consentFollowUp));
      formData.append('status', 'pending');
      formData.append('expected_outcome', data.expectedOutcome || '');
      // Structural payroll link when this concern was raised from a payslip.
      const runId = asStr(prefill.prefillRunId);
      const payslipId = asStr(prefill.prefillPayslipId);
      if (runId) formData.append('payroll_run_id', runId);
      if (payslipId) formData.append('payslip_id', payslipId);
      // Plan Phase 11 Step 4 + Step 6 — channel + anonymity. Sent verbatim;
      // backend normalises 'external'/'internal' and coerces is_anonymous.
      formData.append('channel', data.fileExternally ? 'external' : 'internal');
      formData.append('is_anonymous', String(!!data.isAnonymous));
      // M4 — named parties (max 5, validated by zod + server). Sent as JSON
      // string; the backend parses it back. Empty array is omitted to keep
      // the legacy submission shape backwards-compatible.
      if (data.namedParties && data.namedParties.length > 0) {
        formData.append('named_parties', JSON.stringify(data.namedParties));
      }

      // #6 — route the report to chosen managers/HR (comma-separated user_ids).
      if (data.sendTo && data.sendTo.length > 0) {
        formData.append('send_to', data.sendTo.map((p) => p.user_id).join(','));
      }

      if (file) {
        formData.append('attachment', { uri: file.uri, name: file.name, type: file.mimeType || 'application/octet-stream' } as any);
      }

      const res = await submitUserRightReport(formData);

      if (res && res.status === 'success') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const reportId = (res as any)?.data?.right_id ?? '—';
        const isExternal = !!data.fileExternally;
        // M3 — the backend now returns a one-time PIN in case_access.{pin, case_id}.
        // Route to the PIN screen so the reporter can save it before navigating
        // away. Falls back to legacy alert + history if the PIN is missing
        // (backwards-compat against a backend that hasn't shipped M2 yet).
        const caseAccess = (res as any)?.case_access;
        if (caseAccess?.pin && caseAccess?.case_id) {
          reset();
          setFile(null);
          router.replace({
            pathname: '/private_dashboard/your_right_pin',
            params: {
              case_id: String(caseAccess.case_id),
              pin: String(caseAccess.pin),
              channel: isExternal ? 'external' : 'internal',
            },
          });
          return;
        }
        Alert.alert(
          isExternal ? 'External report submitted' : 'Report submitted',
          isExternal
            ? `Your report #${reportId} was sent to the platform compliance officers. Your employer cannot see this report. You will be notified when it is reviewed.`
            : `Your report #${reportId} has been sent to your employer. They have 5 working days to respond. You will be notified when the status changes.`,
          [
            {
              text: 'View history',
              onPress: () => router.replace('/private_dashboard/your_right_history'),
            },
          ],
        );
        reset();
        setFile(null);
      }
      else {
        const errorMessage = (res as any)?.error || (res as any)?.message || 'Failed to submit complaint. Please try again.';
        Alert.alert('Error', errorMessage);
      }
    } catch (error) {
      console.error('Complaint submission error:', error);
      Alert.alert('Error', 'Failed to submit complaint. Please try again.');
    }
  }

  // File picker handler
  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: false,
      });

      console.log('Document picker result:', result);

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const selectedFile = result.assets[0];
        console.log('Selected file:', selectedFile);
        setFile(selectedFile);
      } else {
        console.log('File selection was canceled or failed');
      }
    } catch (error) {
      console.error('Error picking file:', error);
      Alert.alert('Error', 'Failed to pick file. Please try again.');
    }
  };

  const steps = [
    { title: t('yourRightsForm.stepEssentials'), icon: 'edit-note' },
    { title: t('yourRightsForm.stepTimeline'),   icon: 'event' },
    { title: t('yourRightsForm.stepResponse'),   icon: 'contact-phone' },
    { title: t('yourRightsForm.stepFinalize'),   icon: 'attach-file' },
  ];

  const stepperLineStyle = useAnimatedStyle(() => ({
    width: withTiming(`${(currentStep / (steps.length - 1)) * 80}%`),
  }));

  const renderStepper = () => (
    <Box mb="$8" px="$2">
      <HStack justifyContent="space-between" alignItems="center" position="relative">
        <Box
          position="absolute"
          top="40%"
          left="10%"
          right="10%"
          h={2}
          bg={Palette.gray200}
          zIndex={-1}
        />
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: '40%',
              left: '10%',
              height: 2,
              backgroundColor: Palette.gold,
              zIndex: -1,
            },
            stepperLineStyle
          ]}
        />

        {steps.map((step, index) => {
          const isActive = index <= currentStep;
          const isCurrent = index === currentStep;
          // Tappable when going back to a visited step or advancing exactly one.
          const isTappable = index <= currentStep + 1;
          return (
            <Pressable
              key={index}
              onPress={() => goToStep(index)}
              disabled={!isTappable}
              style={{ flex: 1 }}
              accessibilityRole="tab"
              accessibilityState={{ selected: isCurrent }}
              accessibilityLabel={step.title}
            >
              <VStack alignItems="center" space="xs">
                <Box
                  w={40}
                  h={40}
                  rounded="$full"
                  bg={isActive ? Palette.gold : Palette.white}
                  borderWidth={2}
                  borderColor={isActive ? Palette.gold : Palette.gray300}
                  justifyContent="center"
                  alignItems="center"
                  shadowColor={isCurrent ? Palette.gold : 'transparent'}
                  shadowOffset={{ width: 0, height: 4 }}
                  shadowOpacity={0.3}
                  shadowRadius={8}
                  elevation={isCurrent ? 6 : 0}
                >
                  <MaterialIcons
                    name={step.icon as any}
                    size={20}
                    color={isActive ? Palette.white : Palette.gray400}
                  />
                </Box>
                <Text
                  fontSize={Type.tiny}
                  fontWeight={isActive ? '700' : '500'}
                  color={isActive ? Palette.ink : Palette.gray400}
                >
                  {step.title}
                </Text>
              </VStack>
            </Pressable>
          );
        })}
      </HStack>
    </Box>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.white }}>
      <PremiumHeader
        title={t('yourRightsForm.pageTitle')}
        onBack={() => router.replace('/private_dashboard/settings')}
        zIndex={100}
        rightElement={
          <RNTouchableOpacity
            onPress={() => router.push('/private_dashboard/your_right_history')}
            style={styles.historyButton}
          >
            <MaterialIcons name="history" size={24} color={Palette.gold} />
          </RNTouchableOpacity>
        }
      />
      {/* Decorative Background Elements */}
      <Box position="absolute" top={-50} right={-50} w={200} h={200} rounded="$full" bg={Palette.goldTint} />
      <Box position="absolute" bottom={-100} left={-50} w={300} h={300} rounded="$full" bg={Palette.blueTint} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 10, paddingBottom: 160, paddingHorizontal: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Step Indicator Text */}
        <VStack space="xs" mb="$6" px="$2">
          <Text fontSize={Type.body} color={Palette.gray500} fontWeight="700" letterSpacing={-0.2}>Step {currentStep + 1} of {steps.length}: {steps[currentStep].title}</Text>
        </VStack>

        {/* Stepper */}
        {renderStepper()}

        <Box minHeight={450}>
          {/* Step 0: Essentials */}
          {currentStep === 0 && (
            <View>
              <Box bg={Palette.white} borderRadius={18} borderWidth={1} borderColor={Palette.gray100} p="$6" shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={8} elevation={2}>
                <HStack space="md" alignItems="center" mb="$6">
                  <Box bg={Palette.blue} borderRadius={10} p={7}><MaterialIcons name="edit-note" size={16} color={Palette.white} /></Box>
                  <Heading fontSize={Type.h2} fontWeight="800" color={Palette.ink} letterSpacing={-0.5}>{t('yourRightsForm.sectionDefineIssue')}</Heading>
                </HStack>

                <VStack space="lg">
                  <FormControl isInvalid={!!errors.title}>
                    <FormControlLabel><FormControlLabelText>{t('yourRightsForm.labelReportTitle')}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="title" render={({ field: { onChange, onBlur, value } }) => (
                      <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}>
                        <InputField placeholder={t('yourRightsForm.placeholderReportTitle')} onChangeText={onChange} onBlur={onBlur} value={value} />
                      </Input>
                    )} />
                    <FormControlError><FormControlErrorText>{errors.title?.message}</FormControlErrorText></FormControlError>
                  </FormControl>

                  <FormControl isInvalid={!!errors.category}>
                    <FormControlLabel><FormControlLabelText>{t('yourRightsForm.labelCategory')}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="category" render={({ field: { onChange, value } }) => (
                      <Select selectedValue={value} onValueChange={onChange}>
                        <SelectTrigger size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}><SelectInput placeholder={t('yourRightsForm.placeholderSelectCategory')} /></SelectTrigger>
                        <SelectPortal><SelectBackdrop /><SelectContent>
                          <SelectItem label={t('yourRightsForm.categoryPayroll')} value="payroll" />
                          <SelectItem label={t('yourRightsForm.categoryAttendance')} value="attendance" />
                          <SelectItem label={t('yourRightsForm.categoryExpense')} value="expense" />
                          <SelectItem label={t('yourRightsForm.categoryPerformance')} value="performance" />
                          <SelectItem label={t('yourRightsForm.categoryOther')} value="other" />
                        </SelectContent></SelectPortal>
                      </Select>
                    )} />
                    <FormControlError><FormControlErrorText>{errors.category?.message}</FormControlErrorText></FormControlError>
                  </FormControl>

                  {category === 'other' ? (
                    <FormControl isInvalid={!!errors.otherDescription}>
                      <FormControlLabel><FormControlLabelText>{t('yourRightsForm.labelSpecifyIssue')}</FormControlLabelText></FormControlLabel>
                      <Controller control={control} name="otherDescription" render={({ field: { onChange, onBlur, value } }) => (
                        <Textarea size="lg" rounded="$xl" bg={Palette.gray50}><TextareaInput placeholder={t('yourRightsForm.placeholderDescribeIssue')} value={value} onChangeText={onChange} onBlur={onBlur} /></Textarea>
                      )} />
                      <FormControlError><FormControlErrorText>{errors.otherDescription?.message}</FormControlErrorText></FormControlError>
                    </FormControl>
                  ) : (
                    <FormControl isInvalid={!!errors.description}>
                      <FormControlLabel><FormControlLabelText>{t('yourRightsForm.labelDescription')}</FormControlLabelText></FormControlLabel>
                      <Controller control={control} name="description" render={({ field: { onChange, onBlur, value } }) => (
                        <Textarea size="lg" rounded="$xl" bg={Palette.gray50}><TextareaInput placeholder={t('yourRightsForm.placeholderDetailedDescription')} value={value} onChangeText={onChange} onBlur={onBlur} /></Textarea>
                      )} />
                      <FormControlError><FormControlErrorText>{errors.description?.message}</FormControlErrorText></FormControlError>
                    </FormControl>
                  )}

                  <FormControl isInvalid={!!errors.expectedOutcome}>
                    <FormControlLabel><FormControlLabelText>{t('yourRightsForm.labelExpectedOutcome')}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="expectedOutcome" render={({ field: { onChange, onBlur, value } }) => (
                      <Textarea size="lg" rounded="$xl" bg={Palette.gray50}><TextareaInput placeholder={t('yourRightsForm.placeholderExpectedOutcome')} value={value} onChangeText={onChange} onBlur={onBlur} /></Textarea>
                    )} />
                    <FormControlError><FormControlErrorText>{errors.expectedOutcome?.message}</FormControlErrorText></FormControlError>
                  </FormControl>

                  {/* M4 — named_parties picker. Tap a colleague to add/remove
                      them from the report. If a named party is a company
                      admin, the case auto-escalates to Kiruko so they can't
                      see the case against themselves. */}
                  <Controller
                    control={control}
                    name="namedParties"
                    render={({ field: { onChange, value } }) => {
                      const selected = value || [];
                      const selectedIds = new Set(selected.map((p) => p.user_id));
                      const atCap = selected.length >= 5;
                      const toggle = (u: { user_id: number; label: string }) => {
                        if (selectedIds.has(u.user_id)) {
                          onChange(selected.filter((p) => p.user_id !== u.user_id));
                        } else if (!atCap) {
                          onChange([...selected, u]);
                        }
                      };
                      return (
                        <VStack space="xs">
                          <FormControlLabel>
                            <FormControlLabelText>
                              Who is this about? (optional, max 5)
                            </FormControlLabelText>
                          </FormControlLabel>
                          <Text fontSize={Type.caption} color={Palette.gray500}>
                            If you name an admin who would normally see this report, it will be sent to Kiruko Compliance instead. Selected: {selected.length}/5
                          </Text>
                          {companyUsers.length === 0 ? (
                            <Text fontSize={Type.small} color={Palette.gray400} italic>
                              Loading colleagues…
                            </Text>
                          ) : (
                            <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                              {companyUsers.map((u) => {
                                const isSelected = selectedIds.has(u.user_id);
                                return (
                                  <Box
                                    key={u.user_id}
                                    bg={isSelected ? Palette.blue : Palette.gray50}
                                    borderColor={isSelected ? Palette.blue : Palette.gray200}
                                    borderWidth={1}
                                    rounded="$full"
                                    opacity={atCap && !isSelected ? 0.4 : 1}
                                    style={{ flexDirection: 'row', alignItems: 'center' }}
                                  >
                                    {/* Name → toggles selection */}
                                    <Pressable
                                      onPress={() => toggle(u)}
                                      disabled={atCap && !isSelected}
                                      style={{ paddingLeft: 12, paddingRight: 4, paddingVertical: 6 }}
                                    >
                                      <Text
                                        fontSize={Type.small}
                                        fontWeight="600"
                                        color={isSelected ? Palette.white : Palette.gray700}
                                      >
                                        {isSelected ? '✓ ' : ''}{u.label}
                                      </Text>
                                    </Pressable>
                                    {/* ⓘ → inline profile preview (no navigation) */}
                                    <Pressable
                                      onPress={() => setPreviewUser(u)}
                                      hitSlop={8}
                                      style={{ paddingRight: 10, paddingLeft: 2, paddingVertical: 6 }}
                                    >
                                      <MaterialIcons
                                        name="info-outline"
                                        size={15}
                                        color={isSelected ? Palette.white : Palette.gray500}
                                      />
                                    </Pressable>
                                  </Box>
                                );
                              })}
                            </Box>
                          )}
                        </VStack>
                      );
                    }}
                  />

                  {/* #6 — route the report to a manager / HR (from the company role
                      page). These handlers are notified in addition to normal routing. */}
                  <Controller
                    control={control}
                    name="sendTo"
                    render={({ field: { onChange, value } }) => {
                      const selected = value || [];
                      const selectedIds = new Set(selected.map((p) => p.user_id));
                      const atCap = selected.length >= 5;
                      const toggle = (u: { user_id: number; label: string }) => {
                        if (selectedIds.has(u.user_id)) {
                          onChange(selected.filter((p) => p.user_id !== u.user_id));
                        } else if (!atCap) {
                          onChange([...selected, u]);
                        }
                      };
                      return (
                        <VStack space="xs">
                          <FormControlLabel>
                            <FormControlLabelText>
                              Send to manager / HR (optional, max 5)
                            </FormControlLabelText>
                          </FormControlLabel>
                          <Text fontSize={Type.caption} color={Palette.gray500}>
                            They'll be notified to review your report. Selected: {selected.length}/5
                          </Text>
                          {companyManagers.length === 0 ? (
                            <Text fontSize={Type.small} color={Palette.gray400} italic>
                              No managers/HR available
                            </Text>
                          ) : (
                            <Box style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                              {companyManagers.map((u) => {
                                const isSelected = selectedIds.has(u.user_id);
                                return (
                                  <Box
                                    key={u.user_id}
                                    bg={isSelected ? Palette.teal : Palette.gray50}
                                    borderColor={isSelected ? Palette.teal : Palette.gray200}
                                    borderWidth={1}
                                    rounded="$full"
                                    opacity={atCap && !isSelected ? 0.4 : 1}
                                    style={{ flexDirection: 'row', alignItems: 'center' }}
                                  >
                                    {/* Name → toggles selection */}
                                    <Pressable
                                      onPress={() => toggle(u)}
                                      disabled={atCap && !isSelected}
                                      style={{ paddingLeft: 12, paddingRight: 4, paddingVertical: 6 }}
                                    >
                                      <Text
                                        fontSize={Type.small}
                                        fontWeight="600"
                                        color={isSelected ? Palette.white : Palette.gray700}
                                      >
                                        {isSelected ? '✓ ' : ''}{u.label}
                                      </Text>
                                    </Pressable>
                                    {/* ⓘ → inline profile preview (no navigation) */}
                                    <Pressable
                                      onPress={() => setPreviewUser(u)}
                                      hitSlop={8}
                                      style={{ paddingRight: 10, paddingLeft: 2, paddingVertical: 6 }}
                                    >
                                      <MaterialIcons
                                        name="info-outline"
                                        size={15}
                                        color={isSelected ? Palette.white : Palette.gray500}
                                      />
                                    </Pressable>
                                  </Box>
                                );
                              })}
                            </Box>
                          )}
                        </VStack>
                      );
                    }}
                  />
                </VStack>
              </Box>
            </View>
          )}

          {/* Step 1: Timeline */}
          {currentStep === 1 && (
            <View>
              <Box bg={Palette.white} borderRadius={18} borderWidth={1} borderColor={Palette.gray100} p="$6" shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={8} elevation={2}>
                <HStack space="md" alignItems="center" mb="$6">
                  <Box bg={Palette.teal} borderRadius={10} p={7}><MaterialIcons name="event" size={16} color={Palette.white} /></Box>
                  <Heading fontSize={Type.h2} fontWeight="800" color={Palette.ink} letterSpacing={-0.5}>{t('yourRightsForm.sectionOccurrence')}</Heading>
                </HStack>

                <VStack space="lg">
                  <FormControl isInvalid={!!errors.incidentDate}>
                    <FormControlLabel><FormControlLabelText>{t('yourRightsForm.labelDateOfIncident')}</FormControlLabelText></FormControlLabel>
                    <RNTouchableOpacity onPress={() => setShowDatePicker(true)} style={styles.customInput}>
                      <Text style={styles.inputText}>{watch('incidentDate') || t('yourRightsForm.placeholderSelectDate')}</Text>
                      <MaterialIcons name="calendar-today" size={20} color={Palette.gray500} />
                    </RNTouchableOpacity>
                    <FormControlError><FormControlErrorText>{errors.incidentDate?.message}</FormControlErrorText></FormControlError>
                  </FormControl>

                  <FormControl isInvalid={!!errors.incidentTime}>
                    <FormControlLabel><FormControlLabelText>{t('yourRightsForm.labelTimeOfIncident')}</FormControlLabelText></FormControlLabel>
                    <RNTouchableOpacity onPress={() => setShowTimePicker(true)} style={styles.customInput}>
                      <Text style={styles.inputText}>{watch('incidentTime') || t('yourRightsForm.placeholderSelectTime')}</Text>
                      <MaterialIcons name="access-time" size={20} color={Palette.gray500} />
                    </RNTouchableOpacity>
                    <FormControlError><FormControlErrorText>{errors.incidentTime?.message}</FormControlErrorText></FormControlError>
                  </FormControl>

                  <FormControl isInvalid={!!errors.previousOccurrence}>
                    <FormControlLabel><FormControlLabelText>{t('yourRightsForm.labelPreviousOccurrence')}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="previousOccurrence" render={({ field: { onChange, value } }) => (
                      <HStack space="sm">
                        {(['yes', 'no'] as const).map((val) => (
                          <RNTouchableOpacity key={val} onPress={() => onChange(val)} style={[styles.pillButton, value === val && styles.pillButtonActive]}>
                            <Text color={value === val ? Palette.gold : Palette.gray600} fontWeight="700">{val === 'yes' ? t('yourRightsForm.yes') : t('yourRightsForm.no')}</Text>
                          </RNTouchableOpacity>
                        ))}
                      </HStack>
                    )} />
                    <FormControlError><FormControlErrorText>{errors.previousOccurrence?.message}</FormControlErrorText></FormControlError>
                  </FormControl>

                  {previousOccurrence === 'yes' && (
                    <FormControl isInvalid={!!errors.previousDetails}>
                      <FormControlLabel><FormControlLabelText>{t('yourRightsForm.labelPreviousDetails')}</FormControlLabelText></FormControlLabel>
                      <Controller control={control} name="previousDetails" render={({ field: { onChange, onBlur, value } }) => (
                        <Textarea size="lg" rounded="$xl" bg={Palette.gray50}><TextareaInput placeholder={t('yourRightsForm.placeholderPreviousDetails')} value={value} onChangeText={onChange} onBlur={onBlur} /></Textarea>
                      )} />
                      <FormControlError><FormControlErrorText>{errors.previousDetails?.message}</FormControlErrorText></FormControlError>
                    </FormControl>
                  )}
                </VStack>
              </Box>
            </View>
          )}

          {/* Step 2: Response Preferences */}
          {currentStep === 2 && (
            <View>
              <Box bg={Palette.white} borderRadius={18} borderWidth={1} borderColor={Palette.gray100} p="$6" shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={8} elevation={2}>
                <HStack space="md" alignItems="center" mb="$6">
                  <Box bg={Palette.violet} borderRadius={10} p={7}><MaterialIcons name="contact-phone" size={16} color={Palette.white} /></Box>
                  <Heading fontSize={Type.h2} fontWeight="800" color={Palette.ink} letterSpacing={-0.5}>{t('yourRightsForm.sectionPreferences')}</Heading>
                </HStack>

                <VStack space="lg">
                  <FormControl isInvalid={!!errors.urgency}>
                    <FormControlLabel><FormControlLabelText>{t('yourRightsForm.labelUrgencyLevel')}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="urgency" render={({ field: { onChange, value } }) => (
                      <HStack space="xs">
                        {(['low', 'medium', 'high'] as const).map((level) => (
                          <RNTouchableOpacity key={level} onPress={() => onChange(level)} style={[styles.pillButton, { borderColor: value === level ? Palette.blue : Palette.gray200, backgroundColor: value === level ? Palette.blueTint : Palette.gray50 }]}>
                            <Text fontSize={Type.small} color={value === level ? Palette.blue : Palette.gray600} fontWeight="700">{t(`yourRightsForm.urgency${level.charAt(0).toUpperCase()}${level.slice(1)}`)}</Text>
                          </RNTouchableOpacity>
                        ))}
                      </HStack>
                    )} />
                    <FormControlError><FormControlErrorText>{errors.urgency?.message}</FormControlErrorText></FormControlError>
                  </FormControl>

                  <FormControl isInvalid={!!errors.preferredContact}>
                    <FormControlLabel><FormControlLabelText>{t('yourRightsForm.labelPreferredContact')}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="preferredContact" render={({ field: { onChange, value } }) => (
                      <Select selectedValue={value} onValueChange={onChange}>
                        <SelectTrigger size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}><SelectInput placeholder={t('yourRightsForm.placeholderSelectMethod')} /></SelectTrigger>
                        <SelectPortal><SelectBackdrop /><SelectContent>
                          <SelectItem label={t('yourRightsForm.contactEmail')} value="email" /><SelectItem label={t('yourRightsForm.contactPhone')} value="phone" /><SelectItem label={t('yourRightsForm.contactInApp')} value="in-app" />
                        </SelectContent></SelectPortal>
                      </Select>
                    )} />
                    <FormControlError><FormControlErrorText>{errors.preferredContact?.message}</FormControlErrorText></FormControlError>
                  </FormControl>

                  <FormControl isInvalid={!!errors.resolutionMethod}>
                    <FormControlLabel><FormControlLabelText>{t('yourRightsForm.labelPreferredResolution')}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="resolutionMethod" render={({ field: { onChange, value } }) => (
                      <Select selectedValue={value} onValueChange={onChange}>
                        <SelectTrigger size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}><SelectInput placeholder={t('yourRightsForm.placeholderSelectMethod')} /></SelectTrigger>
                        <SelectPortal><SelectBackdrop /><SelectContent>
                          <SelectItem label={t('yourRightsForm.contactEmail')} value="email" /><SelectItem label={t('yourRightsForm.contactPhoneCall')} value="phone" /><SelectItem label={t('yourRightsForm.contactInAppNotification')} value="in-app" />
                        </SelectContent></SelectPortal>
                      </Select>
                    )} />
                    <FormControlError><FormControlErrorText>{errors.resolutionMethod?.message}</FormControlErrorText></FormControlError>
                  </FormControl>
                </VStack>
              </Box>
            </View>
          )}

          {/* Step 3: Verification & Finalize */}
          {currentStep === 3 && (
            <View>
              <Box bg={Palette.white} borderRadius={18} borderWidth={1} borderColor={Palette.gray100} p="$6" shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={8} elevation={2}>
                <HStack space="md" alignItems="center" mb="$6">
                  <Box bg={Palette.green} borderRadius={10} p={7}><MaterialIcons name="check-circle" size={16} color={Palette.white} /></Box>
                  <Heading fontSize={Type.h2} fontWeight="800" color={Palette.ink} letterSpacing={-0.5}>{t('yourRightsForm.sectionFinalVerification')}</Heading>
                </HStack>

                <VStack space="lg">
                  <FormControl>
                    <FormControlLabel><FormControlLabelText>{t('yourRightsForm.labelAttachments')}</FormControlLabelText></FormControlLabel>
                    <Box bg={Palette.gray50} borderColor={Palette.gray300} borderWidth={1} rounded="$xl" p="$4">
                      {!file ? (
                        <VStack alignItems="center" space="md">
                          <Box bg={Palette.gray100} p="$4" rounded="$full"><MaterialIcons name="cloud-upload" size={32} color={Palette.gray400} /></Box>
                          <Text color={Palette.gray500} fontSize={Type.label} textAlign="center">{t('yourRightsForm.uploadProof')}</Text>
                          <Button size="xs" onPress={pickFile} bg={Palette.blueTint} rounded="$lg">
                            <HStack space="xs" alignItems="center"><MaterialIcons name="file-present" size={16} color={Palette.blue} /><ButtonText color={Palette.blue}>{t('yourRightsForm.chooseFile')}</ButtonText></HStack>
                          </Button>
                        </VStack>
                      ) : (
                        <HStack justifyContent="space-between" alignItems="center">
                          <HStack alignItems="center" space="md" flex={1}>
                            <Box bg={Palette.successTint} p="$2" rounded="$lg"><MaterialIcons name="description" size={20} color={Palette.success} /></Box>
                            <VStack flex={1}><Text color={Palette.ink} fontWeight="600" fontSize={Type.body} numberOfLines={1}>{file.name}</Text><Text color={Palette.gray500} fontSize={Type.caption}>{((file.size || 0) / 1024).toFixed(1)} KB</Text></VStack>
                          </HStack>
                          <RNTouchableOpacity onPress={() => setFile(null)}><MaterialIcons name="cancel" size={24} color={Palette.errorAlt} /></RNTouchableOpacity>
                        </HStack>
                      )}
                    </Box>
                  </FormControl>

                  <VStack space="md" mt="$2">
                    <Controller control={control} name="consentTerms" render={({ field: { onChange, value } }) => (
                      <Checkbox value="consentTerms" isChecked={value} onChange={onChange} size="md">
                        <CheckboxIndicator mr="$3" rounded="$md"><CheckboxIcon as={Check} /></CheckboxIndicator><CheckboxLabel fontSize={Type.label}>{t('yourRightsForm.agreeToTerms')}</CheckboxLabel>
                      </Checkbox>
                    )} />
                    {errors.consentTerms && <Text fontSize={Type.small} color={Palette.error} ml="$9">{errors.consentTerms.message}</Text>}

                    <Controller control={control} name="acknowledgeAccuracy" render={({ field: { onChange, value } }) => (
                      <Checkbox value="acknowledgeAccuracy" isChecked={value} onChange={onChange} size="md">
                        <CheckboxIndicator mr="$3" rounded="$md"><CheckboxIcon as={Check} /></CheckboxIndicator><CheckboxLabel fontSize={Type.label}>{t('yourRightsForm.infoIsAccurate')}</CheckboxLabel>
                      </Checkbox>
                    )} />
                    {errors.acknowledgeAccuracy && <Text fontSize={Type.small} color={Palette.error} ml="$9">{errors.acknowledgeAccuracy.message}</Text>}

                    <Controller control={control} name="consentFollowUp" render={({ field: { onChange, value } }) => (
                      <Checkbox value="consentFollowUp" isChecked={value} onChange={onChange} size="md">
                        <CheckboxIndicator mr="$3" rounded="$md"><CheckboxIcon as={Check} /></CheckboxIndicator><CheckboxLabel fontSize={Type.label}>Consent to follow-up</CheckboxLabel>
                      </Checkbox>
                    )} />
                    {errors.consentFollowUp && <Text fontSize={Type.small} color={Palette.error} ml="$9">{errors.consentFollowUp.message}</Text>}

                    {/* Plan Phase 11 Step 6 — anonymity opt-in */}
                    <Controller control={control} name="isAnonymous" render={({ field: { onChange, value } }) => (
                      <VStack space="xs">
                        <Checkbox value="isAnonymous" isChecked={!!value} onChange={onChange} size="md">
                          <CheckboxIndicator mr="$3" rounded="$md"><CheckboxIcon as={Check} /></CheckboxIndicator>
                          <CheckboxLabel fontSize={Type.label}>{t('yourRightsForm.anonymousLabel')}</CheckboxLabel>
                        </Checkbox>
                        {/* M7: explicit disclosure that anonymity is one-way
                            (hidden from employer, not from Kiruko). Always
                            shown — visibility doesn't depend on the checkbox
                            state because the reporter needs the disclosure
                            to make an informed choice BEFORE ticking it. */}
                        <Box bg={Palette.warningTint} borderColor={Palette.warningTint} borderWidth={1} rounded="$md" p="$2" ml="$8">
                          <Text fontSize={Type.caption} color={Palette.warning} lineHeight="$sm">
                            {t('yourRightsForm.anonymousDisclosure')}
                          </Text>
                        </Box>
                      </VStack>
                    )} />

                    {/* Plan Phase 11 Step 4 — external-channel opt-in */}
                    <Controller control={control} name="fileExternally" render={({ field: { onChange, value } }) => (
                      <Checkbox value="fileExternally" isChecked={!!value} onChange={onChange} size="md">
                        <CheckboxIndicator mr="$3" rounded="$md"><CheckboxIcon as={Check} /></CheckboxIndicator>
                        <CheckboxLabel fontSize={Type.label}>Do NOT show this report to my employer — send it to a compliance officer instead</CheckboxLabel>
                      </Checkbox>
                    )} />
                  </VStack>

                  {/* M8 closeout — pre-submit PIN-recovery preview so the
                      reporter understands the "save this PIN" story BEFORE
                      filing, not after. Pairs with the dedicated PIN screen
                      that shows up post-submit. */}
                  <Box
                    bg={Palette.blueTint}
                    borderColor={Palette.blueTint}
                    borderWidth={1}
                    rounded="$xl"
                    p="$3"
                    mt="$2"
                  >
                    <HStack space="sm" alignItems="flex-start">
                      <MaterialIcons name="vpn-key" size={18} color={Palette.blue} />
                      <Text fontSize={Type.small} color={Palette.blue} flex={1} lineHeight="$sm">
                        {t('yourRightsForm.pinPreviewWarning')}
                      </Text>
                    </HStack>
                  </Box>
                </VStack>
              </Box>
            </View>
          )}
        </Box>

        {/* Navigation Buttons */}
        <HStack space="md" mt="$8" px="$2">
          {currentStep > 0 && (
            <Button
              flex={1}
              variant="outline"
              borderColor={Palette.gray200}
              rounded="$2xl"
              h="$16"
              onPress={prevStep}
              isDisabled={isSubmitting}
            >
              <ButtonText color={Palette.gray600} fontWeight="700">Back</ButtonText>
            </Button>
          )}

          {currentStep < steps.length - 1 ? (
            <Button
              flex={2}
              bg={Palette.gold}
              rounded="$2xl"
              h="$16"
              onPress={nextStep}
              shadowColor={Palette.gold}
              shadowOffset={{ width: 0, height: 4 }}
              shadowOpacity={0.2}
              shadowRadius={8}
              elevation={6}
            >
              <HStack space="md" alignItems="center">
                <ButtonText color={Palette.white} fontWeight="700">Continue</ButtonText>
                <MaterialIcons name="arrow-forward" size={20} color={Palette.white} />
              </HStack>
            </Button>
          ) : (
            <Button
              flex={2}
              bg={Palette.gold}
              rounded="$2xl"
              h="$16"
              onPress={handleSubmit(submitRightsReport)}
              isDisabled={!isValid || isSubmitting}
              shadowColor={Palette.gold}
              shadowOffset={{ width: 0, height: 4 }}
              shadowOpacity={0.2}
              shadowRadius={8}
              elevation={6}
            >
              <HStack space="md" alignItems="center">
                {isSubmitting ? <ActivityIndicator size="small" color={Palette.white} /> : <MaterialIcons name="send" size={20} color={Palette.white} />}
                <ButtonText color={Palette.white} fontWeight="700">{isSubmitting ? 'Sending...' : 'Submit Report'}</ButtonText>
              </HStack>
            </Button>
          )}
        </HStack>

        {/* Date/Time Pickers (Fixed with Modal Overlay) */}
        {Platform.OS === 'ios' ? (
          <>
            <Modal visible={showDatePicker} transparent animationType="slide" onRequestClose={() => setShowDatePicker(false)}>
              <View style={styles.modalOverlay}>
                <RNTouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowDatePicker(false)} />
                <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
                  <Box bg={Palette.white} borderTopLeftRadius={16} borderTopRightRadius={16} overflow="hidden">
                    {/* Header */}
                    <HStack justifyContent="space-between" alignItems="center" p="$4" borderBottomWidth={1} borderBottomColor={Palette.gray200}>
                      <Box w={60} />
                      <Heading fontSize={Type.title} fontWeight="700" color={Palette.ink}>Select Date</Heading>
                      <Button variant="link" onPress={() => setShowDatePicker(false)}>
                        <ButtonText color={Palette.blue} fontSize={Type.title} fontWeight="600">Done</ButtonText>
                      </Button>
                    </HStack>
                    {/* Picker */}
                    <Box bg={Palette.white}>
                      <DateTimePicker
                        value={(() => {
                          const d = watch('incidentDate');
                          if (!d) return new Date();
                          const [year, month, day] = d.split('-').map(Number);
                          return new Date(year, month - 1, day);
                        })()}
                        mode="date"
                        display="spinner"
                        textColor={Palette.black}
                        onChange={(event, selectedDate) => {
                          if (event.type === 'set' && selectedDate) {
                            const year = selectedDate.getFullYear();
                            const month = (selectedDate.getMonth() + 1).toString().padStart(2, '0');
                            const day = selectedDate.getDate().toString().padStart(2, '0');
                            setValue('incidentDate', `${year}-${month}-${day}`, { shouldValidate: true });
                          }
                        }}
                      />
                    </Box>
                  </Box>
                </View>
              </View>
            </Modal>


            <Modal visible={showTimePicker} transparent animationType="slide" onRequestClose={() => setShowTimePicker(false)}>
              <View style={styles.modalOverlay}>
                <RNTouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowTimePicker(false)} />
                <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
                  <Box bg={Palette.white} borderTopLeftRadius={16} borderTopRightRadius={16} overflow="hidden">
                    {/* Header */}
                    <HStack justifyContent="space-between" alignItems="center" p="$4" borderBottomWidth={1} borderBottomColor={Palette.gray200}>
                      <Box w={60} />
                      <Heading fontSize={Type.title} fontWeight="700" color={Palette.ink}>Select Time</Heading>
                      <Button variant="link" onPress={() => setShowTimePicker(false)}>
                        <ButtonText color={Palette.blue} fontSize={Type.title} fontWeight="600">Done</ButtonText>
                      </Button>
                    </HStack>
                    {/* Picker */}
                    <Box bg={Palette.white}>
                      <DateTimePicker
                        value={(() => {
                          const t = watch('incidentTime');
                          if (!t) return new Date();
                          const [hours, minutes] = t.split(':').map(Number);
                          const d = new Date();
                          d.setHours(hours, minutes, 0, 0);
                          return d;
                        })()}
                        mode="time"
                        display="spinner"
                        is24Hour={true}
                        textColor={Palette.black}
                        onChange={(event, selectedTime) => {
                          if (event.type === 'set' && selectedTime) {
                            const h = selectedTime.getHours().toString().padStart(2, '0');
                            const m = selectedTime.getMinutes().toString().padStart(2, '0');
                            setValue('incidentTime', `${h}:${m}`, { shouldValidate: true });
                          }
                        }}
                      />
                    </Box>
                  </Box>
                </View>
              </View>
            </Modal>
          </>
        ) : (
          <>
            {showDatePicker && (
              <DateTimePicker
                value={(() => {
                  const d = watch('incidentDate');
                  if (!d) return new Date();
                  const [year, month, day] = d.split('-').map(Number);
                  return new Date(year, month - 1, day);
                })()}
                mode="date"
                display="calendar"
                onChange={(event, selectedDate) => {
                  setShowDatePicker(false);
                  if (event.type === 'set' && selectedDate) {
                    const year = selectedDate.getFullYear();
                    const month = (selectedDate.getMonth() + 1).toString().padStart(2, '0');
                    const day = selectedDate.getDate().toString().padStart(2, '0');
                    setValue('incidentDate', `${year}-${month}-${day}`, { shouldValidate: true });
                  }
                }}
              />
            )}
            {showTimePicker && (
              <DateTimePicker
                value={(() => {
                  const t = watch('incidentTime');
                  if (!t) return new Date();
                  const [hours, minutes] = t.split(':').map(Number);
                  const d = new Date();
                  d.setHours(hours, minutes, 0, 0);
                  return d;
                })()}
                mode="time"
                display="clock"
                is24Hour={true}
                onChange={(event, selectedTime) => {
                  setShowTimePicker(false);
                  if (event.type === 'set' && selectedTime) {
                    const h = selectedTime.getHours().toString().padStart(2, '0');
                    const m = selectedTime.getMinutes().toString().padStart(2, '0');
                    setValue('incidentTime', `${h}:${m}`, { shouldValidate: true });
                  }
                }}
              />
            )}
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Inline profile-preview card — tap a person's ⓘ. No navigation: the
          employee app has no view-other-profile route, so we surface identity
          (name / role / department) in a lightweight card instead. */}
      {previewUser ? (
        <View
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, elevation: 1000 }}
        >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
          onPress={() => setPreviewUser(null)}
        >
          {/* Stop taps inside the card from closing the modal */}
          <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 360 }}>
            <Box bg={Palette.white} borderRadius={18} p="$5">
              <HStack space="md" alignItems="center">
                <Box
                  w={56}
                  h={56}
                  rounded="$full"
                  bg={Palette.blueTint ?? Palette.gray100}
                  justifyContent="center"
                  alignItems="center"
                >
                  <Text fontSize={Type.h3} fontWeight="800" color={Palette.blue}>
                    {previewUser?.initials}
                  </Text>
                </Box>
                <VStack flex={1}>
                  <Text fontSize={Type.h3} fontWeight="800" color={Palette.ink}>
                    {previewUser?.label}
                  </Text>
                  {previewUser?.role ? (
                    <Text fontSize={Type.body} color={Palette.gray600}>
                      {previewUser.role}
                    </Text>
                  ) : null}
                </VStack>
                <Pressable onPress={() => setPreviewUser(null)} hitSlop={10} style={{ padding: 4 }}>
                  <MaterialIcons name="close" size={22} color={Palette.gray500} />
                </Pressable>
              </HStack>

              {previewUser?.department ? (
                <HStack space="xs" alignItems="center" mt="$4">
                  <MaterialIcons name="apartment" size={16} color={Palette.gray500} />
                  <Text fontSize={Type.small} color={Palette.gray700}>
                    {previewUser.department}
                  </Text>
                </HStack>
              ) : null}
            </Box>
          </Pressable>
        </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  customInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: Palette.gray200,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 60,
    backgroundColor: Palette.gray50,
  },
  inputText: {
    fontSize: 16,
    color: Palette.gray700,
    fontWeight: '500',
  },
  pillButton: {
    flex: 1,
    padding: 12,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Palette.gray200,
    backgroundColor: Palette.gray50,
    alignItems: 'center',
  },
  pillButtonActive: {
    borderColor: Palette.gold,
    backgroundColor: Palette.warningTint,
  },
  historyButton: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    backgroundColor: Palette.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Palette.goldTint,
    shadowColor: Palette.gold,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});

export default KnowYourRight;
