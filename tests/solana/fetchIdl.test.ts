import { describe, it, expect, vi, afterEach } from "vitest";
import { inflateSync, zlibSync } from "fflate";
import { isLegacyIdl } from "@/types/idl";
import {
  sampleIdl,
  legacyIdl,
  compressedSampleIdl,
  buildIdlAccountData,
  legacyIdlAccountData,
  buildMetadataAccountData,
  buildMetadataIdlAccountData,
} from "../fixtures/compressedIdl";
import { fetchAccountsBatch } from "@/solana/fetchAccounts";

vi.mock("@/solana/fetchAccounts", () => ({
  fetchAccountsBatch: vi.fn(),
}));

/**
 * Test IDL decompression and parsing logic without making real RPC calls.
 * We test the core logic that fetchIdl relies on.
 */

describe("IDL PDA address derivation", () => {
  it("derives a deterministic IDL address for a given program ID", async () => {
    // We import lazily to avoid issues with ESM resolution in tests
    const { deriveIdlAddress } = await import("@/solana/fetchIdl");

    const programId = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    const address1 = await deriveIdlAddress(programId);
    const address2 = await deriveIdlAddress(programId);

    // Should be deterministic
    expect(address1).toBe(address2);
    // Should be a base58 string of reasonable length
    expect(address1.length).toBeGreaterThan(30);
    expect(address1.length).toBeLessThanOrEqual(44);
  });

  it("derives different addresses for different programs", async () => {
    const { deriveIdlAddress } = await import("@/solana/fetchIdl");

    const addr1 = await deriveIdlAddress(
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    );
    const addr2 = await deriveIdlAddress(
      "11111111111111111111111111111111",
    );

    expect(addr1).not.toBe(addr2);
  });
});

describe("IDL decompression", () => {
  it("decompresses zlib-compressed IDL data correctly", () => {
    const decompressed = inflateSync(compressedSampleIdl);
    const jsonStr = new TextDecoder().decode(decompressed);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.metadata.name).toBe("sample_program");
    expect(parsed.metadata.version).toBe("0.1.0");
    expect(parsed.instructions).toHaveLength(1);
    expect(parsed.accounts).toHaveLength(1);
  });

  it("correctly extracts compressed data from full account buffer", () => {
    const accountData = buildIdlAccountData(sampleIdl);

    // Read data_len from offset 40
    const dataLen = new DataView(
      accountData.buffer,
      accountData.byteOffset + 40,
      4,
    ).getUint32(0, true);

    // Extract and decompress
    const compressed = accountData.slice(44, 44 + dataLen);
    const decompressed = inflateSync(compressed);
    const parsed = JSON.parse(new TextDecoder().decode(decompressed));

    expect(parsed.metadata.name).toBe("sample_program");
    expect(parsed.metadata.spec).toBe("0.1.0");
  });
});

describe("IDL format detection", () => {
  it("detects v0.30+ IDL format (has metadata.spec)", () => {
    expect(isLegacyIdl(sampleIdl)).toBe(false);
  });

  it("detects legacy IDL format (no metadata.spec)", () => {
    expect(isLegacyIdl(legacyIdl)).toBe(true);
  });

  it("parses legacy IDL from compressed data", () => {
    const dataLen = new DataView(
      legacyIdlAccountData.buffer,
      legacyIdlAccountData.byteOffset + 40,
      4,
    ).getUint32(0, true);

    const compressed = legacyIdlAccountData.slice(44, 44 + dataLen);
    const decompressed = inflateSync(compressed);
    const parsed = JSON.parse(new TextDecoder().decode(decompressed));

    expect(parsed.name).toBe("legacy_program");
    expect(parsed.metadata.spec).toBeUndefined();
    expect(isLegacyIdl(parsed)).toBe(true);
  });
});

