import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { currencyConverter } from '../services/currencyConverter';

export interface Currency {
  code: string;
  name: string;
  symbol: string;
}

export const AVAILABLE_CURRENCIES: Currency[] = [
  { code: 'MUR', name: 'Mauritian Rupee', symbol: '₨' },
  { code: 'MGA', name: 'Malagasy Ariary', symbol: 'Ar' },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R' },
];

const CURRENCY_STORAGE_KEY = 'userCurrency';
const BASE_CURRENCY_STORAGE_KEY = 'baseCurrency';

interface CurrencyContextType {
  currency: string;
  currencyInfo: Currency;
  baseCurrency: string;
  isLoading: boolean;
  updateCurrency: (newCurrency: string) => Promise<void>;
  updateBaseCurrency: (newBaseCurrency: string) => Promise<void>;
  formatCurrency: (
    amount: number, 
    options?: { 
      minimumFractionDigits?: number; 
      maximumFractionDigits?: number;
      showSymbol?: boolean;
      currencyCode?: string;
      convert?: boolean;
      fromCurrency?: string;
    }
  ) => string;
  convertCurrency: (amount: number, fromCurrency: string, toCurrency: string) => number;
  getCurrencyInfo: (currencyCode?: string) => Currency;
  getExchangeRate: (fromCurrency: string, toCurrency: string) => number;
  refreshExchangeRates: () => Promise<void>;
  availableCurrencies: Currency[];
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export const CurrencyProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currency, setCurrency] = useState<string>('MUR'); // Display currency
  const [baseCurrency, setBaseCurrency] = useState<string>('MUR'); // Base currency for amounts
  const [isLoading, setIsLoading] = useState(true);

  // Load currency and initialize converter on mount
  useEffect(() => {
    const initializeCurrency = async () => {
      try {
        console.log('🔄 Currency: Initializing currency system');
        
        // Initialize currency converter
        await currencyConverter.initialize();
        
        // Load saved currencies
        const [savedCurrency, savedBaseCurrency] = await Promise.all([
          AsyncStorage.getItem(CURRENCY_STORAGE_KEY),
          AsyncStorage.getItem(BASE_CURRENCY_STORAGE_KEY)
        ]);
        
        if (savedCurrency) {
          console.log('✅ Currency: Found saved display currency:', savedCurrency);
          setCurrency(savedCurrency);
        }
        
        if (savedBaseCurrency) {
          console.log('✅ Currency: Found saved base currency:', savedBaseCurrency);
          setBaseCurrency(savedBaseCurrency);
        } else {
          // Use converter's base currency as default
          const converterBaseCurrency = currencyConverter.getBaseCurrency();
          console.log('ℹ️ Currency: Using converter base currency:', converterBaseCurrency);
          setBaseCurrency(converterBaseCurrency);
        }
        
      } catch (error) {
        console.error('❌ Currency: Error initializing currency system:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    initializeCurrency();
  }, []);

  // Save currency to storage and update state
  const updateCurrency = useCallback(async (newCurrency: string) => {
    try {
      console.log('💰 Currency: Updating display currency to:', newCurrency);
      await AsyncStorage.setItem(CURRENCY_STORAGE_KEY, newCurrency);
      setCurrency(newCurrency);
      console.log('✅ Currency: Successfully updated display currency to:', newCurrency);
    } catch (error) {
      console.error('❌ Currency: Error saving currency to storage:', error);
      throw error;
    }
  }, []);

  // Update base currency (what amounts are stored in)
  const updateBaseCurrency = useCallback(async (newBaseCurrency: string) => {
    try {
      console.log('🏦 Currency: Updating base currency to:', newBaseCurrency);
      await AsyncStorage.setItem(BASE_CURRENCY_STORAGE_KEY, newBaseCurrency);
      setBaseCurrency(newBaseCurrency);
      
      // Update converter base currency and refresh rates
      await currencyConverter.forceRefresh(newBaseCurrency);
      console.log('✅ Currency: Successfully updated base currency to:', newBaseCurrency);
    } catch (error) {
      console.error('❌ Currency: Error updating base currency:', error);
      throw error;
    }
  }, []);

  // Convert currency amounts
  const convertCurrency = useCallback((amount: number, fromCurrency: string, toCurrency: string) => {
    return currencyConverter.convert(amount, fromCurrency, toCurrency);
  }, []);

  // Get exchange rate between currencies
  const getExchangeRate = useCallback((fromCurrency: string, toCurrency: string) => {
    return currencyConverter.getExchangeRate(fromCurrency, toCurrency);
  }, []);

  // Refresh exchange rates
  const refreshExchangeRates = useCallback(async () => {
    try {
      console.log('🔄 Currency: Refreshing exchange rates');
      await currencyConverter.forceRefresh();
      console.log('✅ Currency: Exchange rates refreshed');
    } catch (error) {
      console.error('❌ Currency: Error refreshing exchange rates:', error);
      throw error;
    }
  }, []);

  // Get currency object with symbol and name
  const getCurrencyInfo = useCallback((currencyCode?: string) => {
    const code = currencyCode || currency;
    return AVAILABLE_CURRENCIES.find(c => c.code === code) || AVAILABLE_CURRENCIES[0];
  }, [currency]);

  // Get current currency info
  const currencyInfo = getCurrencyInfo();

  // Format currency with proper symbol, locale, and optional conversion
  const formatCurrency = useCallback((
    amount: number, 
    options?: { 
      minimumFractionDigits?: number; 
      maximumFractionDigits?: number;
      showSymbol?: boolean;
      currencyCode?: string;
      convert?: boolean;
      fromCurrency?: string;
    }
  ) => {
    const targetCurrency = options?.currencyCode || currency;
    const fromCurrency = options?.fromCurrency || baseCurrency;
    const shouldConvert = options?.convert !== false; // Default to true
    
    let finalAmount = amount;
    
    // Convert currency if requested and different currencies
    if (shouldConvert && fromCurrency !== targetCurrency) {
      finalAmount = currencyConverter.convert(amount, fromCurrency, targetCurrency);
    }
    
    const currencyInfo = getCurrencyInfo(targetCurrency);
    
    try {
      // Use Intl.NumberFormat for proper currency formatting
      if (options?.showSymbol !== false) {
        return new Intl.NumberFormat(undefined, {
          style: 'currency',
          currency: targetCurrency,
          minimumFractionDigits: options?.minimumFractionDigits ?? 2,
          maximumFractionDigits: options?.maximumFractionDigits ?? 2,
        }).format(finalAmount);
      } else {
        // Just format the number without currency symbol
        return new Intl.NumberFormat(undefined, {
          minimumFractionDigits: options?.minimumFractionDigits ?? 2,
          maximumFractionDigits: options?.maximumFractionDigits ?? 2,
        }).format(finalAmount);
      }
    } catch (error) {
      // Fallback formatting if Intl fails
      const formattedAmount = finalAmount.toFixed(options?.maximumFractionDigits ?? 2);
      return options?.showSymbol !== false 
        ? `${currencyInfo.symbol} ${formattedAmount}`
        : formattedAmount;
    }
  }, [currency, baseCurrency, getCurrencyInfo]);

  const value: CurrencyContextType = {
    currency,
    currencyInfo,
    baseCurrency,
    isLoading,
    updateCurrency,
    updateBaseCurrency,
    formatCurrency,
    convertCurrency,
    getCurrencyInfo,
    getExchangeRate,
    refreshExchangeRates,
    availableCurrencies: AVAILABLE_CURRENCIES
  };

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
};

export const useCurrency = (): CurrencyContextType => {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
};

export default useCurrency;