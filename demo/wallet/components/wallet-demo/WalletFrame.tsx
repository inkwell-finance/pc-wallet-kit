/**
 * WalletFrame — the phone-shaped mock wallet.
 *
 * A consumer-wallet layout rendered entirely from mock data, showing what
 * pc-token + pc-swap feel like from inside a wallet: hidden private
 * balances with a local viewing-key reveal, wrap as the public ramp leg,
 * and a swap whose quote is estimate + guaranteed floor.
 *
 * Three style studies (see theme.ts): a neutral look plus Phantom-style
 * and Solflare-style variants calibrated against real screenshots —
 * palette and layout grammar only, no real wallet's branding, name, or
 * logo. All figures illustrative; pre-alpha rail underneath.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowDownUp, ArrowDown, Check, Clock3, Download, Lock, PiggyBank, RefreshCw, Send, Shield } from 'lucide-react';
import gsap from 'gsap';
import { cn } from '@/lib/cn';
import {
  estimateOut,
  floorOut,
  fmtAmount,
  fmtUsd,
  INITIAL_ACTIVITY,
  INITIAL_BALANCES,
  PRIVATE_META,
  PUBLIC_META,
  PYTH_MID,
  SAVINGS_DEPOSIT,
  SAVINGS_RATE_START,
  SAVINGS_RATE_WEEK,
  WRAP_AMOUNT,
  YPCUSD_META,
  type ActivityEntry,
  type Balances,
  type DemoToken,
  type ScreenId,
  type SheetId,
} from './data';
import { ChangeTag, InfoRow, PrimaryButton, SheetShell, TokenGlyph, TokenRow } from './bits';
import { WALLET_THEMES, WalletThemeProvider, type WalletThemeId } from './theme';
import type { TourAction } from './tourSteps';

export interface WalletFrameProps {
  themeId?: WalletThemeId;
  /** Freeze the inner scroll surface (used while the guided tour runs). */
  locked?: boolean;
  onContextChange?: (context: ScreenId | 'wrap' | 'confirm') => void;
}

export interface WalletFrameHandle {
  run: (action: TourAction) => void;
}

interface RevealState {
  revealed: boolean;
  decrypting: boolean;
}

function SaveValue({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const from = prev.current;
    prev.current = value;
    if (from === value || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.textContent = fmtUsd(value);
      return;
    }
    const obj = { v: from };
    const tween = gsap.to(obj, {
      v: value,
      duration: 1.4,
      ease: 'power2.out',
      onUpdate: () => {
        el.textContent = fmtUsd(obj.v);
      },
    });
    return () => {
      tween.kill();
    };
  }, [value]);
  return (
    <span ref={ref} className="font-mono text-3xl font-medium tabular-nums text-wd-text">
      {fmtUsd(value)}
    </span>
  );
}

