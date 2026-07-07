import type { Idl } from "@/types/idl";
import {
  getProgramDerivedAddress,
  getAddressEncoder,
  getAddressDecoder,
  getBase16Decoder,
  getBase58Decoder,
  getBase64Decoder,
  address,
  createAddressWithSeed,
} from "@solana/kit";
import { decompressSync } from "fflate";
import { fetchAccountsBatch } from "./fetchAccounts";
import type { FetchedAccount } from "./fetchAccount";
import { isLegacyFormat, convertLegacyIdl } from "@/engine/legacyIdlConverter";

/**
 * Derive the legacy Anchor IDL account address.
 *
 * Two-step derivation:
 *   1. base = PDA([], programId)
 *   2. idlAddress = createWithSeed(base, "anchor:idl", programId)
 */
export async function deriveIdlAddress(programId: string): Promise<string> {
  const programAddr = address(programId);

  const [base] = await getProgramDerivedAddress({
    programAddress: programAddr,
    seeds: [],
  });

  const idlAddr = await createAddressWithSeed({
    baseAddress: address(base),
    seed: "anchor:idl",
    programAddress: programAddr,
  });

  return idlAddr as string;
}

/**
 * The Program Metadata program (solana-program/program-metadata) — where
 * Anchor v1 publishes IDLs.
 */
const PROGRAM_METADATA_ID = "ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S";

/**
 * Derive the canonical Program Metadata IDL account address.
 *
 * Canonical PDA seeds: [programId, seed] where the seed string ("idl") is
 * zero-padded to a fixed 16 bytes.
 */
export async function deriveMetadataIdlAddress(
  programId: string,
): Promise<string> {
  const programBytes = getAddressEncoder().encode(address(programId));
  const seedBytes = new Uint8Array(16);
  seedBytes.set(new TextEncoder().encode("idl"));

  const [pda] = await getProgramDerivedAddress({
    programAddress: address(PROGRAM_METADATA_ID),
    seeds: [programBytes, seedBytes],
  });

  return pda as string;
}

/**
 * Parse compressed IDL data from an Anchor IDL account.
 *
 * Legacy Anchor IDL account layout:
 *   8 bytes  - discriminator
 *   32 bytes - authority pubkey
 *   4 bytes  - data_len (u32 LE)
 *   N bytes  - compressed IDL JSON (zlib or raw deflate)
 *
 * Total header before compressed data: 44 bytes
 */
export function parseAnchorIdlAccount(data: Uint8Array, programAddress?: string): Idl {
  const compressed = data.slice(44);
  const decompressed = decompressSync(compressed);
  return parseIdlJson(new TextDecoder().decode(decompressed), programAddress);
}

function parseIdlJson(jsonStr: string, programAddress?: string): Idl {
  const raw = JSON.parse(jsonStr);
  if (isLegacyFormat(raw)) return convertLegacyIdl(raw, programAddress);
  return raw as Idl;
}

/**
 * Program Metadata account layout (solana-program/program-metadata):
 *   offset 0   - discriminator u8 (2 = Metadata)
 *   offset 1   - program pubkey (32)
 *   offset 33  - authority Option<pubkey> (32, all-zeroes = None)
 *   offset 65  - mutable bool (1)
 *   offset 66  - canonical bool (1)
 *   offset 67  - seed [u8;16] utf8, zero-padded
 *   offset 83  - encoding u8 (0 none/hex, 1 utf8, 2 base58, 3 base64)
 *   offset 84  - compression u8 (0 none, 1 gzip, 2 zlib)
 *   offset 85  - format u8 (0 none, 1 json, 2 yaml, 3 toml)
 *   offset 86  - dataSource u8 (0 direct, 1 url, 2 external)
 *   offset 87  - dataLength u32 LE, then 5 bytes padding
 *   offset 96  - data (dataLength bytes)
 */
const METADATA_HEADER_SIZE = 96;
const METADATA_DISCRIMINATOR = 2;

const MetadataEncoding = { None: 0, Utf8: 1, Base58: 2, Base64: 3 } as const;
const MetadataCompression = { None: 0, Gzip: 1, Zlib: 2 } as const;
const MetadataFormat = { None: 0, Json: 1, Yaml: 2, Toml: 3 } as const;
const MetadataDataSource = { Direct: 0, Url: 1, External: 2 } as const;

interface MetadataAccountData {
  encoding: number;
  compression: number;
  format: number;
  dataSource: number;
  payload: Uint8Array;
}

/**
 * Parse the header of a Program Metadata account. Returns null if the data
 * is not a Metadata account (wrong discriminator or too short).
 */
export function parseMetadataAccount(data: Uint8Array): MetadataAccountData | null {
  if (data.length < METADATA_HEADER_SIZE || data[0] !== METADATA_DISCRIMINATOR) {
    return null;
  }
  const dataLength = new DataView(
    data.buffer,
    data.byteOffset + 87,
    4,
  ).getUint32(0, true);
  return {
    encoding: data[83],
    compression: data[84],
    format: data[85],
    dataSource: data[86],
    payload: data.slice(
      METADATA_HEADER_SIZE,
      METADATA_HEADER_SIZE + dataLength,
    ),
  };
}

