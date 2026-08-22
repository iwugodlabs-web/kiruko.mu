import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ExchangeRates {
  [currencyCode: string]: number;
}

export interface CurrencyConversionData {
  rates: ExchangeRates;
  baseCurrency: string;
  lastUpdated: number;
}

const EXCHANGE_RATES_KEY = 'exchangeRates';
const RATES_CACHE_DURATION = 3600000; // 1 hour in milliseconds
const DEFAULT_BASE_CURRENCY = 'MUR'; // Mauritian Rupee as default base

// Free exchange rate API - you can replace with your preferred service
const EXCHANGE_API_URL = 'https://api.exchangerate-api.com/v4/latest';

export class CurrencyConverter {
  private static instance: CurrencyConverter;
  private rates: ExchangeRates = {};
  private baseCurrency: string = DEFAULT_BASE_CURRENCY;
  private lastUpdated: number = 0;

  private constructor() {}

  static getInstance(): CurrencyConverter {
    if (!CurrencyConverter.instance) {
      CurrencyConverter.instance = new CurrencyConverter();
    }
    return CurrencyConverter.instance;
  }

  /**
   * Initialize converter with cached rates
   */
  async initialize(): Promise<void> {
    try {
      const cached = await this.getCachedRates();
      if (cached) {
        this.rates = cached.rates;
        this.baseCurrency = cached.baseCurrency;
        this.lastUpdated = cached.lastUpdated;
        console.log('💱 CurrencyConverter: Loaded cached rates', { baseCurrency: this.baseCurrency, lastUpdated: new Date(this.lastUpdated) });
      }
      
      // Update rates if cache is stale or empty
      if (this.shouldUpdateRates()) {
        await this.updateExchangeRates();
      }
    } catch (error) {
      console.error('❌ CurrencyConverter: Initialize error:', error);
      // Set default rates as fallback
      this.setDefaultRates();
    }
  }

  /**
   * Check if rates need updating
   */
  private shouldUpdateRates(): boolean {
    const now = Date.now();
    const isStale = now - this.lastUpdated > RATES_CACHE_DURATION;
    const isEmpty = Object.keys(this.rates).length === 0;
    return isEmpty || isStale;
  }

  /**
   * Fetch latest exchange rates from API
   */
  async updateExchangeRates(baseCurrency: string = this.baseCurrency): Promise<void> {
    try {
      console.log('🔄 CurrencyConverter: Fetching exchange rates for', baseCurrency);
      
      const response = await fetch(`${EXCHANGE_API_URL}/${baseCurrency}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      if (!data.rates) {
        throw new Error('Invalid API response: no rates data');
      }

      this.rates = data.rates;
      this.baseCurrency = baseCurrency;
      this.lastUpdated = Date.now();

      // Cache the rates
      await this.cacheRates();
      
      console.log('✅ CurrencyConverter: Updated exchange rates', { 
        baseCurrency: this.baseCurrency, 
        ratesCount: Object.keys(this.rates).length,
        sampleRates: {
          USD: this.rates.USD,
          EUR: this.rates.EUR,
          GBP: this.rates.GBP
        }
      });
    } catch (error) {
      console.error('❌ CurrencyConverter: Failed to update exchange rates:', error);
      
      // If no cached rates, set default fallback rates
      if (Object.keys(this.rates).length === 0) {
        this.setDefaultRates();
      }
      throw error;
    }
  }

  /**
   * Set default fallback rates (approximate rates as of late 2024)
   */
  private setDefaultRates(): void {
    console.log('⚠️ CurrencyConverter: Using default fallback rates');
    this.baseCurrency = 'MUR';
    this.rates = {
      MUR: 1,
      USD: 0.022, // 1 MUR ≈ 0.022 USD
      EUR: 0.021, // 1 MUR ≈ 0.021 EUR  
      GBP: 0.018, // 1 MUR ≈ 0.018 GBP
      INR: 1.83,  // 1 MUR ≈ 1.83 INR
      ZAR: 0.40,  // 1 MUR ≈ 0.40 ZAR
    };
    this.lastUpdated = Date.now();
  }

  /**
   * Convert amount from one currency to another
   */
  convert(amount: number, fromCurrency: string, toCurrency: string): number {
    if (fromCurrency === toCurrency) {
      return amount;
    }

    if (!this.rates[fromCurrency] || !this.rates[toCurrency]) {
      console.warn(`⚠️ CurrencyConverter: Missing rate for ${fromCurrency} or ${toCurrency}, returning original amount`);
      return amount;
    }

    // Convert to base currency first, then to target currency
    const baseAmount = fromCurrency === this.baseCurrency 
      ? amount 
      : amount / this.rates[fromCurrency];
    
    const convertedAmount = toCurrency === this.baseCurrency 
      ? baseAmount 
      : baseAmount * this.rates[toCurrency];

    return convertedAmount;
  }

  /**
   * Get current exchange rate between two currencies
   */
  getExchangeRate(fromCurrency: string, toCurrency: string): number {
    if (fromCurrency === toCurrency) return 1;
    
    if (!this.rates[fromCurrency] || !this.rates[toCurrency]) {
      return 1; // Fallback to 1:1 if rates not available
    }

    return this.rates[toCurrency] / this.rates[fromCurrency];
  }

  /**
   * Get all available currency rates
   */
  getAllRates(): ExchangeRates {
    return { ...this.rates };
  }

  /**
   * Get base currency
   */
  getBaseCurrency(): string {
    return this.baseCurrency;
  }

  /**
   * Get last update timestamp
   */
  getLastUpdated(): Date {
    return new Date(this.lastUpdated);
  }

  /**
   * Check if rates are available for a currency
   */
  isSupported(currencyCode: string): boolean {
    return currencyCode in this.rates;
  }

  /**
   * Cache rates to AsyncStorage
   */
  private async cacheRates(): Promise<void> {
    try {
      const cacheData: CurrencyConversionData = {
        rates: this.rates,
        baseCurrency: this.baseCurrency,
        lastUpdated: this.lastUpdated,
      };
      await AsyncStorage.setItem(EXCHANGE_RATES_KEY, JSON.stringify(cacheData));
    } catch (error) {
      console.error('❌ CurrencyConverter: Failed to cache rates:', error);
    }
  }

  /**
   * Get cached rates from AsyncStorage
   */
  private async getCachedRates(): Promise<CurrencyConversionData | null> {
    try {
      const cached = await AsyncStorage.getItem(EXCHANGE_RATES_KEY);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      console.error('❌ CurrencyConverter: Failed to get cached rates:', error);
    }
    return null;
  }

  /**
   * Force refresh exchange rates
   */
  async forceRefresh(baseCurrency?: string): Promise<void> {
    await this.updateExchangeRates(baseCurrency || this.baseCurrency);
  }

  /**
   * Clear cached rates
   */
  async clearCache(): Promise<void> {
    try {
      await AsyncStorage.removeItem(EXCHANGE_RATES_KEY);
      this.rates = {};
      this.lastUpdated = 0;
      console.log('🗑️ CurrencyConverter: Cache cleared');
    } catch (error) {
      console.error('❌ CurrencyConverter: Failed to clear cache:', error);
    }
  }
}

// Export singleton instance
export const currencyConverter = CurrencyConverter.getInstance();