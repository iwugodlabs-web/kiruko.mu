// Re-export from the context for backward compatibility
export { useCurrency as useCurrencyHook, CurrencyProvider, AVAILABLE_CURRENCIES } from '../context/CurrencyContext';
export type { Currency } from '../context/CurrencyContext';

// Default export
import { useCurrency as useCurrencyHook } from '../context/CurrencyContext';
export default useCurrencyHook;