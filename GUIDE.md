# pc-token / pc-swap — Wallet Integration Guide (Solana devnet)

**Audience:** wallet engineering teams integrating confidential balances and a confidential swap on devnet.
**Status:** pre-alpha technical preview. Devnet only. Read §1 before anything else.
**Date:** 2026-10-19 (devnet epoch 2)
**Contact:** integrations — reply on the thread you received this from.

This guide covers, in the order a wallet would ship them:

1. Wrap a public SPL token into a pc-token balance
2. Send (transfer) pc-token to another wallet
3. Decrypt (reveal) a pc-token balance to the user
4. Swap between two pc-tokens through pc-swap
5. Unwrap back to SPL

Everything here is written against the programs that are actually deployed on devnet today, from the reference client we run in our own web demo. Where a flow has no finished reference client yet, it says so.

### What changed in epoch 2

Epoch 1 ran the upstream pc-token / pc-swap examples. Those had program-level holes: wrap credited a client-supplied ciphertext, accounts weren't checked for owner or type, the unwrap steps weren't bound together, the Encrypt program and the pc-token program weren't pinned, and pc-swap's pool wasn't owner-checked. Epoch 2 redeploys patched programs at new addresses, built from `encrypt-pre-alpha` branch `inkwell/epoch-2-hardening` (commit `3a49223`). Each hole has a regression test there that fails on the old build.

For a wallet, only these change:

- **Wrap (§4):** the amount ciphertext is a fresh keypair you `partialSign`. There is no `createInput` and no verification poll; the program creates the ciphertext from the SPL amount.
- **Unwrap (§9):** `burnedCt` is a fresh keypair you `partialSign`, created by the program. The receipt is now 203 bytes, so unwrap rent rises slightly. Decryption can be requested once per receipt.
- **Swap floor:** a swap that misses its floor now refunds the input in the same transaction (upstream `f7f410a`). In epoch 1 the input stayed in the pool.
- **Mock tokens:** 2 decimals instead of 6, so the 64-bit curve math can't overflow (§2).
- **Settlement:** wait for the status byte (`data[99] == 1`) as well as a digest change (§8). The epoch 1 client relied on the digest alone, which fires before the executor commits.
- **Send:** the reference client has a tested `transfer()` (§6).
- **Errors:** wrong-owner or wrong-length accounts, a foreign Encrypt program, a wrong caller, aliased accounts and non-canonical bumps are rejected. Custom errors are `0x100`–`0x10E` from pc-token and `0x200`–`0x207` from pc-swap (names in the vendored sources).

Every other instruction keeps its discriminator, data and account order. Every address in §2 is new.

---

## 1. Read this first — what is and isn't true today

**Encrypt is pre-alpha and does not encrypt yet.** The Encrypt network that executes the confidential arithmetic is at a stage where, in their own words, "there is no real encryption — all data is completely public and stored as plaintext on-chain." Every "ciphertext" account below is a real account with the real shape of the final system, but its contents are readable by anyone today. What you are integrating is the *shape* of the rail — the account model, the instruction flow, the asynchronous executor, the UX constraints — so that when Encrypt's Alpha 1 lands with real threshold-FHE, your integration is already correct. Do not present this to end users as private.

**Devnet only, and it will be wiped.** Encrypt Alpha 1 redeploys the network with no state migration. Every program ID, mint, pool and ciphertext account in §2 dies at that point. Treat all addresses as a versioned config you can swap out, never as constants in code.

**The executor is third-party hosted dev infrastructure.** Every wrap, send, swap and reveal round-trips through `https://pre-alpha-dev-1.encrypt.ika-network.net:443`, a development executor operated by dWallet Labs (the Encrypt team). It has no SLA, and results land asynchronously — typically seconds, occasionally up to a minute or more. Your UI has to be built around "submitted" vs "settled" as distinct states (§8).

**What the design hides, once encryption is real:**

