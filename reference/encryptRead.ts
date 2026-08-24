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
