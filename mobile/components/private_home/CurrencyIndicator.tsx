import React from 'react';
import { Palette } from '@/app/constants/theme';
import { Box, Text, HStack } from '@gluestack-ui/themed';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import useCurrency from '@/app/hooks/useCurrency';

const CurrencyIndicator: React.FC = () => {
  const { t } = useTranslation();
  const { currency, baseCurrency, getExchangeRate } = useCurrency();
  
  if (currency === baseCurrency) {
    return null; // No conversion needed
  }
  
  const rate = getExchangeRate(baseCurrency, currency);
  
  return (
    <Box 
      bg="rgba(59, 130, 246, 0.1)" 
      p="$2" 
      rounded="$lg" 
      borderWidth={1} 
      borderColor="rgba(59, 130, 246, 0.3)"
      mb="$2"
    >
      <HStack alignItems="center" space="xs" justifyContent="center">
        <MaterialIcons name="sync" size={14} color={Palette.blue} />
        <Text fontSize={11} color="$blue700" fontWeight="600">
          {t('privateHomeCards.converting', { currency: baseCurrency, rate: rate.toFixed(4) })}
        </Text>
        <MaterialIcons name="info-outline" size={12} color={Palette.blue} />
      </HStack>
    </Box>
  );
};

export default CurrencyIndicator;