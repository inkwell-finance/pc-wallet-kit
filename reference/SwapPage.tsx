/**
 * Encrypted Swap demo — devnet preview of the receipt-gated PC-Token + PC-Swap flow.
 *
 * No more deposit/withdraw step: pc-swap CPIs into pc-token::TransferWithReceipt to debit
 * the user, runs swap_graph against the receipt, then CPIs pc-token::Transfer for the
 * vault → user payout. User holds balance in pc-token throughout.
 *
 * Pre-alpha disclaimer is required on every screen (SOUL.md §108).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Transaction } from '@solana/web3.js';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { toast } from 'sonner';
import { WalletButton } from '@/components/shared/WalletButton';
import { PreAlphaDisclaimer } from '@/components/swap/Disclaimer';
import { StepCard } from '@/components/swap/StepCard';
import { resolvePcSwapClient, type PcSwapResult } from '@/lib/pcSwap';
import { WalletBalances } from '@/components/swap/WalletBalances';
import { EncryptedBalances } from '@/components/swap/EncryptedBalances';
// AuditLog removed 2026-05-09: surfaced wallet-history rows from days/weeks
// ago that didn't reflect the current swap session, confusing demo viewers.
// The seal-side (memo emission per wrap/swap) lives inside pcSwap and is
// unaffected — only the read-side reveal UI got cut.

const ENCRYPT_PROGRAM_ID = import.meta.env.VITE_ENCRYPT_PROGRAM_ID as string | undefined;
const PC_TOKEN_PROGRAM_ID = import.meta.env.VITE_PC_TOKEN_PROGRAM_ID as string | undefined;
const PC_SWAP_PROGRAM_ID = import.meta.env.VITE_PC_SWAP_PROGRAM_ID as string | undefined;

const PC_TOKEN_USDC_SPL_MINT = import.meta.env.VITE_PC_TOKEN_USDC_SPL_MINT as string | undefined;
const PC_TOKEN_USDC_PC_MINT = import.meta.env.VITE_PC_TOKEN_USDC_PC_MINT as string | undefined;
const PC_TOKEN_USDC_VAULT = import.meta.env.VITE_PC_TOKEN_USDC_VAULT as string | undefined;
const PC_TOKEN_USDC_VAULT_ATA = import.meta.env.VITE_PC_TOKEN_USDC_VAULT_ATA as string | undefined;
const PC_TOKEN_USDC_DECIMALS = import.meta.env.VITE_PC_TOKEN_USDC_DECIMALS as string | undefined;

const PC_TOKEN_DOGE_SPL_MINT = import.meta.env.VITE_PC_TOKEN_DOGE_SPL_MINT as string | undefined;
const PC_TOKEN_DOGE_PC_MINT = import.meta.env.VITE_PC_TOKEN_DOGE_PC_MINT as string | undefined;
const PC_TOKEN_DOGE_VAULT = import.meta.env.VITE_PC_TOKEN_DOGE_VAULT as string | undefined;
const PC_TOKEN_DOGE_VAULT_ATA = import.meta.env.VITE_PC_TOKEN_DOGE_VAULT_ATA as string | undefined;
const PC_TOKEN_DOGE_DECIMALS = import.meta.env.VITE_PC_TOKEN_DOGE_DECIMALS as string | undefined;

const PC_SWAP_POOL_PDA = import.meta.env.VITE_PC_SWAP_POOL_PDA as string | undefined;
const PC_SWAP_POOL_VAULT_USDC = import.meta.env.VITE_PC_SWAP_POOL_VAULT_USDC as string | undefined;
const PC_SWAP_POOL_VAULT_DOGE = import.meta.env.VITE_PC_SWAP_POOL_VAULT_DOGE as string | undefined;
const PC_SWAP_POOL_VAULT_USDC_BAL_CT = import.meta.env.VITE_PC_SWAP_POOL_VAULT_USDC_BAL_CT as string | undefined;
const PC_SWAP_POOL_VAULT_DOGE_BAL_CT = import.meta.env.VITE_PC_SWAP_POOL_VAULT_DOGE_BAL_CT as string | undefined;
const PC_SWAP_POOL_RESERVE_USDC_CT = import.meta.env.VITE_PC_SWAP_POOL_RESERVE_USDC_CT as string | undefined;
const PC_SWAP_POOL_RESERVE_DOGE_CT = import.meta.env.VITE_PC_SWAP_POOL_RESERVE_DOGE_CT as string | undefined;

const POINTS_API_URL =
  (import.meta.env.VITE_POINTS_API_URL as string | undefined) ?? 'http://localhost:8788';

const STEP_TOOLTIPS = {
  drip:
    "Devnet mock-USDC. It has no value. We're using it to teach you the flow. The faucet API mints from the deployer's authority, rate-limited 1 drip per wallet per 4 hours.",
  wrap:
    'Wrap SPL → pc-token. SPL goes into the pc-token vault; an encrypted balance is credited to your wallet. Bal stays under pc-token authority — pc-swap reads it via CPI during swap.',
  swap:
    'Atomic receipt-gated swap. pc-swap CPIs pc-token::TransferWithReceipt (debits you, emits a binary receipt = amount on success / 0 on insufficient), runs swap_graph against the receipt, then CPIs pc-token::Transfer for the vault → you payout. Lying user → receipt = 0 → uniform no-op. No deposit, no withdraw.',
  view:
    "Decrypt your encrypted pc-token balance via ViewBalance + gRPC readCiphertext. We generate a one-time keypair, on-chain copy_ciphertext to that key's authority, sign the BCS read message locally with that key, ask Encrypt for plaintext. Wallet only authorizes the on-chain copy — never sees the BCS bytes Phantom would otherwise reject.",
} as const;

/** Demo defaults. */
const WRAP_USDC_AMOUNT = 100n * 10n ** 6n;   // 100 USDC
const WRAP_DOGE_AMOUNT = 100n * 10n ** 6n;   // 100 DOGE
const SWAP_AMOUNT = 1n * 10n ** 6n;          // 1 USDC → ~1 DOGE at our 1:1 pool ratio