export const WalletFrame = forwardRef<WalletFrameHandle, WalletFrameProps>(function WalletFrame(
  { themeId = 'neutral', locked = false, onContextChange }: WalletFrameProps,
  ref,
) {
  const theme = WALLET_THEMES[themeId];
  const [screen, setScreen] = useState<ScreenId>('home');
  const [sheet, setSheet] = useState<SheetId>('none');
  const [reveals, setReveals] = useState<Record<string, RevealState>>({});
  const [swapAmount, setSwapAmount] = useState('100');
  const [tolerance, setTolerance] = useState(1);
  const [activity, setActivity] = useState<ActivityEntry[]>(INITIAL_ACTIVITY);
  const [balances, setBalances] = useState<Balances>(INITIAL_BALANCES);
  const [savings, setSavings] = useState({ shares: 0, rate: SAVINGS_RATE_START });
  const [settledWeek, setSettledWeek] = useState(false);
  const timers = useRef<number[]>([]);

  const publicTokens: DemoToken[] = PUBLIC_META.map((m) => ({
    ...m,
    amount: balances[m.symbol as 'SOL' | 'USDC'],
  }));
  const privateTokens: DemoToken[] = [
    ...PRIVATE_META.map((m) => ({ ...m, amount: balances[m.symbol as 'pcUSD' | 'pcDOGE'] })),
    ...(savings.shares > 0
      ? [{ ...YPCUSD_META, amount: savings.shares, usdPrice: savings.rate }]
      : []),
  ];

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  useEffect(() => {
    if (sheet === 'wrap') onContextChange?.('wrap');
    else if (sheet === 'confirm' || sheet === 'success') onContextChange?.('confirm');
    else onContextChange?.(screen);
  }, [screen, sheet, onContextChange]);

  const toggleReveal = (symbol: string) => {
    const current = reveals[symbol];
    if (current?.revealed) {
      setReveals((r) => ({ ...r, [symbol]: { revealed: false, decrypting: false } }));
      return;
    }
    setReveals((r) => ({ ...r, [symbol]: { revealed: false, decrypting: true } }));
    timers.current.push(
      window.setTimeout(() => {
        setReveals((r) => ({ ...r, [symbol]: { revealed: true, decrypting: false } }));
      }, 900),
    );
  };

  const anyRevealed = privateTokens.some((t) => reveals[t.symbol]?.revealed);
  const publicUsd = publicTokens.reduce((s, t) => s + t.amount * t.usdPrice, 0);
  const revealedUsd = privateTokens.reduce(
    (s, t) => s + (reveals[t.symbol]?.revealed ? t.amount * t.usdPrice : 0),
    0,
  );

  const amountIn = Number.parseFloat(swapAmount) || 0;
  const validAmount = amountIn > 0 && amountIn <= balances.pcUSD;

  const executeSwap = () => {
    setBalances((b) => ({
      ...b,
      pcUSD: b.pcUSD - amountIn,
      pcDOGE: b.pcDOGE + estimateOut(amountIn),
    }));
    setSheet('success');
    setActivity((a) => [
      {
        id: `s${a.length + 1}`,
        kind: 'swap',
        title: 'Private swap',
        detail: 'pcUSD → pcDOGE · sealed',
        amount: 'Amount hidden',
        sealed: true,
      },
      ...a,
    ]);
  };

  const confirmWrap = () => {
    setBalances((b) => ({ ...b, USDC: b.USDC - WRAP_AMOUNT, pcUSD: b.pcUSD + WRAP_AMOUNT }));
    setSheet('wrapSuccess');
    setActivity((a) => [
      {
        id: `w${a.length + 1}`,
        kind: 'wrap',
        title: 'Wrapped to pcUSD',
        detail: 'USDC → pcUSD · public ramp leg',
        amount: `${WRAP_AMOUNT.toFixed(2)} USDC`,
      },
      ...a,
    ]);
  };

  const confirmDeposit = () => {
    setBalances((b) => ({ ...b, pcUSD: b.pcUSD - SAVINGS_DEPOSIT }));
    setSavings((s) => ({ ...s, shares: s.shares + SAVINGS_DEPOSIT / s.rate }));
    setSheet('none');
    setActivity((a) => [
      {
        id: `d${a.length + 1}`,
        kind: 'wrap',
        title: 'Savings deposit',
        detail: 'pcUSD → ypcUSD · shares sealed',
        amount: 'Amount hidden',
        sealed: true,
      },
      ...a,
    ]);
  };

  const settleWeek = () => {
    setSavings((s) => ({ ...s, rate: SAVINGS_RATE_WEEK }));
    setSettledWeek(true);
    setActivity((a) => [
      {
        id: `y${a.length + 1}`,
        kind: 'receive',
        title: 'Yield settled',
        detail: `Vault aggregate · rate → ${SAVINGS_RATE_WEEK.toFixed(4)}`,
        amount: '+0.12% rate',
      },
      ...a,
    ]);
  };

  useImperativeHandle(ref, () => ({
    run: (action: TourAction) => {
      switch (action) {
        case 'home':
          setScreen('home');
          setSheet('none');
          break;
        case 'close-sheet-home':
          setSheet('none');
          setScreen('home');
          break;
        case 'reset':
          setScreen('home');
          setSheet('none');
          setReveals({});
          setSwapAmount('100');
          setTolerance(1);
          setActivity(INITIAL_ACTIVITY);
          setBalances(INITIAL_BALANCES);
          setSavings({ shares: 0, rate: SAVINGS_RATE_START });
          setSettledWeek(false);
          break;
      }
    },
  }));

  const listWrap = (children: React.ReactNode, aux?: React.ReactNode) => {
    if (theme.listStyle === 'container') {
      return <div className={cn('mx-4 bg-wd-card', theme.card)}>{aux}{children}</div>;
    }
    if (theme.listStyle === 'cards') {
      return <div className="mx-4 flex flex-col gap-2">{aux}{children}</div>;
    }
    return <div className="mx-2">{aux}{children}</div>;
  };

  const rowShell = (key: string, row: React.ReactNode) =>
    theme.listStyle === 'cards' ? (
      <div key={key} className={cn('bg-wd-card', theme.card)}>{row}</div>
    ) : (
      <div key={key}>{row}</div>
    );

  return (
    <WalletThemeProvider value={theme}>
      <div
        data-wd-frame
        className={cn(
          'relative mx-auto flex h-[740px] w-[340px] flex-col overflow-hidden rounded-[2.5rem] border border-wd-line bg-wd-bg shadow-2xl shadow-black/60 ring-8 ring-black',
          theme.frameClass,
        )}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <button
            type="button"
            className="flex items-center gap-2 rounded-full bg-wd-card px-3 py-1.5 text-xs font-medium text-wd-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wd-accent"
          >
            <span aria-hidden className="h-4 w-4 rounded-full bg-gradient-to-br from-wd-accent to-wd-up" />
            {theme.accountName}
          </button>
          <span className="font-mono text-[10px] text-wd-sub">devnet · demo</span>
        </div>

        <div className={cn('relative flex-1', locked ? 'overflow-hidden' : 'overflow-y-auto')}>
          {screen === 'home' && (
            <div>
              <div data-tour="total" className={cn('px-5 pb-2 pt-2', theme.totalAlign === 'left' ? 'text-left' : 'text-center')}>
                <div className="font-mono text-3xl font-medium tabular-nums text-wd-text">
                  {fmtUsd(publicUsd + revealedUsd)}
                </div>
                <div
                  className={cn(
                    'mt-1.5 flex items-center gap-1.5 text-xs text-wd-sub',
                    theme.totalAlign === 'left' ? 'justify-start' : 'justify-center',
                  )}
                >
                  <span
                    className={cn(
                      'flex items-center gap-1.5',
                      theme.changePill && 'rounded-md bg-wd-up/10 px-2 py-0.5 text-wd-up',
                    )}
                  >
                    <Lock className={cn('h-3 w-3', theme.changePill ? 'text-wd-up' : 'text-wd-accent')} aria-hidden />
                    {anyRevealed ? 'includes revealed private balances' : '+ 2 private balances (hidden)'}
                  </span>
                </div>
              </div>

              <div
                className={cn(
                  'px-4 py-4',
                  theme.actionStyle === 'square-card'
                    ? 'grid grid-cols-4 gap-2'
                    : 'flex items-start justify-center gap-5 px-5',
                )}
              >
                {[
                  { icon: Download, label: 'Receive' },
                  { icon: Send, label: 'Send' },
                  { icon: ArrowDownUp, label: 'Swap', onClick: () => setScreen('swap') },
                  { icon: RefreshCw, label: 'Wrap', onClick: () => setSheet('wrap') },
                ].map(({ icon: Icon, label, onClick }) => {
                  const tourAttrs =
                    label === 'Wrap'
                      ? { 'data-tour': 'action-wrap', 'data-tour-click': 'action-wrap' }
                      : {};
                  return theme.actionStyle === 'square-card' ? (
                    <button
                      key={label}
                      type="button"
                      onClick={onClick}
                      {...tourAttrs}
                      className={cn(
                        'flex flex-col items-center gap-1.5 bg-wd-card py-3',
                        theme.card,
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wd-accent',
                      )}
                    >
                      <Icon className="h-5 w-5 text-wd-accent" aria-hidden />
                      <span className="text-[11px] text-wd-sub">{label}</span>
                    </button>
                  ) : (
                    <div key={label} className="flex flex-col items-center gap-1.5">
                      <button
                        type="button"
                        onClick={onClick}
                        {...tourAttrs}
                        className={cn(
                          'flex h-12 w-12 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wd-accent',
                          theme.actionStyle === 'circle-white'
                            ? 'bg-wd-elev text-wd-text hover:brightness-125'
                            : 'bg-wd-card text-wd-accent hover:bg-wd-elev',
                        )}
                        aria-label={label}
                      >
                        <Icon className="h-5 w-5" aria-hidden />
                      </button>
                      <span className="text-[11px] text-wd-sub">{label}</span>
                    </div>
                  );
                })}
              </div>

              {listWrap(
                publicTokens.map((t) =>
                  rowShell(t.symbol, <TokenRow token={t} revealed decrypting={false} />),
                ),
              )}

              <div data-tour="private" className="mt-3 mb-4">
                {listWrap(
                  <>
                    {privateTokens.map((t) =>
                      rowShell(
                        t.symbol,
                        <div data-tour={t.symbol === 'pcUSD' ? 'reveal' : undefined}>
                          <TokenRow
                            token={t}
                            revealed={Boolean(reveals[t.symbol]?.revealed)}
                            decrypting={Boolean(reveals[t.symbol]?.decrypting)}
                            onToggleReveal={() => toggleReveal(t.symbol)}
                            eyeClickId={t.symbol === 'pcUSD' ? 'reveal-eye' : undefined}
                          />
                        </div>,
                      ),
                    )}
                    <p className="px-4 pb-3 pt-1 text-[10px] leading-relaxed text-wd-sub">
                      Once Encrypt's encryption is live, these balances are encrypted on-chain and
                      only your viewing key can read them. Pre-alpha: values are still plaintext.
                    </p>
                  </>,
                  <div className="flex items-center gap-1.5 px-4 pb-1 pt-3 text-[10px] font-medium uppercase tracking-widest text-wd-sub">
                    <Shield className="h-3 w-3 text-wd-accent" aria-hidden />
                    Private balances
                  </div>,
                )}
              </div>
            </div>
          )}

          {screen === 'swap' && (
            <div className="flex flex-col gap-3 px-4 pt-2">
              <div className={cn('bg-wd-card p-4', theme.card)}>
                <div className="mb-2 flex items-center justify-between text-xs text-wd-sub">
                  <span>You pay</span>
                  <span className="font-mono tabular-nums">
                    Balance: {reveals.pcUSD?.revealed ? fmtAmount(balances.pcUSD) : '••••'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <TokenGlyph token={privateTokens[0]} size="sm" />
                  <span className="text-sm font-medium text-wd-text">pcUSD</span>
                  <label className="sr-only" htmlFor="wd-swap-amount">
                    Amount of pcUSD to swap
                  </label>
                  <input
                    id="wd-swap-amount"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={swapAmount}
                    onChange={(e) => setSwapAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    className="min-w-0 flex-1 bg-transparent text-right font-mono text-xl tabular-nums text-wd-text focus-visible:outline-none"
                    aria-invalid={!validAmount}
                  />
                </div>
              </div>

              <div className="relative -my-4 flex justify-center" aria-hidden>
                <span className="z-10 flex h-8 w-8 items-center justify-center rounded-full border border-wd-line bg-wd-elev text-wd-sub">
                  <ArrowDown className="h-4 w-4" />
                </span>
              </div>

              <div className={cn('bg-wd-card p-4', theme.card)}>
                <div className="mb-2 text-xs text-wd-sub">You receive (estimated)</div>
                <div className="flex items-center gap-3">
                  <TokenGlyph token={privateTokens[1]} size="sm" />
                  <span className="text-sm font-medium text-wd-text">pcDOGE</span>
                  <span className="flex-1 text-right font-mono text-xl tabular-nums text-wd-text">
                    ≈ {validAmount ? fmtAmount(estimateOut(amountIn)) : '—'}
                  </span>
                </div>
              </div>

              <div data-tour="quote" className={cn('border border-wd-line bg-wd-bg p-4', theme.card)}>
                <InfoRow label="Reference price (Pyth)" value={`1 pcUSD ≈ ${PYTH_MID} pcDOGE`} dim />
                <InfoRow
                  label="Guaranteed minimum"
                  value={validAmount ? `${fmtAmount(floorOut(amountIn, tolerance))} pcDOGE` : '—'}
                />
                <div className="mt-2 flex items-center gap-2">
                  <span id="wd-tolerance-label" className="text-xs text-wd-sub">
                    Tolerance
                  </span>
                  <div role="group" aria-labelledby="wd-tolerance-label" className="flex gap-1.5">
                    {[0.5, 1, 2].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => setTolerance(pct)}
                        aria-pressed={tolerance === pct}
                        className={cn(
                          'rounded-full px-3 py-2 font-mono text-[11px]',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wd-accent',
                          tolerance === pct
                            ? 'bg-wd-accent/20 text-wd-accent ring-1 ring-wd-accent/50'
                            : 'bg-wd-elev text-wd-sub hover:text-wd-text',
                        )}
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>
                <p className="mt-3 text-[10px] leading-relaxed text-wd-sub">
                  Reserves are encrypted, so there is no firm quote. The estimate is Pyth-anchored;
                  the minimum is enforced inside the encrypted swap. Below the floor, it fails
                  whole.
                </p>
              </div>

              <div data-tour="review" data-tour-click="review">
                <PrimaryButton disabled={!validAmount} onClick={() => setSheet('confirm')}>
                  {validAmount ? 'Review swap' : 'Enter an amount'}
                </PrimaryButton>
              </div>
              <p className="pb-3 text-center text-[10px] text-wd-sub">
                Observers see that you swapped. Never how much.
              </p>
            </div>
          )}

          {screen === 'save' && (
            <div className="flex flex-col gap-3 px-4 pt-2">
              <div data-tour="savevalue" className={cn('bg-wd-card p-4', theme.card)}>
                <div className="mb-2 flex items-center gap-1.5 text-xs text-wd-sub">
                  <Lock className="h-3 w-3 text-wd-accent" aria-hidden />
                  Savings value
                </div>
                {savings.shares === 0 ? (
                  <>
                    <div className="font-mono text-3xl font-medium text-wd-sub">—</div>
                    <p className="mt-1 text-[10px] text-wd-sub">No savings yet.</p>
                  </>
                ) : (
                  <>
                    <SaveValue value={savings.shares * savings.rate} />
                    <p className="mt-1 font-mono text-[10px] tabular-nums text-wd-sub">
                      {fmtAmount(savings.shares)} ypcUSD shares · decrypted locally
                    </p>
                  </>
                )}
              </div>

              <div data-tour="saveinfo" className={cn('border border-wd-line bg-wd-bg p-4', theme.card)}>
                <InfoRow label="Redemption rate" value={`1 ypcUSD = ${savings.rate.toFixed(4)} pcUSD`} />
                <InfoRow label="Past week" value={settledWeek ? '+0.12%' : '—'} dim={!settledWeek} />
                <InfoRow label="Backing" value="Short-dated treasuries" dim />
                <InfoRow label="Streamed by" value="Solomon · issued via Bridge" dim />
                <p className="mt-3 text-[10px] leading-relaxed text-wd-sub">
                  The rate is public and only rises. Your share count stays sealed. Rewards are
                  variable and not guaranteed.
                </p>
              </div>

              {savings.shares === 0 ? (
                <div data-tour="deposit" data-tour-click="deposit">
                  <PrimaryButton onClick={() => setSheet('deposit')}>Deposit</PrimaryButton>
                </div>
              ) : (
                <div data-tour="settle" data-tour-click="settle">
                  <button
                    type="button"
                    onClick={settleWeek}
                    disabled={settledWeek}
                    className={cn(
                      'w-full border border-wd-line py-3.5 text-sm font-semibold text-wd-text transition-colors',
                      theme.cta,
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wd-accent',
                      settledWeek
                        ? 'cursor-not-allowed text-wd-sub'
                        : 'hover:border-wd-accent hover:text-wd-accent',
                    )}
                  >
                    {settledWeek ? 'Week settled' : 'Run a week (simulate settlement)'}
                  </button>
                </div>
              )}
              <p className="pb-3 text-center text-[10px] text-wd-sub">
                Yield arrives as one aggregate vault transfer. Never as a payout to you.
              </p>
            </div>
          )}

          {screen === 'activity' && (
            <div data-tour="activity" className="mt-2 mb-4">
              {listWrap(
                <>
                  {activity.map((e) =>
                    rowShell(
                      e.id,
                      <div className="flex items-center gap-3 px-4 py-3">
                        <span
                          aria-hidden
                          className={cn(
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
                            e.sealed ? 'bg-wd-accent/15 text-wd-accent' : 'bg-wd-elev text-wd-sub',
                          )}
                        >
                          {e.kind === 'swap' ? (
                            <ArrowDownUp className="h-4 w-4" />
                          ) : e.kind === 'wrap' ? (
                            <RefreshCw className="h-4 w-4" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-wd-text">{e.title}</div>
                          <div className="truncate text-xs text-wd-sub">{e.detail}</div>
                        </div>
                        <div
                          className={cn(
                            'flex items-center gap-1 font-mono text-xs tabular-nums',
                            e.sealed ? 'text-wd-accent' : 'text-wd-text',
                          )}
                        >
                          {e.sealed && <Lock className="h-3 w-3" aria-hidden />}
                          {e.amount}
                        </div>
                      </div>,
                    ),
                  )}
                  <p className="px-4 pb-3 pt-1 text-[10px] leading-relaxed text-wd-sub">
                    Wrap and unwrap are the public ramp legs. Swap amounts stay sealed on-chain.
                  </p>
                </>,
              )}
            </div>
          )}
        </div>

        <nav aria-label="Wallet tabs" className="flex border-t border-wd-line bg-wd-bg">
          {(
            [
              { id: 'home', label: 'Home', icon: Shield },
              { id: 'swap', label: 'Swap', icon: ArrowDownUp },
              { id: 'save', label: 'Save', icon: PiggyBank },
              { id: 'activity', label: 'Activity', icon: Clock3 },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              data-tour={`tab-${id}`}
              data-tour-click={`tab-${id}`}
              onClick={() => {
                setScreen(id);
                setSheet('none');
              }}
              aria-current={screen === id ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center gap-1 py-3 text-[10px]',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wd-accent',
                screen === id ? 'text-wd-accent' : 'text-wd-sub hover:text-wd-text',
              )}
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span className={theme.navLabels ? undefined : 'sr-only'}>{label}</span>
            </button>
          ))}
        </nav>

        {sheet === 'deposit' && (
          <SheetShell title="Deposit to savings" onClose={() => setSheet('none')}>
            <div data-tour="depositconfirm" className={cn('border border-wd-line p-4', theme.card)}>
              <InfoRow label="You deposit" value="1,000.00 pcUSD" />
              <InfoRow
                label="You receive"
                value={`≈ ${fmtAmount(SAVINGS_DEPOSIT / savings.rate)} ypcUSD`}
              />
              <InfoRow label="Rate" value={`1 ypcUSD = ${savings.rate.toFixed(4)} pcUSD`} dim />
            </div>
            <p className="my-3 text-[10px] leading-relaxed text-wd-sub">
              Shares are sealed on-chain like every balance. Rewards are variable and not
              guaranteed; eligibility is checked at this step.
            </p>
            <div data-tour="deposit-confirm" data-tour-click="deposit-confirm">
              <PrimaryButton onClick={confirmDeposit} disabled={balances.pcUSD < SAVINGS_DEPOSIT}>
                Deposit 1,000 pcUSD
              </PrimaryButton>
            </div>
          </SheetShell>
        )}

        {sheet === 'wrap' && (
          <SheetShell title="Wrap to private dollar" onClose={() => setSheet('none')}>
            <div data-tour="wrapsheet" className={cn('border border-wd-line p-4', theme.card)}>
              <InfoRow label="You wrap" value="250.00 USDC" />
              <InfoRow label="You receive" value="250.00 pcUSD" />
              <InfoRow label="Wrap fee (5 bps)" value="$0.13" dim />
            </div>
            <p className="my-3 text-[10px] leading-relaxed text-wd-sub">
              This step is public on-chain. It's the ramp. Once encryption is live, your pcUSD
              balance after this step is encrypted and readable only with your viewing key.
              Pre-alpha: it is still plaintext.
            </p>
            <div data-tour="wrap-cta" data-tour-click="wrap-cta">
              <PrimaryButton onClick={confirmWrap} disabled={balances.USDC < WRAP_AMOUNT}>
                Wrap 250 USDC
              </PrimaryButton>
            </div>
          </SheetShell>
        )}

        {sheet === 'confirm' && (
          <SheetShell title="Confirm swap" onClose={() => setSheet('none')}>
            <div className={cn('border border-wd-line p-4', theme.card)}>
              <InfoRow label="You pay" value={`${fmtAmount(amountIn)} pcUSD`} />
              <InfoRow label="Estimated out" value={`≈ ${fmtAmount(estimateOut(amountIn))} pcDOGE`} />
              <InfoRow label="Guaranteed minimum" value={`${fmtAmount(floorOut(amountIn, tolerance))} pcDOGE`} />
              <InfoRow label="Swap fee" value="0.30%" dim />
            </div>
            <div data-tour="split" className="my-3 grid grid-cols-2 gap-2 text-[10px] leading-relaxed">
              <div className="rounded-xl bg-wd-elev p-2.5 text-wd-sub">
                <span className="font-medium text-wd-text">Public:</span> that this wallet swapped
                pcUSD → pcDOGE, and when.
              </div>
              <div className="rounded-xl bg-wd-accent/10 p-2.5 text-wd-sub">
                <span className="font-medium text-wd-accent">Sealed:</span> both amounts, your
                balances, and the pool's reserves.
              </div>
            </div>
            <div data-tour="swapnow" data-tour-click="swapnow">
              <PrimaryButton onClick={executeSwap}>Swap now</PrimaryButton>
            </div>
          </SheetShell>
        )}

        {(sheet === 'success' || sheet === 'wrapSuccess') && (
          <SheetShell
            title={sheet === 'success' ? 'Swap settled' : 'Wrapped'}
            onClose={() => setSheet('none')}
          >
            <div data-tour="success" className="flex flex-col items-center gap-3 py-2 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-wd-up/15 text-wd-up">
                <Check className="h-7 w-7" aria-hidden />
              </span>
              <p className="text-sm text-wd-text">
                {sheet === 'success'
                  ? 'Swapped in one transaction. Amounts sealed on-chain.'
                  : 'Your dollars are now a private balance.'}
              </p>
              <p className="text-[10px] leading-relaxed text-wd-sub">
                {sheet === 'success'
                  ? 'Debit receipt, encrypted curve math, payout: one atomic transaction.'
                  : 'Reveal it anytime with your viewing key.'}
              </p>
              <div
                className="w-full pt-1"
                data-tour={sheet === 'success' ? 'viewactivity' : 'wrapdone'}
                data-tour-click={sheet === 'success' ? 'viewactivity' : 'wrapdone'}
              >
                <PrimaryButton
                  onClick={() => {
                    setSheet('none');
                    setScreen(sheet === 'success' ? 'activity' : 'home');
                  }}
                >
                  {sheet === 'success' ? 'View activity' : 'Done'}
                </PrimaryButton>
              </div>
            </div>
          </SheetShell>
        )}
      </div>
    </WalletThemeProvider>
  );
});
