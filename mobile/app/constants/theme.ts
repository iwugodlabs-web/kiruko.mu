/**
 * Kiruko design tokens — the single source of truth for app colors.
 *
 * Change a brand color here and it updates everywhere (all screens reference
 * these tokens; no inline hex colors). Brand palette mirrors
 * branding/kiruko-unity-brand.html, brightened for UI vibrancy.
 */
export const Palette = {
  // ---- Brand (vivid, coordinated) ----
  gold: '#F2B705',
  green: '#33CC11',
  teal: '#14B8A6',
  blue: '#4F6BE0',
  violet: '#8B5CF6',
  indigo: '#1E2A52',
  ink: '#16203B', // primary text / darkest surface

  // soft brand tints (card/badge backgrounds)
  goldTint: '#FFF6DB',
  greenTint: '#ECFDE7',
  tealTint: '#DEFAF4',
  blueTint: '#EAEEFC',
  violetTint: '#F1ECFE',

  // ---- Semantic status ----
  success: '#16A34A',
  successTint: '#D1FAE5',
  warning: '#F59E0B',
  warningTint: '#FEF3C7',
  error: '#DC2626',
  errorAlt: '#EF4444',
  errorTint: '#FEE2E2',
  info: '#4F6BE0',
  infoTint: '#EAEEFC',

  // ---- Neutrals (single gray scale) ----
  white: '#FFFFFF',
  black: '#000000',
  gray50: '#F9FAFB',
  gray100: '#F3F4F6',
  gray200: '#E5E7EB',
  gray300: '#D1D5DB',
  gray400: '#9CA3AF',
  gray500: '#6B7280',
  gray600: '#4B5563',
  gray700: '#374151',
  gray800: '#1F2937',
  gray900: '#16203B', // = ink
};

export type PaletteToken = keyof typeof Palette;

/**
 * Typography scale — the single source of truth for font sizes & weights.
 *
 * Use `Type.*` for fontSize and `Weight.*` for fontWeight so the whole app
 * shares one type ramp (change it here, it updates everywhere). Mirrors the
 * Palette pattern.
 */
export const Type = {
  hero: 40, // big hero numbers
  display: 32, // secondary hero / KPI headline
  h1: 24, // page title
  h2: 20, // major section title
  h3: 18, // sub-section title
  title: 16, // card title / emphasis
  body: 14, // default body text
  label: 13, // dense labels / list rows
  small: 12, // secondary labels
  caption: 11, // captions / meta
  tiny: 10, // micro labels / badges
};

export const Weight = {
  black: '800',
  bold: '700',
  semibold: '600',
  medium: '500',
  regular: '400',
} as const;

export type TypeToken = keyof typeof Type;
export default Palette;
