# pc-wallet-kit

Integration kit for wallets adding confidential balances and a confidential swap on **Solana devnet**, built on Encrypt's `pc-token` and `pc-swap` programs.

**Pre-alpha. Devnet only. Not private yet.** Read [GUIDE.md §1](GUIDE.md#1-read-this-first--what-is-and-isnt-true-today) before anything else.

## For humans

- [**GUIDE.md**](GUIDE.md) — the integration guide: what's true today, devnet addresses, instruction layouts for wrap / reveal / send / swap / unwrap, settlement UX.
- [`devnet.json`](devnet.json) — every address and byte offset, with an `epoch` that bumps on each redeploy.

## For coding agents

Point your agent at one file:

```
https://raw.githubusercontent.com/inkwell-finance/pc-wallet-kit/main/llms-full.md
```

`llms-full.md` is the guide plus every reference source file inline (client, Encrypt gRPC-web closure, upstream instruction builders, both on-chain programs). It is self-contained; an agent can implement the full flow set from it without cloning.

## Layout

| Path | What |
|---|---|
| `reference/pcSwap.ts` | Browser-tested client: setup, wrap, swap, viewBalance, settlement waiters. Lifted verbatim from our demo app — imports (`./encryptRead`, `@encrypt.xyz/pre-alpha-solana-client/grpc-web`) need re-pointing at `vendor/encrypt/client/`. |
| `reference/encryptRead.ts` | BCS read-message encoding, ed25519 signing, `readCiphertext`, u64 decode. |
| `reference/SwapPage.tsx` | How the demo wires wallet `signTransaction` + `sendRawTransaction` and sequences wrap → swap → reveal. |
| `vendor/encrypt/client/` | The three-file gRPC-web client closure. Use this; the published npm package is broken as published. |
| `vendor/encrypt/examples/` | Upstream instruction builders and both on-chain programs — authoritative over the guide where they disagree. |
| `demo/` | The guided mock-wallet walkthrough from the call — interaction patterns for reveal, floor, ramp, settled states. Mock data only; see `demo/README.md`. |
| `THIRD-PARTY-NOTICES.md` | Encrypt files are BSD-3-Clause-Clear, dWallet Labs. |

Dependencies the reference code expects: `@solana/web3.js`, `@solana/spl-token`, `@noble/curves`, `@protobuf-ts/runtime`, `@protobuf-ts/runtime-rpc`, `@protobuf-ts/grpcweb-transport`.

## Test tokens

No public faucet yet. Send us the devnet pubkeys you want funded and we drip 1 000 mock-USDC + 1 000 mock-DOGE per wallet. `faucetUrl` in `devnet.json` becomes non-null when the public endpoint exists.

## Status and what's coming

**Epoch 2 (deployed 2026-10-20)** replaces the epoch 1 programs, which had program-level security holes, with patched builds at new addresses. Wrap and unwrap changed for clients; see [GUIDE.md "What changed in epoch 2"](GUIDE.md#what-changed-in-epoch-2). The epoch 1 addresses still exist on devnet but must not be used. No external audit has been done; this is a devnet preview holding no value. Encrypt Alpha 1 will wipe devnet state and every address. A packaged SDK (`wrap`/`unwrap`/`transfer`/`revealBalance`/`submitSwap`/`verifySwapOutcome`, typed errors, integration suite) is in progress and will land in this repo.

## License

Our own files (`GUIDE.md`, `llms-full.md`, `devnet.json`, `reference/`, `demo/`) are licensed under the [Apache License 2.0](LICENSE). Everything under `vendor/encrypt/` is derived from dWallet Labs' Encrypt and stays under BSD-3-Clause-Clear, including Inkwell's changes to those files (see `THIRD-PARTY-NOTICES.md`). Both licenses allow distribution through app stores and extension stores; the Clear variant grants no patent rights.
