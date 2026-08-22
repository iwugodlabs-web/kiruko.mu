/**
 * M3: in-app message thread for a concern.
 *
 * Owner-gated — uses the M3 backend endpoints `/user/user-right/{id}/messages`
 * (GET + POST) which are scoped to the case owner. Anonymous reporters
 * returning from a different device use the public `/concerns/track` web
 * portal instead (PIN-scoped).
 *
 * Polls every 30s while the screen is foregrounded so handler replies show
 * up without a manual refresh. A push notification (sent from the backend)
 * is the primary signal; polling is the fallback.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Palette, Type } from '@/app/constants/theme';
import {
  Alert,
  AppState,
  AppStateStatus,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal as RNModal,
  Platform,
  RefreshControl,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Box,
  Button,
  ButtonText,
  HStack,
  Heading,
  Input,
  InputField,
  Spinner,
  Text,
  VStack,
} from '@gluestack-ui/themed';
import { Send, MessagesSquare, Paperclip, X } from 'lucide-react-native';
import { PremiumHeader } from '@/components/PremiumHeader';
import { ConcernMessage, getOwnerThread, postOwnerMessage, resolveFileUrl } from '@/services/api';

const POLL_INTERVAL_MS = 30_000;

/** True when a stored file URL points at an image we can preview inline. */
const isImageUrl = (url?: string | null): boolean =>
  !!url && /\.(png|jpe?g|gif|webp|heic|bmp)(\?.*)?$/i.test(url);

type ThreadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; messages: ConcernMessage[] };

