import React from 'react';
import { Palette } from '@/app/constants/theme';
import { HStack, Pressable, Text } from '@gluestack-ui/themed';
import { useTranslation } from 'react-i18next';

interface ClockInModeTabsProps {
  clockInMode: 'clockin' | 'leave';
  setClockInMode: (mode: 'clockin' | 'leave') => void;
  primary: string;
}

const ClockInModeTabs: React.FC<ClockInModeTabsProps> = ({
  clockInMode,
  setClockInMode,
  primary
}) => {
  const { t } = useTranslation();
  return (
    <HStack justifyContent="center" space="sm" mb="$2">
      <Pressable
        onPress={() => setClockInMode('clockin')}
        accessibilityLabel={t('calculator.tabClockIn')}
        style={{
          paddingVertical: 8,
          paddingHorizontal: 14,
          borderRadius: 999,
          backgroundColor: clockInMode === 'clockin' ? primary : 'transparent',
          borderWidth: clockInMode === 'clockin' ? 0 : 1,
          borderColor: clockInMode === 'clockin' ? 'transparent' : Palette.gray200
        }}
      >
        <Text color={clockInMode === 'clockin' ? Palette.white : '$text800'} fontWeight="$semibold">{t('calculator.tabClockIn')}</Text>
      </Pressable>
      <Pressable
        onPress={() => setClockInMode('leave')}
        accessibilityLabel={t('calculator.tabLeave')}
        style={{
          paddingVertical: 8,
          paddingHorizontal: 14,
          borderRadius: 999,
          backgroundColor: clockInMode === 'leave' ? primary : 'transparent',
          borderWidth: clockInMode === 'leave' ? 0 : 1,
          borderColor: clockInMode === 'leave' ? 'transparent' : Palette.gray200
        }}
      >
        <Text color={clockInMode === 'leave' ? Palette.white : '$text800'} fontWeight="$semibold">{t('calculator.tabLeave')}</Text>
      </Pressable>
    </HStack>
  );
};

export default ClockInModeTabs;