describe("Program Metadata IDL PDA derivation", () => {
  it("derives a deterministic canonical address", async () => {
    const { deriveMetadataIdlAddress } = await import("@/solana/fetchIdl");

    const programId = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
    const addr1 = await deriveMetadataIdlAddress(programId);
    const addr2 = await deriveMetadataIdlAddress(programId);

    expect(addr1).toBe(addr2);
    expect(addr1.length).toBeGreaterThan(30);
    expect(addr1.length).toBeLessThanOrEqual(44);
  });

  it("derives different addresses for different programs", async () => {
    const { deriveMetadataIdlAddress } = await import("@/solana/fetchIdl");

    const addr1 = await deriveMetadataIdlAddress(
      "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    );
    const addr2 = await deriveMetadataIdlAddress(
      "11111111111111111111111111111111",
    );

    expect(addr1).not.toBe(addr2);
  });

  it("derives the known canonical IDL address for drift v2", async () => {
    const { deriveMetadataIdlAddress } = await import("@/solana/fetchIdl");

    // Live mainnet Program Metadata IDL account for drift v2
    const addr = await deriveMetadataIdlAddress(
      "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH",
    );
    expect(addr).toBe("7DuBKBbixzCJEFgvAxpt7MCUuSwuY854iYJ4BLpzPEVt");
  });
});

describe("Program Metadata account parsing", () => {
  const RPC_URL = "http://localhost:8899";

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.mocked(fetchAccountsBatch).mockReset();
  });

  it("parses the 96-byte header fields", async () => {
    const { parseMetadataAccount } = await import("@/solana/fetchIdl");

    const payload = new Uint8Array([1, 2, 3, 4]);
    const data = buildMetadataAccountData(payload, {
      encoding: 1,
      compression: 2,
      format: 1,
      dataSource: 0,
    });

    const meta = parseMetadataAccount(data);
    expect(meta).not.toBeNull();
    expect(meta!.encoding).toBe(1);
    expect(meta!.compression).toBe(2);
    expect(meta!.format).toBe(1);
    expect(meta!.dataSource).toBe(0);
    expect(Array.from(meta!.payload)).toEqual([1, 2, 3, 4]);
  });

  it("returns null for a non-Metadata discriminator", async () => {
    const { parseMetadataAccount } = await import("@/solana/fetchIdl");

    const data = buildMetadataAccountData(new Uint8Array([1]), {
      discriminator: 1, // Buffer, not Metadata
    });
    expect(parseMetadataAccount(data)).toBeNull();
  });

  it("returns null for data shorter than the header", async () => {
    const { parseMetadataAccount } = await import("@/solana/fetchIdl");
    expect(parseMetadataAccount(new Uint8Array(95))).toBeNull();
  });

  it("respects dataLength and ignores trailing bytes", async () => {
    const { resolveMetadataIdl } = await import("@/solana/fetchIdl");

    const data = buildMetadataIdlAccountData(sampleIdl, { trailingBytes: 64 });
    const idl = await resolveMetadataIdl(data, sampleIdl.address, RPC_URL);

    expect(idl?.metadata?.name).toBe("sample_program");
  });

  it.each(["zlib", "gzip", "none"] as const)(
    "resolves a direct IDL with %s compression",
    async (compression) => {
      const { resolveMetadataIdl } = await import("@/solana/fetchIdl");

      const data = buildMetadataIdlAccountData(sampleIdl, { compression });
      const idl = await resolveMetadataIdl(data, sampleIdl.address, RPC_URL);

      expect(idl?.metadata?.name).toBe("sample_program");
      expect(idl?.instructions).toHaveLength(1);
    },
  );

  it("resolves a url data source by fetching the URL", async () => {
    const { resolveMetadataIdl } = await import("@/solana/fetchIdl");

    const url = "https://example.com/idl.json";
    const data = buildMetadataAccountData(
      zlibSync(new TextEncoder().encode(url)),
      { dataSource: 1 },
    );

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify(sampleIdl)),
    });
    vi.stubGlobal("fetch", fetchMock);

    const idl = await resolveMetadataIdl(data, sampleIdl.address, RPC_URL);

    expect(fetchMock).toHaveBeenCalledWith(url);
    expect(idl?.metadata?.name).toBe("sample_program");
  });

  it("resolves an external data source via account fetch", async () => {
    const { resolveMetadataIdl } = await import("@/solana/fetchIdl");

    // External payload: address (32) | offset u32 | length u32 (0 = None)
    const externalAddress = "SampLE1111111111111111111111111111111111111";
    const { getAddressEncoder, address } = await import("@solana/kit");
    const offset = 8;
    const externalPayload = new Uint8Array(40);
    externalPayload.set(getAddressEncoder().encode(address(externalAddress)), 0);
    new DataView(externalPayload.buffer).setUint32(32, offset, true);

    const data = buildMetadataAccountData(externalPayload, {
      dataSource: 2,
      compression: 2,
    });

    const compressed = zlibSync(
      new TextEncoder().encode(JSON.stringify(sampleIdl)),
    );
    const externalAccountData = new Uint8Array(offset + compressed.length);
    externalAccountData.set(compressed, offset);
    vi.mocked(fetchAccountsBatch).mockResolvedValue(
      new Map([
        [
          externalAddress,
          {
            address: externalAddress,
            data: externalAccountData,
            owner: "11111111111111111111111111111111",
            lamports: 0n,
            executable: false,
            space: BigInt(externalAccountData.length),
          },
        ],
      ]),
    );

    const idl = await resolveMetadataIdl(data, sampleIdl.address, RPC_URL);

    expect(fetchAccountsBatch).toHaveBeenCalledWith([externalAddress], RPC_URL);
    expect(idl?.metadata?.name).toBe("sample_program");
  });

  it("throws on yaml/toml formats", async () => {
    const { resolveMetadataIdl } = await import("@/solana/fetchIdl");

    const data = buildMetadataAccountData(new Uint8Array([1]), { format: 2 });
    await expect(
      resolveMetadataIdl(data, undefined, RPC_URL),
    ).rejects.toThrow(/format/i);
  });

  it("tryParseIdlFromAccount handles both layouts", async () => {
    const { tryParseIdlFromAccount } = await import("@/solana/fetchIdl");

    const base = {
      owner: "11111111111111111111111111111111",
      lamports: 0n,
      executable: false,
      space: 0n,
    };
    const fromMetadata = await tryParseIdlFromAccount(
      { ...base, address: "a", data: buildMetadataIdlAccountData(sampleIdl) },
      sampleIdl.address,
      RPC_URL,
    );
    const fromLegacy = await tryParseIdlFromAccount(
      { ...base, address: "b", data: buildIdlAccountData(sampleIdl) },
      sampleIdl.address,
      RPC_URL,
    );

    expect(fromMetadata?.metadata?.name).toBe("sample_program");
    expect(fromLegacy?.metadata?.name).toBe("sample_program");
  });
});