export default function ConcernThreadScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ right_id?: string }>();
  const rightId = Number(params.right_id || 0);
  const router = useRouter();

  const [state, setState] = useState<ThreadState>({ kind: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  // Full-screen viewer for an attached evidence image.
  const [imageViewer, setImageViewer] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const fetchThread = useCallback(async (silent = false) => {
    if (!rightId) {
      setState({ kind: 'error', message: t('concernThread.errorLoad') });
      return;
    }
    if (!silent) setRefreshing(true);
    const res = await getOwnerThread(rightId);
    if ('error' in res) {
      setState({ kind: 'error', message: res.error || t('concernThread.errorLoad') });
    } else {
      setState({ kind: 'ready', messages: res.messages || [] });
      // Scroll to bottom on fresh load.
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: !silent }));
    }
    if (!silent) setRefreshing(false);
  }, [rightId, t]);

  // Initial load.
  useEffect(() => { fetchThread(); }, [fetchThread]);

  // Foreground polling: every POLL_INTERVAL_MS while active. Stops when
  // the app backgrounds; restarts on resume.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let mounted = true;

    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (!mounted) return;
        fetchThread(true).catch(() => undefined);
      }, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };

    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') {
        // Fire one immediate fetch on resume so the user sees fresh data.
        fetchThread(true).catch(() => undefined);
        start();
      } else {
        stop();
      }
    });

    return () => {
      mounted = false;
      stop();
      sub.remove();
    };
  }, [fetchThread]);

  const onSend = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const res = await postOwnerMessage(rightId, body);
    if ('error' in res) {
      Alert.alert(t('concernThread.errorSend'), res.error);
    } else {
      setDraft('');
      // Optimistic refetch — the new message will appear in the list.
      await fetchThread(true);
    }
    setSending(false);
  };

  const authorLabel = (kind: ConcernMessage['author_kind']): string => {
    switch (kind) {
      case 'reporter':  return t('concernThread.authorReporter');
      case 'employer':  return t('concernThread.authorEmployer');
      case 'kontokaz':  return t('concernThread.authorKontokaz');
      case 'system':    return t('concernThread.authorSystem');
      default:          return kind;
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.white }}>
      <PremiumHeader
        title={t('concernThread.pageTitle')}
        /* In a Tabs navigator router.back() pops to the initial tab (dashboard),
           not the concern list — so navigate to the list explicitly. */
        onBack={() => router.replace('/private_dashboard/your_right_history')}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ padding: 16, paddingBottom: 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchThread()} />}
        >
          {state.kind === 'loading' && (
            <Box alignItems="center" mt="$10">
              <Spinner color={Palette.gold} />
            </Box>
          )}

          {state.kind === 'error' && (
            <Box alignItems="center" mt="$10" px="$6">
              <Text color={Palette.error} mb="$3" textAlign="center" fontSize={Type.body}>{state.message}</Text>
              <Button onPress={() => fetchThread()} bg={Palette.indigo} rounded="$xl">
                <ButtonText color={Palette.white}>{t('concernThread.retryAction')}</ButtonText>
              </Button>
            </Box>
          )}

          {state.kind === 'ready' && state.messages.length === 0 && (
            <Box alignItems="center" mt="$10" px="$6">
              <Box bg={Palette.gray100} rounded="$full" p="$4" mb="$3">
                <MessagesSquare size={28} color={Palette.gray400} />
              </Box>
              <Heading color={Palette.ink} mb="$1" textAlign="center" fontSize={Type.h3} fontWeight="700">
                {t('concernThread.emptyTitle')}
              </Heading>
              <Text color={Palette.gray500} textAlign="center" fontSize={Type.label}>
                {t('concernThread.emptyBody')}
              </Text>
            </Box>
          )}

          {state.kind === 'ready' && state.messages.length > 0 && (
            <VStack space="md">
              {state.messages.map((m) => {
                const mine = m.author_kind === 'reporter';
                return (
                  <Box
                    key={m.message_id}
                    alignSelf={mine ? 'flex-end' : 'flex-start'}
                    maxWidth="85%"
                    bg={mine ? Palette.indigo : Palette.gray100}
                    borderColor={mine ? Palette.indigo : Palette.gray200}
                    borderWidth={1}
                    rounded="$xl"
                    p="$3"
                  >
                    <Text
                      fontSize={Type.caption}
                      fontWeight="700"
                      color={mine ? Palette.white : Palette.gray500}
                      letterSpacing={0.5}
                      mb="$1"
                    >
                      {authorLabel(m.author_kind).toUpperCase()}
                    </Text>
                    {m.body ? (
                      <Text color={mine ? Palette.white : Palette.ink} fontSize={Type.body}>
                        {m.body}
                      </Text>
                    ) : null}
                    {m.attachment_url ? (() => {
                      const resolved = resolveFileUrl(m.attachment_url);
                      if (!resolved) return null;
                      return isImageUrl(m.attachment_url) ? (
                        <TouchableOpacity activeOpacity={0.85} onPress={() => setImageViewer(resolved)}>
                          <Image
                            source={{ uri: resolved }}
                            style={{ width: 200, height: 150, borderRadius: 12, marginTop: m.body ? 8 : 0 }}
                            resizeMode="cover"
                          />
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          activeOpacity={0.85}
                          onPress={() => Linking.openURL(resolved).catch(() => undefined)}
                          style={{ marginTop: m.body ? 8 : 0, flexDirection: 'row', alignItems: 'center' }}
                        >
                          <Paperclip size={14} color={mine ? Palette.white : Palette.indigo} />
                          <Text
                            color={mine ? Palette.white : Palette.indigo}
                            fontSize={Type.label}
                            fontWeight="700"
                            ml="$1"
                          >
                            {t('concernThread.openAttachment') || 'Open attachment'}
                          </Text>
                        </TouchableOpacity>
                      );
                    })() : null}
                    {m.created_at && (
                      <Text
                        mt="$1"
                        fontSize={Type.tiny}
                        color={mine ? Palette.gray300 : Palette.gray400}
                      >
                        {new Date(m.created_at).toLocaleString()}
                      </Text>
                    )}
                  </Box>
                );
              })}
            </VStack>
          )}
        </ScrollView>

        {/* Composer */}
        <Box
          px="$3"
          py="$3"
          bg={Palette.white}
          borderTopWidth={1}
          borderTopColor={Palette.gray200}
        >
          <HStack space="sm" alignItems="center">
            <Input flex={1} variant="outline" rounded="$xl">
              <InputField
                placeholder={t('concernThread.composerPlaceholder')}
                value={draft}
                onChangeText={setDraft}
                editable={!sending}
                multiline
              />
            </Input>
            <Button
              onPress={onSend}
              isDisabled={sending || !draft.trim()}
              bg={Palette.indigo}
              rounded="$xl"
            >
              {sending ? (
                <Spinner color={Palette.white} size="small" />
              ) : (
                <HStack space="xs" alignItems="center">
                  <Send size={16} color={Palette.white} />
                  <ButtonText color={Palette.white}>{t('concernThread.sendAction')}</ButtonText>
                </HStack>
              )}
            </Button>
          </HStack>
        </Box>
      </KeyboardAvoidingView>

      {/* Full-screen evidence-image viewer (schedule-style). */}
      {imageViewer && (
        <RNModal visible transparent animationType="fade" onRequestClose={() => setImageViewer(null)}>
          <Box flex={1} justifyContent="center" style={{ backgroundColor: 'rgba(0,0,0,0.95)' }}>
            <TouchableOpacity
              activeOpacity={1}
              style={{ position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 8 }}
              onPress={() => setImageViewer(null)}
            >
              <X size={28} color="white" />
            </TouchableOpacity>
            <Image source={{ uri: imageViewer }} style={{ width: '100%', height: '70%' }} resizeMode="contain" />
          </Box>
        </RNModal>
      )}
    </SafeAreaView>
  );
}
