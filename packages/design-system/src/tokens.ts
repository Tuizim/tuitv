/**
 * Identidade visual oficial do TuiTV (PRD §5).
 * Os mesmos valores são usados em Kotlin: packages/android-core/.../ui/TuiColors.kt
 */
export const colors = {
  navy: '#101827',
  navyRaised: '#172B46',
  cyan: '#38BDF8',
  white: '#FFFFFF',
  // Derivadas
  navyDeep: '#0B111D',
  line: '#22344F',
  muted: '#93A4BB',
  danger: '#F87171',
  success: '#34D399',
  warning: '#FBBF24',
} as const;

export const brand = {
  name: 'TuiTV',
  tagline: 'Seu entretenimento em um só lugar.',
} as const;

export type ColorToken = keyof typeof colors;