| Data | Visibility |
|---|---|
| pc-token balances | Encrypted |
| Transfer amounts | Encrypted |
| Swap amounts | Encrypted |
| Pool reserves (TVL) | Encrypted |
| LP positions | Encrypted |
| Wrap / unwrap amounts (the ramp) | **Public** — this is an SPL transfer |
| That a wallet transacted, with which program, when | **Public** |

The honest one-liner: *it hides how much, not that.* A wrap is a public SPL transfer into a vault; the transaction history of a wallet shows that it wrapped, sent, swapped and revealed. Only the amounts inside the pc-token layer are (will be) sealed.

**Failures are silent by design.** Insufficient balance on a transfer, a swap that violates the user's floor, an unwrap of more than the user holds — none of these error. The transaction succeeds and the encrypted arithmetic produces a no-op (zero moves). The chain cannot reveal *why* nothing moved without leaking the balance. Your wallet must therefore decrypt after the fact to know what happened (§5, §8). Never render "swap succeeded" from a confirmed signature alone.

**Revealing a balance costs a transaction.** There is no passive "read my encrypted balance" call. A reveal is a wallet-signed on-chain instruction plus an executor round-trip, and it is visible on-chain as a wallet-attributed event (§5). Design balance display around a cached last-revealed value with a timestamp, not around refresh-on-every-render.

**Relationship to Token-2022 Confidential Transfer.** Solana's native Token-2022 confidential-transfer extension hides transfer amounts and balances with ZK proofs and is live on mainnet; if all you need is confidential *transfers*, start there (https://solana.com/docs/tokens/extensions/confidential-transfer). pc-token exists for the case where something has to *compute* on hidden values — a swap against hidden reserves, a floor check inside the math — which Token-2022 cannot do. The two are complementary rails, not competitors.

---

## 2. Devnet addresses (config, not constants)

Cluster: Solana devnet. Any devnet RPC works; the reference client defaults to `https://api.devnet.solana.com`. The public RPC rate-limits aggressively and this rail polls account state a lot (§8) — use your own provider.

Encrypt executor (gRPC-web): `https://pre-alpha-dev-1.encrypt.ika-network.net:443`
Network encryption key (32 bytes, all `0x55`): `Uint8Array(32).fill(0x55)`

| Program | Address |
|---|---|
| Encrypt | `4ebfzWdKnrnGseuQpezXdG8yCdHqwQ1SSBHD3bWArND8` |
| pc-token | `3kjJEx6G1XdrtixFg9f8eGRAyzW5QmhsJQq6qCUZYhXZ` |
| pc-swap | `BqJMtWQYiis1264KqBN3wssNqTofK5RuP67hkZYvb4SD` |

Two mock tokens, both **2 decimals**, named USDC and DOGE for demo purposes only. They are test mints we control, worth nothing. They use 2 decimals because pc-swap's curve math is 64-bit: `amountIn × 997 × reserveOut` must stay below 2⁶⁴, which 6-decimal reserves of any useful size break. Their SPL mints, pc-mints, vaults, the mock-USDC / mock-DOGE pool and its reserve ciphertexts are created when epoch 2 is initialized on devnet. Read every one of them from [`devnet.json`](devnet.json) rather than from this guide. Its `epoch` bumps on every redeploy, so your build can refuse to run against a stale set.

The epoch 1 addresses (pc-token `3QaXJefr…`, pc-swap `C3FYxXn1…`) still exist on devnet but run the unpatched programs. Don't integrate against them.

### PDA derivations

