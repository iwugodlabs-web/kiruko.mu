import { Palette, Type } from '@/app/constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EntryMode, dashboardRouteForMode, setEntryMode } from '@/services/entryMode';

export default function ChooseModeScreen() {
  const { t } = useTranslation();

  const choose = async (mode: EntryMode) => {
    await setEntryMode(mode);
    router.replace(dashboardRouteForMode(mode) as any);
  };

  const Card = ({ mode, icon, color, tint, title, desc }: {
    mode: EntryMode; icon: any; color: string; tint: string; title: string; desc: string;
  }) => (
    <Pressable
      onPress={() => choose(mode)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: tint,
        borderColor: color + '40',
        borderWidth: 1.5,
        borderRadius: 20,
        paddingVertical: 20,
        paddingHorizontal: 18,
        marginBottom: 16,
        shadowColor: Palette.black,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.06,
        shadowRadius: 12,
        elevation: 3,
      }}
    >
      <View style={{ width: 54, height: 54, borderRadius: 16, backgroundColor: color, alignItems: 'center', justifyContent: 'center', marginRight: 16 }}>
        <MaterialIcons name={icon} size={24} color={Palette.white} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: Type.h3, fontWeight: '800', color: Palette.ink, letterSpacing: -0.3 }}>{title}</Text>
        <Text style={{ fontSize: Type.small, color: Palette.gray600, marginTop: 3, lineHeight: 17 }}>{desc}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={24} color={color} />
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Image source={require('@/assets/images/kiruko-mark.png')} style={styles.mark} resizeMode="contain" />
        <Text style={styles.title}>{t('chooseMode.title') || 'Welcome back'}</Text>
        <Text style={styles.subtitle}>{t('chooseMode.subtitle') || 'How do you want to continue today?'}</Text>
      </View>

      <View>
        <Card
          mode="employer"
          icon="business-center"
          color={Palette.indigo}
          tint={Palette.blueTint}
          title={t('chooseMode.employerTitle') || 'Employer'}
          desc={t('chooseMode.employerDesc') || 'Manage your team, schedules & payroll'}
        />
        <Card
          mode="employee"
          icon="badge"
          color={Palette.teal}
          tint={Palette.tealTint}
          title={t('chooseMode.employeeTitle') || 'Employee'}
          desc={t('chooseMode.employeeDesc') || 'Clock in, payslips, leave & tasks'}
        />
      </View>

      <Text style={styles.footnote}>{t('chooseMode.footnote') || 'Remembered until you sign out.'}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Palette.white, paddingHorizontal: 24, justifyContent: 'center' },
  header: { alignItems: 'center', marginBottom: 34 },
  mark: { width: 60, height: 60, marginBottom: 20 },
  title: { fontSize: Type.display, fontWeight: '800', color: Palette.ink, letterSpacing: -0.5, textAlign: 'center' },
  subtitle: { fontSize: Type.title, color: Palette.gray500, textAlign: 'center', marginTop: 8, lineHeight: 22 },
  footnote: { fontSize: Type.caption, color: Palette.gray400, textAlign: 'center', marginTop: 30 },
});
