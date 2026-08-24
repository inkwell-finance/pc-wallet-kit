/**
 * Wallet-demo style studies, calibrated against real Phantom and Solflare
 * screenshots (2026-07-20).
 *
 * Each theme is (a) a CSS-var override class from index.css recoloring the
 * wd-* tokens, and (b) structural knobs for the layout grammar the looks
 * actually differ on:
 *   - Phantom-style: neutral dark gray, purple as icon accent only, square
 *     action cards, each token its own rounded card, icon-only bottom nav,
 *     change shown as a green pill.
 *   - Solflare-style: near-black, yellow accent, circular actions with
 *     white icons, flat token rows, left-aligned totals, icon-only nav.
 *   - Neutral: the original generic study.
 *
 * Approximations for a partner-facing "in your wallet" mock only — no
 * affiliation, no endorsement, no logos or wordmarks.
 */

import { createContext, useContext } from 'react';

export type WalletThemeId = 'neutral' | 'phantom' | 'solflare';

export interface WalletThemeSpec {
  id: WalletThemeId;
  label: string;
  frameClass: string;
  card: string;
  cta: string;
  /** Action-row treatment: circular buttons vs Phantom's square cards. */
  actionStyle: 'circle-accent' | 'square-card' | 'circle-white';
  /** Token-list treatment: one container, per-row cards, or flat rows. */
  listStyle: 'container' | 'cards' | 'flat';
  totalAlign: 'center' | 'left';
  /** Icon-only bottom nav (labels stay for screen readers). */
  navLabels: boolean;
  changePill: boolean;
  accountName: string;
}

export const WALLET_THEMES: Record<WalletThemeId, WalletThemeSpec> = {
  neutral: {
    id: 'neutral',
    label: 'Neutral',
    frameClass: '',
    card: 'rounded-2xl',
    cta: 'rounded-2xl',
    actionStyle: 'circle-accent',
    listStyle: 'container',
    totalAlign: 'center',
    navLabels: true,
    changePill: false,
    accountName: 'Wallet 1',
  },
  phantom: {
    id: 'phantom',
    label: 'Phantom-style',
    frameClass: 'wd-theme-phantom',
    card: 'rounded-2xl',
    cta: 'rounded-full',
    actionStyle: 'square-card',
    listStyle: 'cards',
    totalAlign: 'center',
    navLabels: false,
    changePill: true,
    accountName: 'Account 1',
  },
  solflare: {
    id: 'solflare',
    label: 'Solflare-style',
    frameClass: 'wd-theme-solflare',
    card: 'rounded-xl',
    cta: 'rounded-xl',
    actionStyle: 'circle-white',
    listStyle: 'flat',
    totalAlign: 'left',
    navLabels: false,
    changePill: false,
    accountName: 'Main Wallet',
  },
};

const WalletThemeContext = createContext<WalletThemeSpec>(WALLET_THEMES.neutral);

export const WalletThemeProvider = WalletThemeContext.Provider;

export function useWalletTheme(): WalletThemeSpec {
  return useContext(WalletThemeContext);
}
