import { deflateSync, gzipSync, zlibSync } from "fflate";
import type { Idl } from "@/types/idl";

/**
 * A minimal IDL for testing compression/decompression.
 */
export const sampleIdl: Idl = {
  address: "SampLE1111111111111111111111111111111111111",
  metadata: {
    name: "sample_program",
    version: "0.1.0",
    spec: "0.1.0",
  },
  instructions: [
    {
      name: "initialize",
      discriminator: [0, 1, 2, 3, 4, 5, 6, 7],
      accounts: [],
      args: [],
    },
  ],
  accounts: [
    {
      name: "myAccount",
      discriminator: [10, 20, 30, 40, 50, 60, 70, 80],
    },
  ],
  types: [
    {
      name: "myAccount",
      type: {
        kind: "struct",
        fields: [
          { name: "value", type: "u64" },
        ],
      },
    },
  ],
};

/**
 * The same IDL but in legacy format (no metadata.spec).
 */
export const legacyIdl: Idl = {
  metadata: {
    name: "legacy_program",
    version: "0.0.1",
  },
  name: "legacy_program",
  version: "0.0.1",
  instructions: [],
  accounts: [],
  types: [],
};

/**
 * Compress an IDL to a zlib blob, as it would appear on-chain.
 */
export function compressIdl(idl: Idl): Uint8Array {
  const jsonStr = JSON.stringify(idl);
  const jsonBytes = new TextEncoder().encode(jsonStr);
  return deflateSync(jsonBytes);
}

/**
 * Build a fake on-chain IDL account data buffer:
 *   8 bytes discriminator (zeros)
 *   32 bytes authority (zeros)
 *   4 bytes data_len (u32 LE)
 *   N bytes compressed IDL
 */
export function buildIdlAccountData(idl: Idl): Uint8Array {
  const compressed = compressIdl(idl);
  const total = 8 + 32 + 4 + compressed.length;
  const buf = new Uint8Array(total);

  // Write data_len at offset 40
  new DataView(buf.buffer).setUint32(40, compressed.length, true);

  // Write compressed data at offset 44
  buf.set(compressed, 44);

  return buf;
}

export const sampleIdlAccountData = buildIdlAccountData(sampleIdl);
export const legacyIdlAccountData = buildIdlAccountData(legacyIdl);
export const compressedSampleIdl = compressIdl(sampleIdl);

/**
 * Build a fake Program Metadata account data buffer (96-byte header):
 *   offset 0  - discriminator u8 (2 = Metadata)
 *   offset 1  - program pubkey (32, zeros)
 *   offset 33 - authority Option<pubkey> (32, zeros = None)
 *   offset 65 - mutable bool
 *   offset 66 - canonical bool
 *   offset 67 - seed [u8;16] utf8, zero-padded ("idl")
 *   offset 83 - encoding u8 (0 none, 1 utf8, 2 base58, 3 base64)
 *   offset 84 - compression u8 (0 none, 1 gzip, 2 zlib)
 *   offset 85 - format u8 (0 none, 1 json, 2 yaml, 3 toml)
 *   offset 86 - dataSource u8 (0 direct, 1 url, 2 external)
 *   offset 87 - dataLength u32 LE + 5 bytes padding
 *   offset 96 - payload
 */
export function buildMetadataAccountData(
  payload: Uint8Array,
  opts: {
    discriminator?: number;
    encoding?: number;
    compression?: number;
    format?: number;
    dataSource?: number;
    trailingBytes?: number;
  } = {},
): Uint8Array {
  const {
    discriminator = 2,
    encoding = 1,
    compression = 2,
    format = 1,
    dataSource = 0,
    trailingBytes = 0,
  } = opts;

  const buf = new Uint8Array(96 + payload.length + trailingBytes);
  buf[0] = discriminator;
  buf.set(new TextEncoder().encode("idl"), 67);
  buf[65] = 1; // mutable
  buf[66] = 1; // canonical
  buf[83] = encoding;
  buf[84] = compression;
  buf[85] = format;
  buf[86] = dataSource;
  new DataView(buf.buffer).setUint32(87, payload.length, true);
  buf.set(payload, 96);
  // trailing bytes stay zero — they must be ignored via dataLength
  return buf;
}

/**
 * Build a Program Metadata IDL account with direct, utf8 payload.
 */
export function buildMetadataIdlAccountData(
  idl: Idl,
  opts: { compression?: "none" | "gzip" | "zlib"; trailingBytes?: number } = {},
): Uint8Array {
  const { compression = "zlib", trailingBytes = 0 } = opts;
  const jsonBytes = new TextEncoder().encode(JSON.stringify(idl));
  const payload =
    compression === "none"
      ? jsonBytes
      : compression === "gzip"
        ? gzipSync(jsonBytes)
        : zlibSync(jsonBytes);
  const compressionCode = { none: 0, gzip: 1, zlib: 2 }[compression];
  return buildMetadataAccountData(payload, {
    compression: compressionCode,
    trailingBytes,
  });
}
