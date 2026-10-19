/**
 * pcSwap.ts — receipt-gated USDC↔DOGE swap client for the upstream pc-token + pc-swap programs.
 *
 * Replaces the previous dagon-points-pool / pc-token-cold flow for the demo Swap page.
 * The new flow has no explicit deposit/withdraw step — pc-swap CPIs into pc-token's
 * TransferWithReceipt to debit the user, runs swap_graph against the receipt, then CPIs
 * pc-token::Transfer to credit the output side. User holds balance in pc-token throughout.
 *
 * On-chain instruction builders inlined (rather than imported from the encrypt package's
 * e2e/instructions.ts) because those files transitively pull in Node-only gRPC. We only
 * need pure-TS instruction layout, no runtime deps from there.
 */

import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type TransactionSignature,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';
import {
  createEncryptWebClient,
  encryptValue,
  Chain,
} from '@encrypt.xyz/pre-alpha-solana-client/grpc-web';
import { ed25519 } from '@noble/curves/ed25519';
import { decodeU64, encodeReadCiphertextMessage, readCiphertext } from './encryptRead';

// ── Types ──

export type Side = 'USDC' | 'DOGE';

export interface PcSwapClientOpts {
  connection: Connection;
  encryptProgramId: PublicKey;
  pcTokenProgramId: PublicKey;
  pcSwapProgramId: PublicKey;
  // Side mints + vaults (per-side immutable for the deployed pool)
  usdc: SideConfig;
  doge: SideConfig;
  // Pool ciphertexts (created at init time, persist for the lifetime of the pool)
  pool: PoolConfig;
  signAndSend: (tx: Transaction) => Promise<TransactionSignature>;
  faucetApiUrl?: string;
}

export interface SideConfig {
  splMint: PublicKey;
  pcMint: PublicKey;
  vault: PublicKey;
  vaultAta: PublicKey;
  decimals: number;
}

export interface PoolConfig {
  poolPda: PublicKey;
  vaultUsdc: PublicKey;
  vaultDoge: PublicKey;
  vaultUsdcBalCt: PublicKey;
  vaultDogeBalCt: PublicKey;
  reserveUsdcCt: PublicKey;
  reserveDogeCt: PublicKey;
}

export type PcSwapResult =
  | { ok: true; signature: TransactionSignature }
  | { ok: false; reason: 'programs_not_deployed' | 'unsupported' | 'user_rejected' | 'rpc_error'; detail?: string };

export interface DecryptedAmount { ok: true; side: Side; amount: bigint; decimals: number }

// ── Constants ──

const FHE_TYPE_U64 = 4;
const ENCRYPT_GRPC_URL = 'https://pre-alpha-dev-1.encrypt.ika-network.net:443';
const NETWORK_KEY = new Uint8Array(32).fill(0x55);

// ── Helpers (PDA derivation, account list assembly — inlined from upstream e2e) ──

function pda(seeds: (Buffer | Uint8Array)[], programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(seeds, programId);
}

function derivePcTokenCpiAuthority(programId: PublicKey): [PublicKey, number] {
  return pda([Buffer.from('__encrypt_cpi_authority')], programId);
}

function derivePcAccountPda(programId: PublicKey, mint: PublicKey, owner: PublicKey): [PublicKey, number] {
  return pda([Buffer.from('pc_account'), mint.toBuffer(), owner.toBuffer()], programId);
}

interface EncryptCpiAccts {
  encryptProgram: PublicKey;
  configPda: PublicKey;
  depositPda: PublicKey;
  networkKeyPda: PublicKey;
  eventAuthority: PublicKey;
}

function deriveEncryptAccts(EP: PublicKey, payer: PublicKey): EncryptCpiAccts & { depositBump: number } {
  const [configPda] = pda([Buffer.from('encrypt_config')], EP);
  const [eventAuthority] = pda([Buffer.from('__event_authority')], EP);
  const [depositPda, depositBump] = pda([Buffer.from('encrypt_deposit'), payer.toBuffer()], EP);
  const [networkKeyPda] = pda([Buffer.from('network_encryption_key'), Buffer.from(NETWORK_KEY)], EP);
  return { encryptProgram: EP, configPda, eventAuthority, depositPda, depositBump, networkKeyPda };
}

