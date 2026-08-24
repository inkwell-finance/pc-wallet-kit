/**
 * Small shared pieces of the mock wallet frame. wd-* tokens only —
 * this is the quoted third-party-wallet theme, not Dagon chrome.
 */

import type { ReactNode } from 'react';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fmtAmount, fmtUsd, type DemoToken } from './data';
import { useWalletTheme } from './theme';

export function TokenGlyph({ token, size = 'md' }: { token: DemoToken; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex items-center justify-center rounded-full font-semibold shrink-0',
        size === 'md' ? 'h-10 w-10 text-base' : 'h-7 w-7 text-xs',
        token.isPrivate
          ? 'bg-wd-accent/15 text-wd-accent ring-1 ring-wd-accent/30'
          : 'bg-wd-elev text-wd-text ring-1 ring-wd-line',
      )}
    >
      {token.glyph}
    </span>
  );
}

export function ChangeTag({ pct }: { pct: number }) {
  const flat = Math.abs(pct) < 0.005;
  return (
    <span
      className={cn(
        'font-mono text-[11px] tabular-nums',
        flat ? 'text-wd-sub' : pct > 0 ? 'text-wd-up' : 'text-wd-down',
      )}
    >
      {flat ? '0.00%' : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`}
    </span>
  );
}

export interface TokenRowProps {
  token: DemoToken;
  revealed: boolean;
  decrypting: boolean;
  onToggleReveal?: () => void;
  eyeClickId?: string;
}

export function TokenRow({ token, revealed, decrypting, onToggleReveal, eyeClickId }: TokenRowProps) {
  const hidden = Boolean(token.isPrivate) && !revealed;
  const usd = token.amount * token.usdPrice;
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <TokenGlyph token={token} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium text-wd-text">
          {token.symbol}
          {token.isPrivate && <Lock aria-label="private balance" className="h-3 w-3 text-wd-accent" />}
        </div>
        <div className="flex items-center gap-2 text-xs text-wd-sub">
          <span>{token.name}</span>
          <ChangeTag pct={token.change24h} />
        </div>
      </div>
      <div className="text-right">
        {hidden ? (
          <div className={cn('font-mono text-sm tracking-widest text-wd-sub', decrypting && 'animate-pulse motion-reduce:animate-none')}>
            {decrypting ? 'decrypting…' : '••••••'}
          </div>
        ) : (
          <div className="font-mono text-sm tabular-nums text-wd-text">{fmtAmount(token.amount)}</div>
        )}
        <div className="font-mono text-xs tabular-nums text-wd-sub">
          {hidden ? '•••' : fmtUsd(usd)}
        </div>
      </div>
      {token.isPrivate && onToggleReveal && (
        <button
          type="button"
          data-tour={eyeClickId}
          data-tour-click={eyeClickId}
          onClick={onToggleReveal}
          aria-label={revealed ? `Hide ${token.symbol} balance` : `Reveal ${token.symbol} balance with viewing key`}
          className="ml-1 flex h-10 w-10 items-center justify-center rounded-full text-wd-sub hover:text-wd-text hover:bg-wd-elev focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wd-accent"
        >
          {revealed ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
        </button>
      )}
    </div>
  );
}

export function SheetShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const theme = useWalletTheme();
  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 focus-visible:outline-none"
        tabIndex={-1}
      />
      <div className={cn('relative border-t border-wd-line bg-wd-card p-5 pb-6 motion-safe:animate-[wd-sheet_.25s_ease-out]', theme.id === 'solflare' ? 'rounded-t-2xl' : 'rounded-t-3xl')}>
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-wd-line" aria-hidden />
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-wd-text">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-2 text-xs text-wd-sub hover:text-wd-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wd-accent"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const theme = useWalletTheme();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full py-3.5 text-sm font-semibold transition-colors',
        theme.cta,
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wd-accent focus-visible:ring-offset-2 focus-visible:ring-offset-wd-bg',
        disabled
          ? 'cursor-not-allowed bg-wd-elev text-wd-sub'
          : 'bg-wd-accent text-[#0B1020] hover:brightness-110',
      )}
    >
      {children}
    </button>
  );
}

export function InfoRow({ label, value, dim }: { label: string; value: ReactNode; dim?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-1.5 text-xs">
      <span className="text-wd-sub">{label}</span>
      <span className={cn('font-mono tabular-nums', dim ? 'text-wd-sub' : 'text-wd-text')}>{value}</span>
    </div>
  );
}
