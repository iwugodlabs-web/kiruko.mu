/**
 * Currency utility functions for Mauritian Rupee (Rs) formatting
 */

/**
 * Format amount as Mauritian Rupee with proper prefix
 * @param amount - The amount to format
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted currency string
 */
export const formatMauritianRupee = (amount: number, decimals: number = 2): string => {
  if (isNaN(amount)) return 'Rs 0.00';
  return `Rs ${amount.toFixed(decimals)}`;
};

/**
 * Format amount as compact Mauritian Rupee (e.g., Rs 1.2K, Rs 1.5M)
 * @param amount - The amount to format
 * @returns Compact formatted currency string
 */
export const formatMauritianRupeeCompact = (amount: number): string => {
  if (isNaN(amount)) return 'Rs 0';
  const formatted = Intl.NumberFormat('en-US', { 
    notation: 'compact', 
    compactDisplay: 'short' 
  }).format(amount);
  return `Rs ${formatted}`;
};

/**
 * Parse currency string and extract numeric value
 * @param currencyString - String like "Rs 1,234.56" or "1234.56"
 * @returns Numeric value
 */
export const parseMauritianRupee = (currencyString: string): number => {
  if (!currencyString) return 0;
  
  // Remove Rs prefix and any commas, then parse
  const cleanString = currencyString
    .replace(/^Rs\s*/i, '')
    .replace(/,/g, '')
    .trim();
    
  const parsed = parseFloat(cleanString);
  return isNaN(parsed) ? 0 : parsed;
};

/**
 * Get currency symbol for Mauritian Rupee
 * @returns Currency symbol/prefix
 */
export const getMauritianRupeeSymbol = (): string => {
  return 'Rs';
};

/**
 * Get currency code for Mauritian Rupee
 * @returns Currency code
 */
export const getMauritianRupeeCurrencyCode = (): string => {
  return 'MUR';
};

/**
 * Format amount with thousands separators (e.g., Rs 1,234,567.89)
 * @param amount - The amount to format
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted currency string with thousands separators
 */
export const formatMauritianRupeeWithSeparators = (amount: number, decimals: number = 2): string => {
  if (isNaN(amount)) return 'Rs 0.00';
  
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
  
  return `Rs ${formatted}`;
};

/**
 * Default export for easy importing
 */
export default {
  format: formatMauritianRupee,
  formatCompact: formatMauritianRupeeCompact,
  formatWithSeparators: formatMauritianRupeeWithSeparators,
  parse: parseMauritianRupee,
  symbol: getMauritianRupeeSymbol,
  currencyCode: getMauritianRupeeCurrencyCode,
};