function encryptCpiAccountsList(enc: EncryptCpiAccts, callerProgram: PublicKey, cpiAuthority: PublicKey, payer: PublicKey) {
  return [
    { pubkey: enc.encryptProgram, isSigner: false, isWritable: false },
    { pubkey: enc.configPda, isSigner: false, isWritable: true },
    { pubkey: enc.depositPda, isSigner: false, isWritable: true },
    { pubkey: cpiAuthority, isSigner: false, isWritable: false },
    { pubkey: callerProgram, isSigner: false, isWritable: false },
    { pubkey: enc.networkKeyPda, isSigner: false, isWritable: false },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: enc.eventAuthority, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
}

function swapEncryptAndTokenAccounts(
  enc: EncryptCpiAccts, swapCpiAuthority: PublicKey, pcSwapProgram: PublicKey,
  pcTokenCpiAuthority: PublicKey, pcTokenProgram: PublicKey, payer: PublicKey,
) {
  return [
    { pubkey: enc.encryptProgram, isSigner: false, isWritable: false },
    { pubkey: enc.configPda, isSigner: false, isWritable: true },
    { pubkey: enc.depositPda, isSigner: false, isWritable: true },
    { pubkey: swapCpiAuthority, isSigner: false, isWritable: false },
    { pubkey: pcSwapProgram, isSigner: false, isWritable: false },
    { pubkey: pcTokenCpiAuthority, isSigner: false, isWritable: false },
    { pubkey: pcTokenProgram, isSigner: false, isWritable: false },
    { pubkey: enc.networkKeyPda, isSigner: false, isWritable: false },
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: enc.eventAuthority, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
}

// ── Instruction builders ──

function buildCreateDepositIx(EP: PublicKey, payer: PublicKey, configPda: PublicKey, depositPda: PublicKey, depositBump: number, vaultPk: PublicKey): TransactionInstruction {
  const data = Buffer.alloc(18); data[0] = 14; data[1] = depositBump;
  return new TransactionInstruction({
    programId: EP, data,
    keys: [
      { pubkey: depositPda, isSigner: false, isWritable: true },
      { pubkey: configPda, isSigner: false, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: vaultPk, isSigner: vaultPk.equals(payer), isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

function buildInitializeAccountIx(
  pcTokenProgram: PublicKey, accountPda: PublicKey, accountBump: number, mint: PublicKey,
  owner: PublicKey, balanceCt: PublicKey, encAccts: EncryptCpiAccts, cpiAuthority: PublicKey, cpiBump: number,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: pcTokenProgram,
    data: Buffer.from([1, accountBump, cpiBump]),
    keys: [
      { pubkey: accountPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: balanceCt, isSigner: true, isWritable: true },
      ...encryptCpiAccountsList(encAccts, pcTokenProgram, cpiAuthority, owner),
    ],
  });
}

function buildWrapIx(
  pcTokenProgram: PublicKey, vault: PublicKey, tokenAccount: PublicKey, userAta: PublicKey,
  vaultAta: PublicKey, balanceCt: PublicKey, amountCt: PublicKey, owner: PublicKey,
  amount: bigint, encAccts: EncryptCpiAccts, cpiAuthority: PublicKey, cpiBump: number,
): TransactionInstruction {
  const data = Buffer.alloc(10);
  data[0] = 30; data[1] = cpiBump;
  data.writeBigUInt64LE(amount, 2);
  return new TransactionInstruction({
    programId: pcTokenProgram, data,
    keys: [
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: tokenAccount, isSigner: false, isWritable: false },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: balanceCt, isSigner: false, isWritable: true },
      // Epoch 2: a fresh keypair. The program creates this ciphertext from `amount`
      // itself, so the credit always equals the SPL deposited.
      { pubkey: amountCt, isSigner: true, isWritable: true },
      ...encryptCpiAccountsList(encAccts, pcTokenProgram, cpiAuthority, owner),
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
}

function buildViewBalanceIx(
  pcTokenProgram: PublicKey, tokenAccount: PublicKey, balanceCt: PublicKey, viewCt: PublicKey,
  newAuthorized: PublicKey, encAccts: EncryptCpiAccts, cpiAuthority: PublicKey, cpiBump: number, owner: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: pcTokenProgram,
    data: Buffer.from([40, cpiBump]),
    keys: [
      { pubkey: tokenAccount, isSigner: false, isWritable: false },
      { pubkey: balanceCt, isSigner: false, isWritable: false },
      { pubkey: viewCt, isSigner: true, isWritable: true },
      { pubkey: newAuthorized, isSigner: false, isWritable: false },
      ...encryptCpiAccountsList(encAccts, pcTokenProgram, cpiAuthority, owner),
    ],
  });
}

function buildSwapIx(
  pcSwapProgram: PublicKey, pcTokenProgram: PublicKey, pool: PublicKey,
  userInAcct: PublicKey, userOutAcct: PublicKey,
  vaultInAcct: PublicKey, vaultOutAcct: PublicKey,
  userInBalCt: PublicKey, userOutBalCt: PublicKey,
  vaultInBalCt: PublicKey, vaultOutBalCt: PublicKey,
  reserveInCt: PublicKey, reserveOutCt: PublicKey,
  amtInCt: PublicKey, minOutCt: PublicKey, amtOutCt: PublicKey,
  receiptCt: PublicKey, direction: number,
  encAccts: EncryptCpiAccts, swapCpiAuthority: PublicKey, swapCpiBump: number,
  pcTokenCpiAuthority: PublicKey, pcTokenCpiBump: number, payer: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: pcSwapProgram,
    data: Buffer.from([1, swapCpiBump, pcTokenCpiBump, direction]),
    keys: [
      { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: userInAcct, isSigner: false, isWritable: true },
      { pubkey: userOutAcct, isSigner: false, isWritable: true },
      { pubkey: vaultInAcct, isSigner: false, isWritable: true },
      { pubkey: vaultOutAcct, isSigner: false, isWritable: true },
      { pubkey: userInBalCt, isSigner: false, isWritable: true },
      { pubkey: userOutBalCt, isSigner: false, isWritable: true },
      { pubkey: vaultInBalCt, isSigner: false, isWritable: true },
      { pubkey: vaultOutBalCt, isSigner: false, isWritable: true },
      { pubkey: reserveInCt, isSigner: false, isWritable: true },
      { pubkey: reserveOutCt, isSigner: false, isWritable: true },
      { pubkey: amtInCt, isSigner: false, isWritable: true },
      { pubkey: minOutCt, isSigner: false, isWritable: true },
      { pubkey: amtOutCt, isSigner: false, isWritable: true },
      { pubkey: receiptCt, isSigner: true, isWritable: true },
      ...swapEncryptAndTokenAccounts(encAccts, swapCpiAuthority, pcSwapProgram, pcTokenCpiAuthority, pcTokenProgram, payer),
    ],
  });
}

// ── Client ──

export class PcSwapClient {
  private readonly grpc = createEncryptWebClient(ENCRYPT_GRPC_URL);

  constructor(private readonly opts: PcSwapClientOpts) {}

  /** Programs are always considered available because env validates at construction time. */
  get programsAvailable(): boolean { return true; }

  // ── Internal helpers ──

  private encryptInputCt(value: bigint, authorized: PublicKey): Promise<PublicKey> {
    return this.grpc.createInput({
      chain: Chain.SOLANA,
      inputs: [{ ciphertextBytes: encryptValue(value, FHE_TYPE_U64), fheType: FHE_TYPE_U64 }],
      authorized: authorized.toBytes(),
      networkEncryptionPublicKey: NETWORK_KEY,
    }).then((ids) => {
      if (ids.length !== 1) throw new Error('expected 1 ct id');
      return new PublicKey(ids[0]);
    });
  }

  private async maybeBuildCreateDepositIx(payer: PublicKey, encAccts: EncryptCpiAccts & { depositBump: number }): Promise<TransactionInstruction | null> {
    if (await this.opts.connection.getAccountInfo(encAccts.depositPda)) return null;
    const cfg = await this.opts.connection.getAccountInfo(encAccts.configPda);
    if (!cfg) throw new Error('Encrypt config not initialized at this devnet');
    const encVault = new PublicKey((cfg.data as Buffer).subarray(100, 132));
    const vaultPk = encVault.equals(SystemProgram.programId) ? payer : encVault;
    return buildCreateDepositIx(this.opts.encryptProgramId, payer, encAccts.configPda, encAccts.depositPda, encAccts.depositBump, vaultPk);
  }

  private sideConfig(side: Side): SideConfig {
    return side === 'USDC' ? this.opts.usdc : this.opts.doge;
  }

  private async getUserPcAccountInfo(wallet: PublicKey, side: Side): Promise<{ acct: PublicKey; bump: number; balCt: PublicKey | null }> {
    const cfg = this.sideConfig(side);
    const [acct, bump] = derivePcAccountPda(this.opts.pcTokenProgramId, cfg.pcMint, wallet);
    const info = await this.opts.connection.getAccountInfo(acct);
    if (!info) return { acct, bump, balCt: null };
    // TokenAccount layout: mint(32) + owner(32) + balance(EUint64 = 32 bytes ciphertext id)
    const balCtBytes = (info.data as Buffer).subarray(64, 96);
    return { acct, bump, balCt: new PublicKey(balCtBytes) };
  }

  /**
   * A balance CT is "stale" when the executor never committed any FHE state to it —
   * digest bytes 2..34 are all zeros. Detected against an existing pc_account, this
   * indicates either: (a) a wrap fired but the executor lost the wrap-graph event, or
   * (b) the pc_account points at a bal CT from a prior executor instance that's now
   * forgotten. False-positive on a freshly-init'd-never-wrapped account, so don't use
   * this to gate wrap() — only swap(), where zero digest means swap_graph would read
   * garbage.
   */
  private async isBalCtStale(balCt: PublicKey): Promise<boolean> {
    const info = await this.opts.connection.getAccountInfo(balCt, 'confirmed');
    if (!info || info.data.length < 34) return false;
    const buf = info.data as Buffer;
    for (let i = 2; i < 34; i++) {
      if (buf[i] !== 0) return false;
    }
    return true;
  }

  private async waitForExecutorCommit(_ct: PublicKey, delayMs = 2000): Promise<void> {
    // Devnet mock executor doesn't flip byte 99 on FHE-graph outputs, so we can't poll
    // for verification. The executor processes ExecuteGraph events asynchronously after
    // the on-chain TX confirms; a small fixed delay gives it time to commit before the
    // subsequent gRPC readCiphertext call.
    await new Promise(r => setTimeout(r, delayMs));
  }

  /**
   * Poll until each ciphertext is in VERIFIED state (byte 99 == 1).
   *
   * Unlike FHE-graph outputs (which the mock executor doesn't flip), ciphertexts
   * created via gRPC `createInput` *are* committed by the executor — fesal from
   * dWallet flagged that submitting a swap before its `min_out` / `amount_in` /
   * `amount_out` inputs are committed is the most common cause of pc-token=0
   * symptoms. Wait for them.
   */
  private async pollVerifiedInputs(cts: PublicKey[], timeoutMs = 60_000): Promise<void> {
    const start = Date.now();
    const remaining = new Set(cts.map(c => c.toBase58()));
    while (remaining.size > 0 && Date.now() - start < timeoutMs) {
      const infos = await Promise.all(
        [...remaining].map(async addr => ({
          addr,
          info: await this.opts.connection.getAccountInfo(new PublicKey(addr), 'confirmed'),
        })),
      );
      for (const { addr, info } of infos) {
        if (info && info.data.length >= 100 && (info.data as Buffer)[99] === 1) {
          remaining.delete(addr);
        }
      }
      if (remaining.size > 0) await new Promise(r => setTimeout(r, 750));
    }
    if (remaining.size > 0) {
      throw new Error(`timeout waiting for createInput CTs to verify: ${[...remaining].join(', ')}`);
    }
  }

  // ── Public API ──

  /** Mock-USDC drip via points-farm faucet API (unchanged from old flow). */
  async faucetDrip({ wallet }: { wallet: PublicKey }): Promise<PcSwapResult> {
    const base = (this.opts.faucetApiUrl ?? 'http://localhost:8788').replace(/\/$/, '');
    const url = `${base}/faucet/${wallet.toBase58()}`;
    try {
      const r = await fetch(url, { method: 'POST' });
      if (!r.ok) return { ok: false, reason: 'rpc_error', detail: `faucet ${r.status} ${await r.text()}` };
      const j = await r.json() as { signature?: string };
      return { ok: true, signature: (j.signature ?? '') as TransactionSignature };
    } catch (err) {
      return { ok: false, reason: 'rpc_error', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Wrap SPL → pc-token. Auto-creates the user's pc-token account if first time.
   * Both USDC and DOGE are mock SPL mints with the deployer as mint authority.
   */
  async wrap({ wallet, side, amount }: { wallet: PublicKey; side: Side; amount: bigint }): Promise<PcSwapResult> {
    try {
      const cfg = this.sideConfig(side);
      const enc = deriveEncryptAccts(this.opts.encryptProgramId, wallet);
      const [cpiAuth, cpiBump] = derivePcTokenCpiAuthority(this.opts.pcTokenProgramId);

      const { acct: userAcct, bump: userAcctBump, balCt: existingBalCt } = await this.getUserPcAccountInfo(wallet, side);

      // ── Setup ixs sent in their own tx, separate from wrap.
      // Empirical finding (devnet, post-Fesal-redeploy): the executor silently fails to
      // commit the FIRST wrap-graph in a session if create_deposit + init_account + wrap
      // arrive too close together — bal CT stays uninitialized (byte 99 = 0). Splitting
      // setup off and adding a generous post-setup delay gives the executor time to
      // register the deposit + bal CT before the wrap event fires.
      const depositIx = await this.maybeBuildCreateDepositIx(wallet, enc);
      const userAta = await getAssociatedTokenAddress(cfg.splMint, wallet);
      const ataMissing = !(await this.opts.connection.getAccountInfo(userAta));

      const setupIxs: TransactionInstruction[] = [];
      const setupSigners: Keypair[] = [];

      if (depositIx) setupIxs.push(depositIx);
      if (ataMissing) setupIxs.push(createAssociatedTokenAccountIdempotentInstruction(wallet, userAta, wallet, cfg.splMint));

      let balanceCt: PublicKey;
      let initializingBalCt = false;
      if (existingBalCt) {
        balanceCt = existingBalCt;
      } else {
        const balCtKp = Keypair.generate();
        balanceCt = balCtKp.publicKey;
        setupSigners.push(balCtKp);
        setupIxs.push(buildInitializeAccountIx(this.opts.pcTokenProgramId, userAcct, userAcctBump, cfg.pcMint, wallet, balanceCt, enc, cpiAuth, cpiBump));
        initializingBalCt = true;
      }

      if (setupIxs.length > 0) {
        const setupTx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...setupIxs);
        setupTx.feePayer = wallet;
        setupTx.recentBlockhash = (await this.opts.connection.getLatestBlockhash('confirmed')).blockhash;
        if (setupSigners.length) setupTx.partialSign(...setupSigners);
        await this.opts.signAndSend(setupTx);
        // Long-ish delay: executor needs time to process create_deposit + init_account
        // events before it can correctly handle a wrap-graph against the new bal CT.
        if (initializingBalCt || depositIx) await new Promise((r) => setTimeout(r, 5000));
      }

      // Epoch 2: no createInput for wrap. The amount ciphertext is a fresh keypair that
      // pc-token initializes from the SPL amount, so there is nothing to poll.
      const amountCtKp = Keypair.generate();
      const amountCt = amountCtKp.publicKey;

      // Snapshot the bal CT digest *before* submitting the wrap — we'll wait for it to
      // change as the signal that the executor committed the new balance. For repeat
      // wraps the bal CT already has a non-zero digest (e.g., enc(100)); without a "before"
      // snapshot, a digest != zero check would return immediately and the auto-decrypt
      // would fire on the stale value.
      const previousDigest = await this.snapshotBalCtDigest(balanceCt);

      const submitWrap = async (): Promise<TransactionSignature> => {
        const wrapTx = new Transaction().add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
          buildWrapIx(this.opts.pcTokenProgramId, cfg.vault, userAcct, userAta, cfg.vaultAta, balanceCt, amountCt, wallet, amount, enc, cpiAuth, cpiBump),
        );
        wrapTx.feePayer = wallet;
        wrapTx.recentBlockhash = (await this.opts.connection.getLatestBlockhash('confirmed')).blockhash;
        wrapTx.partialSign(amountCtKp);
        return this.opts.signAndSend(wrapTx);
      };

      const signature = await submitWrap();

      // Wait for the digest to differ from previousDigest (or become non-zero if the
      // account didn't exist before). Devnet executor lag is typically 10–30s, occasionally
      // longer; cap at 90s before declaring failure.
      const committed = await this.waitForBalCtCommitted(balanceCt, previousDigest, 90_000);
      if (!committed) {
        return {
          ok: false,
          reason: 'rpc_error',
          detail: `On-chain wrap succeeded (sig ${signature.slice(0, 16)}…) but the Encrypt executor hasn't committed the FHE balance update within 90s. Your ${side} SPL is in the vault; try wrapping again or waiting a bit longer before swapping.`,
        };
      }
      return { ok: true, signature };
    } catch (err) {
      return errToResult(err);
    }
  }

  /**
   * Snapshot the current ciphertext digest (bytes 2..34) of a bal CT, or null if the
   * account doesn't exist yet. Used as a "before" reference so we can detect when the
   * executor commits a new value (digest *changes*, not just becomes non-zero — repeat
   * wraps already start with a non-zero digest).
   */
  private async snapshotBalCtDigest(balCt: PublicKey): Promise<Buffer | null> {
    const info = await this.opts.connection.getAccountInfo(balCt, 'confirmed');
    if (!info || info.data.length < 34) return null;
    return Buffer.from(info.data.subarray(2, 34));
  }

  /**
   * Wait for the executor to commit an FHE-graph result to bal CT. Watches for the digest
   * to differ from the snapshot (or to become non-zero if the account didn't exist before).
   * Uses WebSocket onAccountChange for near-real-time signal, with a polling fallback for
   * the initial state and timeout enforcement. Byte 99 is *not* a reliable signal here —
   * the current devnet executor only flips it on createInput CTs, not on graph outputs.
   */
  private waitForBalCtCommitted(
    balCt: PublicKey,
    previousDigest: Buffer | null,
    timeoutMs: number,
  ): Promise<boolean> {
    const conn = this.opts.connection;
    const matchesCommit = (data: Buffer | Uint8Array): boolean => {
      if (data.length < 34) return false;
      const buf = data instanceof Buffer ? data : Buffer.from(data);
      const current = buf.subarray(2, 34);
      if (previousDigest === null) {
        for (let i = 0; i < 32; i++) if (current[i] !== 0) return true;
        return false;
      }
      return !current.equals(previousDigest);
    };
    return new Promise<boolean>((resolve) => {
      let done = false;
      let subId: number | null = null;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        if (subId !== null) void conn.removeAccountChangeListener(subId).catch(() => {});
        resolve(ok);
      };
      subId = conn.onAccountChange(balCt, (info) => {
        if (matchesCommit(info.data)) finish(true);
      }, 'confirmed');
      void (async () => {
        const start = Date.now();
        while (!done && Date.now() - start < timeoutMs) {
          const info = await conn.getAccountInfo(balCt, 'confirmed');
          if (info && matchesCommit(info.data)) { finish(true); return; }
          await new Promise((r) => setTimeout(r, 1500));
        }
        finish(false);
      })();
    });
  }

  /**
   * Atomic receipt-gated swap. Direction 0 = USDC→DOGE; direction 1 = DOGE→USDC.
   *
   * pc-swap CPIs into pc-token::TransferWithReceipt (debits user, emits a binary receipt
   * authorized to pc-swap), runs swap_graph against the receipt (lying user → receipt = 0
   * → uniform no-op), then CPIs pc-token::Transfer for the vault → user payout. All in one
   * Solana transaction; no asymmetric-failure window.
   */
  async swap({ wallet, direction, amountIn, minOut }: {
    wallet: PublicKey; direction: 0 | 1; amountIn: bigint; minOut: bigint;
  }): Promise<PcSwapResult> {
    try {
      const enc = deriveEncryptAccts(this.opts.encryptProgramId, wallet);
      const [pcTokenCpiAuth, pcTokenCpiBump] = derivePcTokenCpiAuthority(this.opts.pcTokenProgramId);
      const [swapCpiAuth, swapCpiBump] = pda([Buffer.from('__encrypt_cpi_authority')], this.opts.pcSwapProgramId);

      const inSide: Side = direction === 0 ? 'USDC' : 'DOGE';
      const outSide: Side = direction === 0 ? 'DOGE' : 'USDC';
      const inCfg = this.sideConfig(inSide);
      const outCfg = this.sideConfig(outSide);

      // User's pc-token accounts must exist on both sides — caller should have wrapped both
      // first (or at least the input side; the output side will be auto-created).
      const userIn = await this.getUserPcAccountInfo(wallet, inSide);
      const userOut = await this.getUserPcAccountInfo(wallet, outSide);
      if (!userIn.balCt) {
        return { ok: false, reason: 'unsupported', detail: `Wrap some ${inSide} first.` };
      }

      // Refuse if the input side's bal CT digest is still zero — that means the executor
      // hasn't committed the most recent wrap yet, and the swap_graph would read balance =
      // 0 → receipt = 0 → uniform no-op (silent). Output side is allowed to be uninit (it
      // gets created/credited by this swap).
      const [inStale, outStale] = await Promise.all([
        this.isBalCtStale(userIn.balCt),
        userOut.balCt ? this.isBalCtStale(userOut.balCt) : Promise.resolve(false),
      ]);
      if (inStale) {
        return {
          ok: false,
          reason: 'unsupported',
          detail: `Your ${inSide} encrypted balance hasn't been committed by the executor yet (digest is zero). Wait ~30–60s after wrapping, decrypt to confirm a non-zero balance, then retry the swap.`,
        };
      }
      if (outStale) {
        return {
          ok: false,
          reason: 'unsupported',
          detail: `Your ${outSide} encrypted balance hasn't been committed by the executor yet — wait, decrypt to verify, then retry.`,
        };
      }

      const ixs: TransactionInstruction[] = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })];
      const extraSigners: Keypair[] = [];

      const depositIx = await this.maybeBuildCreateDepositIx(wallet, enc);
      if (depositIx) ixs.push(depositIx);

      let userOutBalCt: PublicKey;
      if (userOut.balCt) {
        userOutBalCt = userOut.balCt;
      } else {
        const kp = Keypair.generate(); userOutBalCt = kp.publicKey; extraSigners.push(kp);
        ixs.push(buildInitializeAccountIx(this.opts.pcTokenProgramId, userOut.acct, userOut.bump, outCfg.pcMint, wallet, userOutBalCt, enc, pcTokenCpiAuth, pcTokenCpiBump));
      }

      // Pool-side vault accounts + reserves (direction-mapped)
      const vaultInAcct = direction === 0 ? this.opts.pool.vaultUsdc : this.opts.pool.vaultDoge;
      const vaultOutAcct = direction === 0 ? this.opts.pool.vaultDoge : this.opts.pool.vaultUsdc;
      const vaultInBalCt = direction === 0 ? this.opts.pool.vaultUsdcBalCt : this.opts.pool.vaultDogeBalCt;
      const vaultOutBalCt = direction === 0 ? this.opts.pool.vaultDogeBalCt : this.opts.pool.vaultUsdcBalCt;
      const reserveInCt = direction === 0 ? this.opts.pool.reserveUsdcCt : this.opts.pool.reserveDogeCt;
      const reserveOutCt = direction === 0 ? this.opts.pool.reserveDogeCt : this.opts.pool.reserveUsdcCt;

      // Encrypt user inputs authorized to pc-swap (the program that will read them)
      const amtInCt = await this.encryptInputCt(amountIn, this.opts.pcSwapProgramId);
      const minOutCt = await this.encryptInputCt(minOut, this.opts.pcSwapProgramId);
      const amtOutCt = await this.encryptInputCt(0n, this.opts.pcSwapProgramId);
      // Wait for executor to commit createInput CTs before submitting the swap. If the swap
      // fires while these are PENDING, swap_graph reads them as empty bytes and produces 0
      // outputs (and may zero out user balances en route via the receipt path).
      await this.pollVerifiedInputs([amtInCt, minOutCt, amtOutCt]);
      const receiptKp = Keypair.generate();
      extraSigners.push(receiptKp);

      ixs.push(buildSwapIx(
        this.opts.pcSwapProgramId, this.opts.pcTokenProgramId, this.opts.pool.poolPda,
        userIn.acct, userOut.acct, vaultInAcct, vaultOutAcct,
        userIn.balCt, userOutBalCt, vaultInBalCt, vaultOutBalCt,
        reserveInCt, reserveOutCt,
        amtInCt, minOutCt, amtOutCt, receiptKp.publicKey, direction,
        enc, swapCpiAuth, swapCpiBump, pcTokenCpiAuth, pcTokenCpiBump, wallet,
      ));

      // Snapshot both user bal CT digests pre-swap. Need this to know when the executor
      // commits — without a "before" reference, callers would see stale pre-swap values.
      const [prevInDigest, prevOutDigest] = await Promise.all([
        this.snapshotBalCtDigest(userIn.balCt),
        userOut.balCt ? this.snapshotBalCtDigest(userOut.balCt) : Promise.resolve(null),
      ]);

      const tx = new Transaction().add(...ixs);
      tx.feePayer = wallet;
      tx.recentBlockhash = (await this.opts.connection.getLatestBlockhash('confirmed')).blockhash;
      tx.partialSign(...extraSigners);
      const signature = await this.opts.signAndSend(tx);

      // Wait for both sides to commit before returning success. Caller can decrypt
      // immediately after — no more "fire too early, see stale" race.
      const [inOk, outOk] = await Promise.all([
        this.waitForBalCtCommitted(userIn.balCt, prevInDigest, 90_000),
        this.waitForBalCtCommitted(userOutBalCt, prevOutDigest, 90_000),
      ]);
      if (!inOk || !outOk) {
        return {
          ok: false,
          reason: 'rpc_error',
          detail: `On-chain swap confirmed (sig ${signature.slice(0, 16)}…) but the Encrypt executor hasn't committed within 90s (in=${inOk} out=${outOk}). Check encrypted balances in a moment.`,
        };
      }
      return { ok: true, signature };
    } catch (err) {
      return errToResult(err);
    }
  }

  /**
   * Decrypt the user's pc-token balance via ViewBalance + gRPC readCiphertext.
   * Generates an ephemeral ed25519 keypair, on-chain copy_ciphertext to that pubkey's
   * authority, signs a BCS read message locally with that key, asks Encrypt for plaintext.
   * Wallet only authorizes the on-chain copy — never sees the BCS bytes.
   */
  async viewBalance({ wallet, side }: { wallet: PublicKey; side: Side }): Promise<DecryptedAmount | { ok: false; reason: string; detail?: string }> {
    try {
      const cfg = this.sideConfig(side);
      const userInfo = await this.getUserPcAccountInfo(wallet, side);
      if (!userInfo.balCt) return { ok: false, reason: 'unsupported', detail: `No ${side} balance — wrap first.` };

      const enc = deriveEncryptAccts(this.opts.encryptProgramId, wallet);
      const [cpiAuth, cpiBump] = derivePcTokenCpiAuthority(this.opts.pcTokenProgramId);

      const viewCt = Keypair.generate();
      const ephemeral = Keypair.generate();

      const ix = buildViewBalanceIx(this.opts.pcTokenProgramId, userInfo.acct, userInfo.balCt, viewCt.publicKey, ephemeral.publicKey, enc, cpiAuth, cpiBump, wallet);
      const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }), ix);
      tx.feePayer = wallet;
      tx.recentBlockhash = (await this.opts.connection.getLatestBlockhash('confirmed')).blockhash;
      tx.partialSign(viewCt);

      await this.opts.signAndSend(tx);
      await this.waitForExecutorCommit(viewCt.publicKey);

      const message = encodeReadCiphertextMessage({
        chain: 0, ciphertextIdentifier: viewCt.publicKey.toBytes(),
        reencryptionKey: new Uint8Array(0), epoch: 0n,
      });
      const signature = ed25519.sign(message, ephemeral.secretKey.slice(0, 32));
      const result = await readCiphertext({
        ciphertextIdentifier: viewCt.publicKey.toBytes(),
        signature, signer: ephemeral.publicKey.toBytes(),
      });
      const amount = decodeU64(result.value);
      return { ok: true, side, amount, decimals: cfg.decimals };
    } catch (err) {
      return { ok: false, reason: 'rpc_error', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Wallet-health probe: returns the set of sides whose pc_account exists on-chain
   * but points at an uncommitted (stale) balance ciphertext. UI shows a banner when
   * this is non-empty — affected wallets cannot wrap or swap that side until they
   * switch to a fresh wallet.
   */
  async checkStaleBalCts({ wallet }: { wallet: PublicKey }): Promise<Side[]> {
    const stale: Side[] = [];
    for (const side of ['USDC', 'DOGE'] as const) {
      const info = await this.getUserPcAccountInfo(wallet, side);
      if (info.balCt && (await this.isBalCtStale(info.balCt))) stale.push(side);
    }
    return stale;
  }
}

// ── Errors ──

function errToResult(err: unknown): PcSwapResult {
  const detail = err instanceof Error ? err.message : String(err);
  if (/user reject|declined/i.test(detail)) return { ok: false, reason: 'user_rejected', detail };
  return { ok: false, reason: 'rpc_error', detail };
}

// ── Resolver ──

export interface ResolvePcSwapClientOpts {
  connection: Connection;
  signAndSend?: (tx: Transaction) => Promise<TransactionSignature>;
  faucetApiUrl?: string;
  // Env-driven addresses (all required)
  encryptProgramId?: string;
  pcTokenProgramId?: string;
  pcSwapProgramId?: string;
  usdcSplMint?: string; usdcPcMint?: string; usdcVault?: string; usdcVaultAta?: string; usdcDecimals?: string | number;
  dogeSplMint?: string; dogePcMint?: string; dogeVault?: string; dogeVaultAta?: string; dogeDecimals?: string | number;
  poolPda?: string; poolVaultUsdc?: string; poolVaultDoge?: string;
  poolVaultUsdcBalCt?: string; poolVaultDogeBalCt?: string;
  poolReserveUsdcCt?: string; poolReserveDogeCt?: string;
}

/** Returns a real client if all required addresses are present, otherwise a stub that
 *  reports `programsAvailable=false` so the UI can render an explanatory message. */
export function resolvePcSwapClient(opts: ResolvePcSwapClientOpts): PcSwapClient | { programsAvailable: false; faucetDrip(args: { wallet: PublicKey }): Promise<PcSwapResult>; wrap(): Promise<PcSwapResult>; swap(): Promise<PcSwapResult>; viewBalance(): Promise<{ ok: false; reason: string; detail?: string }>; checkStaleBalCts(): Promise<Side[]> } {
  const required: (keyof ResolvePcSwapClientOpts)[] = [
    'encryptProgramId', 'pcTokenProgramId', 'pcSwapProgramId',
    'usdcSplMint', 'usdcPcMint', 'usdcVault', 'usdcVaultAta', 'usdcDecimals',
    'dogeSplMint', 'dogePcMint', 'dogeVault', 'dogeVaultAta', 'dogeDecimals',
    'poolPda', 'poolVaultUsdc', 'poolVaultDoge',
    'poolVaultUsdcBalCt', 'poolVaultDogeBalCt',
    'poolReserveUsdcCt', 'poolReserveDogeCt',
  ];
  const missing = required.filter(k => !opts[k]);
  if (missing.length || !opts.signAndSend) {
    const reason = missing.length ? `Missing env: ${missing.join(', ')}` : 'wallet not connected';
    const stub = (): Promise<PcSwapResult> => Promise.resolve({ ok: false, reason: 'unsupported', detail: reason });
    return {
      programsAvailable: false,
      faucetDrip: stub, wrap: stub, swap: stub,
      viewBalance: () => Promise.resolve({ ok: false as const, reason: 'unsupported', detail: reason }),
      checkStaleBalCts: () => Promise.resolve([]),
    };
  }
  return new PcSwapClient({
    connection: opts.connection,
    encryptProgramId: new PublicKey(opts.encryptProgramId!),
    pcTokenProgramId: new PublicKey(opts.pcTokenProgramId!),
    pcSwapProgramId: new PublicKey(opts.pcSwapProgramId!),
    usdc: {
      splMint: new PublicKey(opts.usdcSplMint!), pcMint: new PublicKey(opts.usdcPcMint!),
      vault: new PublicKey(opts.usdcVault!), vaultAta: new PublicKey(opts.usdcVaultAta!),
      decimals: Number(opts.usdcDecimals),
    },
    doge: {
      splMint: new PublicKey(opts.dogeSplMint!), pcMint: new PublicKey(opts.dogePcMint!),
      vault: new PublicKey(opts.dogeVault!), vaultAta: new PublicKey(opts.dogeVaultAta!),
      decimals: Number(opts.dogeDecimals),
    },
    pool: {
      poolPda: new PublicKey(opts.poolPda!),
      vaultUsdc: new PublicKey(opts.poolVaultUsdc!), vaultDoge: new PublicKey(opts.poolVaultDoge!),
      vaultUsdcBalCt: new PublicKey(opts.poolVaultUsdcBalCt!), vaultDogeBalCt: new PublicKey(opts.poolVaultDogeBalCt!),
      reserveUsdcCt: new PublicKey(opts.poolReserveUsdcCt!), reserveDogeCt: new PublicKey(opts.poolReserveDogeCt!),
    },
    signAndSend: opts.signAndSend!,
    faucetApiUrl: opts.faucetApiUrl,
  });
}
