import React from 'react';
import { Palette } from '@/app/constants/theme';
import {
  Box,
  Button,
  ButtonText,
  Heading,
  HStack,
  Pressable,
  Text,
  VStack
} from '@gluestack-ui/themed';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeIn } from '@/app/utils/animated';

interface CurrencySettingsProps {
  currentCurrency: string;
  onCurrencyChange: (currency: string) => void;
}

const SUPPORTED_CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$', flag: '🇺🇸' },
  { code: 'EUR', name: 'Euro', symbol: '€', flag: '🇪🇺' },
  { code: 'GBP', name: 'British Pound', symbol: '£', flag: '🇬🇧' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', flag: '🇯🇵' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', flag: '🇦🇺' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', flag: '🇨🇦' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', flag: '🇨🇭' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', flag: '🇨🇳' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', flag: '🇮🇳' },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: 'Rs', flag: '🇵🇰' },
  { code: 'MUR', name: 'Mauritian Rupee', symbol: '₨', flag: '🇲🇺' },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', flag: '🇰🇷' },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽', flag: '🇷🇺' },
];

const CurrencySettings: React.FC<CurrencySettingsProps> = ({
  currentCurrency,
  onCurrencyChange,
}) => {
  const formatPreview = (currency: string) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(1250);
    } catch {
      const currencyInfo = SUPPORTED_CURRENCIES.find(c => c.code === currency);
      return `${currencyInfo?.symbol || '$'}1,250`;
    }
  };

  return (
    <Animated.View entering={FadeIn.duration(600)}>
      <Box
        bg="white"
        p="$6"
        rounded="$3xl"
        shadowColor="$shadowColor"
        shadowOffset={{ width: 0, height: 4 }}
        shadowOpacity={0.1}
        shadowRadius={20}
        elevation={8}
        borderWidth={1}
        borderColor="$borderLight100"
      >
        <VStack space="lg">
          {/* Header */}
          <HStack alignItems="center" space="sm">
            <Box bg="$primary100" p="$3" rounded="$full">
              <MaterialIcons name="attach-money" size={24} color={Palette.blue} />
            </Box>
            <VStack flex={1}>
              <Heading size="lg" color="$textDark900" fontWeight="700">
                Currency Settings
              </Heading>
              <Text color="$textLight600" fontSize={14}>
                Choose your preferred currency for displaying earnings
              </Text>
            </VStack>
          </HStack>

          {/* Current Selection */}
          <Box bg="$blue50" p="$4" rounded="$xl">
            <VStack space="sm">
              <Text color="$blue700" fontWeight="600" fontSize={14}>
                Current Currency
              </Text>
              <HStack alignItems="center" justifyContent="space-between">
                <HStack alignItems="center" space="md">
                  <Text fontSize={24}>
                    {SUPPORTED_CURRENCIES.find(c => c.code === currentCurrency)?.flag || '💰'}
                  </Text>
                  <VStack>
                    <Text color="$blue900" fontWeight="700" fontSize={16}>
                      {SUPPORTED_CURRENCIES.find(c => c.code === currentCurrency)?.name || 'Unknown'}
                    </Text>
                    <Text color="$blue700" fontSize={14}>
                      {currentCurrency}
                    </Text>
                  </VStack>
                </HStack>
                <Text color="$blue800" fontWeight="600" fontSize={18}>
                  {formatPreview(currentCurrency)}
                </Text>
              </HStack>
            </VStack>
          </Box>

          {/* Currency Options */}
          <VStack space="xs">
            <Text fontWeight="600" color="$textDark700" fontSize={14}>
              Available Currencies:
            </Text>
            
            <VStack space="xs" maxHeight={300}>
              {SUPPORTED_CURRENCIES.map((currency) => (
                <Pressable
                  key={currency.code}
                  onPress={() => onCurrencyChange(currency.code)}
                  disabled={currency.code === currentCurrency}
                >
                  <Box
                    bg={currency.code === currentCurrency ? '$primary50' : '$gray50'}
                    p="$3"
                    rounded="$xl"
                    borderWidth={1}
                    borderColor={currency.code === currentCurrency ? '$primary200' : '$gray200'}
                    opacity={currency.code === currentCurrency ? 0.7 : 1}
                  >
                    <HStack alignItems="center" justifyContent="space-between">
                      <HStack alignItems="center" space="md" flex={1}>
                        <Text fontSize={20}>
                          {currency.flag}
                        </Text>
                        <VStack flex={1}>
                          <Text 
                            color={currency.code === currentCurrency ? '$primary700' : '$textDark900'} 
                            fontWeight="600" 
                            fontSize={14}
                            numberOfLines={1}
                          >
                            {currency.name}
                          </Text>
                          <Text 
                            color={currency.code === currentCurrency ? '$primary600' : '$textLight600'} 
                            fontSize={12}
                          >
                            {currency.code} • {currency.symbol}
                          </Text>
                        </VStack>
                      </HStack>
                      
                      <VStack alignItems="flex-end">
                        <Text 
                          color={currency.code === currentCurrency ? '$primary800' : '$textDark700'} 
                          fontWeight="600" 
                          fontSize={14}
                        >
                          {formatPreview(currency.code)}
                        </Text>
                        {currency.code === currentCurrency && (
                          <HStack alignItems="center" space="xs">
                            <MaterialIcons name="check-circle" size={16} color={Palette.success} />
                            <Text color="$green700" fontSize={10} fontWeight="600">
                              SELECTED
                            </Text>
                          </HStack>
                        )}
                      </VStack>
                    </HStack>
                  </Box>
                </Pressable>
              ))}
            </VStack>
          </VStack>

          {/* Info */}
          <Box bg="$gray50" p="$4" rounded="$xl">
            <HStack alignItems="center" space="sm">
              <MaterialIcons name="info-outline" size={20} color={Palette.gray500} />
              <VStack flex={1}>
                <Text color="$gray700" fontSize={12} fontWeight="600">
                  Currency Display Info
                </Text>
                <Text color="$gray600" fontSize={11}>
                  This setting only changes how amounts are displayed. Your actual pay calculations remain in your company's configured currency.
                </Text>
              </VStack>
            </HStack>
          </Box>
        </VStack>
      </Box>
    </Animated.View>
  );
};

export default CurrencySettings;