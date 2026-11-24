/**
 * MediMove design tokens.
 *
 * Single source of truth for the mandatory design system. Colours, type,
 * spacing, radius and elevation are defined here only; screens must never
 * hard-code colour values.
 *
 * The product is light mode only. Soft tints are alpha values of the approved
 * palette colours, so no unapproved hex colours enter the product.
 */

import { Platform, type TextStyle, type ViewStyle } from 'react-native'

export type ColorSchemeName = 'light'

export interface ThemeColors {
  /** App canvas behind everything. */
  bg: string
  /** Elevated surfaces such as headers, sheets and nav bars. */
  bgElevated: string
  /** Cards and grouped surfaces. */
  surface: string
  /** Inputs, pressed states and subtle highlights. */
  surfaceAlt: string
  /** Alias for the subtle highlight surface. */
  subtle: string
  border: string
  borderStrong: string
  /** Modal scrim, derived from the active canvas. */
  overlay: string
  /** Restrained shadow tint derived from the active palette. */
  shadow: string

  text: string
  textMuted: string
  textFaint: string
  textInverse: string

  /** Primary navigation, active states and main action. */
  primary: string
  primaryPressed: string
  primarySoft: string
  onPrimary: string
  onPrimarySoft: string
  /** Translucent primary foreground for icons sitting on brand surfaces. */
  onPrimaryOverlay: string

  /** Calm clinical accent for secondary actions and information. */
  secondary: string
  secondaryPressed: string
  secondarySoft: string
  onSecondary: string
  onSecondarySoft: string

  /** Reserved for urgent, user-initiated actions only. */
  emergency: string
  emergencyPressed: string
  emergencySoft: string
  onEmergency: string
  onEmergencySoft: string

  success: string
  successSoft: string
  onSuccessSoft: string
  warning: string
  warningSoft: string
  onWarningSoft: string
  info: string
  infoSoft: string
  onInfoSoft: string

  disabled: string
  onDisabled: string
}

/** Convert an approved hex colour into an alpha tint of that same colour. */
function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const light = {
  primary: '#145B63',
  secondary: '#087F8C',
  bg: '#F4F7F8',
  surface: '#FFFFFF',
  elevated: '#FFFFFF',
  highlight: '#EAF3F5',
  text: '#172B3A',
  textSecondary: '#64748B',
  textMuted: '#94A3B8',
  border: '#E2E8F0',
  success: '#16845B',
  warning: '#D97706',
  error: '#D92D20',
  onPrimary: '#FFFFFF',
  onSecondary: '#FFFFFF',
  onError: '#FFFFFF',
} as const

export const lightColors: ThemeColors = {
  bg: light.bg,
  bgElevated: light.elevated,
  surface: light.surface,
  surfaceAlt: light.highlight,
  subtle: light.highlight,
  border: light.border,
  borderStrong: light.textMuted,
  overlay: withAlpha(light.text, 0.45),
  shadow: withAlpha(light.primary, 0.14),

  text: light.text,
  textMuted: light.textSecondary,
  textFaint: light.textMuted,
  textInverse: light.bg,

  primary: light.primary,
  primaryPressed: light.primary,
  primarySoft: light.highlight,
  onPrimary: light.onPrimary,
  onPrimarySoft: light.primary,
  onPrimaryOverlay: withAlpha(light.onPrimary, 0.18),

  secondary: light.secondary,
  secondaryPressed: light.secondary,
  secondarySoft: light.highlight,
  onSecondary: light.onSecondary,
  onSecondarySoft: light.secondary,

  emergency: light.error,
  emergencyPressed: light.error,
  emergencySoft: withAlpha(light.error, 0.08),
  onEmergency: light.onError,
  onEmergencySoft: light.error,

  success: light.success,
  successSoft: withAlpha(light.success, 0.10),
  onSuccessSoft: light.success,
  warning: light.warning,
  warningSoft: withAlpha(light.warning, 0.10),
  onWarningSoft: light.warning,
  info: light.secondary,
  infoSoft: light.highlight,
  onInfoSoft: light.secondary,

  disabled: light.border,
  onDisabled: light.textMuted,
}

/** Kept as a named export for non-hook consumers. The app is light mode only. */
export function getColors(): ThemeColors {
  return lightColors
}

/** The app is light mode only; kept as a named export for compatibility. */
export const colors: ThemeColors = lightColors

/** 4pt spacing scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  xxxxl: 40,
} as const

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  xxl: 28,
  pill: 999,
} as const

/** Recurring component dimensions from the design constitution. */
export const componentSizes = {
  screenPadding: 20,
  sectionSpacing: 24,
  inputHeight: 54,
  buttonHeight: 56,
  buttonHeightLarge: 58,
  listRowHeight: 56,
  touchTarget: 44,
} as const

/** The single typeface used across the entire product. */
export const FONT_FAMILY = 'Manrope'

export type TextVariant =
  | 'display'
  | 'title'
  | 'heading'
  | 'subheading'
  | 'body'
  | 'bodyStrong'
  | 'button'
  | 'label'
  | 'caption'
  | 'micro'

/** React Native types only list fixed weights; the variable font supports 650. */
const weight = (value: string) => value as unknown as TextStyle['fontWeight']

/**
 * Manrope type scale. Weights are deliberately varied: only headings, buttons
 * and labels are heavy, while body and supporting copy stay regular.
 */
export const typography: Record<TextVariant, TextStyle> = {
  display: { fontFamily: FONT_FAMILY, fontSize: 28, lineHeight: 34, fontWeight: weight('700') },
  title: { fontFamily: FONT_FAMILY, fontSize: 24, lineHeight: 30, fontWeight: weight('700') },
  heading: { fontFamily: FONT_FAMILY, fontSize: 19, lineHeight: 25, fontWeight: weight('700') },
  subheading: { fontFamily: FONT_FAMILY, fontSize: 16, lineHeight: 22, fontWeight: weight('650') },
  body: { fontFamily: FONT_FAMILY, fontSize: 15, lineHeight: 22, fontWeight: weight('400') },
  bodyStrong: { fontFamily: FONT_FAMILY, fontSize: 15, lineHeight: 22, fontWeight: weight('600') },
  button: { fontFamily: FONT_FAMILY, fontSize: 15, lineHeight: 20, fontWeight: weight('700') },
  label: { fontFamily: FONT_FAMILY, fontSize: 12, lineHeight: 16, fontWeight: weight('600') },
  caption: { fontFamily: FONT_FAMILY, fontSize: 13, lineHeight: 18, fontWeight: weight('400') },
  micro: { fontFamily: FONT_FAMILY, fontSize: 12, lineHeight: 16, fontWeight: weight('400') },
}

export type Elevation = 'none' | 'sm' | 'md' | 'lg'

/**
 * Depth is deliberately restrained: a hairline border does most of the work.
 * Only the `lg` preset adds a soft, on-palette shadow for sheets and overlays.
 */
export function elevation(level: Elevation): ViewStyle {
  if (level === 'none' || level === 'sm' || level === 'md') return {}
  return Platform.select<ViewStyle>({
    ios: {
      shadowColor: lightColors.shadow,
      shadowOpacity: 0.16,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 10 },
    },
    android: { elevation: 8 },
    default: {},
  }) as ViewStyle
}

/** Minimum tap target size recommended by both iOS and Android. */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const
export const MIN_TAP = 44
