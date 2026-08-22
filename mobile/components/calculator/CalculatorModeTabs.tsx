import React from 'react';
import { Palette } from '@/app/constants/theme';
import { HStack, Pressable, Text } from '@gluestack-ui/themed';
import { useTranslation } from 'react-i18next';

interface CalculatorModeTabsProps {
  calculatorMode: 'manual' | 'clockin';
  setCalculatorMode: (mode: 'manual' | 'clockin') => void;
  primary: string;
}

const CalculatorModeTabs: React.FC<CalculatorModeTabsProps> = ({
  calculatorMode,
  setCalculatorMode,
  primary
}) => {
  const { t } = useTranslation();
  return (
    <HStack
      justifyContent="center"
      bg={Palette.gray100}
      rounded="$full"
      p="$2"
      mx="$2"
      mb="$2"
      borderWidth={1}
      borderColor={Palette.gray200}
    >
      <Pressable
        onPress={() => setCalculatorMode('manual')}
        accessibilityLabel={t('calculator.tabManual')}
        style={{
          paddingVertical: 9,
          paddingHorizontal: 20,
          borderRadius: 999,
          flex: 1,
          alignItems: 'center',
          backgroundColor: calculatorMode === 'manual' ? Palette.gray700 : 'transparent',
        }}
      >
        <Text
          color={calculatorMode === 'manual' ? Palette.white : Palette.gray700}
          fontWeight="$semibold"
          fontSize={14}
        >{t('calculator.tabManual')}</Text>
      </Pressable>
      <Pressable
        onPress={() => setCalculatorMode('clockin')}
        accessibilityLabel={t('calculator.tabClockIn')}
        style={{
          paddingVertical: 9,
          paddingHorizontal: 20,
          borderRadius: 999,
          flex: 1,
          alignItems: 'center',
          backgroundColor: calculatorMode === 'clockin' ? Palette.gray700 : 'transparent',
        }}
      >
        <Text
          color={calculatorMode === 'clockin' ? Palette.white : Palette.gray700}
          fontWeight="$semibold"
          fontSize={14}
        >{t('calculator.tabClockIn')}</Text>
      </Pressable>
    </HStack>
  );
};

export default CalculatorModeTabs;