/**
 * M3: PIN screen shown immediately after a concern is filed.
 *
 * The backend (M2) returns `case_access.{case_id, pin}` in the POST /user-right
 * response. The plaintext PIN is shown ONCE here and never persisted — if the
 * reporter loses it they cannot recover it (preserves true anonymity for
 * anonymous filings).
 *
 * The "I have saved" gate is intentional: it forces the reporter to commit
 * to having captured the PIN before letting them continue. Tested with the
 * react-native built-in `Share` API (no extra dependency); a follow-up PR
 * can wire `expo-print` for a proper PDF export.
 */
import React, { useState } from 'react';
import { Palette, Type } from '@/app/constants/theme';
import { Alert, Share, ScrollView, View, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Box,
  Button,
  ButtonText,
  Checkbox,
  CheckboxGroup,
  CheckboxIcon,
  CheckboxIndicator,
  CheckboxLabel,
  Heading,
  HStack,
  Text,
  VStack,
  Pressable,
  Divider,
} from '@gluestack-ui/themed';
import { Check, Shield, Share2 } from 'lucide-react-native';
import { PremiumHeader } from '@/components/PremiumHeader';

export default function YourRightPinScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ case_id?: string; pin?: string; channel?: string }>();
  const caseId = params.case_id || '—';
  const pin = params.pin || '—';

  const [acked, setAcked] = useState<string[]>([]);
  const isAcked = acked.includes('saved');

  const onShare = async () => {
    try {
      const message = `${t('concernPin.shareTitle')}\n\n${t('concernPin.caseIdLabel')}: ${caseId}\n${t('concernPin.pinLabel')}: ${pin}\n\n${t('concernPin.shownOnceWarning')}`;
      // `title` works on both iOS and Android (used as subject when shared
      // via email on iOS, as the chooser title on Android).
      await Share.share({ message, title: t('concernPin.shareSubject') });
    } catch (e) {
      // User cancelled or share unavailable — non-fatal.
      console.warn('share failed', e);
    }
  };

  const onContinue = () => {
    if (!isAcked) {
      Alert.alert(
        t('concernPin.shownOnceWarning'),
        t('concernPin.intro'),
      );
      return;
    }
    router.replace('/private_dashboard/your_right_history');
  };

  // Block hardware back gesture without acknowledging — honest UX:
  // we shouldn't let them "back" out of the only screen that shows the PIN.
  // expo-router will still allow it; we display a clear warning before they
  // leave via the Continue button.

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.white }}>
      <PremiumHeader title={t('concernPin.pageTitle')} showBack={false} />

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
        <VStack space="lg">

          {/* Warning banner */}
          <Box
            bg={Palette.warningTint}
            borderColor={Palette.warningTint}
            borderWidth={1}
            borderRadius="$xl"
            p="$4"
          >
            <HStack space="sm" alignItems="flex-start">
              <Shield size={20} color={Palette.gold} />
              <VStack flex={1} space="xs">
                <Text color={Palette.gold} fontWeight="700" fontSize={Type.label}>
                  {t('concernPin.shownOnceWarning')}
                </Text>
                <Text color={Palette.gray700} fontSize={Type.label}>
                  {t('concernPin.intro')}
                </Text>
              </VStack>
            </HStack>
          </Box>

          {/* Case ID + PIN cards */}
          <Box
            bg={Palette.white}
            borderRadius={18}
            p="$5"
            borderColor={Palette.gray100}
            borderWidth={1}
            shadowColor={Palette.black}
            shadowOffset={{ width: 0, height: 2 }}
            shadowOpacity={0.04}
            shadowRadius={8}
            elevation={2}
          >
            <VStack space="lg">
              <VStack space="xs">
                <Text color={Palette.gray500} fontSize={Type.caption} fontWeight="700" letterSpacing={1}>
                  {(t('concernPin.caseIdLabel') || '').toUpperCase()}
                </Text>
                <Heading color={Palette.ink} fontSize={Type.h1} fontWeight="800" letterSpacing={2}>
                  #{caseId}
                </Heading>
              </VStack>

              <Divider />

              <VStack space="xs">
                <Text color={Palette.gray500} fontSize={Type.caption} fontWeight="700" letterSpacing={1}>
                  {(t('concernPin.pinLabel') || '').toUpperCase()}
                </Text>
                <Heading
                  color={Palette.indigo}
                  fontSize={Type.display}
                  fontWeight="800"
                  letterSpacing={6}
                  fontFamily={Platform.OS === 'ios' ? 'Menlo' : 'monospace'}
                >
                  {pin}
                </Heading>
              </VStack>
            </VStack>
          </Box>

          {/* Share / save */}
          <Pressable onPress={onShare}>
            <Box
              bg={Palette.white}
              borderColor={Palette.gray100}
              borderWidth={1}
              borderRadius={18}
              p="$4"
              shadowColor={Palette.black}
              shadowOffset={{ width: 0, height: 2 }}
              shadowOpacity={0.04}
              shadowRadius={8}
              elevation={2}
            >
              <HStack space="sm" alignItems="center" justifyContent="center">
                <Share2 size={18} color={Palette.indigo} />
                <Text color={Palette.indigo} fontWeight="700" fontSize={Type.body}>
                  {t('concernPin.shareAction')}
                </Text>
              </HStack>
            </Box>
          </Pressable>

          {/* Acknowledgement gate */}
          <CheckboxGroup value={acked} onChange={setAcked}>
            <Checkbox value="saved" aria-label="I have saved" mt="$2">
              <CheckboxIndicator mr="$3" rounded="$md">
                <CheckboxIcon as={Check} />
              </CheckboxIndicator>
              <CheckboxLabel fontSize={Type.body} color={Palette.ink} flex={1}>
                {t('concernPin.ackCheckbox')}
              </CheckboxLabel>
            </Checkbox>
          </CheckboxGroup>

          <Button
            size="lg"
            rounded={18}
            bg={isAcked ? Palette.indigo : Palette.gray300}
            isDisabled={!isAcked}
            onPress={onContinue}
            mt="$2"
          >
            <ButtonText color={Palette.white} fontWeight="700">
              {t('concernPin.continueAction')}
            </ButtonText>
          </Button>

          {/* Portal URL hint */}
          <View>
            <Text color={Palette.gray500} fontSize={Type.small} textAlign="center">
              {t('concernPin.portalUrlLabel')}: <Text color={Palette.ink} fontWeight="700">/concerns/track</Text>
            </Text>
          </View>

        </VStack>
      </ScrollView>
    </SafeAreaView>
  );
}
