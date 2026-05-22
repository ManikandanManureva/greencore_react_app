import Constants from 'expo-constants';

export type ProductionLineTitleKey =
  | 'login.productionLinePC'
  | 'login.productionLinePE'
  | 'login.productionLinePET'
  | 'login.productionLinePPIC'
  | 'login.appHeadline';

/** Maps API `user.role` to the correct production-line title (post-login). */
export function productionLineTitleKeyFromRole(role: string | undefined | null): ProductionLineTitleKey {
  const r = (role || '').toLowerCase();
  if (r === 'pe') return 'login.productionLinePE';
  if (r === 'pet') return 'login.productionLinePET';
  if (r === 'ppic') return 'login.productionLinePPIC';
  return 'login.productionLinePC';
}

/**
 * Login screen only: optional build profile (e.g. separate APK per line).
 * Set `expo.extra.productionLine` to `PC` | `PE` | `PET`, or `EXPO_PUBLIC_PRODUCTION_LINE` at build time.
 * If unset, use neutral `login.appHeadline`.
 */
export function loginScreenTitleKey(): ProductionLineTitleKey {
  const extra = Constants.expoConfig?.extra as { productionLine?: string } | undefined;
  const raw = (extra?.productionLine || process.env.EXPO_PUBLIC_PRODUCTION_LINE || '')
    .toString()
    .trim()
    .toUpperCase();
  if (raw === 'PE') return 'login.productionLinePE';
  if (raw === 'PET') return 'login.productionLinePET';
  if (raw === 'PC') return 'login.productionLinePC';
  return 'login.appHeadline';
}

/** True when the APK is the unified build (all lines on one app — recommended for PPIC / shared tablets). */
export function isUnifiedProductionBuild(): boolean {
  const extra = Constants.expoConfig?.extra as { productionLine?: string } | undefined;
  const raw = (extra?.productionLine || process.env.EXPO_PUBLIC_PRODUCTION_LINE || '')
    .toString()
    .trim();
  return raw === '';
}