function decodeMetadataContent(
  payload: Uint8Array,
  compression: number,
  encoding: number,
): string {
  // decompressSync auto-detects gzip vs zlib
  const bytes =
    compression === MetadataCompression.None ? payload : decompressSync(payload);
  switch (encoding) {
    case MetadataEncoding.None:
      return getBase16Decoder().decode(bytes);
    case MetadataEncoding.Base58:
      return getBase58Decoder().decode(bytes);
    case MetadataEncoding.Base64:
      return getBase64Decoder().decode(bytes);
    case MetadataEncoding.Utf8:
    default:
      return new TextDecoder().decode(bytes);
  }
}

/**
 * ExternalData payload: address (32) | offset u32 LE | length Option<u32> (0 = None)
 */
function parseExternalData(payload: Uint8Array): {
  address: string;
  offset: number;
  length: number | null;
} {
  if (payload.length < 40) {
    throw new Error("Program Metadata external data payload too short");
  }
  const view = new DataView(payload.buffer, payload.byteOffset);
  const length = view.getUint32(36, true);
  return {
    address: getAddressDecoder().decode(payload.slice(0, 32)) as string,
    offset: view.getUint32(32, true),
    length: length === 0 ? null : length,
  };
}

async function resolveMetadataContent(
  meta: MetadataAccountData,
  rpcUrl: string,
): Promise<string> {
  switch (meta.dataSource) {
    case MetadataDataSource.Direct:
      return decodeMetadataContent(meta.payload, meta.compression, meta.encoding);
    case MetadataDataSource.Url: {
      const url = decodeMetadataContent(meta.payload, meta.compression, meta.encoding);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch metadata content from ${url}: ${response.status}`);
      }
      return response.text();
    }
    case MetadataDataSource.External: {
      const external = parseExternalData(meta.payload);
      const accountMap = await fetchAccountsBatch([external.address], rpcUrl);
      const account = accountMap.get(external.address);
      if (!account) {
        throw new Error(`External metadata account ${external.address} not found`);
      }
      const sliced = account.data.slice(
        external.offset,
        external.length === null ? undefined : external.offset + external.length,
      );
      return decodeMetadataContent(sliced, meta.compression, meta.encoding);
    }
    default:
      throw new Error(`Unsupported metadata data source: ${meta.dataSource}`);
  }
}

/**
 * Resolve an IDL from a Program Metadata account, following url/external
 * data sources when needed. Returns null if the account is not a Metadata
 * account; throws on unresolvable/unsupported content.
 */
export async function resolveMetadataIdl(
  data: Uint8Array,
  programAddress: string | undefined,
  rpcUrl: string,
): Promise<Idl | null> {
  const meta = parseMetadataAccount(data);
  if (!meta) return null;
  if (meta.format === MetadataFormat.Yaml || meta.format === MetadataFormat.Toml) {
    throw new Error(`Unsupported metadata IDL format: ${meta.format} (only JSON is supported)`);
  }
  const content = await resolveMetadataContent(meta, rpcUrl);
  return parseIdlJson(content, programAddress);
}

/**
 * Try to parse an IDL from already-fetched account data.
 * Recognizes Program Metadata accounts by discriminator, otherwise falls
 * back to the legacy Anchor IDL account layout.
 */
export async function tryParseIdlFromAccount(
  account: FetchedAccount,
  programAddress: string | undefined,
  rpcUrl: string,
): Promise<Idl | null> {
  try {
    const metadataIdl = await resolveMetadataIdl(account.data, programAddress, rpcUrl);
    if (metadataIdl) return metadataIdl;
  } catch (err) { console.warn("Failed to parse IDL as Program Metadata format", err); }
  try {
    return parseAnchorIdlAccount(account.data, programAddress);
  } catch (err) { console.warn("Failed to parse IDL as legacy Anchor format", err); }
  return null;
}

/**
 * Fetch and decode an Anchor IDL from on-chain data.
 *
 * Derives both legacy + metadata IDL addresses and fetches them in a single
 * batched getMultipleAccounts call.
 */
export async function fetchIdl(
  programId: string,
  rpcUrl: string,
): Promise<Idl | null> {
  // Derive both addresses in parallel
  const derivations = await Promise.allSettled([
    deriveIdlAddress(programId),
    deriveMetadataIdlAddress(programId),
  ]);

  const addrsToFetch: string[] = [];
  let legacyAddr: string | null = null;
  let metaAddr: string | null = null;

  if (derivations[0].status === "fulfilled") {
    legacyAddr = derivations[0].value;
    addrsToFetch.push(legacyAddr);
  }
  if (derivations[1].status === "fulfilled") {
    metaAddr = derivations[1].value;
    addrsToFetch.push(metaAddr);
  }

  if (addrsToFetch.length === 0) return null;

  // Single batched RPC call for both IDL accounts
  const accountMap = await fetchAccountsBatch(addrsToFetch, rpcUrl);

  // Prefer the Program Metadata IDL (where Anchor v1 publishes) over the
  // legacy Anchor IDL account, which may be stale for migrated programs.
  if (metaAddr) {
    const account = accountMap.get(metaAddr);
    if (account) {
      try {
        const idl = await resolveMetadataIdl(account.data, programId, rpcUrl);
        if (idl) return idl;
      } catch (err) { console.warn(`Failed to parse metadata IDL for program ${programId}`, err); }
    }
  }

  if (legacyAddr) {
    const account = accountMap.get(legacyAddr);
    if (account) {
      try {
        return parseAnchorIdlAccount(account.data, programId);
      } catch (err) { console.warn(`Failed to parse legacy Anchor IDL for program ${programId}`, err); }
    }
  }

  return null;
}