type StepStatus = 'idle' | 'pending' | 'done';
type StepKey = 'drip' | 'wrap_usdc' | 'wrap_doge' | 'swap' | 'view_usdc' | 'view_doge';

function reasonText(result: PcSwapResult | { ok: false; reason: string; detail?: string }): string | undefined {
  if (result.ok === true) return undefined;
  switch (result.reason) {
    case 'programs_not_deployed':
      return 'PC-Token / PC-Swap programs not deployed yet — set the VITE_PC_TOKEN_*/VITE_PC_SWAP_* env vars.';
    case 'unsupported':
      return result.detail ?? 'This step is not part of this flow.';
    case 'user_rejected':
      return 'Wallet rejected the transaction.';
    case 'rpc_error':
      return result.detail ?? 'RPC error contacting devnet.';
    default:
      return result.detail ?? 'Unknown error.';
  }
}

export function SwapPage() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();

  const signAndSend = useMemo(() => {
    return signTransaction
      ? async (tx: Transaction) => {
          const signed = await signTransaction(tx);
          return connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
        }
      : undefined;
  }, [connection, signTransaction]);

  const client = useMemo(() => resolvePcSwapClient({
    connection,
    signAndSend,
    faucetApiUrl: POINTS_API_URL,
    encryptProgramId: ENCRYPT_PROGRAM_ID,
    pcTokenProgramId: PC_TOKEN_PROGRAM_ID,
    pcSwapProgramId: PC_SWAP_PROGRAM_ID,
    usdcSplMint: PC_TOKEN_USDC_SPL_MINT,
    usdcPcMint: PC_TOKEN_USDC_PC_MINT,
    usdcVault: PC_TOKEN_USDC_VAULT,
    usdcVaultAta: PC_TOKEN_USDC_VAULT_ATA,
    usdcDecimals: PC_TOKEN_USDC_DECIMALS,
    dogeSplMint: PC_TOKEN_DOGE_SPL_MINT,
    dogePcMint: PC_TOKEN_DOGE_PC_MINT,
    dogeVault: PC_TOKEN_DOGE_VAULT,
    dogeVaultAta: PC_TOKEN_DOGE_VAULT_ATA,
    dogeDecimals: PC_TOKEN_DOGE_DECIMALS,
    poolPda: PC_SWAP_POOL_PDA,
    poolVaultUsdc: PC_SWAP_POOL_VAULT_USDC,
    poolVaultDoge: PC_SWAP_POOL_VAULT_DOGE,
    poolVaultUsdcBalCt: PC_SWAP_POOL_VAULT_USDC_BAL_CT,
    poolVaultDogeBalCt: PC_SWAP_POOL_VAULT_DOGE_BAL_CT,
    poolReserveUsdcCt: PC_SWAP_POOL_RESERVE_USDC_CT,
    poolReserveDogeCt: PC_SWAP_POOL_RESERVE_DOGE_CT,
  }), [connection, signAndSend]);

  const [drip, setDrip] = useState<StepStatus>('idle');
  const [wrapUsdc, setWrapUsdc] = useState<StepStatus>('idle');
  const [wrapDoge, setWrapDoge] = useState<StepStatus>('idle');
  const [swap, setSwap] = useState<StepStatus>('idle');
  const [viewUsdc, setViewUsdc] = useState<StepStatus>('idle');
  const [viewDoge, setViewDoge] = useState<StepStatus>('idle');
  const [viewedUsdc, setViewedUsdc] = useState<{ amount: bigint; decimals: number } | null>(null);
  const [viewedDoge, setViewedDoge] = useState<{ amount: bigint; decimals: number } | null>(null);
  const [blocked, setBlocked] = useState<Partial<Record<StepKey, string>>>({});
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);
  // Stale-balance-CT banner removed: the digest-bytes-zero heuristic in
  // `client.checkStaleBalCts` was firing while wrap/swap were actually
  // working, confusing demo users. The swap-time check inside
  // PcSwapClient.swap() still gates real broken state — this just kills
  // the noisy pre-emptive UI banner.

  const handle = useCallback(
    async (
      step: StepKey,
      action: () => Promise<PcSwapResult>,
      setStatus: (s: StepStatus) => void,
    ) => {
      if (!publicKey) { toast.error('Connect a wallet first.'); return; }
      setStatus('pending');
      setBlocked((prev) => ({ ...prev, [step]: undefined }));
      try {
        const result = await action();
        if (result.ok) {
          setStatus('done');
          toast.success(`${step.toUpperCase()} confirmed`, {
            description: result.signature ? result.signature.slice(0, 16) + '…' : undefined,
          });
          setBalanceRefreshKey((k) => k + 1);
          setTimeout(() => setBalanceRefreshKey((k) => k + 1), 2500);
        } else {
          setStatus('idle');
          const reason = reasonText(result) ?? 'Unknown error.';
          setBlocked((prev) => ({ ...prev, [step]: reason }));
          toast.message(`${step.toUpperCase()} unavailable`, { description: reason });
        }
      } catch (err) {
        setStatus('idle');
        const reason = err instanceof Error ? err.message : 'unknown error';
        setBlocked((prev) => ({ ...prev, [step]: reason }));
        toast.error(`${step.toUpperCase()} failed`, { description: reason });
      }
    },
    [publicKey],
  );

  const onDrip = useCallback(() => {
    if (!publicKey) return;
    return handle('drip', () => client.faucetDrip({ wallet: publicKey }), setDrip);
  }, [client, handle, publicKey]);

  const decryptInto = useCallback(async (
    side: 'USDC' | 'DOGE',
    setStatus: (s: StepStatus) => void,
    setVal: (v: { amount: bigint; decimals: number } | null) => void,
    stepKey: StepKey,
  ) => {
    if (!publicKey) return;
    setStatus('pending');
    setBlocked((prev) => ({ ...prev, [stepKey]: undefined }));
    try {
      const result = await client.viewBalance({ wallet: publicKey, side });
      if (result.ok === true) {
        setVal({ amount: result.amount, decimals: result.decimals });
        setStatus('done');
        toast.success(`${side} decrypted`, {
          description: `${(Number(result.amount) / 10 ** result.decimals).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${side}`,
        });
      } else {
        setStatus('idle');
        const reason = reasonText(result) ?? 'Decrypt failed.';
        setBlocked((prev) => ({ ...prev, [stepKey]: reason }));
        toast.error('Decrypt failed', { description: reason });
      }
    } catch (err) {
      setStatus('idle');
      const reason = err instanceof Error ? err.message : String(err);
      setBlocked((prev) => ({ ...prev, [stepKey]: reason }));
      toast.error('Decrypt failed', { description: reason });
    }
  }, [client, publicKey]);

  const onViewUsdc = useCallback(() => decryptInto('USDC', setViewUsdc, setViewedUsdc, 'view_usdc'), [decryptInto]);
  const onViewDoge = useCallback(() => decryptInto('DOGE', setViewDoge, setViewedDoge, 'view_doge'), [decryptInto]);

  const onWrapUsdc = useCallback(async () => {
    if (!publicKey) return;
    // wrap() only resolves once the executor has committed the new bal CT digest, so
    // a follow-up decrypt always reads the latest state — no race window, no fixed delay.
    await handle('wrap_usdc', () => client.wrap({ wallet: publicKey, side: 'USDC', amount: WRAP_USDC_AMOUNT }), setWrapUsdc);
    void onViewUsdc();
  }, [client, handle, publicKey, onViewUsdc]);

  const onWrapDoge = useCallback(async () => {
    if (!publicKey) return;
    await handle('wrap_doge', () => client.wrap({ wallet: publicKey, side: 'DOGE', amount: WRAP_DOGE_AMOUNT }), setWrapDoge);
    void onViewDoge();
  }, [client, handle, publicKey, onViewDoge]);

  const onSwap = useCallback(async () => {
    if (!publicKey) return;
    await handle('swap', () => client.swap({
      wallet: publicKey, direction: 0, amountIn: SWAP_AMOUNT, minOut: 0n,
    }), setSwap);
    void onViewUsdc(); void onViewDoge();
  }, [client, handle, publicKey, onViewUsdc, onViewDoge]);

  const walletConnected = !!publicKey;

  return (
    <>
      <Helmet>
        <title>Dagon · Encrypted Swap (Devnet Pre-Alpha)</title>
      </Helmet>
      <main className="mx-auto max-w-5xl px-6 py-12">
        <PreAlphaDisclaimer />
        <header className="mb-10 flex flex-wrap items-end justify-between gap-6">
          <div>
            <h1 className="text-3xl uppercase tracking-[0.3em] text-primary mb-2">
              Encrypted Swap
            </h1>
            <p className="text-sm text-tertiary max-w-prose">
              Solana devnet. Pre-alpha SDK — receipt-gated PC-Token + PC-Swap flow.
              Wrap mock-USDC + mock-DOGE into encrypted balances, then swap
              PC-USDC ↔ PC-DOGE through a single CPI receipt-gated graph. No deposit,
              no withdraw — pc-swap reads from your pc-token balance directly.
            </p>
          </div>
          <WalletButton />
        </header>

        <section className="grid md:grid-cols-2 gap-4 mb-10">
          <div className="space-y-4">
            <StepCard
              index={1}
              title="Faucet — drip mock-USDC"
              tooltip={STEP_TOOLTIPS.drip}
              cta="Drip"
              onClick={onDrip}
              disabled={!walletConnected || !client.programsAvailable}
              pending={drip === 'pending'}
              done={drip === 'done'}
              blockedReason={blocked.drip}
            />
            <StepCard
              index={2}
              title="Wrap 100 USDC → pc-USDC"
              tooltip={STEP_TOOLTIPS.wrap}
              cta="Wrap USDC"
              onClick={onWrapUsdc}
              disabled={!walletConnected || !client.programsAvailable}
              pending={wrapUsdc === 'pending'}
              done={wrapUsdc === 'done'}
              blockedReason={blocked.wrap_usdc}
            />
            <StepCard
              index={3}
              title="Wrap 100 DOGE → pc-DOGE"
              tooltip={STEP_TOOLTIPS.wrap}
              cta="Wrap DOGE"
              onClick={onWrapDoge}
              disabled={!walletConnected || !client.programsAvailable}
              pending={wrapDoge === 'pending'}
              done={wrapDoge === 'done'}
              blockedReason={blocked.wrap_doge}
            />
            <StepCard
              index={4}
              title="Swap 1 pc-USDC → pc-DOGE"
              tooltip={STEP_TOOLTIPS.swap}
              cta="Swap"
              onClick={onSwap}
              disabled={!walletConnected || !client.programsAvailable}
              pending={swap === 'pending'}
              done={swap === 'done'}
              blockedReason={blocked.swap}
            />
            <StepCard
              index={5}
              title={
                viewedUsdc
                  ? `pc-USDC: ${(Number(viewedUsdc.amount) / 10 ** viewedUsdc.decimals).toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC`
                  : 'Decrypt pc-USDC'
              }
              tooltip={STEP_TOOLTIPS.view}
              cta={viewedUsdc ? 'Re-decrypt USDC' : 'View pc-USDC'}
              onClick={onViewUsdc}
              disabled={!walletConnected || !client.programsAvailable}
              pending={viewUsdc === 'pending'}
              done={viewUsdc === 'done'}
              blockedReason={blocked.view_usdc}
            />
            <StepCard
              index={6}
              title={
                viewedDoge
                  ? `pc-DOGE: ${(Number(viewedDoge.amount) / 10 ** viewedDoge.decimals).toLocaleString(undefined, { maximumFractionDigits: 6 })} DOGE`
                  : 'Decrypt pc-DOGE'
              }
              tooltip={STEP_TOOLTIPS.view}
              cta={viewedDoge ? 'Re-decrypt DOGE' : 'View pc-DOGE'}
              onClick={onViewDoge}
              disabled={!walletConnected || !client.programsAvailable}
              pending={viewDoge === 'pending'}
              done={viewDoge === 'done'}
              blockedReason={blocked.view_doge}
            />
          </div>
          <div className="space-y-4">
            <WalletBalances refreshKey={balanceRefreshKey} />
            <EncryptedBalances
              refreshKey={balanceRefreshKey}
              viewedUsdc={viewedUsdc}
              viewedDoge={viewedDoge}
            />
          </div>
        </section>

        {!client.programsAvailable && (
          <aside className="border border-outline-variant/30 px-5 py-4 text-xs text-tertiary leading-relaxed">
            <p className="mb-2">
              <strong className="text-secondary">Heads-up to operators:</strong> PC-Token / PC-Swap
              env vars missing. Run <code>packages/dagon/ops/scripts/init-pc-pool.ts</code> after
              deploying both programs to populate <code>.env.devnet</code>, then copy the
              <code>VITE_*</code> mirrors into <code>apps/ui-start/.env.local</code>.
            </p>
          </aside>
        )}
      </main>
    </>
  );
}
