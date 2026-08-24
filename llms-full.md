# pc-token / pc-swap — Wallet Integration, LLM-complete bundle (Solana devnet)

> This single file is everything an engineer or coding agent needs to implement wrap, reveal, send, swap and unwrap against the pc-token and pc-swap programs deployed on Solana devnet. Part 1 is the human guide. Part 2 is the verbatim reference source: the browser-tested client, the Encrypt gRPC-web client closure, the upstream instruction builders, and both on-chain programs. Addresses in Part 1 were verified live on 2026-08-24. Encrypt source pin: `7d34bb1f5889045a21fb428a96dd667aabd78157`. Repository: https://github.com/inkwell-finance/pc-wallet-kit.
>
> Instructions for an agent: read Part 1 fully first — §1 lists what is NOT true yet (pre-alpha, plaintext, devnet-only, silent no-ops). Implement against the account layouts and discriminators in Part 1; use Part 2 to resolve any ambiguity — the on-chain `lib.rs` files are authoritative over the guide. Do not depend on the `@encrypt.xyz/pre-alpha-solana-client` npm package; vendor the three files in §2.4–2.6 instead and add `@protobuf-ts/runtime`, `@protobuf-ts/runtime-rpc`, `@protobuf-ts/grpcweb-transport` as dependencies. Preserve partial signatures from ephemeral keypairs when the wallet signs. Never report a send or swap as successful from a confirmed signature alone; reveal afterwards.

---

# Part 1 — Guide


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
| pc-token | `3QaXJefrZ5K2nPWUfQwhbqUVMc1azSZT4MzU2hTfQV8C` |
| pc-swap | `C3FYxXn15CMfimyrPU5FdwjyuMwvjVuB9zUPShL9eEMv` |

Two mock tokens are deployed, both 6 decimals. They are named USDC and DOGE for demo purposes only — they are test mints we control, worth nothing.

| | mock-USDC | mock-DOGE |
|---|---|---|
| SPL mint | `AHfy9KyJLQMCS6mjcoUvvFgUqKr6HKoywee2mdpBpwa4` | `DHoyYsraopt627rYMgaweGYpm3rQkXXGWL6AW3EZpjon` |
| pc-mint (PDA) | `6CXh4GJMSd8d3PAYCqsAYyK25prbTH1LAQiusg1BZkAH` | `3pvtAYbteZJWkia5gg8yMSRvFcUfaPjcwoK4LKw274Fn` |
| pc-mint authority | `G1zjvpQwg9LycZXPCuYN4kxsSNQBMzsXKz9bMz6GkJGD` | `ms9YhtEZPVBdXDwbCswDQc1m7GkrdtiLHF3TzD9SVdH` |
| vault (PDA) | `5KDQ5YZbDMregqrWpwkqi4dCRU4yqbSCYFngXgdp5Nep` | `GSTAGfDfEhiCuBpzDpTZwbj2XSyZRwbp1Qtq3qudf61S` |
| vault SPL ATA | `DcBz3thrap7j5QiQA8iaEWZu5p9wfcuz49QU1nFTvs9f` | `2hcPj5doJfYm2UwQPo4hGVUAd5jY6zwrcyxqcSaPg5Uh` |

pc-swap pool (mock-USDC / mock-DOGE, seeded 100 : 100):

| | Address |
|---|---|
| pool PDA `[b"pc_pool", pcUSDC, pcDOGE]` | `4f9qJbkX1jkHgzZMVC8eRfQFuPUokf1hZn7rDsYZezWB` |
| pool vault pc-account USDC / DOGE | `3mX9fEr4uZDF2mUALxM3aSVVmgdFYXPdotXSkZ9PLhsF` / `7BEzSH2GhUVyvxuokrtDG7WdvgDk7hA7CLb73ZCEakRc` |
| pool vault balance CT USDC / DOGE | `6WXyJ61jV7VW2M5LsrkT4JUzmaJCt3WeSvkTbNbKx96A` / `EdhnbDApUHZ4NMYb6gu8KuoKGyi8Z165mcuJbXuRrojx` |
| reserve CT USDC / DOGE | `25ir3Q29HsWsFRxyruzraDJb3seGry25GptzZe8aCuho` / `JAZB6uVEJMirzUoZqKvGQE59aoYNUsFjpmgpBtpW1caV` |

All of the above verified live on devnet on 2026-08-24. We will send a `devnet.json` with the same fields, plus an `epoch` number that bumps on every redeploy, so your build can refuse to run against a stale set.

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
- **Ciphertext account** (owned by Encrypt): `data[2..34]` is the current value digest — it changes whenever the executor commits a new value to that account. `data[99] == 1` means an *input* ciphertext (one you created via `createInput`) has been verified by the executor. This byte is *not* set on ciphertexts produced by computation, which is why settlement is detected by digest change (§8).
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

1. `createInput(amount, fheType=4, authorized = pc-token program)` → `amountCt`. Poll `amountCt` account until `data[99] == 1` (reference: 750 ms interval, 60 s cap). Submitting before verification is the most common cause of "wrapped but balance is 0".
2. Build and send the wrap transaction: CU limit 400 000 + the instruction below.
3. Wait for settlement: snapshot the balance CT's `data[2..34]` before sending; the wrap has settled when it changes (§8).

**Wrap** — pc-token discriminator `30`, data = 10 bytes: `[30, cpiBump, amount as u64 LE]`.

```
vault PDA               ro
pcAccount PDA           ro
userAta                 w
vaultAta                w
balanceCt               w      (from pcAccount data[64..96])
amountCt                w      (from createInput)
… Encrypt tail (payer = owner, signer)
TOKEN_PROGRAM_ID        ro
```

`amount == 0` is rejected. The reference client waits up to 90 s for the digest change and reports failure if it never moves — note the SPL has already left the user's ATA at that point; the pc-token balance will catch up when the executor commits.

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
4. Wait for the executor. There is no verification flag to poll on a computed ciphertext; the reference client sleeps 2 s. If the read in step 6 returns empty, retry after another delay.
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

Reference implementation status: the deployed pc-token program supports this and the instruction builder is in the upstream e2e suite (`pc-token/e2e/instructions.ts`, `Transfer`). Our web demo does not expose a send button yet, so there is no browser-tested TypeScript for this exact flow; the closest tested code is the same-shaped `transfer()` in our legacy cold-storage client, which also demonstrates recipient auto-onboarding. We will ship a tested `transfer()` in the SDK (§9).

---

## 7. Swap — pc-token ↔ pc-token through pc-swap

pc-swap is a constant-product AMM (0.3 % fee, UniV2 math) whose reserves, input, output and floor are all ciphertexts. One transaction does: debit the user with a receipt → encrypted curve math gated on the receipt → credit the user → close the receipt. There is no batch window and no mempool-visible amount.

### Quoting: estimate plus floor, not a firm outAmount

Reserves are encrypted, so nobody — including us — can compute an exact quote off-chain, and publishing exact quotes would reconstruct the reserves. The integration contract is:

