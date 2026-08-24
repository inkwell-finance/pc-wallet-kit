/**
 * Wallet-demo state + mock data.
 *
 * Everything here is illustrative: no wallet connection, no RPC, no real
 * balances. The demo shows what pc-token / pc-swap flows would look and
 * feel like inside a consumer wallet (Phantom/Solflare-class layout),
 * with the honest constraints of the rail preserved:
 *   - private balances render hidden until a local viewing-key decrypt
 *   - swap quotes are Pyth-anchored estimate + guaranteed floor, never a
 *     firm outAmount (confidential-swap-pilot.md §6)
 *   - wrap/unwrap is the public plaintext boundary; swap amounts are not
 */

export type ScreenId = 'home' | 'swap' | 'save' | 'activity';
export type SheetId = 'none' | 'wrap' | 'confirm' | 'success' | 'wrapSuccess' | 'deposit';

/** Savings (ypcUSD) demo constants: exchange-rate share over the vault.
    One simulated weekly Solomon settlement moves the rate start → week. */
export const SAVINGS_RATE_START = 1.0231;
export const SAVINGS_RATE_WEEK = 1.0243;
export const SAVINGS_DEPOSIT = 1000;

export interface DemoToken {
  symbol: string;
  name: string;
  glyph: string;
  amount: number;
  usdPrice: number;
  change24h: number;
  isPrivate?: boolean;
}

export interface ActivityEntry {
  id: string;
  kind: 'swap' | 'wrap' | 'receive';
  title: string;
  detail: string;
  amount: string;
  sealed?: boolean;
}

export interface Balances {
  SOL: number;
  USDC: number;
  pcUSD: number;
  pcDOGE: number;
}

export const INITIAL_BALANCES: Balances = {
  SOL: 8.42,
  USDC: 1240.5,
  pcUSD: 4200.0,
  pcDOGE: 12480,
};

export const WRAP_AMOUNT = 250;

export const PUBLIC_META: Omit<DemoToken, 'amount'>[] = [
  { symbol: 'SOL', name: 'Solana', glyph: '◎', usdPrice: 176.5, change24h: 2.4 },
  { symbol: 'USDC', name: 'USD Coin', glyph: '$', usdPrice: 1, change24h: 0.0 },
];

export const PRIVATE_META: Omit<DemoToken, 'amount'>[] = [
  { symbol: 'pcUSD', name: 'Private dollar', glyph: '$', usdPrice: 1, change24h: 0.0, isPrivate: true },
  { symbol: 'pcDOGE', name: 'Private DOGE', glyph: 'Ð', usdPrice: 0.042, change24h: -1.2, isPrivate: true },
];

export const YPCUSD_META: Omit<DemoToken, 'amount' | 'usdPrice'> = {
  symbol: 'ypcUSD',
  name: 'Savings share',
  glyph: '◆',
  change24h: 0.0,
  isPrivate: true,
};

export const INITIAL_ACTIVITY: ActivityEntry[] = [
  {
    id: 'a3',
    kind: 'wrap',
    title: 'Wrapped to pcUSD',
    detail: 'USDC → pcUSD · public ramp leg',
    amount: '250.00 USDC',
  },
  {
    id: 'a2',
    kind: 'swap',
    title: 'Private swap',
    detail: 'pcUSD → pcDOGE · sealed',
    amount: 'Amount hidden',
    sealed: true,
  },
  {
    id: 'a1',
    kind: 'receive',
    title: 'Received',
    detail: 'From 7xKX…p2aB',
    amount: '+2.00 SOL',
  },
];

/** Mock Pyth mid for the pcUSD → pcDOGE pair (1 USD ≈ 23.8 DOGE). */
export const PYTH_MID = 23.8;
export const SWAP_FEE = 0.003;
export const EXPECTED_SPREAD = 0.002;

export function estimateOut(amountIn: number): number {
  return amountIn * PYTH_MID * (1 - SWAP_FEE - EXPECTED_SPREAD);
}

export function floorOut(amountIn: number, tolerancePct: number): number {
  return amountIn * PYTH_MID * (1 - SWAP_FEE - tolerancePct / 100);
}

export function fmtUsd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function fmtAmount(n: number, maxFrac = 2): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: maxFrac });
}
