import { Palette, Type } from '@/app/constants/theme';
import {
  Box,
  Button,
  ButtonText,
  Heading,
  HStack,
  Input,
  InputField,
  Modal,
  ModalBackdrop,
  ModalBody,
  ModalContent,
  ModalFooter,
  Pressable,
  SafeAreaView,
  ScrollView,
  Spinner,
  Text,
  VStack,
} from '@gluestack-ui/themed';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { MapPin, Plus, Search, LocateFixed, Pencil, Trash2 } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import { Alert, Platform, KeyboardAvoidingView, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PremiumHeader } from '@/components/PremiumHeader';
import useAuth from '../hooks/useAuth';
import {
  MobileGeofence,
  getCompanyGeofences,
  createCompanyGeofence,
  updateCompanyGeofence,
  deleteCompanyGeofence,
  setCompanyGeofenceDefaultMode,
  searchPlace,
  reverseGeocode,
} from '../../services/api';

type FormState = {
  name: string;
  address: string;
  lat: string;
  lng: string;
  radius: string;
  mode: 'block' | 'flag';
  active: boolean;
};

const EMPTY_FORM: FormState = { name: '', address: '', lat: '', lng: '', radius: '200', mode: 'block', active: true };

export default function GeofencingScreen() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const companyId = user?.company?.company_id || user?.private_user?.company_id || (user as any)?.company_id;
  const countryCode = ((user as any)?.company?.country_code || '').toUpperCase();

  const [sites, setSites] = useState<MobileGeofence[]>([]);
  const [defaultMode, setDefaultMode] = useState('off');
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<{ lat: number; lng: number; name: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const res = await getCompanyGeofences(companyId);
    if ('error' in res) {
      setNotice(res.error);
    } else {
      setSites(res.geofences);
      setDefaultMode(res.geofence_default_mode);
    }
    setLoading(false);
  }, [companyId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(''), 4000);
  };

  const changeDefaultMode = async (mode: 'off' | 'block' | 'flag') => {
    if (!companyId) return;
    setDefaultMode(mode);
    const res = await setCompanyGeofenceDefaultMode(companyId, mode);
    if (typeof res !== 'boolean') flash(res.error);
    else flash(t('geofencing.updated'));  };

  const toggleActive = async (site: MobileGeofence) => {
    if (!companyId) return;
    setBusyId(site.geofence_id);
    const res = await updateCompanyGeofence(companyId, site.geofence_id, { active: !site.active });
    setBusyId(null);
    if ('error' in res) flash(res.error);
    else setSites((prev) => prev.map((s) => (s.geofence_id === site.geofence_id ? { ...s, active: !site.active } : s)));
  };

  const toggleMode = async (site: MobileGeofence) => {
    if (!companyId) return;
    const next = site.mode === 'block' ? 'flag' : 'block';
    setBusyId(site.geofence_id);
    const res = await updateCompanyGeofence(companyId, site.geofence_id, { mode: next });
    setBusyId(null);
    if ('error' in res) flash(res.error);
    else setSites((prev) => prev.map((s) => (s.geofence_id === site.geofence_id ? { ...s, mode: next } : s)));
  };

  const confirmDelete = (site: MobileGeofence) => {
    Alert.alert(
      t('geofencing.deleteConfirmTitle'),
      t('geofencing.deleteConfirmMessage', { name: site.name }),
      [
        { text: t('geofencing.cancel'), style: 'cancel' },
        {
          text: t('geofencing.delete'),
          style: 'destructive',
          onPress: async () => {
            if (!companyId) return;
            const res = await deleteCompanyGeofence(companyId, site.geofence_id, null);
            if ('error' in res) flash(res.error);
            else {
              flash(t('geofencing.deleted'));
              setSites((prev) => prev.filter((s) => s.geofence_id !== site.geofence_id));
            }
          },
        },
      ],
    );
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setSearchQ('');
    setSearchResults([]);
    setSearchError('');
    setShowForm(true);
  };

  const openEdit = (site: MobileGeofence) => {
    setEditingId(site.geofence_id);
    setForm({
      name: site.name,
      address: site.address ?? '',
      lat: String(site.latitude),
      lng: String(site.longitude),
      radius: String(site.radius_meters),
      mode: site.mode,
      active: site.active,
    });
    setSearchQ('');
    setSearchResults([]);
    setSearchError('');
    setShowForm(true);
  };

  const doSearch = async () => {
    const q = searchQ.trim();
    if (q.length < 3) return;
    setSearching(true);
    setSearchError('');
    const res = await searchPlace(q, countryCode || undefined);
    setSearching(false);
    if ('error' in res) {
      setSearchError(res.error);
      setSearchResults([]);
    } else {
      setSearchResults(res.map((r) => ({ lat: r.latitude, lng: r.longitude, name: r.display_name })));
    }
  };

  const pickResult = (r: { lat: number; lng: number; name: string }) => {
    set({ lat: String(r.lat), lng: String(r.lng), address: r.name });
    setSearchResults([]);
    setSearchQ('');
  };

  const useMyLocation = async () => {
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('', t('geofencing.searchUnavailable'));
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      let addr = '';
      const rev = await reverseGeocode(lat, lng);
      if (typeof rev === 'string') addr = rev;
      set({ lat: String(lat), lng: String(lng), address: addr });
    } catch {
      Alert.alert('', t('geofencing.failed'));
    } finally {
      setLocating(false);
    }
  };

  const save = async () => {
    if (!companyId) return;
    const latNum = Number(form.lat);
    const lngNum = Number(form.lng);
    if (!form.name.trim() || !Number.isFinite(latNum) || !Number.isFinite(lngNum)) {
      Alert.alert('', t('geofencing.emptyLatLng'));
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      address: form.address.trim() || null,
      latitude: latNum,
      longitude: lngNum,
      radius_meters: Number(form.radius) || 200,
      mode: form.mode,
      active: form.active,
    };
    const res = editingId == null
      ? await createCompanyGeofence(companyId, payload)
      : await updateCompanyGeofence(companyId, editingId, payload);
    setSaving(false);
    if ('error' in res) {
      flash(res.error);
    } else {
      flash(editingId == null ? t('geofencing.created') : t('geofencing.updated'));
      setShowForm(false);
      load();
    }
  };

  const chip = (label: string, selected: boolean, onPress: () => void) => (
    <Pressable onPress={onPress} style={{ flex: 1 }}>
      <Box
        style={{
          paddingVertical: 8,
          borderRadius: 10,
          alignItems: 'center',
          backgroundColor: selected ? Palette.ink : Palette.white,
          borderWidth: 1,
          borderColor: selected ? Palette.ink : Palette.gray200,
        }}
      >
        <Text fontSize={Type.small} fontWeight="700" color={selected ? Palette.white : Palette.ink}>{label}</Text>
      </Box>
    </Pressable>
  );

  return (
    <LinearGradient colors={[Palette.gray50, Palette.gray100, Palette.white]} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <PremiumHeader
          title={t('geofencing.title')}
          rightElement={
            <Pressable onPress={openAdd}>
              <Box bg={Palette.blue} p="$2" rounded="$lg">
                <Plus color={Palette.white} size={18} />
              </Box>
            </Pressable>
          }
        />

        {notice ? (
          <Box mx="$4" mb="$3" bg={Palette.blueTint} borderLeftWidth={4} borderLeftColor={Palette.blue} rounded="$xl" p="$3">
            <Text fontSize={Type.small} color={Palette.blue} fontWeight="600">{notice}</Text>
          </Box>
        ) : null}

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120, paddingHorizontal: 16 }}>
          <Text fontSize={Type.small} color={Palette.gray500} lineHeight={17} mb="$4">
            {t('geofencing.subtitle')}
          </Text>

          {/* Company default mode */}
          <Box bg={Palette.white} rounded="$2xl" p="$4" mb="$4" borderWidth={1} borderColor={Palette.gray100}>
            <Text fontSize={Type.label} fontWeight="700" color={Palette.ink} mb="$3">{t('geofencing.defaultMode')}</Text>
            <HStack space="sm">
              {(['off', 'block', 'flag'] as const).map((m) =>
                chip(t(`geofencing.mode${m === 'off' ? 'Off' : m === 'block' ? 'Block' : 'Flag'}`), defaultMode === m, () => changeDefaultMode(m)),
              )}
            </HStack>
          </Box>

          {/* Sites */}
          <Text fontSize={Type.label} fontWeight="800" color={Palette.ink} mb="$2">
            {t('geofencing.sites')} ({sites.length})
          </Text>

          {loading ? (
            <Box py="$10" alignItems="center"><Spinner color={Palette.blue} /></Box>
          ) : sites.length === 0 ? (
            <Box bg={Palette.white} rounded="$2xl" p="$5" borderWidth={1} borderColor={Palette.gray100}>
              <Text fontSize={Type.body} color={Palette.gray500} textAlign="center">{t('geofencing.noSites')}</Text>
            </Box>
          ) : (
            sites.map((site) => (
              <Box key={site.geofence_id} bg={Palette.white} rounded="$2xl" p="$4" mb="$3" borderWidth={1} borderColor={Palette.gray100}>
                <HStack space="md" alignItems="flex-start">
                  <Box bg={site.active ? Palette.teal : Palette.gray200} p="$2" rounded="$lg">
                    <MapPin size={16} color={site.active ? Palette.white : Palette.gray500} />
                  </Box>
                  <VStack flex={1} space="xs">
                    <Text fontSize={Type.body} fontWeight="700" color={Palette.ink}>{site.name}</Text>
                    {site.address ? <Text fontSize={Type.small} color={Palette.gray500}>{site.address}</Text> : null}
                    <Text fontSize={Type.tiny} color={Palette.gray400}>
                      {site.latitude.toFixed(5)}, {site.longitude.toFixed(5)} · {site.radius_meters}m
                    </Text>
                    {typeof site.employee_count === 'number' && site.employee_count > 0 ? (
                      <Text fontSize={Type.tiny} color={Palette.gold} fontWeight="700">
                        {t('geofencing.employeesAssigned', { count: site.employee_count })}
                      </Text>
                    ) : null}
                  </VStack>
                  <VStack space="sm">
                    <Pressable onPress={() => openEdit(site)}>
                      <Box bg={Palette.blueTint} p="$2" rounded="$lg"><Pencil size={14} color={Palette.blue} /></Box>
                    </Pressable>
                    <Pressable onPress={() => confirmDelete(site)}>
                      <Box bg={Palette.warningTint} p="$2" rounded="$lg"><Trash2 size={14} color={Palette.error} /></Box>
                    </Pressable>
                  </VStack>
                </HStack>

                <Box borderTopWidth={1} borderTopColor={Palette.gray100} mt="$3" pt="$3">
                  <HStack space="md" alignItems="center">
                    <HStack space="xs" flex={1}>
                      {(['block', 'flag'] as const).map((m) => (
                        <Pressable key={m} onPress={() => toggleMode(site)}>
                          <Box
                            style={{
                              paddingHorizontal: 12,
                              paddingVertical: 6,
                              borderRadius: 8,
                              backgroundColor: site.mode === m ? (m === 'block' ? Palette.error : Palette.gold) : Palette.gray100,
                            }}
                          >
                            <Text fontSize={Type.tiny} fontWeight="700" color={site.mode === m ? Palette.white : Palette.gray500}>
                              {m === 'block' ? t('geofencing.modeBlock') : t('geofencing.modeFlag')}
                            </Text>
                          </Box>
                        </Pressable>
                      ))}
                    </HStack>
                    {busyId === site.geofence_id ? (
                      <ActivityIndicator size="small" color={Palette.blue} />
                    ) : (
                      <Pressable onPress={() => toggleActive(site)}>
                        <Box style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Box style={{ width: 34, height: 20, borderRadius: 10, backgroundColor: site.active ? Palette.teal : Palette.gray300, padding: 2 }}>
                            <Box style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: Palette.white, alignSelf: site.active ? 'flex-end' : 'flex-start' }} />
                          </Box>
                          <Text fontSize={Type.tiny} color={Palette.gray500}>{site.active ? t('geofencing.active') : '—'}</Text>
                        </Box>
                      </Pressable>
                    )}
                  </HStack>
                </Box>
              </Box>
            ))
          )}

          <Button onPress={openAdd} bg={Palette.blue} rounded="$xl" mt="$2">
            <ButtonText><Plus size={16} /> {t('geofencing.addSite')}</ButtonText>
          </Button>
        </ScrollView>

        {/* Add / Edit modal */}
        <Modal isOpen={showForm} onClose={() => setShowForm(false)} size="full" avoidKeyboard>
          <ModalBackdrop />
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
            <ModalContent bg={Palette.white} rounded="$3xl" overflow="hidden" maxHeight="88%" my="$2" mx="$4" p="$0">
              <ModalBody>
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  <HStack space="md" alignItems="center" mb="$4">
                    <Box bg={Palette.teal} p="$2" rounded="$lg"><MapPin size={18} color={Palette.white} /></Box>
                    <Heading size="sm" color={Palette.ink}>
                      {editingId == null ? t('geofencing.addSite') : t('geofencing.editSite')}
                    </Heading>
                  </HStack>

                  <VStack space="lg">
                    <Input variant="outline" rounded="$xl" bg={Palette.gray50}>
                      <InputField placeholder={t('geofencing.siteNamePlaceholder')} value={form.name} onChangeText={(v) => set({ name: v })} />
                    </Input>

                    {/* Address search */}
                    <HStack space="sm">
                      <Input variant="outline" rounded="$xl" bg={Palette.gray50} flex={1}>
                        <InputField placeholder={t('geofencing.searchAddress')} value={searchQ} onChangeText={setSearchQ} onSubmitEditing={doSearch} />
                      </Input>
                      <Button onPress={doSearch} bg={Palette.blue} rounded="$xl" px="$3" disabled={searching}>
                        {searching ? <Spinner color={Palette.white} size="small" /> : <Search size={16} color={Palette.white} />}
                      </Button>
                    </HStack>
                    {searchError ? (
                      <Text fontSize={Type.tiny} color={Palette.error}>{searchError}</Text>
                    ) : null}
                    {searchResults.length > 0 ? (
                      <VStack space="xs">
                        {searchResults.map((r, i) => (
                          <Pressable key={i} onPress={() => pickResult(r)}>
                            <Box bg={Palette.blueTint} rounded="$lg" p="$3">
                              <Text fontSize={Type.small} color={Palette.ink}>{r.name}</Text>
                            </Box>
                          </Pressable>
                        ))}
                      </VStack>
                    ) : null}

                    <Button variant="outline" onPress={useMyLocation} disabled={locating} borderColor={Palette.teal} rounded="$xl">
                      {locating ? <Spinner color={Palette.teal} size="small" /> : <LocateFixed size={16} color={Palette.teal} />}
                      <ButtonText color={Palette.teal}>{t('geofencing.useMyLocation')}</ButtonText>
                    </Button>

                    <HStack space="sm">
                      <Input variant="outline" rounded="$xl" bg={Palette.gray50} flex={1}>
                        <InputField keyboardType="decimal-pad" placeholder="Latitude" value={form.lat} onChangeText={(v) => set({ lat: v })} />
                      </Input>
                      <Input variant="outline" rounded="$xl" bg={Palette.gray50} flex={1}>
                        <InputField keyboardType="decimal-pad" placeholder="Longitude" value={form.lng} onChangeText={(v) => set({ lng: v })} />
                      </Input>
                    </HStack>

                    <Input variant="outline" rounded="$xl" bg={Palette.gray50}>
                      <InputField keyboardType="number-pad" placeholder={t('geofencing.radiusMeters')} value={form.radius} onChangeText={(v) => set({ radius: v })} />
                    </Input>

                    <Text fontSize={Type.label} fontWeight="700" color={Palette.ink}>{t('geofencing.mode')}</Text>
                    <HStack space="sm">
                      {(['block', 'flag'] as const).map((m) => chip(t(`geofencing.mode${m === 'block' ? 'Block' : 'Flag'}`), form.mode === m, () => set({ mode: m })))}
                    </HStack>

                    <Pressable onPress={() => set({ active: !form.active })}>
                      <HStack space="sm" alignItems="center">
                        <Box style={{ width: 40, height: 24, borderRadius: 12, backgroundColor: form.active ? Palette.teal : Palette.gray300, padding: 3 }}>
                          <Box style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: Palette.white, alignSelf: form.active ? 'flex-end' : 'flex-start' }} />
                        </Box>
                        <Text fontSize={Type.label} color={Palette.ink}>{t('geofencing.active')}</Text>
                      </HStack>
                    </Pressable>
                  </VStack>
                </ScrollView>
              </ModalBody>
              <ModalFooter>
                <Button variant="outline" onPress={() => setShowForm(false)} disabled={saving} borderColor={Palette.gray200} rounded="$xl" flex={1}>
                  <ButtonText color={Palette.gray500}>{t('geofencing.cancel')}</ButtonText>
                </Button>
                <Button onPress={save} disabled={saving} bg={Palette.blue} rounded="$xl" flex={1}>
                  {saving ? <Spinner color={Palette.white} size="small" /> : null}
                  <ButtonText>{saving ? t('geofencing.saving') : t('geofencing.save')}</ButtonText>
                </Button>
              </ModalFooter>
            </ModalContent>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    </LinearGradient>
  );
}