- **Indicative price:** the wallet shows an estimate from a price source *it* trusts (the reference design anchors on Pyth). On the devnet toy pair the pool is seeded 1 : 1 and there is no meaningful external price; use 1.0.
- **Floor:** the wallet derives `minAmountOut = estimate × (1 − tolerance)` and passes it in as a ciphertext. The curve enforces `amountOut ≥ minAmountOut` *inside the encrypted math*.
- **Enforcement is silent.** If the floor is violated (or the user's balance is insufficient), the transaction still succeeds; both `finalIn` and `finalOut` collapse to zero, reserves are untouched, and the user's balances don't change. There is no error and no event. The only way to learn the outcome is to reveal the balance afterwards.

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
- **Settled** — the executor committed a new value to the affected ciphertext(s). Detected by the balance CT's `data[2..34]` digest changing versus a snapshot taken before sending. Use `onAccountChange` plus a slow poll (reference: 1.5 s, 90 s cap) — subscriptions alone are unreliable on devnet.
- **Unknown outcome** — after settlement of a send or swap you still don't know whether it was a fill or a no-op until you reveal.

Timing observed on devnet: `createInput` verification 1–10 s; wrap/swap settlement 2–30 s typical, up to a minute or more under load; reveal read available ~2 s after the ViewBalance tx. Budget for the worst case and never block the wallet's main thread on it.

Other things to handle:

- **Executor unreachable / timeout after an on-chain confirm** is a first-class state, not an error to swallow. The transaction is real; the balance will catch up. Show "settling…" and re-check later.
- **Stale balance ciphertext** (all-zero digest): the executor never committed to this account. Wrap will still go through; swap should refuse. Surface it as "your deposit is still settling".
- **RPC load.** Each settlement wait opens a WebSocket subscription and polls; a swap does two in parallel. The public devnet RPC will 429 you. Use your own provider.
- **Rent leakage.** Each reveal creates a ciphertext account that isn't reclaimed today (~0.0023 SOL). Swap receipts and unwrap receipts are closed in-flow. This is a pre-alpha wart we've flagged upstream.
- **ACL is coarse.** In pre-alpha Encrypt, "authorized to compute on" equals "authorized to decrypt". Never authorize a balance copy to a key you don't control, and never call `make_public`/`request_decryption` on anything but your own reveal copies.

---

## 9. Unwrap — pc-token → SPL

Three instructions: burn an encrypted amount into a receipt, request decryption of the burned amount, then release SPL from the vault once the decrypted amount is verified on-chain.

1. `createInput(amount, fheType=4, authorized = pc-token)` → `amountCt`; poll verified. Generate ephemeral `burnedCt`.
2. **UnwrapBurn** — discriminator `31`, data = 11 bytes `[31, receiptBump, cpiBump, amount u64 LE]`. Accounts: `vault(ro)`, `pcAccount(w)`, `receiptPda(w) [b"pc_receipt", burnedCt]`, `balanceCt(w)`, `amountCt(w)`, `burnedCt(w)` + Encrypt tail. The graph computes `burned = balance ≥ amount ? amount : 0`.
3. **UnwrapDecrypt** — discriminator `32`, data `[32, cpiBump]`. Accounts: `receipt(w)`, `requestAcct(signer, w)` (ephemeral), `burnedCt(ro)` + Encrypt tail with `encryptConfig` **read-only**. Wait for the executor to post the decryption (reference: poll up to 180 s).
4. **UnwrapComplete** — discriminator `33`, data `[33]`. Accounts: `receipt(w)`, `vault(ro)`, `pcMint(ro)`, `requestAcct(ro)`, `vaultAta(w)`, `userAta(w)`, `owner(signer)`, `destination(w)`, `TOKEN_PROGRAM_ID(ro)`. If the decrypted `burned` ≠ requested amount (i.e. the user didn't have it), the receipt is closed and **no SPL is released — silently**.

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

---

# Part 2 — Reference source (verbatim)

| § | File | Role |
|---|---|---|
| 2.1 | `reference/pcSwap.ts` | Browser-tested client: setup, wrap, swap, viewBalance, settlement waiters |
| 2.2 | `reference/encryptRead.ts` | BCS read message, ed25519 signing, readCiphertext, u64 decode |
| 2.3 | `reference/SwapPage.tsx` | Wallet wiring and sequencing in the demo |
| 2.4 | `encrypt/chains/solana/clients/typescript/src/grpc-web.ts` | gRPC-web transport shim + `createInput` / `encryptValue` |
| 2.5 | `.../src/generated/grpc-web/encrypt_service.client.ts` | Generated protobuf-ts service client |
| 2.6 | `.../src/generated/grpc-web/encrypt_service.ts` | Generated protobuf-ts messages |
| 2.7 | `encrypt/chains/solana/examples/pc-token/e2e/instructions.ts` | Upstream instruction builders incl. Transfer, Unwrap* |
| 2.8 | `encrypt/chains/solana/examples/pc-token/pinocchio/src/lib.rs` | pc-token program (authoritative) |
| 2.9 | `encrypt/chains/solana/examples/pc-swap/pinocchio/src/lib.rs` | pc-swap program (authoritative) |


## 2.1 — `dagon/apps/ui-start/src/lib/pcSwap.ts`

```ts
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
      { pubkey: amountCt, isSigner: false, isWritable: true },
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

      // Encrypt the wrap amount, authorized to pc-token (caller of the wrap ix).
      const amountCt = await this.encryptInputCt(amount, this.opts.pcTokenProgramId);
      await this.pollVerifiedInputs([amountCt]);

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
```

## 2.2 — `dagon/apps/ui-start/src/lib/encryptRead.ts`

```ts
/**
 * Browser readCiphertext wrapper.
 *
 * The upstream `@encrypt.xyz/pre-alpha-solana-client/grpc-web` entry only re-exports
 * `createInput`. For `readCiphertext` we build a parallel client over the same
 * `GrpcWebFetchTransport` using the generated client class via Vite's path resolution.
 *
 * Source of truth for shape: packages/encrypt/chains/solana/clients/typescript/src/grpc.ts
 * (the Node-side wrapper does the same thing). The BCS message encoder is transcribed verbatim
 * so we don't depend on the deep-import path either.
 */

import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';
// Deep-import into the generated grpc-web client. The encrypt package's `exports` field gates
// official entry points, but Vite resolves these through the workspace symlink chain and they
// work in dev + build. If a future upstream restructuring breaks this, copy the two generated
// files into our codebase.
import { EncryptServiceClient } from '../../../../../encrypt/chains/solana/clients/typescript/src/generated/grpc-web/encrypt_service.client';
import { Chain } from '../../../../../encrypt/chains/solana/clients/typescript/src/generated/grpc-web/encrypt_service';

const ENCRYPT_GRPC_URL = 'https://pre-alpha-dev-1.encrypt.ika-network.net:443';

let cached: EncryptServiceClient | null = null;
function client(): EncryptServiceClient {
  if (!cached) {
    cached = new EncryptServiceClient(new GrpcWebFetchTransport({ baseUrl: ENCRYPT_GRPC_URL }));
  }
  return cached;
}

/**
 * BCS encode a `ReadCiphertextMessage` — the bytes the user signs to authorize a read.
 * Format: chain(u8) + ciphertext_id(ULEB128 len + bytes) + reencryption_key(ULEB128 len + bytes) + epoch(u64 LE).
 */
export function encodeReadCiphertextMessage(opts: {
  chain: number;
  ciphertextIdentifier: Uint8Array;
  reencryptionKey: Uint8Array;
  epoch: bigint;
}): Uint8Array {
  const { chain, ciphertextIdentifier, reencryptionKey, epoch } = opts;
  if (ciphertextIdentifier.length > 127 || reencryptionKey.length > 127) {
    throw new Error('ULEB128 fast path only supports lengths <= 127');
  }
  const total = 1 + 1 + ciphertextIdentifier.length + 1 + reencryptionKey.length + 8;
  const buf = new Uint8Array(total);
  let off = 0;
  buf[off++] = chain;
  buf[off++] = ciphertextIdentifier.length;
  buf.set(ciphertextIdentifier, off);
  off += ciphertextIdentifier.length;
  buf[off++] = reencryptionKey.length;
  buf.set(reencryptionKey, off);
  off += reencryptionKey.length;
  // u64 LE epoch
  let v = epoch;
  for (let i = 0; i < 8; i++) {
    buf[off + i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

export interface ReadCiphertextResult {
  /** Pre-alpha: plaintext bytes. Production: re-encrypted ciphertext for the requesting party. */
  value: Uint8Array;
  fheType: number;
  digest: Uint8Array;
}

export async function readCiphertext(opts: {
  ciphertextIdentifier: Uint8Array;
  signature: Uint8Array;
  signer: Uint8Array;
  /** 0 = Solana */
  chain?: number;
  reencryptionKey?: Uint8Array;
  epoch?: bigint;
}): Promise<ReadCiphertextResult> {
  const message = encodeReadCiphertextMessage({
    chain: opts.chain ?? 0,
    ciphertextIdentifier: opts.ciphertextIdentifier,
    reencryptionKey: opts.reencryptionKey ?? new Uint8Array(0),
    epoch: opts.epoch ?? 0n,
  });
  const { response } = await client().readCiphertext({
    message,
    signature: opts.signature,
    signer: opts.signer,
  });
  return {
    value: response.value,
    fheType: response.fheType,
    digest: response.digest,
  };
}

void Chain;

/**
 * Decode an EUint64 plaintext value from a readCiphertext response. Pre-alpha returns
 * 8 little-endian bytes for u64 values. For larger types, use the appropriate decoder.
 */
export function decodeU64(value: Uint8Array): bigint {
  if (value.length < 8) {
    // Sometimes returns truncated for non-existent / zero-allocated CTs.
    return 0n;
  }
  let v = 0n;
  for (let i = 7; i >= 0; i--) {
    v = (v << 8n) | BigInt(value[i]);
  }
  return v;
}
```

## 2.3 — `dagon/apps/ui-start/src/SwapPage.tsx`

```tsx
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
```

## 2.4 — `encrypt/chains/solana/clients/typescript/src/grpc-web.ts`

```ts
/**
 * Encrypt gRPC-Web client — browser-compatible.
 *
 * Uses @protobuf-ts/grpcweb-transport which works via fetch() in any browser.
 * Server must have tonic-web layer enabled (already configured in the executor).
 *
 * Usage:
 *   import { createEncryptWebClient, encryptValue, Chain } from "@encrypt.xyz/pre-alpha-solana-client/grpc-web";
 *
 *   const client = createEncryptWebClient("https://pre-alpha-dev-1.encrypt.ika-network.net:443");
 *   const ct = encryptValue(42, 4); // value, fheType (EUint64 = 4)
 *   const ids = await client.createInput({
 *     chain: Chain.SOLANA,
 *     inputs: [{ ciphertextBytes: ct, fheType: 4 }],
 *     authorized: programId.toBytes(),
 *     networkEncryptionPublicKey: networkKey,
 *   });
 */

import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { EncryptServiceClient } from "./generated/grpc-web/encrypt_service.client";
import { Chain, type CreateInputRequest } from "./generated/grpc-web/encrypt_service";

export { Chain } from "./generated/grpc-web/encrypt_service";

export interface EncryptInput {
  ciphertextBytes: Uint8Array;
  fheType: number;
}

export interface CreateInputParams {
  chain: Chain;
  inputs: EncryptInput[];
  proof?: Uint8Array;
  authorized: Uint8Array;
  networkEncryptionPublicKey: Uint8Array;
}

/**
 * Create a browser gRPC-Web client for the Encrypt executor.
 *
 * @param baseUrl - Executor gRPC address, e.g. "https://pre-alpha-dev-1.encrypt.ika-network.net:443"
 */
export function createEncryptWebClient(baseUrl: string) {
  const transport = new GrpcWebFetchTransport({ baseUrl });
  const client = new EncryptServiceClient(transport);

  return {
    /**
     * Submit encrypted inputs and get back on-chain ciphertext identifiers.
     * Encryption happens CLIENT-SIDE — only ciphertext bytes cross the wire.
     */
    async createInput(params: CreateInputParams): Promise<Uint8Array[]> {
      const request: CreateInputRequest = {
        chain: params.chain,
        inputs: params.inputs.map((inp) => ({
          ciphertextBytes: inp.ciphertextBytes,
          fheType: inp.fheType,
        })),
        proof: params.proof ?? new Uint8Array(0),
        authorized: params.authorized,
        networkEncryptionPublicKey: params.networkEncryptionPublicKey,
      };

      const { response } = await client.createInput(request);
      return response.ciphertextIdentifiers;
    },
  };
}

/**
 * Client-side mock encryption (dev mode).
 *
 * Emits the executor's legacy 17-byte input format:
 * `[fhe_type(1) || value_le(16)]`. The type tag is required — without it the
 * executor falls into a fallback that misreads multi-byte scalars (e.g.
 * EUint64 returns `value >> 8`).
 *
 * In production, this is replaced by a WASM FHE encryptor that produces
 * real ciphertexts + a ZK proof of valid encryption.
 */
export function encryptValue(value: number | bigint, fheType: number): Uint8Array {
  const buf = new Uint8Array(17);
  buf[0] = fheType;
  let v = BigInt(value);
  for (let i = 0; i < 16; i++) {
    buf[1 + i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}
```

## 2.5 — `encrypt/chains/solana/clients/typescript/src/generated/grpc-web/encrypt_service.client.ts`

```ts
// @generated by protobuf-ts 2.11.1
// @generated from protobuf file "encrypt_service.proto" (package "encrypt.v1", syntax proto3)
// tslint:disable
//
// Copyright (c) dWallet Labs, Ltd.
// SPDX-License-Identifier: BSD-3-Clause-Clear
//
import type { RpcTransport } from "@protobuf-ts/runtime-rpc";
import type { ServiceInfo } from "@protobuf-ts/runtime-rpc";
import { EncryptService } from "./encrypt_service";
import type { ReadCiphertextResponse } from "./encrypt_service";
import type { ReadCiphertextRequest } from "./encrypt_service";
import { stackIntercept } from "@protobuf-ts/runtime-rpc";
import type { CreateInputResponse } from "./encrypt_service";
import type { CreateInputRequest } from "./encrypt_service";
import type { UnaryCall } from "@protobuf-ts/runtime-rpc";
import type { RpcOptions } from "@protobuf-ts/runtime-rpc";
/**
 * Client-facing gRPC API for the Encrypt executor.
 *
 * Same API across all chains and environments (local dev, devnet, testnet, mainnet).
 *
 * @generated from protobuf service encrypt.v1.EncryptService
 */
export interface IEncryptServiceClient {
    /**
     * Submit one or more encrypted input ciphertexts.
     *
     * A single ZK proof covers all inputs in the batch. All inputs share
     * the same authorized party and network encryption key. The executor
     * validates the proof (mock in dev mode), creates each ciphertext on-chain,
     * and returns their identifiers ready for immediate use.
     *
     * @generated from protobuf rpc: CreateInput
     */
    createInput(input: CreateInputRequest, options?: RpcOptions): UnaryCall<CreateInputRequest, CreateInputResponse>;
    /**
     * Read a ciphertext off-chain.
     *
     * The request contains a BCS-serialized ReadCiphertextMessage signed by
     * the authorized party (or anyone if the ciphertext is public).
     *
     * In production: returns the ciphertext re-encrypted under the user's
     * re-encryption key (the user decrypts locally with their private key).
     * In mock mode: returns the plaintext value directly.
     *
     * Responses are cached per (ciphertext_identifier, signer, epoch).
     * When the epoch advances, the cache is invalidated and old signatures
     * are rejected.
     *
     * @generated from protobuf rpc: ReadCiphertext
     */
    readCiphertext(input: ReadCiphertextRequest, options?: RpcOptions): UnaryCall<ReadCiphertextRequest, ReadCiphertextResponse>;
}
/**
 * Client-facing gRPC API for the Encrypt executor.
 *
 * Same API across all chains and environments (local dev, devnet, testnet, mainnet).
 *
 * @generated from protobuf service encrypt.v1.EncryptService
 */
export class EncryptServiceClient implements IEncryptServiceClient, ServiceInfo {
    typeName = EncryptService.typeName;
    methods = EncryptService.methods;
    options = EncryptService.options;
    constructor(private readonly _transport: RpcTransport) {
    }
    /**
     * Submit one or more encrypted input ciphertexts.
     *
     * A single ZK proof covers all inputs in the batch. All inputs share
     * the same authorized party and network encryption key. The executor
     * validates the proof (mock in dev mode), creates each ciphertext on-chain,
     * and returns their identifiers ready for immediate use.
     *
     * @generated from protobuf rpc: CreateInput
     */
    createInput(input: CreateInputRequest, options?: RpcOptions): UnaryCall<CreateInputRequest, CreateInputResponse> {
        const method = this.methods[0], opt = this._transport.mergeOptions(options);
        return stackIntercept<CreateInputRequest, CreateInputResponse>("unary", this._transport, method, opt, input);
    }
    /**
     * Read a ciphertext off-chain.
     *
     * The request contains a BCS-serialized ReadCiphertextMessage signed by
     * the authorized party (or anyone if the ciphertext is public).
     *
     * In production: returns the ciphertext re-encrypted under the user's
     * re-encryption key (the user decrypts locally with their private key).
     * In mock mode: returns the plaintext value directly.
     *
     * Responses are cached per (ciphertext_identifier, signer, epoch).
     * When the epoch advances, the cache is invalidated and old signatures
     * are rejected.
     *
     * @generated from protobuf rpc: ReadCiphertext
     */
    readCiphertext(input: ReadCiphertextRequest, options?: RpcOptions): UnaryCall<ReadCiphertextRequest, ReadCiphertextResponse> {
        const method = this.methods[1], opt = this._transport.mergeOptions(options);
        return stackIntercept<ReadCiphertextRequest, ReadCiphertextResponse>("unary", this._transport, method, opt, input);
    }
}
```

## 2.6 — `encrypt/chains/solana/clients/typescript/src/generated/grpc-web/encrypt_service.ts`

```ts
// @generated by protobuf-ts 2.11.1
// @generated from protobuf file "encrypt_service.proto" (package "encrypt.v1", syntax proto3)
// tslint:disable
//
// Copyright (c) dWallet Labs, Ltd.
// SPDX-License-Identifier: BSD-3-Clause-Clear
//
import { ServiceType } from "@protobuf-ts/runtime-rpc";
import type { BinaryWriteOptions } from "@protobuf-ts/runtime";
import type { IBinaryWriter } from "@protobuf-ts/runtime";
import { WireType } from "@protobuf-ts/runtime";
import type { BinaryReadOptions } from "@protobuf-ts/runtime";
import type { IBinaryReader } from "@protobuf-ts/runtime";
import { UnknownFieldHandler } from "@protobuf-ts/runtime";
import type { PartialMessage } from "@protobuf-ts/runtime";
import { reflectionMergePartial } from "@protobuf-ts/runtime";
import { MessageType } from "@protobuf-ts/runtime";
// ── CreateInput ──

/**
 * A single encrypted input value.
 *
 * @generated from protobuf message encrypt.v1.EncryptedInput
 */
export interface EncryptedInput {
    /**
     * FHE ciphertext bytes (encrypted under the request's network_encryption_public_key).
     *
     * @generated from protobuf field: bytes ciphertext_bytes = 1
     */
    ciphertextBytes: Uint8Array;
    /**
     * FHE type discriminator (0-44). Validated server-side.
     *
     * @generated from protobuf field: uint32 fhe_type = 2
     */
    fheType: number;
}
/**
 * @generated from protobuf message encrypt.v1.CreateInputRequest
 */
export interface CreateInputRequest {
    /**
     * Target chain where the ciphertexts should be created.
     *
     * @generated from protobuf field: encrypt.v1.Chain chain = 1
     */
    chain: Chain;
    /**
     * One or more encrypted input values to create on-chain.
     *
     * @generated from protobuf field: repeated encrypt.v1.EncryptedInput inputs = 2
     */
    inputs: EncryptedInput[];
    /**
     * ZK proof of valid encryption covering all inputs (skipped in dev mode).
     *
     * @generated from protobuf field: bytes proof = 3
     */
    proof: Uint8Array;
    /**
     * Who can use these ciphertexts (program/contract address or user address).
     * Shared across all inputs in this batch.
     *
     * @generated from protobuf field: bytes authorized = 4
     */
    authorized: Uint8Array;
    /**
     * Network encryption public key all inputs were encrypted under.
     * 32 bytes. Must match an active key registered on-chain.
     *
     * @generated from protobuf field: bytes network_encryption_public_key = 5
     */
    networkEncryptionPublicKey: Uint8Array;
}
/**
 * @generated from protobuf message encrypt.v1.CreateInputResponse
 */
export interface CreateInputResponse {
    /**
     * On-chain ciphertext identifiers, one per input (same order as request).
     *
     * @generated from protobuf field: repeated bytes ciphertext_identifiers = 1
     */
    ciphertextIdentifiers: Uint8Array[];
}
// ── ReadCiphertext ──

/**
 * @generated from protobuf message encrypt.v1.ReadCiphertextRequest
 */
export interface ReadCiphertextRequest {
    /**
     * BCS-serialized ReadCiphertextMessage (the signed payload).
     *
     * @generated from protobuf field: bytes message = 1
     */
    message: Uint8Array;
    /**
     * Ed25519 signature over `message` by the authorized party.
     *
     * @generated from protobuf field: bytes signature = 2
     */
    signature: Uint8Array;
    /**
     * Public key of the signer (32 bytes).
     * Must match the ciphertext's `authorized` field, or the ciphertext must be public.
     *
     * @generated from protobuf field: bytes signer = 3
     */
    signer: Uint8Array;
}
/**
 * @generated from protobuf message encrypt.v1.ReadCiphertextResponse
 */
export interface ReadCiphertextResponse {
    /**
     * Production: ciphertext re-encrypted under the user's re-encryption key.
     *             The user decrypts locally with their private key.
     * Mock: raw plaintext bytes (fhe_type determines interpretation).
     *
     * @generated from protobuf field: bytes value = 1
     */
    value: Uint8Array;
    /**
     * FHE type of the ciphertext.
     *
     * @generated from protobuf field: uint32 fhe_type = 2
     */
    fheType: number;
    /**
     * On-chain digest (for client-side verification).
     *
     * @generated from protobuf field: bytes digest = 3
     */
    digest: Uint8Array;
}
/**
 * Chain identifier.
 *
 * @generated from protobuf enum encrypt.v1.Chain
 */
export enum Chain {
    /**
     * @generated from protobuf enum value: SOLANA = 0;
     */
    SOLANA = 0
}
// @generated message type with reflection information, may provide speed optimized methods
class EncryptedInput$Type extends MessageType<EncryptedInput> {
    constructor() {
        super("encrypt.v1.EncryptedInput", [
            { no: 1, name: "ciphertext_bytes", kind: "scalar", T: 12 /*ScalarType.BYTES*/ },
            { no: 2, name: "fhe_type", kind: "scalar", T: 13 /*ScalarType.UINT32*/ }
        ]);
    }
    create(value?: PartialMessage<EncryptedInput>): EncryptedInput {
        const message = globalThis.Object.create((this.messagePrototype!));
        message.ciphertextBytes = new Uint8Array(0);
        message.fheType = 0;
        if (value !== undefined)
            reflectionMergePartial<EncryptedInput>(this, message, value);
        return message;
    }
    internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: EncryptedInput): EncryptedInput {
        let message = target ?? this.create(), end = reader.pos + length;
        while (reader.pos < end) {
            let [fieldNo, wireType] = reader.tag();
            switch (fieldNo) {
                case /* bytes ciphertext_bytes */ 1:
                    message.ciphertextBytes = reader.bytes();
                    break;
                case /* uint32 fhe_type */ 2:
                    message.fheType = reader.uint32();
                    break;
                default:
                    let u = options.readUnknownField;
                    if (u === "throw")
                        throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
                    let d = reader.skip(wireType);
                    if (u !== false)
                        (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
            }
        }
        return message;
    }
    internalBinaryWrite(message: EncryptedInput, writer: IBinaryWriter, options: BinaryWriteOptions): IBinaryWriter {
        /* bytes ciphertext_bytes = 1; */
        if (message.ciphertextBytes.length)
            writer.tag(1, WireType.LengthDelimited).bytes(message.ciphertextBytes);
        /* uint32 fhe_type = 2; */
        if (message.fheType !== 0)
            writer.tag(2, WireType.Varint).uint32(message.fheType);
        let u = options.writeUnknownFields;
        if (u !== false)
            (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
        return writer;
    }
}
/**
 * @generated MessageType for protobuf message encrypt.v1.EncryptedInput
 */
export const EncryptedInput = new EncryptedInput$Type();
// @generated message type with reflection information, may provide speed optimized methods
class CreateInputRequest$Type extends MessageType<CreateInputRequest> {
    constructor() {
        super("encrypt.v1.CreateInputRequest", [
            { no: 1, name: "chain", kind: "enum", T: () => ["encrypt.v1.Chain", Chain] },
            { no: 2, name: "inputs", kind: "message", repeat: 2 /*RepeatType.UNPACKED*/, T: () => EncryptedInput },
            { no: 3, name: "proof", kind: "scalar", T: 12 /*ScalarType.BYTES*/ },
            { no: 4, name: "authorized", kind: "scalar", T: 12 /*ScalarType.BYTES*/ },
            { no: 5, name: "network_encryption_public_key", kind: "scalar", T: 12 /*ScalarType.BYTES*/ }
        ]);
    }
    create(value?: PartialMessage<CreateInputRequest>): CreateInputRequest {
        const message = globalThis.Object.create((this.messagePrototype!));
        message.chain = 0;
        message.inputs = [];
        message.proof = new Uint8Array(0);
        message.authorized = new Uint8Array(0);
        message.networkEncryptionPublicKey = new Uint8Array(0);
        if (value !== undefined)
            reflectionMergePartial<CreateInputRequest>(this, message, value);
        return message;
    }
    internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: CreateInputRequest): CreateInputRequest {
        let message = target ?? this.create(), end = reader.pos + length;
        while (reader.pos < end) {
            let [fieldNo, wireType] = reader.tag();
            switch (fieldNo) {
                case /* encrypt.v1.Chain chain */ 1:
                    message.chain = reader.int32();
                    break;
                case /* repeated encrypt.v1.EncryptedInput inputs */ 2:
                    message.inputs.push(EncryptedInput.internalBinaryRead(reader, reader.uint32(), options));
                    break;
                case /* bytes proof */ 3:
                    message.proof = reader.bytes();
                    break;
                case /* bytes authorized */ 4:
                    message.authorized = reader.bytes();
                    break;
                case /* bytes network_encryption_public_key */ 5:
                    message.networkEncryptionPublicKey = reader.bytes();
                    break;
                default:
                    let u = options.readUnknownField;
                    if (u === "throw")
                        throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
                    let d = reader.skip(wireType);
                    if (u !== false)
                        (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
            }
        }
        return message;
    }
    internalBinaryWrite(message: CreateInputRequest, writer: IBinaryWriter, options: BinaryWriteOptions): IBinaryWriter {
        /* encrypt.v1.Chain chain = 1; */
        if (message.chain !== 0)
            writer.tag(1, WireType.Varint).int32(message.chain);
        /* repeated encrypt.v1.EncryptedInput inputs = 2; */
        for (let i = 0; i < message.inputs.length; i++)
            EncryptedInput.internalBinaryWrite(message.inputs[i], writer.tag(2, WireType.LengthDelimited).fork(), options).join();
        /* bytes proof = 3; */
        if (message.proof.length)
            writer.tag(3, WireType.LengthDelimited).bytes(message.proof);
        /* bytes authorized = 4; */
        if (message.authorized.length)
            writer.tag(4, WireType.LengthDelimited).bytes(message.authorized);
        /* bytes network_encryption_public_key = 5; */
        if (message.networkEncryptionPublicKey.length)
            writer.tag(5, WireType.LengthDelimited).bytes(message.networkEncryptionPublicKey);
        let u = options.writeUnknownFields;
        if (u !== false)
            (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
        return writer;
    }
}
/**
 * @generated MessageType for protobuf message encrypt.v1.CreateInputRequest
 */
export const CreateInputRequest = new CreateInputRequest$Type();
// @generated message type with reflection information, may provide speed optimized methods
class CreateInputResponse$Type extends MessageType<CreateInputResponse> {
    constructor() {
        super("encrypt.v1.CreateInputResponse", [
            { no: 1, name: "ciphertext_identifiers", kind: "scalar", repeat: 2 /*RepeatType.UNPACKED*/, T: 12 /*ScalarType.BYTES*/ }
        ]);
    }
    create(value?: PartialMessage<CreateInputResponse>): CreateInputResponse {
        const message = globalThis.Object.create((this.messagePrototype!));
        message.ciphertextIdentifiers = [];
        if (value !== undefined)
            reflectionMergePartial<CreateInputResponse>(this, message, value);
        return message;
    }
    internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: CreateInputResponse): CreateInputResponse {
        let message = target ?? this.create(), end = reader.pos + length;
        while (reader.pos < end) {
            let [fieldNo, wireType] = reader.tag();
            switch (fieldNo) {
                case /* repeated bytes ciphertext_identifiers */ 1:
                    message.ciphertextIdentifiers.push(reader.bytes());
                    break;
                default:
                    let u = options.readUnknownField;
                    if (u === "throw")
                        throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
                    let d = reader.skip(wireType);
                    if (u !== false)
                        (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
            }
        }
        return message;
    }
    internalBinaryWrite(message: CreateInputResponse, writer: IBinaryWriter, options: BinaryWriteOptions): IBinaryWriter {
        /* repeated bytes ciphertext_identifiers = 1; */
        for (let i = 0; i < message.ciphertextIdentifiers.length; i++)
            writer.tag(1, WireType.LengthDelimited).bytes(message.ciphertextIdentifiers[i]);
        let u = options.writeUnknownFields;
        if (u !== false)
            (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
        return writer;
    }
}
/**
 * @generated MessageType for protobuf message encrypt.v1.CreateInputResponse
 */
export const CreateInputResponse = new CreateInputResponse$Type();
// @generated message type with reflection information, may provide speed optimized methods
class ReadCiphertextRequest$Type extends MessageType<ReadCiphertextRequest> {
    constructor() {
        super("encrypt.v1.ReadCiphertextRequest", [
            { no: 1, name: "message", kind: "scalar", T: 12 /*ScalarType.BYTES*/ },
            { no: 2, name: "signature", kind: "scalar", T: 12 /*ScalarType.BYTES*/ },
            { no: 3, name: "signer", kind: "scalar", T: 12 /*ScalarType.BYTES*/ }
        ]);
    }
    create(value?: PartialMessage<ReadCiphertextRequest>): ReadCiphertextRequest {
        const message = globalThis.Object.create((this.messagePrototype!));
        message.message = new Uint8Array(0);
        message.signature = new Uint8Array(0);
        message.signer = new Uint8Array(0);
        if (value !== undefined)
            reflectionMergePartial<ReadCiphertextRequest>(this, message, value);
        return message;
    }
    internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: ReadCiphertextRequest): ReadCiphertextRequest {
        let message = target ?? this.create(), end = reader.pos + length;
        while (reader.pos < end) {
            let [fieldNo, wireType] = reader.tag();
            switch (fieldNo) {
                case /* bytes message */ 1:
                    message.message = reader.bytes();
                    break;
                case /* bytes signature */ 2:
                    message.signature = reader.bytes();
                    break;
                case /* bytes signer */ 3:
                    message.signer = reader.bytes();
                    break;
                default:
                    let u = options.readUnknownField;
                    if (u === "throw")
                        throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
                    let d = reader.skip(wireType);
                    if (u !== false)
                        (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
            }
        }
        return message;
    }
    internalBinaryWrite(message: ReadCiphertextRequest, writer: IBinaryWriter, options: BinaryWriteOptions): IBinaryWriter {
        /* bytes message = 1; */
        if (message.message.length)
            writer.tag(1, WireType.LengthDelimited).bytes(message.message);
        /* bytes signature = 2; */
        if (message.signature.length)
            writer.tag(2, WireType.LengthDelimited).bytes(message.signature);
        /* bytes signer = 3; */
        if (message.signer.length)
            writer.tag(3, WireType.LengthDelimited).bytes(message.signer);
        let u = options.writeUnknownFields;
        if (u !== false)
            (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
        return writer;
    }
}
/**
 * @generated MessageType for protobuf message encrypt.v1.ReadCiphertextRequest
 */
export const ReadCiphertextRequest = new ReadCiphertextRequest$Type();
// @generated message type with reflection information, may provide speed optimized methods
class ReadCiphertextResponse$Type extends MessageType<ReadCiphertextResponse> {
    constructor() {
        super("encrypt.v1.ReadCiphertextResponse", [
            { no: 1, name: "value", kind: "scalar", T: 12 /*ScalarType.BYTES*/ },
            { no: 2, name: "fhe_type", kind: "scalar", T: 13 /*ScalarType.UINT32*/ },
            { no: 3, name: "digest", kind: "scalar", T: 12 /*ScalarType.BYTES*/ }
        ]);
    }
    create(value?: PartialMessage<ReadCiphertextResponse>): ReadCiphertextResponse {
        const message = globalThis.Object.create((this.messagePrototype!));
        message.value = new Uint8Array(0);
        message.fheType = 0;
        message.digest = new Uint8Array(0);
        if (value !== undefined)
            reflectionMergePartial<ReadCiphertextResponse>(this, message, value);
        return message;
    }
    internalBinaryRead(reader: IBinaryReader, length: number, options: BinaryReadOptions, target?: ReadCiphertextResponse): ReadCiphertextResponse {
        let message = target ?? this.create(), end = reader.pos + length;
        while (reader.pos < end) {
            let [fieldNo, wireType] = reader.tag();
            switch (fieldNo) {
                case /* bytes value */ 1:
                    message.value = reader.bytes();
                    break;
                case /* uint32 fhe_type */ 2:
                    message.fheType = reader.uint32();
                    break;
                case /* bytes digest */ 3:
                    message.digest = reader.bytes();
                    break;
                default:
                    let u = options.readUnknownField;
                    if (u === "throw")
                        throw new globalThis.Error(`Unknown field ${fieldNo} (wire type ${wireType}) for ${this.typeName}`);
                    let d = reader.skip(wireType);
                    if (u !== false)
                        (u === true ? UnknownFieldHandler.onRead : u)(this.typeName, message, fieldNo, wireType, d);
            }
        }
        return message;
    }
    internalBinaryWrite(message: ReadCiphertextResponse, writer: IBinaryWriter, options: BinaryWriteOptions): IBinaryWriter {
        /* bytes value = 1; */
        if (message.value.length)
            writer.tag(1, WireType.LengthDelimited).bytes(message.value);
        /* uint32 fhe_type = 2; */
        if (message.fheType !== 0)
            writer.tag(2, WireType.Varint).uint32(message.fheType);
        /* bytes digest = 3; */
        if (message.digest.length)
            writer.tag(3, WireType.LengthDelimited).bytes(message.digest);
        let u = options.writeUnknownFields;
        if (u !== false)
            (u == true ? UnknownFieldHandler.onWrite : u)(this.typeName, message, writer);
        return writer;
    }
}
/**
 * @generated MessageType for protobuf message encrypt.v1.ReadCiphertextResponse
 */
export const ReadCiphertextResponse = new ReadCiphertextResponse$Type();
/**
 * @generated ServiceType for protobuf service encrypt.v1.EncryptService
 */
export const EncryptService = new ServiceType("encrypt.v1.EncryptService", [
    { name: "CreateInput", options: {}, I: CreateInputRequest, O: CreateInputResponse },
    { name: "ReadCiphertext", options: {}, I: ReadCiphertextRequest, O: ReadCiphertextResponse }
]);
```

## 2.7 — `encrypt/chains/solana/examples/pc-token/e2e/instructions.ts`

```ts
/**
 * Instruction builders for the PC-Token program.
 */

import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

import type { EncryptAccounts } from "../../_shared/encrypt-setup.ts";
import { encryptCpiAccounts } from "../../_shared/encrypt-setup.ts";
import { pda } from "../../_shared/helpers.ts";
import { TOKEN_PROGRAM_ID } from "./spl-helpers.ts";

export interface PcTokenContext {
  programId: PublicKey;
  enc: EncryptAccounts;
  payer: PublicKey;
  cpiAuthority: PublicKey;
  cpiBump: number;
}

export function derivePcTokenPdas(programId: PublicKey, authority: PublicKey) {
  const [cpiAuthority, cpiBump] = pda(
    [Buffer.from("__encrypt_cpi_authority")],
    programId
  );
  return { cpiAuthority, cpiBump };
}

export function deriveMintPda(
  programId: PublicKey,
  authority: PublicKey
): [PublicKey, number] {
  return pda([Buffer.from("pc_mint"), authority.toBuffer()], programId);
}

export function deriveAccountPda(
  programId: PublicKey,
  mint: PublicKey,
  owner: PublicKey
): [PublicKey, number] {
  return pda(
    [Buffer.from("pc_account"), mint.toBuffer(), owner.toBuffer()],
    programId
  );
}

/** Instruction 0: InitializeMint */
export function initializeMintIx(
  ctx: PcTokenContext,
  mintPda: PublicKey,
  mintBump: number,
  decimals: number,
  mintAuthority: PublicKey,
  freezeAuthority?: PublicKey
): TransactionInstruction {
  const data = Buffer.alloc(freezeAuthority ? 67 : 35);
  data[0] = 0; // disc
  data[1] = mintBump;
  data[2] = decimals;
  mintAuthority.toBuffer().copy(data, 3);
  data[35] = freezeAuthority ? 1 : 0;
  if (freezeAuthority) {
    freezeAuthority.toBuffer().copy(data, 36);
  }

  return new TransactionInstruction({
    programId: ctx.programId,
    data,
    keys: [
      { pubkey: mintPda, isSigner: false, isWritable: true },
      { pubkey: mintAuthority, isSigner: true, isWritable: false },
      { pubkey: ctx.payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

/** Instruction 1: InitializeAccount */
export function initializeAccountIx(
  ctx: PcTokenContext,
  accountPda: PublicKey,
  accountBump: number,
  mint: PublicKey,
  owner: PublicKey,
  balanceCt: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ctx.programId,
    data: Buffer.from([1, accountBump, ctx.cpiBump]),
    keys: [
      { pubkey: accountPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: balanceCt, isSigner: true, isWritable: true },
      ...encryptCpiAccounts(
        ctx.enc,
        ctx.programId,
        ctx.cpiAuthority,
        ctx.payer
      ),
    ],
  });
}

/** Instruction 7: MintTo (amount_ct is client-encrypted via gRPC) */
export function mintToIx(
  ctx: PcTokenContext,
  mint: PublicKey,
  tokenAccount: PublicKey,
  balanceCt: PublicKey,
  amountCt: PublicKey,
  authority: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ctx.programId,
    data: Buffer.from([7, ctx.cpiBump]),
    keys: [
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: tokenAccount, isSigner: false, isWritable: false },
      { pubkey: balanceCt, isSigner: false, isWritable: true },
      { pubkey: amountCt, isSigner: false, isWritable: true },
      ...encryptCpiAccounts(
        ctx.enc,
        ctx.programId,
        ctx.cpiAuthority,
        authority
      ),
    ],
  });
}

/** Instruction 3: Transfer (amount_ct is client-encrypted via gRPC) */
export function transferIx(
  ctx: PcTokenContext,
  fromAccount: PublicKey,
  toAccount: PublicKey,
  fromBalanceCt: PublicKey,
  toBalanceCt: PublicKey,
  amountCt: PublicKey,
  owner: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ctx.programId,
    data: Buffer.from([3, ctx.cpiBump]),
    keys: [
      { pubkey: fromAccount, isSigner: false, isWritable: false },
      { pubkey: toAccount, isSigner: false, isWritable: false },
      { pubkey: fromBalanceCt, isSigner: false, isWritable: true },
      { pubkey: toBalanceCt, isSigner: false, isWritable: true },
      { pubkey: amountCt, isSigner: false, isWritable: true },
      ...encryptCpiAccounts(
        ctx.enc,
        ctx.programId,
        ctx.cpiAuthority,
        owner
      ),
    ],
  });
}

// ── Vault / Wrap / Unwrap ──

export function deriveVaultPda(
  programId: PublicKey,
  pcMint: PublicKey
): [PublicKey, number] {
  return pda([Buffer.from("pc_vault"), pcMint.toBuffer()], programId);
}


/** Instruction 23: InitializeVault */
export function initializeVaultIx(
  ctx: PcTokenContext,
  vaultPda: PublicKey,
  vaultBump: number,
  pcMint: PublicKey,
  splMint: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ctx.programId,
    data: Buffer.from([23, vaultBump]),
    keys: [
      { pubkey: vaultPda, isSigner: false, isWritable: true },
      { pubkey: pcMint, isSigner: false, isWritable: false },
      { pubkey: splMint, isSigner: false, isWritable: false },
      { pubkey: ctx.payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
  });
}

/** Instruction 30: Wrap (deposit SPL → mint pcToken) */
export function wrapIx(
  ctx: PcTokenContext,
  vault: PublicKey,
  tokenAccount: PublicKey,
  userAta: PublicKey,
  vaultAta: PublicKey,
  balanceCt: PublicKey,
  amountCt: PublicKey,
  owner: PublicKey,
  amount: bigint
): TransactionInstruction {
  const data = Buffer.alloc(10);
  data[0] = 30; // disc
  data[1] = ctx.cpiBump;
  data.writeBigUInt64LE(amount, 2);

  return new TransactionInstruction({
    programId: ctx.programId,
    data,
    keys: [
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: tokenAccount, isSigner: false, isWritable: false },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: balanceCt, isSigner: false, isWritable: true },
      { pubkey: amountCt, isSigner: false, isWritable: true },
      ...encryptCpiAccounts(ctx.enc, ctx.programId, ctx.cpiAuthority, owner),
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
}

export function deriveReceiptPda(
  programId: PublicKey, burnedCt: PublicKey
): [PublicKey, number] {
  return pda([Buffer.from("pc_receipt"), burnedCt.toBuffer()], programId);
}

/** Instruction 31: UnwrapBurn */
export function unwrapBurnIx(
  ctx: PcTokenContext, vault: PublicKey, tokenAccount: PublicKey,
  receiptPda: PublicKey, receiptBump: number,
  balanceCt: PublicKey, amountCt: PublicKey, burnedCt: PublicKey,
  owner: PublicKey, amount: bigint
): TransactionInstruction {
  const data = Buffer.alloc(11);
  data[0] = 31; data[1] = receiptBump; data[2] = ctx.cpiBump;
  data.writeBigUInt64LE(amount, 3);
  return new TransactionInstruction({
    programId: ctx.programId, data,
    keys: [
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: tokenAccount, isSigner: false, isWritable: true },
      { pubkey: receiptPda, isSigner: false, isWritable: true },
      { pubkey: balanceCt, isSigner: false, isWritable: true },
      { pubkey: amountCt, isSigner: false, isWritable: true },
      { pubkey: burnedCt, isSigner: false, isWritable: true },
      ...encryptCpiAccounts(ctx.enc, ctx.programId, ctx.cpiAuthority, owner),
    ],
  });
}

/** Instruction 32: UnwrapDecrypt */
export function unwrapDecryptIx(
  ctx: PcTokenContext, receipt: PublicKey,
  requestAcct: PublicKey, burnedCt: PublicKey, owner: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ctx.programId, data: Buffer.from([32, ctx.cpiBump]),
    keys: [
      { pubkey: receipt, isSigner: false, isWritable: true },
      { pubkey: requestAcct, isSigner: true, isWritable: true },
      { pubkey: burnedCt, isSigner: false, isWritable: false },
      ...encryptCpiAccounts(ctx.enc, ctx.programId, ctx.cpiAuthority, owner)
        .map(a => a.pubkey.equals(ctx.enc.configPda) ? { ...a, isWritable: false } : a),
    ],
  });
}

/** Instruction 33: UnwrapComplete */
export function unwrapCompleteIx(
  programId: PublicKey, receipt: PublicKey, vault: PublicKey,
  pcMint: PublicKey, requestAcct: PublicKey,
  vaultAta: PublicKey, userAta: PublicKey,
  owner: PublicKey, destination: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId, data: Buffer.from([33]),
    keys: [
      { pubkey: receipt, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: false },
      { pubkey: pcMint, isSigner: false, isWritable: false },
      { pubkey: requestAcct, isSigner: false, isWritable: false },
      { pubkey: vaultAta, isSigner: false, isWritable: true },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  });
}
```

## 2.8 — `encrypt/chains/solana/examples/pc-token/pinocchio/src/lib.rs`

```rust
// Copyright (c) dWallet Labs, Ltd.
// SPDX-License-Identifier: BSD-3-Clause-Clear

#![allow(unexpected_cfgs)]

/// PC-Token (Confidential Performant Token) — P-Token rebuilt with
/// Encrypt FHE for on-chain confidentiality.
///
/// All balances and transfer amounts are encrypted. There is no
/// decrypt instruction on the TokenAccount — balances are never
/// revealed on-chain. The only plaintext values that ever appear
/// are wrap/unwrap amounts at the SPL boundary, and those live on
/// temporary WithdrawalReceipt accounts that get closed immediately.
///
/// ## Instructions (P-Token discriminators)
///
///  0. InitializeMint
///  1. InitializeAccount
///  3. Transfer (encrypted amount)
///  4. Approve (encrypted allowance)
///  5. Revoke
///  7. MintTo (encrypted amount)
///  8. Burn (encrypted amount)
///  9. CloseAccount
/// 10. FreezeAccount
/// 11. ThawAccount
/// 20. TransferFrom (delegate, composability)
/// 23. InitializeVault
/// 30. Wrap (SPL → pcToken)
/// 31. UnwrapBurn (burn pcTokens + create withdrawal receipt)
/// 32. UnwrapDecrypt (request decryption of burned amount)
/// 33. UnwrapComplete (verify + release SPL tokens + close receipt)
use encrypt_dsl::prelude::encrypt_fn;
use encrypt_pinocchio::accounts;
use encrypt_pinocchio::EncryptContext;
use encrypt_types::encrypted::{EUint64, Uint64};
use pinocchio::{
    cpi::{Seed, Signer},
    entrypoint,
    error::ProgramError,
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::Transfer as SplTransfer;

entrypoint!(process_instruction);

pub const ID: Address = Address::new_from_array([5u8; 32]);

// ── AccountState ──

#[derive(Clone, Copy, PartialEq)]
#[repr(u8)]
pub enum AccountState { Uninitialized = 0, Initialized = 1, Frozen = 2 }
impl From<u8> for AccountState { fn from(v: u8) -> Self { match v { 1 => Self::Initialized, 2 => Self::Frozen, _ => Self::Uninitialized } } }

const COPTION_NONE: [u8; 4] = [0, 0, 0, 0];
const COPTION_SOME: [u8; 4] = [1, 0, 0, 0];

// ── Account layouts ──

#[repr(C)]
pub struct Mint {
    pub mint_authority_flag: [u8; 4],
    pub mint_authority: [u8; 32],
    pub decimals: u8,
    pub is_initialized: u8,
    pub freeze_authority_flag: [u8; 4],
    pub freeze_authority: [u8; 32],
    pub bump: u8,
}
impl Mint {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub fn from_bytes(d: &[u8]) -> Result<&Self, ProgramError> { if d.len() < Self::LEN { return Err(ProgramError::InvalidAccountData); } Ok(unsafe { &*(d.as_ptr() as *const Self) }) }
    pub fn from_bytes_mut(d: &mut [u8]) -> Result<&mut Self, ProgramError> { if d.len() < Self::LEN { return Err(ProgramError::InvalidAccountData); } Ok(unsafe { &mut *(d.as_mut_ptr() as *mut Self) }) }
    pub fn is_initialized(&self) -> bool { self.is_initialized == 1 }
    pub fn has_mint_authority(&self) -> bool { self.mint_authority_flag == COPTION_SOME }
    pub fn has_freeze_authority(&self) -> bool { self.freeze_authority_flag == COPTION_SOME }
}

/// TokenAccount — NO plaintext fields. Balance is always encrypted.
#[repr(C)]
pub struct TokenAccount {
    pub mint: [u8; 32],
    pub owner: [u8; 32],
    pub balance: EUint64,
    pub delegate_flag: [u8; 4],
    pub delegate: [u8; 32],
    pub state: u8,
    pub allowance: EUint64,
    pub close_authority_flag: [u8; 4],
    pub close_authority: [u8; 32],
    pub bump: u8,
}
impl TokenAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub fn from_bytes(d: &[u8]) -> Result<&Self, ProgramError> { if d.len() < Self::LEN { return Err(ProgramError::InvalidAccountData); } Ok(unsafe { &*(d.as_ptr() as *const Self) }) }
    pub fn from_bytes_mut(d: &mut [u8]) -> Result<&mut Self, ProgramError> { if d.len() < Self::LEN { return Err(ProgramError::InvalidAccountData); } Ok(unsafe { &mut *(d.as_mut_ptr() as *mut Self) }) }
    pub fn is_frozen(&self) -> bool { self.state == AccountState::Frozen as u8 }
    pub fn is_initialized(&self) -> bool { self.state != AccountState::Uninitialized as u8 }
    pub fn has_delegate(&self) -> bool { self.delegate_flag == COPTION_SOME }
    pub fn has_close_authority(&self) -> bool { self.close_authority_flag == COPTION_SOME }
}

#[repr(C)]
pub struct Vault { pub spl_mint: [u8; 32], pub bump: u8 }
impl Vault {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub fn from_bytes(d: &[u8]) -> Result<&Self, ProgramError> { if d.len() < Self::LEN { return Err(ProgramError::InvalidAccountData); } Ok(unsafe { &*(d.as_ptr() as *const Self) }) }
    pub fn from_bytes_mut(d: &mut [u8]) -> Result<&mut Self, ProgramError> { if d.len() < Self::LEN { return Err(ProgramError::InvalidAccountData); } Ok(unsafe { &mut *(d.as_mut_ptr() as *mut Self) }) }
}

/// Temporary receipt for unwrap — stores only the withdrawal amount + digest.
/// PDA: `["pc_receipt", burned_ct]`. Closed after unwrap completes.
#[repr(C)]
pub struct WithdrawalReceipt {
    pub owner: [u8; 32],
    pub amount: [u8; 8],           // requested plaintext amount
    pub pending_digest: [u8; 32],  // digest for decryption verification
    pub bump: u8,
}
impl WithdrawalReceipt {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub fn from_bytes(d: &[u8]) -> Result<&Self, ProgramError> { if d.len() < Self::LEN { return Err(ProgramError::InvalidAccountData); } Ok(unsafe { &*(d.as_ptr() as *const Self) }) }
    pub fn from_bytes_mut(d: &mut [u8]) -> Result<&mut Self, ProgramError> { if d.len() < Self::LEN { return Err(ProgramError::InvalidAccountData); } Ok(unsafe { &mut *(d.as_mut_ptr() as *mut Self) }) }
    pub fn requested_amount(&self) -> u64 { u64::from_le_bytes(self.amount) }
}

fn minimum_balance(s: usize) -> u64 { (s as u64 + 128) * 6960 }
fn assert_not_frozen(ta: &TokenAccount) -> ProgramResult { if ta.is_frozen() { Err(ProgramError::Custom(0x11)) } else { Ok(()) } }

// ── FHE Graphs ──

#[encrypt_fn] fn mint_to_graph(balance: EUint64, amount: EUint64) -> EUint64 { balance + amount }

#[encrypt_fn] fn transfer_graph(from_balance: EUint64, to_balance: EUint64, amount: EUint64) -> (EUint64, EUint64) {
    let s = from_balance >= amount;
    let nf = if s { from_balance - amount } else { from_balance };
    let nt = if s { to_balance + amount } else { to_balance };
    (nf, nt)
}

#[encrypt_fn] fn burn_graph(balance: EUint64, amount: EUint64) -> EUint64 {
    let s = balance >= amount; if s { balance - amount } else { balance }
}

#[encrypt_fn] fn transfer_from_graph(from_balance: EUint64, to_balance: EUint64, allowance: EUint64, amount: EUint64) -> (EUint64, EUint64, EUint64) {
    let sb = from_balance >= amount; let sa = allowance >= amount; let v = sb & sa;
    let nf = if v { from_balance - amount } else { from_balance };
    let nt = if v { to_balance + amount } else { to_balance };
    let na = if v { allowance - amount } else { allowance };
    (nf, nt, na)
}

/// Unwrap burn: conditional burn that outputs the actual burned amount.
/// burned = amount if sufficient, 0 if not.
#[encrypt_fn] fn unwrap_burn_graph(balance: EUint64, amount: EUint64) -> (EUint64, EUint64) {
    let s = balance >= amount;
    let new_balance = if s { balance - amount } else { balance };
    let burned = if s { amount } else { amount - amount };
    (new_balance, burned)
}

/// Transfer + binary receipt. Same balance updates as `transfer_graph`, plus
/// a third output `actual` ∈ {amount, 0} — the receipt is the actually-
/// transferred value, never partial. Consumers (e.g., pc-swap) multiply
/// downstream state by the receipt to gate their own updates in lockstep.
#[encrypt_fn] fn transfer_receipt_graph(from_balance: EUint64, to_balance: EUint64, amount: EUint64) -> (EUint64, EUint64, EUint64) {
    let s = from_balance >= amount;
    let zero = amount - amount;
    let actual = if s { amount } else { zero };
    let nf = from_balance - actual;
    let nt = to_balance + actual;
    (nf, nt, actual)
}

// ── Dispatch ──

fn process_instruction(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    match data.split_first() {
        Some((&0, rest)) => initialize_mint(program_id, accounts, rest),
        Some((&1, rest)) => initialize_account(program_id, accounts, rest),
        Some((&3, rest)) => transfer(accounts, rest),
        Some((&4, rest)) => approve(accounts, rest),
        Some((&5, rest)) => revoke(accounts, rest),
        // No standalone MintTo — tokens can only enter through Wrap (vault-backed)
        // No standalone Burn — tokens can only exit through Unwrap (releases backing SPL)
        Some((&10, rest)) => freeze_account(accounts, rest),
        Some((&11, rest)) => thaw_account(accounts, rest),
        Some((&20, rest)) => transfer_from(accounts, rest),
        Some((&22, rest)) => transfer_with_receipt(accounts, rest),
        Some((&23, rest)) => initialize_vault(program_id, accounts, rest),
        Some((&30, rest)) => wrap(accounts, rest),
        Some((&31, rest)) => unwrap_burn(program_id, accounts, rest),
        Some((&32, rest)) => unwrap_decrypt(accounts, rest),
        Some((&33, _rest)) => unwrap_complete(accounts),
        // 40: ViewBalance — fork-only addition (Inkwell). Lets the account owner produce a
        // wallet-authorized copy of their encrypted balance so they can read it via gRPC.
        // Without this, balance_ct.authorized = PC-Token program → no wallet can decrypt
        // off-chain. PR worth shipping upstream once Encrypt Alpha 1 stabilizes the read flow.
        Some((&40, rest)) => view_balance(accounts, rest),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// ── 0: InitializeMint ──

fn initialize_mint(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [mint_acct, authority, payer, _sys, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !authority.is_signer() || !payer.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.len() < 34 { return Err(ProgramError::InvalidInstructionData); }
    let (bump, decimals) = (data[0], data[1]);
    let mint_authority: [u8; 32] = data[2..34].try_into().unwrap();
    let has_freeze = data.len() > 34 && data[34] != 0;
    let freeze_authority: [u8; 32] = if has_freeze && data.len() >= 66 { data[35..67].try_into().unwrap() } else { [0u8; 32] };
    let bb = [bump];
    let seeds = [Seed::from(b"pc_mint" as &[u8]), Seed::from(authority.address().as_ref()), Seed::from(&bb)];
    CreateAccount { from: payer, to: mint_acct, lamports: minimum_balance(Mint::LEN), space: Mint::LEN as u64, owner: program_id }.invoke_signed(&[Signer::from(&seeds)])?;
    let d = unsafe { mint_acct.borrow_unchecked_mut() };
    let m = Mint::from_bytes_mut(d)?;
    m.mint_authority_flag = COPTION_SOME; m.mint_authority.copy_from_slice(&mint_authority);
    m.decimals = decimals; m.is_initialized = 1;
    if has_freeze { m.freeze_authority_flag = COPTION_SOME; m.freeze_authority.copy_from_slice(&freeze_authority); }
    else { m.freeze_authority_flag = COPTION_NONE; m.freeze_authority = [0u8; 32]; }
    m.bump = bump; Ok(())
}

// ── 1: InitializeAccount ──

fn initialize_account(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [ta_acct, mint_acct, owner, bal_ct, ep, cfg, dep, cpi_auth, caller, nk, payer, evt, sys, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !payer.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.len() < 2 { return Err(ProgramError::InvalidInstructionData); }
    let (ab, cb) = (data[0], data[1]);
    let md = unsafe { mint_acct.borrow_unchecked() };
    if !Mint::from_bytes(md)?.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    let bb = [ab];
    let seeds = [Seed::from(b"pc_account" as &[u8]), Seed::from(mint_acct.address().as_ref()), Seed::from(owner.address().as_ref()), Seed::from(&bb)];
    CreateAccount { from: payer, to: ta_acct, lamports: minimum_balance(TokenAccount::LEN), space: TokenAccount::LEN as u64, owner: program_id }.invoke_signed(&[Signer::from(&seeds)])?;
    let ctx = EncryptContext { encrypt_program: ep, config: cfg, deposit: dep, cpi_authority: cpi_auth, caller_program: caller, network_encryption_key: nk, payer, event_authority: evt, system_program: sys, cpi_authority_bump: cb };
    ctx.create_plaintext_typed::<Uint64>(&0u64, bal_ct)?;
    let d = unsafe { ta_acct.borrow_unchecked_mut() };
    let ta = TokenAccount::from_bytes_mut(d)?;
    ta.mint.copy_from_slice(mint_acct.address().as_ref());
    ta.owner.copy_from_slice(owner.address().as_ref());
    ta.balance = EUint64::from_le_bytes(*bal_ct.address().as_array());
    ta.delegate_flag = COPTION_NONE; ta.delegate = [0u8; 32];
    ta.state = AccountState::Initialized as u8;
    ta.allowance = EUint64::from_le_bytes([0u8; 32]);
    ta.close_authority_flag = COPTION_NONE; ta.close_authority = [0u8; 32];
    ta.bump = ab; Ok(())
}

// ── 7: MintTo ──

fn mint_to(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [mint_acct, ta_acct, bal_ct, amt_ct, ep, cfg, dep, cpi_auth, caller, nk, authority, evt, sys, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !authority.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
    let md = unsafe { mint_acct.borrow_unchecked() };
    let m = Mint::from_bytes(md)?;
    if !m.has_mint_authority() || authority.address().as_array() != &m.mint_authority { return Err(ProgramError::InvalidArgument); }
    let td = unsafe { ta_acct.borrow_unchecked() };
    let ta = TokenAccount::from_bytes(td)?;
    if !ta.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    assert_not_frozen(ta)?;
    if &ta.mint != mint_acct.address().as_array() { return Err(ProgramError::InvalidArgument); }
    if bal_ct.address().as_array() != ta.balance.id() { return Err(ProgramError::InvalidArgument); }
    let ctx = EncryptContext { encrypt_program: ep, config: cfg, deposit: dep, cpi_authority: cpi_auth, caller_program: caller, network_encryption_key: nk, payer: authority, event_authority: evt, system_program: sys, cpi_authority_bump: data[0] };
    ctx.mint_to_graph(bal_ct, amt_ct, bal_ct)?; Ok(())
}

// ── 3: Transfer ──

fn transfer(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [from_acct, to_acct, from_ct, to_ct, amt_ct, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !owner.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
    let fd = unsafe { from_acct.borrow_unchecked() };
    let ft = TokenAccount::from_bytes(fd)?;
    if !ft.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    assert_not_frozen(ft)?;
    if owner.address().as_array() != &ft.owner { return Err(ProgramError::InvalidArgument); }
    let td = unsafe { to_acct.borrow_unchecked() };
    let tt = TokenAccount::from_bytes(td)?;
    if !tt.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    assert_not_frozen(tt)?;
    if ft.mint != tt.mint { return Err(ProgramError::InvalidArgument); }
    if from_ct.address().as_array() != ft.balance.id() { return Err(ProgramError::InvalidArgument); }
    if to_ct.address().as_array() != tt.balance.id() { return Err(ProgramError::InvalidArgument); }
    let ctx = EncryptContext { encrypt_program: ep, config: cfg, deposit: dep, cpi_authority: cpi_auth, caller_program: caller, network_encryption_key: nk, payer: owner, event_authority: evt, system_program: sys, cpi_authority_bump: data[0] };
    ctx.transfer_graph(from_ct, to_ct, amt_ct, from_ct, to_ct)?; Ok(())
}

// ── 22: TransferWithReceipt ──
// Same balance updates as Transfer, plus emits a binary receipt ciphertext
// (= amount on success, 0 on insufficient balance) authorized to a caller-
// supplied target program. Owner-signer-only — no delegate path.
//
// SECURITY: receipt_ct's authorized field is the target program. Whoever
// holds compute access also holds decrypt access in encrypt's current ACL
// model — pc-token's contract with callers is that they will not call
// `request_decryption` on receipts. The user's signature on this tx is
// consent for that trust relationship. (The principled fix lives in the
// encrypt program: split authorized into compute_authorized /
// decrypt_authorized.)

fn transfer_with_receipt(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [from_acct, to_acct, from_ct, to_ct, amt_ct, receipt_ct, target_program, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !owner.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
    let fd = unsafe { from_acct.borrow_unchecked() };
    let ft = TokenAccount::from_bytes(fd)?;
    if !ft.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    assert_not_frozen(ft)?;
    if owner.address().as_array() != &ft.owner { return Err(ProgramError::InvalidArgument); }
    let td = unsafe { to_acct.borrow_unchecked() };
    let tt = TokenAccount::from_bytes(td)?;
    if !tt.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    assert_not_frozen(tt)?;
    if ft.mint != tt.mint { return Err(ProgramError::InvalidArgument); }
    if from_ct.address().as_array() != ft.balance.id() { return Err(ProgramError::InvalidArgument); }
    if to_ct.address().as_array() != tt.balance.id() { return Err(ProgramError::InvalidArgument); }
    let ctx = EncryptContext { encrypt_program: ep, config: cfg, deposit: dep, cpi_authority: cpi_auth, caller_program: caller, network_encryption_key: nk, payer: owner, event_authority: evt, system_program: sys, cpi_authority_bump: data[0] };
    ctx.create_plaintext_typed::<Uint64>(&0u64, receipt_ct)?;
    ctx.transfer_receipt_graph(from_ct, to_ct, amt_ct, from_ct, to_ct, receipt_ct)?;
    ctx.transfer_ciphertext(receipt_ct, target_program)?;
    Ok(())
}

// ── 4: Approve ──

fn approve(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [ta_acct, delegate, amt_ct, allow_ct, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !owner.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
    let td = unsafe { ta_acct.borrow_unchecked() };
    let ta = TokenAccount::from_bytes(td)?;
    if !ta.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    assert_not_frozen(ta)?;
    if owner.address().as_array() != &ta.owner { return Err(ProgramError::InvalidArgument); }
    let ctx = EncryptContext { encrypt_program: ep, config: cfg, deposit: dep, cpi_authority: cpi_auth, caller_program: caller, network_encryption_key: nk, payer: owner, event_authority: evt, system_program: sys, cpi_authority_bump: data[0] };
    ctx.create_plaintext_typed::<Uint64>(&0u64, allow_ct)?;
    ctx.mint_to_graph(allow_ct, amt_ct, allow_ct)?;
    let td2 = unsafe { ta_acct.borrow_unchecked_mut() };
    let ta2 = TokenAccount::from_bytes_mut(td2)?;
    ta2.delegate_flag = COPTION_SOME;
    ta2.delegate.copy_from_slice(delegate.address().as_ref());
    ta2.allowance = EUint64::from_le_bytes(*allow_ct.address().as_array());
    Ok(())
}

// ── 5: Revoke ──

fn revoke(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [ta_acct, allow_ct, owner, ep, cfg, dep, cpi_auth, caller, nk, payer, evt, sys, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !owner.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
    let td = unsafe { ta_acct.borrow_unchecked() };
    let ta = TokenAccount::from_bytes(td)?;
    if owner.address().as_array() != &ta.owner { return Err(ProgramError::InvalidArgument); }
    if !ta.has_delegate() { return Err(ProgramError::InvalidArgument); }
    if allow_ct.address().as_array() != ta.allowance.id() { return Err(ProgramError::InvalidArgument); }
    let ctx = EncryptContext { encrypt_program: ep, config: cfg, deposit: dep, cpi_authority: cpi_auth, caller_program: caller, network_encryption_key: nk, payer, event_authority: evt, system_program: sys, cpi_authority_bump: data[0] };
    ctx.close_ciphertext(allow_ct, payer)?;
    let td2 = unsafe { ta_acct.borrow_unchecked_mut() };
    let ta2 = TokenAccount::from_bytes_mut(td2)?;
    ta2.delegate_flag = COPTION_NONE; ta2.delegate = [0u8; 32]; ta2.allowance = EUint64::from_le_bytes([0u8; 32]); Ok(())
}

// ── 8: Burn ──

fn burn(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [ta_acct, mint_acct, bal_ct, amt_ct, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !owner.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
    let td = unsafe { ta_acct.borrow_unchecked() };
    let ta = TokenAccount::from_bytes(td)?;
    if !ta.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    assert_not_frozen(ta)?;
    if owner.address().as_array() != &ta.owner { return Err(ProgramError::InvalidArgument); }
    if &ta.mint != mint_acct.address().as_array() { return Err(ProgramError::InvalidArgument); }
    if bal_ct.address().as_array() != ta.balance.id() { return Err(ProgramError::InvalidArgument); }
    let ctx = EncryptContext { encrypt_program: ep, config: cfg, deposit: dep, cpi_authority: cpi_auth, caller_program: caller, network_encryption_key: nk, payer: owner, event_authority: evt, system_program: sys, cpi_authority_bump: data[0] };
    ctx.burn_graph(bal_ct, amt_ct, bal_ct)?; Ok(())
}

// ── 10: FreezeAccount ──

fn freeze_account(accounts: &[AccountView], _data: &[u8]) -> ProgramResult {
    let [ta_acct, mint_acct, freeze_auth, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !freeze_auth.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    let md = unsafe { mint_acct.borrow_unchecked() };
    let m = Mint::from_bytes(md)?;
    if !m.has_freeze_authority() || freeze_auth.address().as_array() != &m.freeze_authority { return Err(ProgramError::InvalidArgument); }
    let td = unsafe { ta_acct.borrow_unchecked() };
    let ta = TokenAccount::from_bytes(td)?;
    if !ta.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    if &ta.mint != mint_acct.address().as_array() { return Err(ProgramError::InvalidArgument); }
    let td2 = unsafe { ta_acct.borrow_unchecked_mut() };
    TokenAccount::from_bytes_mut(td2)?.state = AccountState::Frozen as u8; Ok(())
}

// ── 11: ThawAccount ──

fn thaw_account(accounts: &[AccountView], _data: &[u8]) -> ProgramResult {
    let [ta_acct, mint_acct, freeze_auth, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !freeze_auth.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    let md = unsafe { mint_acct.borrow_unchecked() };
    let m = Mint::from_bytes(md)?;
    if !m.has_freeze_authority() || freeze_auth.address().as_array() != &m.freeze_authority { return Err(ProgramError::InvalidArgument); }
    let td = unsafe { ta_acct.borrow_unchecked() };
    let ta = TokenAccount::from_bytes(td)?;
    if !ta.is_frozen() { return Err(ProgramError::InvalidArgument); }
    if &ta.mint != mint_acct.address().as_array() { return Err(ProgramError::InvalidArgument); }
    let td2 = unsafe { ta_acct.borrow_unchecked_mut() };
    TokenAccount::from_bytes_mut(td2)?.state = AccountState::Initialized as u8; Ok(())
}

// ── 20: TransferFrom ──

fn transfer_from(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [from_acct, to_acct, from_ct, to_ct, allow_ct, amt_ct, delegate, ep, cfg, dep, cpi_auth, caller, nk, payer, evt, sys, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !delegate.is_signer() || !payer.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
    let fd = unsafe { from_acct.borrow_unchecked() };
    let ft = TokenAccount::from_bytes(fd)?;
    if !ft.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    assert_not_frozen(ft)?;
    if !ft.has_delegate() || delegate.address().as_array() != &ft.delegate { return Err(ProgramError::InvalidArgument); }
    let td = unsafe { to_acct.borrow_unchecked() };
    let tt = TokenAccount::from_bytes(td)?;
    if !tt.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    assert_not_frozen(tt)?;
    if ft.mint != tt.mint { return Err(ProgramError::InvalidArgument); }
    if from_ct.address().as_array() != ft.balance.id() { return Err(ProgramError::InvalidArgument); }
    if to_ct.address().as_array() != tt.balance.id() { return Err(ProgramError::InvalidArgument); }
    if allow_ct.address().as_array() != ft.allowance.id() { return Err(ProgramError::InvalidArgument); }
    let ctx = EncryptContext { encrypt_program: ep, config: cfg, deposit: dep, cpi_authority: cpi_auth, caller_program: caller, network_encryption_key: nk, payer, event_authority: evt, system_program: sys, cpi_authority_bump: data[0] };
    ctx.transfer_from_graph(from_ct, to_ct, allow_ct, amt_ct, from_ct, to_ct, allow_ct)?; Ok(())
}

// ── 23: InitializeVault ──

fn initialize_vault(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [vault_acct, pc_mint, spl_mint, payer, _sys, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !payer.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
    let vb = data[0]; let md = unsafe { pc_mint.borrow_unchecked() };
    if !Mint::from_bytes(md)?.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    let bb = [vb];
    let seeds = [Seed::from(b"pc_vault" as &[u8]), Seed::from(pc_mint.address().as_ref()), Seed::from(&bb)];
    CreateAccount { from: payer, to: vault_acct, lamports: minimum_balance(Vault::LEN), space: Vault::LEN as u64, owner: program_id }.invoke_signed(&[Signer::from(&seeds)])?;
    let d = unsafe { vault_acct.borrow_unchecked_mut() };
    let v = Vault::from_bytes_mut(d)?;
    v.spl_mint.copy_from_slice(spl_mint.address().as_ref()); v.bump = vb; Ok(())
}

// ── 30: Wrap ──

fn wrap(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [vault_acct, ta_acct, user_ata, vault_ata, bal_ct, amt_ct, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, _spl, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !owner.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.len() < 9 { return Err(ProgramError::InvalidInstructionData); }
    let (cb, amount) = (data[0], u64::from_le_bytes(data[1..9].try_into().unwrap()));
    if amount == 0 { return Err(ProgramError::InvalidArgument); }
    let td = unsafe { ta_acct.borrow_unchecked() };
    let ta = TokenAccount::from_bytes(td)?;
    if !ta.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    assert_not_frozen(ta)?;
    if owner.address().as_array() != &ta.owner { return Err(ProgramError::InvalidArgument); }
    if bal_ct.address().as_array() != ta.balance.id() { return Err(ProgramError::InvalidArgument); }
    let vd = unsafe { vault_acct.borrow_unchecked() };
    let vault = Vault::from_bytes(vd)?;
    let vad = unsafe { vault_ata.borrow_unchecked() };
    if vad.len() < 64 { return Err(ProgramError::InvalidAccountData); }
    if &vad[32..64] != vault_acct.address().as_ref() { return Err(ProgramError::InvalidArgument); }
    if &vad[0..32] != &vault.spl_mint { return Err(ProgramError::InvalidArgument); }
    SplTransfer { from: user_ata, to: vault_ata, authority: owner, amount }.invoke()?;
    let ctx = EncryptContext { encrypt_program: ep, config: cfg, deposit: dep, cpi_authority: cpi_auth, caller_program: caller, network_encryption_key: nk, payer: owner, event_authority: evt, system_program: sys, cpi_authority_bump: cb };
    ctx.mint_to_graph(bal_ct, amt_ct, bal_ct)?; Ok(())
}

// ── 31: UnwrapBurn ──
// Burns pcTokens and creates a temporary WithdrawalReceipt.
// The burned_ct (pre-created via gRPC) receives the actual burned amount
// (= amount if sufficient, 0 if not). Receipt tracks the requested amount.

fn unwrap_burn(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [vault_acct, ta_acct, receipt_acct, bal_ct, amt_ct, burned_ct, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !owner.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.len() < 10 { return Err(ProgramError::InvalidInstructionData); }
    let (rb, cb) = (data[0], data[1]);
    let amount = u64::from_le_bytes(data[2..10].try_into().unwrap());
    if amount == 0 { return Err(ProgramError::InvalidArgument); }
    let _vd = unsafe { vault_acct.borrow_unchecked() };
    Vault::from_bytes(_vd)?;
    let td = unsafe { ta_acct.borrow_unchecked() };
    let ta = TokenAccount::from_bytes(td)?;
    if !ta.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    assert_not_frozen(ta)?;
    if owner.address().as_array() != &ta.owner { return Err(ProgramError::InvalidArgument); }
    if bal_ct.address().as_array() != ta.balance.id() { return Err(ProgramError::InvalidArgument); }

    // Create receipt PDA
    let bb = [rb];
    let seeds = [Seed::from(b"pc_receipt" as &[u8]), Seed::from(burned_ct.address().as_ref()), Seed::from(&bb)];
    CreateAccount { from: owner, to: receipt_acct, lamports: minimum_balance(WithdrawalReceipt::LEN),
        space: WithdrawalReceipt::LEN as u64, owner: program_id }.invoke_signed(&[Signer::from(&seeds)])?;

    let ctx = EncryptContext { encrypt_program: ep, config: cfg, deposit: dep, cpi_authority: cpi_auth, caller_program: caller, network_encryption_key: nk, payer: owner, event_authority: evt, system_program: sys, cpi_authority_bump: cb };
    // burned_ct is pre-created via gRPC (value=0). Graph writes actual burned amount.
    ctx.unwrap_burn_graph(bal_ct, amt_ct, bal_ct, burned_ct)?;

    let rd = unsafe { receipt_acct.borrow_unchecked_mut() };
    let r = WithdrawalReceipt::from_bytes_mut(rd)?;
    r.owner.copy_from_slice(owner.address().as_ref());
    r.amount = amount.to_le_bytes();
    r.pending_digest = [0u8; 32]; r.bump = rb; Ok(())
}

// ── 32: UnwrapDecrypt ──

fn unwrap_decrypt(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [receipt_acct, req_acct, burned_ct, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !owner.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
    let rd = unsafe { receipt_acct.borrow_unchecked() };
    let r = WithdrawalReceipt::from_bytes(rd)?;
    if owner.address().as_array() != &r.owner { return Err(ProgramError::InvalidArgument); }
    let ctx = EncryptContext { encrypt_program: ep, config: cfg, deposit: dep, cpi_authority: cpi_auth, caller_program: caller, network_encryption_key: nk, payer: owner, event_authority: evt, system_program: sys, cpi_authority_bump: data[0] };
    let digest = ctx.request_decryption(req_acct, burned_ct)?;
    let rd2 = unsafe { receipt_acct.borrow_unchecked_mut() };
    WithdrawalReceipt::from_bytes_mut(rd2)?.pending_digest = digest; Ok(())
}

// ── 33: UnwrapComplete ──

fn unwrap_complete(accounts: &[AccountView]) -> ProgramResult {
    let [receipt_acct, vault_acct, pc_mint, req_acct, vault_ata, user_ata, owner, destination, _spl, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !owner.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    let rd = unsafe { receipt_acct.borrow_unchecked() };
    let r = WithdrawalReceipt::from_bytes(rd)?;
    if owner.address().as_array() != &r.owner { return Err(ProgramError::InvalidArgument); }
    let requested = r.requested_amount();
    let digest = r.pending_digest;

    let req_data = unsafe { req_acct.borrow_unchecked() };
    let burned: &u64 = accounts::read_decrypted_verified::<Uint64>(req_data, &digest)?;

    // Close receipt
    let rl = receipt_acct.lamports(); receipt_acct.set_lamports(0);
    destination.set_lamports(destination.lamports() + rl);
    let rd2 = unsafe { receipt_acct.borrow_unchecked_mut() };
    for b in rd2.iter_mut() { *b = 0; }

    if *burned != requested { return Ok(()); } // insufficient balance — no-op, receipt closed

    // SPL transfer: vault → user
    let vd = unsafe { vault_acct.borrow_unchecked() };
    let vault = Vault::from_bytes(vd)?;
    let vad = unsafe { vault_ata.borrow_unchecked() };
    if vad.len() < 64 { return Err(ProgramError::InvalidAccountData); }
    if &vad[32..64] != vault_acct.address().as_ref() { return Err(ProgramError::InvalidArgument); }
    let vbb = [vault.bump];
    let vs = [Seed::from(b"pc_vault" as &[u8]), Seed::from(pc_mint.address().as_ref()), Seed::from(&vbb)];
    SplTransfer { from: vault_ata, to: user_ata, authority: vault_acct, amount: requested }.invoke_signed(&[Signer::from(&vs)])?;
    Ok(())
}

// ── 40: ViewBalance ──
//
// Inkwell fork addition. Lets the account owner produce a wallet-authorized COPY of their
// encrypted balance ciphertext so they can read it via gRPC `readCiphertext`. The original
// balance_ct stays under PC-Token's program authority so wraps/transfers/unwraps continue
// to work; the copy is rent-exempt and persists, but is only readable by the owner.
//
// Cost: ~0.0023 SOL rent per view (the new ciphertext metadata account).
//
// Worth shipping upstream if Encrypt's roadmap doesn't already include a wallet-side view path.
fn view_balance(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [ta_acct, balance_ct, view_ct, new_authorized, ep, cfg, dep, cpi_auth, caller, nk, owner, evt, sys, ..] = accounts
    else { return Err(ProgramError::NotEnoughAccountKeys); };
    if !owner.is_signer() { return Err(ProgramError::MissingRequiredSignature); }
    if data.is_empty() { return Err(ProgramError::InvalidInstructionData); }
    let cb = data[0];

    let td = unsafe { ta_acct.borrow_unchecked() };
    let ta = TokenAccount::from_bytes(td)?;
    if !ta.is_initialized() { return Err(ProgramError::UninitializedAccount); }
    if owner.address().as_array() != &ta.owner { return Err(ProgramError::InvalidArgument); }
    if balance_ct.address().as_array() != ta.balance.id() { return Err(ProgramError::InvalidArgument); }

    let ctx = EncryptContext {
        encrypt_program: ep, config: cfg, deposit: dep,
        cpi_authority: cpi_auth, caller_program: caller,
        network_encryption_key: nk, payer: owner,
        event_authority: evt, system_program: sys,
        cpi_authority_bump: cb,
    };
    // Privacy invariant: `new_authorized` must be a key only the user controls. Client supplies
    // an ephemeral ed25519 pubkey — that pubkey becomes the sole reader, and only the matching
    // private key (held in the user's session) can sign a `readCiphertext` request.
    // NEVER `make_public` this CT; doing so leaks the balance to any chain observer.
    ctx.copy_ciphertext(balance_ct, view_ct, new_authorized)?;
    Ok(())
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use encrypt_types::graph::{get_node, parse_graph, GraphNodeKind};
    use encrypt_types::identifier::*;
    use encrypt_types::types::FheType;
    use super::{burn_graph, mint_to_graph, transfer_from_graph, transfer_graph, unwrap_burn_graph};

    fn run_mock(graph_fn: fn() -> Vec<u8>, inputs: &[u128], fhe_types: &[FheType]) -> Vec<u128> {
        let data = graph_fn(); let pg = parse_graph(&data).unwrap();
        let num = pg.header().num_nodes() as usize;
        let mut digests: Vec<[u8; 32]> = Vec::with_capacity(num); let mut inp = 0usize;
        for i in 0..num {
            let n = get_node(pg.node_bytes(), i as u16).unwrap();
            let ft = FheType::from_u8(n.fhe_type()).unwrap_or(FheType::EUint64);
            let d = match n.kind() {
                k if k == GraphNodeKind::Input as u8 => { let v = inputs[inp]; let t = fhe_types[inp]; inp += 1; encode_mock_digest(t, v) }
                k if k == GraphNodeKind::Constant as u8 => { let bw = ft.byte_width().min(16); let off = n.const_offset() as usize;
                    let mut buf = [0u8; 16]; buf[..bw].copy_from_slice(&pg.constants()[off..off + bw]); encode_mock_digest(ft, u128::from_le_bytes(buf)) }
                k if k == GraphNodeKind::Op as u8 => { let (a, b, c) = (n.input_a() as usize, n.input_b() as usize, n.input_c() as usize);
                    if n.op_type() == 60 { mock_select(&digests[a], &digests[b], &digests[c]) }
                    else if b == 0xFFFF { mock_unary_compute(unsafe { core::mem::transmute(n.op_type()) }, &digests[a], ft) }
                    else { mock_binary_compute(unsafe { core::mem::transmute(n.op_type()) }, &digests[a], &digests[b], ft) } }
                k if k == GraphNodeKind::Output as u8 => digests[n.input_a() as usize],
                _ => panic!("bad node"),
            }; digests.push(d);
        }
        (0..num).filter(|&i| get_node(pg.node_bytes(), i as u16).unwrap().kind() == GraphNodeKind::Output as u8)
            .map(|i| decode_mock_identifier(&digests[i])).collect()
    }

    const T: FheType = FheType::EUint64;

    #[test] fn mint_to() { let r = run_mock(mint_to_graph, &[500, 300], &[T, T]); assert_eq!(r[0], 800); }
    #[test] fn transfer_ok() { let r = run_mock(transfer_graph, &[1000, 500, 300], &[T, T, T]); assert_eq!(r[0], 700); assert_eq!(r[1], 800); }
    #[test] fn transfer_insufficient() { let r = run_mock(transfer_graph, &[100, 500, 300], &[T, T, T]); assert_eq!(r[0], 100); assert_eq!(r[1], 500); }
    #[test] fn burn_ok() { let r = run_mock(burn_graph, &[1000, 300], &[T, T]); assert_eq!(r[0], 700); }
    #[test] fn burn_insufficient() { let r = run_mock(burn_graph, &[100, 300], &[T, T]); assert_eq!(r[0], 100); }
    #[test] fn transfer_from_ok() { let r = run_mock(transfer_from_graph, &[1000, 500, 400, 300], &[T, T, T, T]); assert_eq!(r[0], 700); assert_eq!(r[1], 800); assert_eq!(r[2], 100); }
    #[test] fn transfer_from_insufficient() { let r = run_mock(transfer_from_graph, &[100, 500, 400, 300], &[T, T, T, T]); assert_eq!(r[0], 100); assert_eq!(r[1], 500); assert_eq!(r[2], 400); }

    #[test] fn unwrap_burn_sufficient() { let r = run_mock(unwrap_burn_graph, &[1000, 300], &[T, T]); assert_eq!(r[0], 700); assert_eq!(r[1], 300); }
    #[test] fn unwrap_burn_insufficient() { let r = run_mock(unwrap_burn_graph, &[100, 300], &[T, T]); assert_eq!(r[0], 100); assert_eq!(r[1], 0); }

    #[test] fn graph_shapes() {
        let g = swap_shapes(mint_to_graph, 2, 1); let g = swap_shapes(transfer_graph, 3, 2);
        let g = swap_shapes(burn_graph, 2, 1); let g = swap_shapes(transfer_from_graph, 4, 3);
        let g = swap_shapes(unwrap_burn_graph, 2, 2);
    }
    fn swap_shapes(f: fn() -> Vec<u8>, ni: u8, no: u8) { let g = f(); let pg = parse_graph(&g).unwrap();
        assert_eq!(pg.header().num_inputs(), ni); assert_eq!(pg.header().num_outputs(), no); }
}
```

## 2.9 — `encrypt/chains/solana/examples/pc-swap/pinocchio/src/lib.rs`

```rust
// Copyright (c) dWallet Labs, Ltd.
// SPDX-License-Identifier: BSD-3-Clause-Clear

#![allow(unexpected_cfgs)]

/// PC-Swap — Confidential UniV2 AMM that composes with PC-Token via CPI.
///
/// Pool reserves are real PC-Token TokenAccounts owned by the pool PDA.
/// User → vault deposits go through `pc-token::TransferWithReceipt` (disc 22),
/// which emits a binary receipt ciphertext (= amount on success, 0 on
/// insufficient balance). The receipt is authorized to pc-swap and
/// becomes the *only* trusted input to the FHE math. Reserve mirrors and
/// payouts are functions of the receipt, never of the user-supplied
/// `amount_in` directly — so a user who lies about their balance produces
/// `receipt = 0` and the graph no-ops uniformly: reserves untouched,
/// vault → user payout = 0.
///
/// ## Instructions
///
/// 0. CreatePool          — init pool PDA, init pc-token vaults (owner = pool)
/// 1. Swap                — TransferWithReceipt + swap_graph + transfer (vault→user) + close receipt
/// 2. AddLiquidity        — 2× TransferWithReceipt + add_liquidity_graph + 2× close
/// 4. RemoveLiquidity     — remove_liquidity_graph + 2× pc-token::transfer (vault → user)
/// 5. CreateLpPosition    — internal LP balance account
use encrypt_dsl::prelude::encrypt_fn;
use encrypt_pinocchio::EncryptContext;
#[allow(unused_imports)]
use encrypt_types::encrypted::EUint64;
use encrypt_types::encrypted::Uint64;
use pinocchio::{
    AccountView, Address, ProgramResult,
    cpi::{Seed, Signer, invoke_signed},
    entrypoint,
    error::ProgramError,
    instruction::{InstructionAccount, InstructionView},
};
use pinocchio_system::instructions::CreateAccount;

entrypoint!(process_instruction);

pub const ID: Address = Address::new_from_array([6u8; 32]);

/// PC-Token program id (mirrors pc-token::ID).
pub const PC_TOKEN_ID: Address = Address::new_from_array([5u8; 32]);

/// PC-Token instruction discriminators we invoke via CPI.
const PC_TOKEN_IX_INIT_ACCT: u8 = 1;
const PC_TOKEN_IX_TRANSFER: u8 = 3;
const PC_TOKEN_IX_TRANSFER_WITH_RECEIPT: u8 = 22;

// ── Account layouts ──

/// Pool state — PDA: `["pc_pool", mint_a, mint_b]`.
#[repr(C)]
pub struct Pool {
    pub mint_a: [u8; 32],
    pub mint_b: [u8; 32],
    pub vault_a: [u8; 32],      // pc-token TokenAccount (owner = this pool PDA)
    pub vault_b: [u8; 32],      // pc-token TokenAccount (owner = this pool PDA)
    pub reserve_a: [u8; 32],    // encrypted reserve mirror (EUint64)
    pub reserve_b: [u8; 32],    // encrypted reserve mirror (EUint64)
    pub total_supply: [u8; 32], // encrypted LP total supply (EUint64)
    pub is_initialized: u8,
    pub bump: u8,
}

impl Pool {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub fn from_bytes(d: &[u8]) -> Result<&Self, ProgramError> {
        if d.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &*(d.as_ptr() as *const Self) })
    }
    pub fn from_bytes_mut(d: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if d.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &mut *(d.as_mut_ptr() as *mut Self) })
    }
}

/// LP position — PDA: `["pc_lp", pool, owner]`.
/// pc-swap-internal accounting; not a real pc-token mint.
#[repr(C)]
pub struct LpPosition {
    pub pool: [u8; 32],
    pub owner: [u8; 32],
    pub balance: [u8; 32], // encrypted LP balance (EUint64)
    pub bump: u8,
}

impl LpPosition {
    pub const LEN: usize = core::mem::size_of::<Self>();
    pub fn from_bytes(d: &[u8]) -> Result<&Self, ProgramError> {
        if d.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &*(d.as_ptr() as *const Self) })
    }
    pub fn from_bytes_mut(d: &mut [u8]) -> Result<&mut Self, ProgramError> {
        if d.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        Ok(unsafe { &mut *(d.as_mut_ptr() as *mut Self) })
    }
}

fn minimum_balance(s: usize) -> u64 {
    (s as u64 + 128) * 6960
}

// ── FHE Graphs ──

/// Constant-product swap with 0.3% fee + slippage check.
///
/// `receipt` is pc-token's TransferWithReceipt output: it equals `amount_in`
/// on a successful user→vault deposit, exactly `0` on insufficient balance.
/// All reserve and payout updates are functions of `receipt`, never of the
/// user-supplied `amount_in` directly — so a lying user produces `receipt=0`
/// and every output is 0/no-op uniformly. `amount_in_ct` itself is passed
/// to pc-token (not pc-swap), so swap_graph cannot read it — `min_amount_out`
/// (always pc-swap-authorized) provides the typed zero source. On slippage
/// failure both `final_in` and `final_out` collapse to 0.
#[encrypt_fn]
fn swap_graph(
    reserve_in: EUint64,
    reserve_out: EUint64,
    receipt: EUint64,
    min_amount_out: EUint64,
) -> (EUint64, EUint64, EUint64, EUint64) {
    let amount_in_with_fee = receipt * 997;
    let numer = amount_in_with_fee * reserve_out;
    let denom = (reserve_in * 1000) + amount_in_with_fee;
    let amount_out = numer / denom;
    let slip_ok = amount_out >= min_amount_out;
    let zero = min_amount_out - min_amount_out;
    let final_in = if slip_ok { receipt } else { zero };
    let final_out = if slip_ok { amount_out } else { zero };
    let new_reserve_in = reserve_in + final_in;
    let new_reserve_out = reserve_out - final_out;
    (final_in, final_out, new_reserve_in, new_reserve_out)
}

/// Add liquidity — updates reserves, total supply, and user LP balance.
///
/// `receipt_a` / `receipt_b` are pc-token TransferWithReceipt outputs from
/// the two user→vault deposits (= amount on success, 0 on insufficient).
/// Reserves and LP updates are functions of the receipts only; if either
/// deposit no-ops the reserves and LP supply stay consistent.
///
/// First deposit: lp = receipt_a. Subsequent: proportional.
#[encrypt_fn]
fn add_liquidity_graph(
    reserve_a: EUint64,
    reserve_b: EUint64,
    total_supply: EUint64,
    receipt_a: EUint64,
    receipt_b: EUint64,
    user_lp: EUint64,
) -> (EUint64, EUint64, EUint64, EUint64, EUint64, EUint64) {
    let new_reserve_a = reserve_a + receipt_a;
    let new_reserve_b = reserve_b + receipt_b;
    let initial_lp = receipt_a;
    let lp_from_a = (receipt_a * total_supply) / (reserve_a + 1);
    let lp_from_b = (receipt_b * total_supply) / (reserve_b + 1);
    let subsequent_lp = if lp_from_a >= lp_from_b {
        lp_from_b
    } else {
        lp_from_a
    };
    let is_subsequent = total_supply >= 1;
    let lp_to_mint = if is_subsequent {
        subsequent_lp
    } else {
        initial_lp
    };
    let new_total_supply = total_supply + lp_to_mint;
    let new_user_lp = user_lp + lp_to_mint;
    (
        receipt_a,
        receipt_b,
        new_reserve_a,
        new_reserve_b,
        new_total_supply,
        new_user_lp,
    )
}

/// Remove liquidity — gates on user_lp >= burn. On insufficient LP, all
/// outputs are 0 → pc-token transfers no-op, reserves unchanged.
#[encrypt_fn]
fn remove_liquidity_graph(
    reserve_a: EUint64,
    reserve_b: EUint64,
    total_supply: EUint64,
    burn: EUint64,
    user_lp: EUint64,
) -> (EUint64, EUint64, EUint64, EUint64, EUint64, EUint64) {
    let sufficient = user_lp >= burn;
    let amount_a = (reserve_a * burn) / (total_supply + 1);
    let amount_b = (reserve_b * burn) / (total_supply + 1);
    let zero = burn - burn;
    let out_a = if sufficient { amount_a } else { zero };
    let out_b = if sufficient { amount_b } else { zero };
    let new_ra = if sufficient {
        reserve_a - out_a
    } else {
        reserve_a
    };
    let new_rb = if sufficient {
        reserve_b - out_b
    } else {
        reserve_b
    };
    let new_supply = if sufficient {
        total_supply - burn
    } else {
        total_supply
    };
    let new_user_lp = if sufficient { user_lp - burn } else { user_lp };
    (out_a, out_b, new_ra, new_rb, new_supply, new_user_lp)
}

// ── Dispatch ──

fn process_instruction(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    match data.split_first() {
        Some((&0, rest)) => create_pool(program_id, accounts, rest),
        Some((&1, rest)) => swap(accounts, rest),
        Some((&2, rest)) => add_liquidity(accounts, rest),
        Some((&4, rest)) => remove_liquidity(accounts, rest),
        Some((&5, rest)) => create_lp_position(program_id, accounts, rest),
        _ => Err(ProgramError::InvalidInstructionData),
    }
}

// ── Helpers ──

/// Build pc-token instruction account list. pc-token's encrypt CPI uses
/// `pc_token_program` as the caller and `pc_token_cpi_auth` as the cpi_authority.
fn pc_token_transfer_accounts<'a>(
    from_acct: &'a AccountView,
    to_acct: &'a AccountView,
    from_ct: &'a AccountView,
    to_ct: &'a AccountView,
    amt_ct: &'a AccountView,
    ep: &'a AccountView,
    cfg: &'a AccountView,
    dep: &'a AccountView,
    pc_token_cpi_auth: &'a AccountView,
    pc_token_program: &'a AccountView,
    nk: &'a AccountView,
    owner: &'a AccountView,
    evt: &'a AccountView,
    sys: &'a AccountView,
) -> ([InstructionAccount<'a>; 14], [&'a AccountView; 14]) {
    let metas = [
        InstructionAccount {
            address: from_acct.address(),
            is_writable: true,
            is_signer: false,
        },
        InstructionAccount {
            address: to_acct.address(),
            is_writable: true,
            is_signer: false,
        },
        InstructionAccount {
            address: from_ct.address(),
            is_writable: true,
            is_signer: false,
        },
        InstructionAccount {
            address: to_ct.address(),
            is_writable: true,
            is_signer: false,
        },
        InstructionAccount {
            address: amt_ct.address(),
            is_writable: true,
            is_signer: false,
        },
        InstructionAccount {
            address: ep.address(),
            is_writable: false,
            is_signer: false,
        },
        InstructionAccount {
            address: cfg.address(),
            is_writable: true,
            is_signer: false,
        },
        InstructionAccount {
            address: dep.address(),
            is_writable: true,
            is_signer: false,
        },
        InstructionAccount {
            address: pc_token_cpi_auth.address(),
            is_writable: false,
            is_signer: false,
        },
        InstructionAccount {
            address: pc_token_program.address(),
            is_writable: false,
            is_signer: false,
        },
        InstructionAccount {
            address: nk.address(),
            is_writable: false,
            is_signer: false,
        },
        // owner doubles as `payer` for pc-token's inner encrypt CPI, which marks it writable+signer.
        InstructionAccount {
            address: owner.address(),
            is_writable: true,
            is_signer: true,
        },
        InstructionAccount {
            address: evt.address(),
            is_writable: false,
            is_signer: false,
        },
        InstructionAccount {
            address: sys.address(),
            is_writable: false,
            is_signer: false,
        },
    ];
    let views = [
        from_acct,
        to_acct,
        from_ct,
        to_ct,
        amt_ct,
        ep,
        cfg,
        dep,
        pc_token_cpi_auth,
        pc_token_program,
        nk,
        owner,
        evt,
        sys,
    ];
    (metas, views)
}

fn cpi_pc_token_transfer<'a>(
    pc_token_program: &'a AccountView,
    pc_token_cpi_auth_bump: u8,
    metas: &[InstructionAccount; 14],
    views: &[&'a AccountView; 14],
    pool_signer: Option<&[Seed]>,
) -> ProgramResult {
    let data = [PC_TOKEN_IX_TRANSFER, pc_token_cpi_auth_bump];
    let ix = InstructionView {
        program_id: pc_token_program.address(),
        data: &data,
        accounts: metas,
    };
    match pool_signer {
        Some(seeds) => invoke_signed(&ix, views, &[Signer::from(seeds)]),
        None => invoke_signed(&ix, views, &[]),
    }
}

/// Build pc-token::TransferWithReceipt account list.
/// `target_program` becomes the new authorized of the receipt — pass
/// pc-swap's own program id (the `caller_program` AccountView) so the
/// receipt can be read by the swap_graph and closed by pc-swap.
#[allow(clippy::too_many_arguments)]
fn pc_token_transfer_with_receipt_accounts<'a>(
    from_acct: &'a AccountView,
    to_acct: &'a AccountView,
    from_ct: &'a AccountView,
    to_ct: &'a AccountView,
    amt_ct: &'a AccountView,
    receipt_ct: &'a AccountView,
    target_program: &'a AccountView,
    ep: &'a AccountView,
    cfg: &'a AccountView,
    dep: &'a AccountView,
    pc_token_cpi_auth: &'a AccountView,
    pc_token_program: &'a AccountView,
    nk: &'a AccountView,
    owner: &'a AccountView,
    evt: &'a AccountView,
    sys: &'a AccountView,
) -> ([InstructionAccount<'a>; 16], [&'a AccountView; 16]) {
    let metas = [
        InstructionAccount {
            address: from_acct.address(),
            is_writable: true,
            is_signer: false,
        },
        InstructionAccount {
            address: to_acct.address(),
            is_writable: true,
            is_signer: false,
        },
        InstructionAccount {
            address: from_ct.address(),
            is_writable: true,
            is_signer: false,
        },
        InstructionAccount {
            address: to_ct.address(),
            is_writable: true,
            is_signer: false,
        },
        InstructionAccount {
            address: amt_ct.address(),
            is_writable: true,
            is_signer: false,
        },
        // Receipt is a fresh keypair account that the encrypt SDK will create —
        // outer tx must include the keypair as a signer; we propagate that flag.
        InstructionAccount {
            address: receipt_ct.address(),
            is_writable: true,
            is_signer: true,
        },
        InstructionAccount {
            address: target_program.address(),
            is_writable: false,
            is_signer: false,
        },
        InstructionAccount {
            address: ep.address(),
            is_writable: false,
            is_signer: false,
        },
        InstructionAccount {
            address: cfg.address(),
            is_writable: true,
            is_signer: false,
        },
        InstructionAccount {
            address: dep.address(),
            is_writable: true,
            is_signer: false,
        },
        InstructionAccount {
            address: pc_token_cpi_auth.address(),
            is_writable: false,
            is_signer: false,
        },
        InstructionAccount {
            address: pc_token_program.address(),
            is_writable: false,
            is_signer: false,
        },
        InstructionAccount {
            address: nk.address(),
            is_writable: false,
            is_signer: false,
        },
        InstructionAccount {
            address: owner.address(),
            is_writable: true,
            is_signer: true,
        },
        InstructionAccount {
            address: evt.address(),
            is_writable: false,
            is_signer: false,
        },
        InstructionAccount {
            address: sys.address(),
            is_writable: false,
            is_signer: false,
        },
    ];
    let views = [
        from_acct,
        to_acct,
        from_ct,
        to_ct,
        amt_ct,
        receipt_ct,
        target_program,
        ep,
        cfg,
        dep,
        pc_token_cpi_auth,
        pc_token_program,
        nk,
        owner,
        evt,
        sys,
    ];
    (metas, views)
}

fn cpi_pc_token_transfer_with_receipt<'a>(
    pc_token_program: &'a AccountView,
    pc_token_cpi_auth_bump: u8,
    metas: &[InstructionAccount; 16],
    views: &[&'a AccountView; 16],
) -> ProgramResult {
    let data = [PC_TOKEN_IX_TRANSFER_WITH_RECEIPT, pc_token_cpi_auth_bump];
    let ix = InstructionView {
        program_id: pc_token_program.address(),
        data: &data,
        accounts: metas,
    };
    invoke_signed(&ix, views, &[])
}

// ── 0: CreatePool ──
//
// Accounts:
//   pool_acct (write, PDA),
//   mint_a, mint_b                       (pc-token Mints, read)
//   vault_a, vault_b                     (pc-token TokenAccount PDAs to be created, write)
//   vault_a_bal_ct, vault_b_bal_ct       (empty keypairs, signers, write)
//   reserve_a_ct, reserve_b_ct, total_supply_ct  (empty keypairs, signers, write)
//   ep, cfg, dep,
//   cpi_authority (pc-swap),
//   caller_program (pc-swap, == this program),
//   pc_token_cpi_auth, pc_token_program,
//   nk, payer, evt, sys,
//
// Data: [0, pool_bump, vault_a_bump, vault_b_bump, swap_cpi_bump, token_cpi_bump]
fn create_pool(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        pool_acct,
        mint_a,
        mint_b,
        vault_a,
        vault_b,
        vault_a_bal_ct,
        vault_b_bal_ct,
        ra_ct,
        rb_ct,
        ts_ct,
        ep,
        cfg,
        dep,
        cpi_authority,
        caller_program,
        pc_token_cpi_auth,
        pc_token_program,
        nk,
        payer,
        evt,
        sys,
        ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if data.len() < 6 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let pool_bump = data[0];
    let vault_a_bump = data[1];
    let vault_b_bump = data[2];
    let swap_cpi_bump = data[3];
    let token_cpi_bump = data[4];
    let _reserved = data[5];

    // 1) Create pool PDA
    let bb = [pool_bump];
    let pool_seeds = [
        Seed::from(b"pc_pool" as &[u8]),
        Seed::from(mint_a.address().as_ref()),
        Seed::from(mint_b.address().as_ref()),
        Seed::from(&bb),
    ];
    CreateAccount {
        from: payer,
        to: pool_acct,
        lamports: minimum_balance(Pool::LEN),
        space: Pool::LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&[Signer::from(&pool_seeds)])?;

    // 2) CPI pc-token::initialize_account for vault_a (owner = pool_acct PDA)
    cpi_pc_token_init_account(
        vault_a,
        mint_a,
        pool_acct,
        vault_a_bal_ct,
        ep,
        cfg,
        dep,
        pc_token_cpi_auth,
        pc_token_program,
        nk,
        payer,
        evt,
        sys,
        pc_token_program,
        vault_a_bump,
        token_cpi_bump,
    )?;

    // 3) CPI pc-token::initialize_account for vault_b
    cpi_pc_token_init_account(
        vault_b,
        mint_b,
        pool_acct,
        vault_b_bal_ct,
        ep,
        cfg,
        dep,
        pc_token_cpi_auth,
        pc_token_program,
        nk,
        payer,
        evt,
        sys,
        pc_token_program,
        vault_b_bump,
        token_cpi_bump,
    )?;

    // 4) Create pc-swap's encrypted mirrors (reserve_a, reserve_b, total_supply)
    let ctx = EncryptContext {
        encrypt_program: ep,
        config: cfg,
        deposit: dep,
        cpi_authority,
        caller_program,
        network_encryption_key: nk,
        payer,
        event_authority: evt,
        system_program: sys,
        cpi_authority_bump: swap_cpi_bump,
    };
    ctx.create_plaintext_typed::<Uint64>(&0u64, ra_ct)?;
    ctx.create_plaintext_typed::<Uint64>(&0u64, rb_ct)?;
    ctx.create_plaintext_typed::<Uint64>(&0u64, ts_ct)?;

    // 5) Write pool state
    let d = unsafe { pool_acct.borrow_unchecked_mut() };
    let pool = Pool::from_bytes_mut(d)?;
    pool.mint_a.copy_from_slice(mint_a.address().as_ref());
    pool.mint_b.copy_from_slice(mint_b.address().as_ref());
    pool.vault_a.copy_from_slice(vault_a.address().as_ref());
    pool.vault_b.copy_from_slice(vault_b.address().as_ref());
    pool.reserve_a.copy_from_slice(ra_ct.address().as_ref());
    pool.reserve_b.copy_from_slice(rb_ct.address().as_ref());
    pool.total_supply.copy_from_slice(ts_ct.address().as_ref());
    pool.is_initialized = 1;
    pool.bump = pool_bump;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn cpi_pc_token_init_account<'a>(
    ta_acct: &'a AccountView,
    mint_acct: &'a AccountView,
    owner: &'a AccountView,
    bal_ct: &'a AccountView,
    ep: &'a AccountView,
    cfg: &'a AccountView,
    dep: &'a AccountView,
    pc_token_cpi_auth: &'a AccountView,
    pc_token_program_caller: &'a AccountView,
    nk: &'a AccountView,
    payer: &'a AccountView,
    evt: &'a AccountView,
    sys: &'a AccountView,
    pc_token_program_target: &'a AccountView,
    ta_bump: u8,
    token_cpi_bump: u8,
) -> ProgramResult {
    let metas = [
        InstructionAccount {
            address: ta_acct.address(),
            is_writable: true,
            is_signer: false,
        },
        InstructionAccount {
            address: mint_acct.address(),
            is_writable: false,
            is_signer: false,
        },
        InstructionAccount {
            address: owner.address(),
            is_writable: false,
            is_signer: false,
        },
        InstructionAccount {
            address: bal_ct.address(),
            is_writable: true,
            is_signer: true,
        },
        InstructionAccount {
            address: ep.address(),
            is_writable: false,
            is_signer: false,
        },
        InstructionAccount {
            address: cfg.address(),
            is_writable: false,
            is_signer: false,
        },
        InstructionAccount {
            address: dep.address(),
            is_writable: true,
            is_signer: false,
        },
        InstructionAccount {
            address: pc_token_cpi_auth.address(),
            is_writable: false,
            is_signer: false,
        },
        InstructionAccount {
            address: pc_token_program_caller.address(),
            is_writable: false,
            is_signer: false,
        },
        InstructionAccount {
            address: nk.address(),
            is_writable: false,
            is_signer: false,
        },
        InstructionAccount {
            address: payer.address(),
            is_writable: true,
            is_signer: true,
        },
        InstructionAccount {
            address: evt.address(),
            is_writable: false,
            is_signer: false,
        },
        InstructionAccount {
            address: sys.address(),
            is_writable: false,
            is_signer: false,
        },
    ];
    let views = [
        ta_acct,
        mint_acct,
        owner,
        bal_ct,
        ep,
        cfg,
        dep,
        pc_token_cpi_auth,
        pc_token_program_caller,
        nk,
        payer,
        evt,
        sys,
    ];
    let data = [PC_TOKEN_IX_INIT_ACCT, ta_bump, token_cpi_bump];
    let ix = InstructionView {
        program_id: pc_token_program_target.address(),
        data: &data,
        accounts: &metas,
    };
    invoke_signed(&ix, &views, &[])
}

// ── 5: CreateLpPosition ──
fn create_lp_position(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    let [
        lp_acct,
        pool_acct,
        owner,
        balance_ct,
        ep,
        cfg,
        dep,
        cpi_authority,
        caller_program,
        nk,
        payer,
        evt,
        sys,
        ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let (lp_bump, cpi_bump) = (data[0], data[1]);

    let pd = unsafe { pool_acct.borrow_unchecked() };
    let pool = Pool::from_bytes(pd)?;
    if pool.is_initialized != 1 {
        return Err(ProgramError::UninitializedAccount);
    }

    let bb = [lp_bump];
    let seeds = [
        Seed::from(b"pc_lp" as &[u8]),
        Seed::from(pool_acct.address().as_ref()),
        Seed::from(owner.address().as_ref()),
        Seed::from(&bb),
    ];
    CreateAccount {
        from: payer,
        to: lp_acct,
        lamports: minimum_balance(LpPosition::LEN),
        space: LpPosition::LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&[Signer::from(&seeds)])?;

    let ctx = EncryptContext {
        encrypt_program: ep,
        config: cfg,
        deposit: dep,
        cpi_authority,
        caller_program,
        network_encryption_key: nk,
        payer,
        event_authority: evt,
        system_program: sys,
        cpi_authority_bump: cpi_bump,
    };
    ctx.create_plaintext_typed::<Uint64>(&0u64, balance_ct)?;

    let d = unsafe { lp_acct.borrow_unchecked_mut() };
    let lp = LpPosition::from_bytes_mut(d)?;
    lp.pool.copy_from_slice(pool_acct.address().as_ref());
    lp.owner.copy_from_slice(owner.address().as_ref());
    lp.balance.copy_from_slice(balance_ct.address().as_ref());
    lp.bump = lp_bump;
    Ok(())
}

// ── 1: Swap ──
//
// One-tx receipt-gated swap. The user→vault deposit goes through
// pc-token::TransferWithReceipt (disc 22), producing a binary receipt
// (= amount_in on success, 0 on insufficient balance) that becomes the
// only trusted input to swap_graph. Reserves and payout are functions
// of the receipt — a lying user produces receipt=0 and every output
// collapses to 0, leaving reserves and the user's out-account untouched.
//
// Accounts:
//   pool_acct (write),
//   user_in_acct, user_out_acct        (user's pc-token TokenAccounts)
//   vault_in_acct, vault_out_acct      (pool's pc-token vaults)
//   user_in_bal_ct, user_out_bal_ct    (cts referenced by user TAs)
//   vault_in_bal_ct, vault_out_bal_ct  (cts referenced by vault TAs)
//   reserve_in_ct, reserve_out_ct      (pc-swap's mirror, from pool)
//   amt_in_ct, min_out_ct, amt_out_ct  (user inputs + pre-allocated output)
//   receipt_ct                         (fresh keypair, signer)
//   ep, cfg, dep,
//   cpi_authority (pc-swap), caller_program (pc-swap),
//   pc_token_cpi_auth, pc_token_program,
//   nk, payer (signer), evt, sys
//
// Data: [1, swap_cpi_bump, token_cpi_bump, direction]
//   direction: 0 = A→B, 1 = B→A
fn swap(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        pool_acct,
        user_in_acct,
        user_out_acct,
        vault_in_acct,
        vault_out_acct,
        user_in_bal_ct,
        user_out_bal_ct,
        vault_in_bal_ct,
        vault_out_bal_ct,
        reserve_in_ct,
        reserve_out_ct,
        amt_in_ct,
        min_out_ct,
        amt_out_ct,
        receipt_ct,
        ep,
        cfg,
        dep,
        cpi_authority,
        caller_program,
        pc_token_cpi_auth,
        pc_token_program,
        nk,
        payer,
        evt,
        sys,
        ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if data.len() < 3 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let swap_cpi_bump = data[0];
    let token_cpi_bump = data[1];
    let direction = data[2];

    let pd = unsafe { pool_acct.borrow_unchecked() };
    let pool = Pool::from_bytes(pd)?;
    if pool.is_initialized != 1 {
        return Err(ProgramError::UninitializedAccount);
    }

    let (expected_vault_in, expected_vault_out, exp_reserve_in, exp_reserve_out) = if direction == 0
    {
        (
            &pool.vault_a,
            &pool.vault_b,
            &pool.reserve_a,
            &pool.reserve_b,
        )
    } else {
        (
            &pool.vault_b,
            &pool.vault_a,
            &pool.reserve_b,
            &pool.reserve_a,
        )
    };
    if vault_in_acct.address().as_ref() != expected_vault_in {
        return Err(ProgramError::InvalidArgument);
    }
    if vault_out_acct.address().as_ref() != expected_vault_out {
        return Err(ProgramError::InvalidArgument);
    }
    if reserve_in_ct.address().as_ref() != exp_reserve_in {
        return Err(ProgramError::InvalidArgument);
    }
    if reserve_out_ct.address().as_ref() != exp_reserve_out {
        return Err(ProgramError::InvalidArgument);
    }

    // 1) Hand amt_in_ct to pc-token, then CPI TransferWithReceipt (user → vault).
    //    target_program = pc-swap (caller_program) so the receipt is authorized
    //    back to us, readable by swap_graph and closeable below.
    let ctx = EncryptContext {
        encrypt_program: ep,
        config: cfg,
        deposit: dep,
        cpi_authority,
        caller_program,
        network_encryption_key: nk,
        payer,
        event_authority: evt,
        system_program: sys,
        cpi_authority_bump: swap_cpi_bump,
    };
    ctx.transfer_ciphertext(amt_in_ct, pc_token_program)?;
    let (metas, views) = pc_token_transfer_with_receipt_accounts(
        user_in_acct,
        vault_in_acct,
        user_in_bal_ct,
        vault_in_bal_ct,
        amt_in_ct,
        receipt_ct,
        caller_program,
        ep,
        cfg,
        dep,
        pc_token_cpi_auth,
        pc_token_program,
        nk,
        payer,
        evt,
        sys,
    );
    cpi_pc_token_transfer_with_receipt(pc_token_program, token_cpi_bump, &metas, &views)?;

    // 2) Run swap math against the receipt. final_in and final_out are 0 if
    //    the deposit no-op'd or slippage failed; reserves move in lockstep.
    ctx.swap_graph(
        reserve_in_ct,
        reserve_out_ct,
        receipt_ct,
        min_out_ct,
        min_out_ct,     // out 0: final_in (overwrites min_out_ct, used only for tracing)
        amt_out_ct,     // out 1: final_out
        reserve_in_ct,  // out 2: new_reserve_in
        reserve_out_ct, // out 3: new_reserve_out
    )?;

    // 3) Hand off final_out to pc-token, then CPI pc-token::transfer (vault → user) signed by pool PDA.
    ctx.transfer_ciphertext(amt_out_ct, pc_token_program)?;
    let bb = [pool.bump];
    let pool_seeds = [
        Seed::from(b"pc_pool" as &[u8]),
        Seed::from(pool.mint_a.as_ref()),
        Seed::from(pool.mint_b.as_ref()),
        Seed::from(&bb),
    ];
    let (metas, views) = pc_token_transfer_accounts(
        vault_out_acct,
        user_out_acct,
        vault_out_bal_ct,
        user_out_bal_ct,
        amt_out_ct,
        ep,
        cfg,
        dep,
        pc_token_cpi_auth,
        pc_token_program,
        nk,
        pool_acct,
        evt,
        sys,
    );
    cpi_pc_token_transfer(
        pc_token_program,
        token_cpi_bump,
        &metas,
        &views,
        Some(&pool_seeds),
    )?;

    // 4) Reclaim receipt rent. close_ciphertext signs as pc-swap's CPI auth and
    //    requires receipt.authorized == pc-swap, which holds (set by step 1).
    ctx.close_ciphertext(receipt_ct, payer)?;
    Ok(())
}

// ── 2: AddLiquidity ──
//
// Receipt-gated: each user→vault deposit goes through TransferWithReceipt;
// add_liquidity_graph reads both receipts as the trusted deposit amounts.
// If either deposit no-ops (insufficient balance), the corresponding
// receipt is 0 and reserves / LP supply stay consistent.
//
// Accounts:
//   pool_acct (write), lp_pos_acct (read),
//   user_a_acct, user_b_acct           (user's pc-token TAs)
//   vault_a_acct, vault_b_acct         (pool's pc-token vaults)
//   user_a_bal_ct, user_b_bal_ct, vault_a_bal_ct, vault_b_bal_ct,
//   reserve_a_ct, reserve_b_ct, total_supply_ct,
//   amt_a_ct, amt_b_ct, user_lp_ct,
//   receipt_a_ct, receipt_b_ct          (fresh keypairs, signers)
//   ep, cfg, dep,
//   cpi_authority (pc-swap), caller_program (pc-swap),
//   pc_token_cpi_auth, pc_token_program,
//   nk, payer (signer = user, also LP owner), evt, sys
//
// Data: [2, swap_cpi_bump, token_cpi_bump]
fn add_liquidity(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        pool_acct,
        lp_pos_acct,
        user_a_acct,
        user_b_acct,
        vault_a_acct,
        vault_b_acct,
        user_a_bal_ct,
        user_b_bal_ct,
        vault_a_bal_ct,
        vault_b_bal_ct,
        ra_ct,
        rb_ct,
        ts_ct,
        amt_a_ct,
        amt_b_ct,
        user_lp_ct,
        receipt_a_ct,
        receipt_b_ct,
        ep,
        cfg,
        dep,
        cpi_authority,
        caller_program,
        pc_token_cpi_auth,
        pc_token_program,
        nk,
        payer,
        evt,
        sys,
        ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let swap_cpi_bump = data[0];
    let token_cpi_bump = data[1];

    let pd = unsafe { pool_acct.borrow_unchecked() };
    let pool = Pool::from_bytes(pd)?;
    if pool.is_initialized != 1 {
        return Err(ProgramError::UninitializedAccount);
    }
    if vault_a_acct.address().as_ref() != &pool.vault_a {
        return Err(ProgramError::InvalidArgument);
    }
    if vault_b_acct.address().as_ref() != &pool.vault_b {
        return Err(ProgramError::InvalidArgument);
    }
    if ra_ct.address().as_ref() != &pool.reserve_a {
        return Err(ProgramError::InvalidArgument);
    }
    if rb_ct.address().as_ref() != &pool.reserve_b {
        return Err(ProgramError::InvalidArgument);
    }
    if ts_ct.address().as_ref() != &pool.total_supply {
        return Err(ProgramError::InvalidArgument);
    }

    let lpd = unsafe { lp_pos_acct.borrow_unchecked() };
    let lp_pos = LpPosition::from_bytes(lpd)?;
    if &lp_pos.pool != pool_acct.address().as_array() {
        return Err(ProgramError::InvalidArgument);
    }
    if &lp_pos.owner != payer.address().as_array() {
        return Err(ProgramError::InvalidArgument);
    }
    if user_lp_ct.address().as_ref() != &lp_pos.balance {
        return Err(ProgramError::InvalidArgument);
    }

    let ctx = EncryptContext {
        encrypt_program: ep,
        config: cfg,
        deposit: dep,
        cpi_authority,
        caller_program,
        network_encryption_key: nk,
        payer,
        event_authority: evt,
        system_program: sys,
        cpi_authority_bump: swap_cpi_bump,
    };

    // 1) Transfer A with receipt: user → vault_a, receipt authorized to pc-swap.
    ctx.transfer_ciphertext(amt_a_ct, pc_token_program)?;
    let (metas, views) = pc_token_transfer_with_receipt_accounts(
        user_a_acct,
        vault_a_acct,
        user_a_bal_ct,
        vault_a_bal_ct,
        amt_a_ct,
        receipt_a_ct,
        caller_program,
        ep,
        cfg,
        dep,
        pc_token_cpi_auth,
        pc_token_program,
        nk,
        payer,
        evt,
        sys,
    );
    cpi_pc_token_transfer_with_receipt(pc_token_program, token_cpi_bump, &metas, &views)?;

    // 2) Transfer B with receipt: user → vault_b.
    ctx.transfer_ciphertext(amt_b_ct, pc_token_program)?;
    let (metas, views) = pc_token_transfer_with_receipt_accounts(
        user_b_acct,
        vault_b_acct,
        user_b_bal_ct,
        vault_b_bal_ct,
        amt_b_ct,
        receipt_b_ct,
        caller_program,
        ep,
        cfg,
        dep,
        pc_token_cpi_auth,
        pc_token_program,
        nk,
        payer,
        evt,
        sys,
    );
    cpi_pc_token_transfer_with_receipt(pc_token_program, token_cpi_bump, &metas, &views)?;

    // 3) Run liquidity math against the receipts. Reserves, supply, and LP all
    //    update from receipts only — lying inputs collapse to 0 uniformly.
    ctx.add_liquidity_graph(
        ra_ct,
        rb_ct,
        ts_ct,
        receipt_a_ct,
        receipt_b_ct,
        user_lp_ct,
        amt_a_ct,   // out 0: final_a (overwrites amt_a_ct, for tracing)
        amt_b_ct,   // out 1: final_b
        ra_ct,      // out 2: new_reserve_a
        rb_ct,      // out 3: new_reserve_b
        ts_ct,      // out 4: new_total_supply
        user_lp_ct, // out 5: new_user_lp
    )?;

    // 4) Reclaim receipt rent.
    ctx.close_ciphertext(receipt_a_ct, payer)?;
    ctx.close_ciphertext(receipt_b_ct, payer)?;
    Ok(())
}

// ── 4: RemoveLiquidity ──
//
// Accounts: similar to AddLiquidity but vault → user, plus out_a_ct, out_b_ct.
// Data: [4, swap_cpi_bump, token_cpi_bump]
fn remove_liquidity(accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    let [
        pool_acct,
        lp_pos_acct,
        user_a_acct,
        user_b_acct,
        vault_a_acct,
        vault_b_acct,
        user_a_bal_ct,
        user_b_bal_ct,
        vault_a_bal_ct,
        vault_b_bal_ct,
        ra_ct,
        rb_ct,
        ts_ct,
        burn_ct,
        user_lp_ct,
        out_a_ct,
        out_b_ct,
        ep,
        cfg,
        dep,
        cpi_authority,
        caller_program,
        pc_token_cpi_auth,
        pc_token_program,
        nk,
        payer,
        evt,
        sys,
        ..,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    if data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let swap_cpi_bump = data[0];
    let token_cpi_bump = data[1];

    let pd = unsafe { pool_acct.borrow_unchecked() };
    let pool = Pool::from_bytes(pd)?;
    if pool.is_initialized != 1 {
        return Err(ProgramError::UninitializedAccount);
    }
    if vault_a_acct.address().as_ref() != &pool.vault_a {
        return Err(ProgramError::InvalidArgument);
    }
    if vault_b_acct.address().as_ref() != &pool.vault_b {
        return Err(ProgramError::InvalidArgument);
    }
    if ra_ct.address().as_ref() != &pool.reserve_a {
        return Err(ProgramError::InvalidArgument);
    }
    if rb_ct.address().as_ref() != &pool.reserve_b {
        return Err(ProgramError::InvalidArgument);
    }
    if ts_ct.address().as_ref() != &pool.total_supply {
        return Err(ProgramError::InvalidArgument);
    }

    let lpd = unsafe { lp_pos_acct.borrow_unchecked() };
    let lp_pos = LpPosition::from_bytes(lpd)?;
    if &lp_pos.pool != pool_acct.address().as_array() {
        return Err(ProgramError::InvalidArgument);
    }
    if &lp_pos.owner != payer.address().as_array() {
        return Err(ProgramError::InvalidArgument);
    }
    if user_lp_ct.address().as_ref() != &lp_pos.balance {
        return Err(ProgramError::InvalidArgument);
    }

    // 1) Run remove math: out_a/out_b are 0 if user_lp < burn → transfers no-op.
    let ctx = EncryptContext {
        encrypt_program: ep,
        config: cfg,
        deposit: dep,
        cpi_authority,
        caller_program,
        network_encryption_key: nk,
        payer,
        event_authority: evt,
        system_program: sys,
        cpi_authority_bump: swap_cpi_bump,
    };
    ctx.remove_liquidity_graph(
        ra_ct, rb_ct, ts_ct, burn_ct, user_lp_ct, out_a_ct, out_b_ct, ra_ct, rb_ct, ts_ct,
        user_lp_ct,
    )?;

    // 2) vault_a → user_a, signed by pool PDA
    let bb = [pool.bump];
    let pool_seeds = [
        Seed::from(b"pc_pool" as &[u8]),
        Seed::from(pool.mint_a.as_ref()),
        Seed::from(pool.mint_b.as_ref()),
        Seed::from(&bb),
    ];

    ctx.transfer_ciphertext(out_a_ct, pc_token_program)?;
    let (metas, views) = pc_token_transfer_accounts(
        vault_a_acct,
        user_a_acct,
        vault_a_bal_ct,
        user_a_bal_ct,
        out_a_ct,
        ep,
        cfg,
        dep,
        pc_token_cpi_auth,
        pc_token_program,
        nk,
        pool_acct,
        evt,
        sys,
    );
    cpi_pc_token_transfer(
        pc_token_program,
        token_cpi_bump,
        &metas,
        &views,
        Some(&pool_seeds),
    )?;

    // 3) vault_b → user_b
    ctx.transfer_ciphertext(out_b_ct, pc_token_program)?;
    let (metas, views) = pc_token_transfer_accounts(
        vault_b_acct,
        user_b_acct,
        vault_b_bal_ct,
        user_b_bal_ct,
        out_b_ct,
        ep,
        cfg,
        dep,
        pc_token_cpi_auth,
        pc_token_program,
        nk,
        pool_acct,
        evt,
        sys,
    );
    cpi_pc_token_transfer(
        pc_token_program,
        token_cpi_bump,
        &metas,
        &views,
        Some(&pool_seeds),
    )?;
    Ok(())
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::{add_liquidity_graph, remove_liquidity_graph, swap_graph};
    use encrypt_types::graph::{GraphNodeKind, get_node, parse_graph};
    use encrypt_types::identifier::*;
    use encrypt_types::types::FheType;

    fn run_mock(graph_fn: fn() -> Vec<u8>, inputs: &[u128], fhe_types: &[FheType]) -> Vec<u128> {
        let data = graph_fn();
        let pg = parse_graph(&data).unwrap();
        let num = pg.header().num_nodes() as usize;
        let mut digests: Vec<[u8; 32]> = Vec::with_capacity(num);
        let mut inp = 0usize;
        for i in 0..num {
            let n = get_node(pg.node_bytes(), i as u16).unwrap();
            let ft = FheType::from_u8(n.fhe_type()).unwrap_or(FheType::EUint64);
            let d = match n.kind() {
                k if k == GraphNodeKind::Input as u8 => {
                    let v = inputs[inp];
                    let t = fhe_types[inp];
                    inp += 1;
                    encode_mock_digest(t, v)
                }
                k if k == GraphNodeKind::Constant as u8 => {
                    let bw = ft.byte_width().min(16);
                    let off = n.const_offset() as usize;
                    let mut buf = [0u8; 16];
                    buf[..bw].copy_from_slice(&pg.constants()[off..off + bw]);
                    encode_mock_digest(ft, u128::from_le_bytes(buf))
                }
                k if k == GraphNodeKind::Op as u8 => {
                    let (a, b, c) = (
                        n.input_a() as usize,
                        n.input_b() as usize,
                        n.input_c() as usize,
                    );
                    if n.op_type() == 60 {
                        mock_select(&digests[a], &digests[b], &digests[c])
                    } else if b == 0xFFFF {
                        mock_unary_compute(
                            unsafe { core::mem::transmute(n.op_type()) },
                            &digests[a],
                            ft,
                        )
                    } else {
                        mock_binary_compute(
                            unsafe { core::mem::transmute(n.op_type()) },
                            &digests[a],
                            &digests[b],
                            ft,
                        )
                    }
                }
                k if k == GraphNodeKind::Output as u8 => digests[n.input_a() as usize],
                _ => panic!("bad node"),
            };
            digests.push(d);
        }
        (0..num)
            .filter(|&i| {
                get_node(pg.node_bytes(), i as u16).unwrap().kind() == GraphNodeKind::Output as u8
            })
            .map(|i| decode_mock_identifier(&digests[i]))
            .collect()
    }

    const T: FheType = FheType::EUint64;

    #[test]
    fn swap_basic() {
        // reserve_in, reserve_out, receipt, min_out
        let r = run_mock(swap_graph, &[1000, 2000, 100, 0], &[T, T, T, T]);
        // r = (final_in, final_out, new_reserve_in, new_reserve_out)
        assert_eq!(r[0], 100, "final_in == receipt on success");
        assert!(r[1] > 0, "final_out > 0");
        assert_eq!(r[2], 1100);
        assert!(r[2] * r[3] >= 1000 * 2000);
    }
    #[test]
    fn swap_slippage() {
        let r = run_mock(swap_graph, &[1000, 2000, 100, 999], &[T, T, T, T]);
        assert_eq!(r[0], 0);
        assert_eq!(r[1], 0);
        assert_eq!(r[2], 1000);
        assert_eq!(r[3], 2000);
    }
    #[test]
    fn swap_lying_user_receipt_zero() {
        // user claims amount_in=100 but transfer no-op'd → receipt=0.
        // Reserves must stay 1000/2000, payout must be 0.
        let r = run_mock(swap_graph, &[1000, 2000, 0, 0], &[T, T, T, T]);
        assert_eq!(r[0], 0, "final_in collapses with receipt=0");
        assert_eq!(r[1], 0, "final_out collapses with receipt=0");
        assert_eq!(r[2], 1000, "reserve_in untouched");
        assert_eq!(r[3], 2000, "reserve_out untouched");
    }

    #[test]
    fn add_liq_first() {
        // reserve_a, reserve_b, total_supply, receipt_a, receipt_b, user_lp
        let r = run_mock(
            add_liquidity_graph,
            &[0, 0, 0, 1000, 2000, 0],
            &[T, T, T, T, T, T],
        );
        // r = (final_a, final_b, new_reserve_a, new_reserve_b, new_total_supply, new_user_lp)
        assert_eq!(r[0], 1000);
        assert_eq!(r[1], 2000);
        assert_eq!(r[2], 1000);
        assert_eq!(r[3], 2000);
        assert_eq!(r[4], 1000, "supply = receipt_a on first deposit");
        assert_eq!(r[5], 1000);
    }
    #[test]
    fn add_liq_second() {
        let supply = 1000u128;
        let r = run_mock(
            add_liquidity_graph,
            &[1000, 2000, supply, 500, 1000, 0],
            &[T, T, T, T, T, T],
        );
        assert_eq!(r[0], 500);
        assert_eq!(r[1], 1000);
        assert_eq!(r[2], 1500);
        assert_eq!(r[3], 3000);
        assert!(r[4] > supply);
        assert!(r[5] > 0);
    }
    #[test]
    fn add_liq_lying_a_receipt_zero() {
        // user lied about token A: receipt_a=0, receipt_b=1000.
        // Reserves should advance only for B, LP should be 0 (lp_from_a=0 dominates min).
        let supply = 1000u128;
        let r = run_mock(
            add_liquidity_graph,
            &[1000, 2000, supply, 0, 1000, 0],
            &[T, T, T, T, T, T],
        );
        assert_eq!(r[0], 0);
        assert_eq!(r[1], 1000);
        assert_eq!(r[2], 1000);
        assert_eq!(r[3], 3000);
        assert_eq!(r[4], supply, "supply unchanged when lp_to_mint=0");
        assert_eq!(r[5], 0);
    }

    #[test]
    fn remove_liq_sufficient() {
        // reserves 10000/20000, supply 100, burn 50, user_lp 50
        let r = run_mock(
            remove_liquidity_graph,
            &[10000, 20000, 100, 50, 50],
            &[T, T, T, T, T],
        );
        assert!(r[0] > 0);
        assert!(r[1] > 0);
        assert_eq!(r[5], 0, "user lp drained");
    }
    #[test]
    fn remove_liq_insufficient() {
        let r = run_mock(
            remove_liquidity_graph,
            &[10000, 20000, 100, 50, 30],
            &[T, T, T, T, T],
        );
        assert_eq!(r[0], 0);
        assert_eq!(r[1], 0);
        assert_eq!(r[2], 10000);
        assert_eq!(r[3], 20000);
        assert_eq!(r[4], 100);
        assert_eq!(r[5], 30);
    }

    #[test]
    fn graph_shapes() {
        let g = swap_graph();
        let pg = parse_graph(&g).unwrap();
        assert_eq!(pg.header().num_inputs(), 4);
        assert_eq!(pg.header().num_outputs(), 4);
        let g = add_liquidity_graph();
        let pg = parse_graph(&g).unwrap();
        assert_eq!(pg.header().num_inputs(), 6);
        assert_eq!(pg.header().num_outputs(), 6);
        let g = remove_liquidity_graph();
        let pg = parse_graph(&g).unwrap();
        assert_eq!(pg.header().num_inputs(), 5);
        assert_eq!(pg.header().num_outputs(), 6);
    }
}
```