| Account | Seeds | Program |
|---|---|---|
| pc-mint | `[b"pc_mint", authority]` | pc-token |
| pc-account (a wallet's balance account) | `[b"pc_account", pcMint, owner]` | pc-token |
| vault | `[b"pc_vault", pcMint]` | pc-token |
| unwrap receipt | `[b"pc_receipt", burnedCt]` | pc-token |
| pool | `[b"pc_pool", pcMintA, pcMintB]` | pc-swap |
| CPI authority | `[b"__encrypt_cpi_authority"]` | pc-token *and* pc-swap (each has its own) |
| Encrypt config | `[b"encrypt_config"]` | Encrypt |
| Encrypt deposit | `[b"encrypt_deposit", payer]` | Encrypt |
| network key | `[b"network_encryption_key", NETWORK_KEY]` | Encrypt |
| event authority | `[b"__event_authority"]` | Encrypt |

### Account layouts you must read

- **pc-account** (`[b"pc_account", pcMint, owner]`): the balance ciphertext account's pubkey is at `data[64..96]`. You need it for every operation.
- **Ciphertext account** (owned by Encrypt): `data[2..34]` is the current value digest — it changes whenever the executor commits a new value to that account. `data[99]` is the status: `1` Verified (committed by the executor), `0` Pending. Encrypt rewrites the digest and sets status `0` the moment a transaction writes the ciphertext, then the executor sets `1` when it commits. This applies to `createInput` ciphertexts, graph outputs and copies alike. Settlement is therefore digest changed **and** status `1` (§8); a digest change alone fires immediately.
- **Encrypt config** (`[b"encrypt_config"]`): `data[100..132]` is the fee vault pubkey used by `create_deposit`. If it equals the System Program, pass the payer instead.

---

## 3. Client prerequisites

### The Encrypt TypeScript client

The reference client uses `@encrypt.xyz/pre-alpha-solana-client`. **The published npm package is broken as published** (root export points at a missing file; the `./grpc-web` entry ships raw TypeScript that only Vite-style bundlers tolerate; unmet `@solana/kit` peer deps). For a wallet build — especially React Native / Metro — do not depend on it. What you actually need from it is three files: two generated protobuf-ts clients and a ~90-line gRPC-web transport shim, plus `@protobuf-ts/{runtime,runtime-rpc,grpcweb-transport}` as normal dependencies. We will hand you those three files pinned to a commit, alongside the reference client code (§9). Two gRPC calls are used in total:

- `createInput({ value, fheType, authorized, networkKey })` — asks the executor to create an input ciphertext account for a value. Returns the ciphertext account pubkey. `fheType = 4` (u64) for everything in this guide.
- `readCiphertext({ message, signature, signer })` — decrypts a ciphertext you are authorized on. Used only by reveal (§5).

### Signing model

Every flow is a normal legacy `Transaction` (no versioned tx, no lookup tables) signed by the user's wallet via `signTransaction` and sent with `sendRawTransaction`. In addition, most flows need one or more **ephemeral keypairs** as co-signers — a fresh `Keypair` for a ciphertext account being created (`balanceCt`, `viewCt`, `receiptCt`, `requestAcct`). The client `partialSign`s these *before* handing the transaction to the wallet. **Your wallet must preserve existing signatures when it signs.** A wallet that re-serializes and drops partial signatures breaks every flow here. The user never sees these keys; they are single-use.

Compute budgets are fixed and generous; no priority fee is set in the reference client. Add `setComputeUnitPrice` yourself if devnet is congested.

| Flow | `setComputeUnitLimit` |
|---|---|
| setup (deposit + init account) | 400 000 |
| wrap | 400 000 |
| transfer | 450 000 |
| reveal | 250 000 |
| swap | 1 000 000 |

### The common Encrypt account tail

Almost every pc-token instruction ends with the same nine accounts, in this order. `callerProgram` is the program whose CPI authority is being used (pc-token for the flows in §4–§6).

```
encryptProgram          ro
encryptConfig PDA       w
encryptDeposit PDA      w      [b"encrypt_deposit", payer]
cpiAuthority            ro     [b"__encrypt_cpi_authority"] under callerProgram
callerProgram           ro
networkKey PDA          ro
payer                   signer, w
eventAuthority PDA      ro
systemProgram           ro
```

### One-time per wallet: Encrypt deposit account + pc-account

Before a wallet can hold a pc-token it needs (a) an Encrypt deposit account (pays executor fees; one per wallet) and (b) a pc-account for that mint, which owns a balance ciphertext.

**create_deposit** — Encrypt program, discriminator byte `14`, data = 18 bytes: `[14, depositBump, 0 × 16]`.
Accounts: `depositPda(w)`, `configPda(ro)`, `payer(signer)`, `payer(signer)`, `payer(signer)`, `feeVault(w; signer only if it equals payer)`, `systemProgram(ro)`, `systemProgram(ro)`. Skip if the deposit PDA already exists.

**InitializeAccount** — pc-token discriminator `1`, data = `[1, accountBump, cpiBump]`.
Accounts: `pcAccountPda(w)`, `pcMint(ro)`, `owner(ro)`, `balanceCt(signer, w)` + Encrypt tail with `payer = owner`. `balanceCt` is a fresh ephemeral keypair; `partialSign` it. Skip if the pc-account exists.

Reference: `pcSwap.ts` `ensureDeposit` / `buildInitAccountIx` (§9).

**Ordering bug you must respect:** if create_deposit, InitializeAccount and the first wrap go in the same transaction, the executor silently drops the wrap's computation and the balance stays zero. Put setup in its own transaction, confirm it, wait ~5 s, then wrap.

---

## 4. Wrap — SPL → pc-token

The wrap is the public on-ramp: an ordinary SPL transfer from the user's ATA into the mint's vault, followed by an encrypted `mint_to` onto the user's balance ciphertext. The amount is public here and only here.

Steps:

1. Generate a fresh `amountCt` keypair. Don't call `createInput`: the program creates this ciphertext from the SPL `amount` itself, so the credit always equals what was deposited.
2. Build the wrap transaction: CU limit 400 000 + the instruction below. `partialSign(amountCt)`, then the wallet signs.
3. Wait for settlement: snapshot the balance CT's `data[2..34]` before sending; the wrap has settled when it changes (§8).

**Wrap** — pc-token discriminator `30`, data = 10 bytes: `[30, cpiBump, amount as u64 LE]`.

```
vault PDA               ro     [b"pc_vault", pcMint] of this pc-account's mint
pcAccount PDA           ro
userAta                 w
vaultAta                w      owned by SPL Token, mint = the vault's SPL mint
balanceCt               w      (from pcAccount data[64..96])
amountCt                signer, w   fresh keypair (epoch 2)
… Encrypt tail (payer = owner, signer)
TOKEN_PROGRAM_ID        ro
```

`amount == 0` is rejected, and so is a vault that doesn't belong to the pc-account's mint. The reference client waits up to 90 s for the digest change and reports failure if it never moves — note the SPL has already left the user's ATA at that point; the pc-token balance will catch up when the executor commits.

Reference: `PcSwapClient.wrap()` (`pcSwap.ts`).

---

## 5. Decrypt — reveal a balance to its owner

This is the flow to get right in a wallet, because it is unlike anything in a plaintext token. A reveal:

1. Makes an on-chain copy of the balance ciphertext authorized to a fresh ephemeral key (wallet-signed, costs a transaction and ~0.0023 SOL of rent for the new ciphertext account, which is currently never reclaimed).
2. Waits for the executor to process the copy.
3. Asks the executor to decrypt the copy, authenticating with the ephemeral key.

Steps:

1. Read `balanceCt` from the pc-account (`data[64..96]`).
2. Generate two ephemeral keypairs: `viewCt` (the copy's account) and `viewer` (the key authorized to read it).
3. **ViewBalance** — pc-token discriminator `40`, data = `[40, cpiBump]`. CU limit 250 000. `partialSign(viewCt)`, then wallet signs.
   ```
   pcAccount PDA           ro
   balanceCt               ro
   viewCt                  signer, w
   viewer.publicKey        ro     (new authorized key)
   … Encrypt tail (payer = owner, signer)
   ```
4. Wait for the copy to be Verified (`viewCt` `data[99] == 1`). Before step 3, also check that the balance itself is Verified: copying a balance whose last write is still Pending returns the old value.
5. Build the read message (BCS): `chain: u8 = 0` ‖ `ciphertext_id: bytes(32)` (ULEB128 length-prefixed) ‖ `reencryption_key: bytes` (empty, length-prefixed) ‖ `epoch: u64 LE = 0`. Sign it with ed25519 using `viewer`'s 32-byte seed. The wallet does **not** sign this — it's the ephemeral key's job, which is exactly why the ephemeral key exists (wallets refuse to sign arbitrary bytes).
6. `readCiphertext({ message, signature, signer: viewer.publicKey })` → `{ value, fheType, digest }`. Decode `value` as u64 LE. **Treat a response shorter than 8 bytes as an error, not as zero** — the reference client has that footgun.

Return `{ amount, revealedAt }` and cache it. Show the cached number with its timestamp; offer "refresh" as an explicit user action that costs a transaction. Do not reveal on every render.

Privacy note for today's pre-alpha: the ephemeral key gives no unlinkability (the ViewBalance transaction is signed by the wallet and public), and the executor returns plaintext. Once encryption is real, the guarantee becomes: only the holder of `viewer` can decrypt that copy, and `viewer` never leaves the device.

Reference: `PcSwapClient.viewBalance()` (`pcSwap.ts`) + `encryptRead.ts`.

---

## 6. Send — transfer pc-token wallet → wallet

pc-token has a native `Transfer` instruction. The amount moves as a ciphertext; on-chain observers see sender, recipient and the fact of a transfer, not the amount.

Precondition: the **recipient must have a pc-account for that mint**. InitializeAccount (§3) can be paid and signed by the sender (owner is a read-only account in that ix; `payer` in the Encrypt tail is the sender), so a wallet can onboard a first-time recipient in the same transaction. The balance-ciphertext keypair for the recipient's account is ephemeral and discarded — the recipient doesn't need it.

Steps:

1. Derive `fromAccount = [b"pc_account", pcMint, sender]`, `toAccount = [b"pc_account", pcMint, recipient]`; read each `balanceCt` from `data[64..96]` (or, for a fresh recipient, the keypair you just generated).
2. `createInput(amount, fheType=4, authorized = pc-token program)` → `amountCt`; poll `data[99] == 1`.
3. **Transfer** — pc-token discriminator `3`, data = `[3, cpiBump]`. CU limit 450 000.
   ```
   fromAccount PDA         ro
   toAccount PDA           ro
   fromBalanceCt           w
   toBalanceCt             w
   amountCt                w
   … Encrypt tail (payer = sender, signer)
   ```
4. Settlement: watch the sender's balance CT digest (§8).

**Semantics:** the program computes `sufficient = from ≥ amount; from' = sufficient ? from − amount : from; to' = sufficient ? to + amount : to`. An insufficient balance is a **successful transaction that moves nothing**. The sender's wallet should compare its cached balance to the amount before sending, and after settlement reveal (§5) to confirm. Do not render "sent" from the signature.

Reference implementation status: the deployed pc-token program supports this and the instruction builder is in the upstream e2e suite (`pc-token/e2e/instructions.ts`, `Transfer`). Reference: `PcSwapClient.transfer()` (`pcSwap.ts`), tested on devnet epoch 2. It onboards a first-time recipient in a separate transaction (sender pays), waits for that account to be Verified, then sends.

---

## 7. Swap — pc-token ↔ pc-token through pc-swap

pc-swap is a constant-product AMM (0.3 % fee, UniV2 math) whose reserves, input, output and floor are all ciphertexts. One transaction does: debit the user with a receipt → encrypted curve math gated on the receipt → credit the user → close the receipt. There is no batch window and no mempool-visible amount.

### Quoting: estimate plus floor, not a firm outAmount

Reserves are encrypted, so nobody — including us — can compute an exact quote off-chain, and publishing exact quotes would reconstruct the reserves. The integration contract is:

- **Indicative price:** the wallet shows an estimate from a price source *it* trusts (the reference design anchors on Pyth). On the devnet toy pair the pool is seeded 1 : 1 and there is no meaningful external price; use 1.0.
- **Floor:** the wallet derives `minAmountOut = estimate × (1 − tolerance)` and passes it in as a ciphertext. The curve enforces `amountOut ≥ minAmountOut` *inside the encrypted math*.
- **Enforcement is silent.** If the floor is violated (or the user's balance is insufficient), the transaction still succeeds. The input is debited into the pool's vault and then refunded in the same transaction, reserves are untouched, and nothing is paid out, so the user's balances end where they started. There is no error and no event. The only way to learn the outcome is to reveal the balance afterwards. (Epoch 1 had no refund: a missed floor kept the user's input. Epoch 2 includes upstream's refund, `f7f410a`.)

Present this to users as "you will receive at least X, or nothing moves" — not as a firm quote and not as fill-or-fail.

### Steps

1. If the user has no pc-account for the *output* mint, prepend InitializeAccount (§3) with a fresh `outBalanceCt` keypair.
2. Three `createInput` calls, all `fheType = 4`, all **authorized to the pc-swap program** (not pc-token): `amountIn`, `minAmountOut`, and a placeholder `0` for `amountOutCt` (the account the curve writes the output into). Poll all three for `data[99] == 1`.
3. Pre-flight: if the user's *input* balance CT has an all-zero digest (`data[2..34]`), the executor has never committed to it — refuse and tell the user to wait for their wrap to settle.
4. Generate an ephemeral `receiptCt` keypair.
5. Snapshot both of the user's balance CT digests.
6. **Swap** — pc-swap discriminator `1`, data = `[1, swapCpiBump, pcTokenCpiBump, direction]` where `direction 0 = A→B (USDC→DOGE)`, `1 = B→A`. CU limit 1 000 000. `partialSign(receiptCt)` (and `outBalanceCt` if created), then wallet signs.
   ```
   pool PDA                      w
   userInAccount                 w
   userOutAccount                w
   vaultInAccount                w      (pool's pc-account for the input mint)
   vaultOutAccount               w
   userInBalanceCt               w
   userOutBalanceCt              w
   vaultInBalanceCt              w
   vaultOutBalanceCt             w
   reserveInCt                   w
   reserveOutCt                  w
   amountInCt                    w
   minAmountOutCt                w
   amountOutCt                   w
   receiptCt                     signer, w
   encryptProgram                ro
   encryptConfig PDA             w
   encryptDeposit PDA            w      [b"encrypt_deposit", payer]
   pcSwapCpiAuthority            ro
   pcSwapProgram                 ro
   pcTokenCpiAuthority           ro
   pcTokenProgram                ro
   networkKey PDA                ro
   payer                         signer, w
   eventAuthority PDA            ro
   systemProgram                 ro
   ```
   "In"/"out" vault, balance and reserve accounts are the pool's A-side or B-side accounts selected by `direction`; the program validates them against the pool state.
7. Settlement: wait for *both* user balance CT digests to change (§8). The reference client polls each for up to 90 s, in parallel.
8. Outcome: a digest change tells you the executor committed *something* — it fires on a zero no-op just as it does on a fill. To move from "unknown" to "filled" / "no-op", reveal (§5) the output balance and compare to the cached pre-swap value.

Model the result as `{ status: 'submitted' | 'committed', outcome: 'filled' | 'no_op' | 'unknown' }`. Never collapse to a boolean.

Reference: `PcSwapClient.swap()` (`pcSwap.ts`); on-chain math in `pc-swap/pinocchio/src/lib.rs`.

---

## 8. Settlement, latency and state — how to build the UX

The chain confirms in ~400 ms; the encrypted arithmetic lands whenever the executor processes it. Every flow therefore has two phases, and your UI must show both:

- **Submitted** — signature confirmed. SPL has moved (wrap/unwrap), the intent is recorded.
- **Settled** — the executor committed a new value to the affected ciphertext(s). Detected by the balance CT's `data[2..34]` digest differing from a snapshot taken before sending **and** `data[99] == 1`. Don't use the digest alone: it changes as soon as the transaction lands, while the value is still Pending, and a reveal or a follow-up transaction at that point reads the old value. Use `onAccountChange` plus a slow poll (reference: 1.5 s, 90 s cap) — subscriptions alone are unreliable on devnet.
- **Unknown outcome** — after settlement of a send or swap you still don't know whether it was a fill or a no-op until you reveal.

Timing observed on devnet: `createInput` verification 1–10 s; wrap/swap settlement 2–30 s typical, up to a minute or more under load; reveal read available ~2 s after the ViewBalance tx. Budget for the worst case and never block the wallet's main thread on it.

Other things to handle:

- **Executor unreachable / timeout after an on-chain confirm** is a first-class state, not an error to swallow. The transaction is real; the balance will catch up. Show "settling…" and re-check later.
- **Stale balance ciphertext** (all-zero digest): the executor never committed to this account. Wrap will still go through; swap should refuse. Surface it as "your deposit is still settling".
- **RPC load.** Each settlement wait opens a WebSocket subscription and polls; a swap does two in parallel. The public devnet RPC will 429 you. Use your own provider.
- **Rent leakage.** Each reveal creates a ciphertext account that isn't reclaimed today (~0.0023 SOL). Swap receipts and unwrap receipts are closed in-flow. This is a pre-alpha wart we've flagged upstream.
- **Dropped transactions.** The devnet executor occasionally never processes a confirmed transaction (5 of 50 in one of our runs). Its output ciphertexts stay Pending forever, so a settlement wait can time out for good. Show "unknown", never "failed" or "succeeded".
- **Ciphertexts can be overwritten through Encrypt.** On devnet today, the Encrypt program lets anyone name an existing ciphertext as the output of their own graph. Epoch 2 closes the holes in pc-token / pc-swap, but it can't stop a balance being rewritten through Encrypt directly. It has been reported to dWallet Labs. It's another reason this rail is devnet-only and holds no value.
- **ACL is coarse.** In pre-alpha Encrypt, "authorized to compute on" equals "authorized to decrypt". Never authorize a balance copy to a key you don't control, and never call `make_public`/`request_decryption` on anything but your own reveal copies.

---

## 9. Unwrap — pc-token → SPL

Three instructions: burn an encrypted amount into a receipt, request decryption of the burned amount, then release SPL from the vault once the decrypted amount is verified on-chain.

1. `createInput(amount, fheType=4, authorized = pc-token)` → `amountCt`; poll verified. Generate a fresh `burnedCt` keypair (the program creates it; epoch 2).
2. **UnwrapBurn** — discriminator `31`, data = 11 bytes `[31, receiptBump, cpiBump, amount u64 LE]`. Accounts: `vault(ro)` (the PDA of this pc-account's mint), `pcAccount(w)`, `receiptPda(w) [b"pc_receipt", burnedCt]`, `balanceCt(w)`, `amountCt(w)`, `burnedCt(signer, w)` + Encrypt tail. `partialSign(burnedCt)`. The graph computes `burned = balance ≥ amount ? amount : 0`. The receipt (203 bytes) records `burnedCt`, the vault and the pc-mint.
3. **UnwrapDecrypt** — discriminator `32`, data `[32, cpiBump]`. Accounts: `receipt(w)`, `requestAcct(signer, w)` (ephemeral), `burnedCt(ro)` + Encrypt tail with `encryptConfig` **read-only**. `burnedCt` must be the one on the receipt, and decryption can be requested only once per receipt, so persist `requestAcct` until step 4. Wait for the executor to post the decryption (reference: poll up to 180 s).
4. **UnwrapComplete** — discriminator `33`, data `[33]`. Accounts: `receipt(w)`, `vault(ro)`, `pcMint(ro)`, `requestAcct(ro)`, `vaultAta(w)`, `userAta(w)`, `owner(signer)`, `destination(w)`, `TOKEN_PROGRAM_ID(ro)`. Vault, pc-mint and request must match the receipt. If the decrypted `burned` ≠ requested amount (i.e. the user didn't have it), the receipt is closed and **no SPL is released — silently**.

If the executor never answers the decryption request, the burned amount stays stuck; there is no refund path in epoch 2. Don't put unwrap in a live demo.

Reference implementation status: the deployed program supports all three; the upstream e2e suite has builders (`pc-token/e2e/instructions.ts`, `UnwrapBurn/Decrypt/Complete`). Our web demo doesn't expose unwrap yet; a browser-tested three-step client exists only for our legacy cold-storage variant (`pcTokenColdClient.ts`, same shape, different discriminators). The SDK will ship a tested `unwrap()`.

---

## 10. Getting test tokens

The mock mints' authority is held by our faucet service, which mints 1 000 mock-USDC and 1 000 mock-DOGE to a wallet's ATAs with a 4-hour cooldown per wallet. It is **not publicly reachable yet** — we run it on our side. For now: send us the devnet pubkeys you want funded and we'll drip them, or hand you a small allocation of both mints directly. A public faucet URL (`POST /faucet/{wallet}`) is on the list before this preview widens; it will appear as `faucetUrl` in `devnet.json`.

Devnet SOL: the standard Solana devnet faucet.

---

## 11. Reference code and what we will ship

Today, the tested reference is the client inside our web demo — the same code that drove the wallet walkthrough you saw:

| File | What it holds |
|---|---|
| `apps/ui-start/src/lib/pcSwap.ts` | `PcSwapClient`: deposit/init setup, `wrap`, `swap`, `viewBalance`, stale-CT check, settlement waiters, the Encrypt account tails |
| `apps/ui-start/src/lib/encryptRead.ts` | BCS read-message encoding, ed25519 signing, `readCiphertext` gRPC-web call, u64 decode |
| `apps/ui-start/src/SwapPage.tsx` | how the demo wires wallet `signTransaction` + `sendRawTransaction` and sequences wrap → swap → reveal |
| `packages/encrypt/chains/solana/examples/pc-token/pinocchio/src/lib.rs` | pc-token program (discriminators, account checks, graphs) |
| `packages/encrypt/chains/solana/examples/pc-swap/pinocchio/src/lib.rs` | pc-swap program (swap math, account validation) |
| `packages/encrypt/chains/solana/examples/pc-token/e2e/instructions.ts` | upstream instruction builders incl. `Transfer`, `Unwrap*` |

We will send these as a tagged source drop rather than pointing you at the monorepo.

What we are packaging next, as a standalone wallet SDK (git-tag install, no npm dependency on the broken upstream client):

- `wrap`, `unwrap`, `transfer`, `revealBalance` → `{ amount, revealedAt }`, cached `getBalance`, `checkStaleBalances`
- `submitSwap` / `waitForCommit` / `getCommitStatus` / `verifySwapOutcome` with the `submitted|committed × filled|no_op|unknown` result model
- `getTestTokens()` against the public faucet
- a versioned `DEVNET` config (`devnet.json` with `epoch`), all byte offsets and seeds as named constants, and a typed error union (`floor_violated_suspected`, `stale_balance_ct`, `executor_commit_timeout`, `executor_unreachable`, `no_pc_account`, `config_epoch_mismatch`)
- an integration test suite mirroring Encrypt's own 11-stage devnet e2e (lying user, floor boundary, slippage rejection, SPL conservation)

Until then, everything in §3–§9 is enough to build against the deployed programs directly, and we'll answer questions on the thread.
