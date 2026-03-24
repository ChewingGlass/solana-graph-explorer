import { getRpc } from "./rpc";
import {
  getBase58Decoder,
  getBase58Encoder,
  getBase64Encoder,
} from "@solana/kit";
import { mapRpcInstruction } from "./transactionMapping";
import type { ParsedTransaction, ParsedInstruction, InnerInstructionSet } from "@/types/transaction";

/**
 * Detect whether a string is base64-encoded (vs base58).
 * Base64 uses +, /, = which are not valid base58 chars.
 */
function isBase64(input: string): boolean {
  return /[+/=]/.test(input);
}

/**
 * Convert input string (base64 or base58) to a Uint8Array of message bytes.
 * In @solana/kit, "Encoder" converts string→bytes.
 */
function decodeInputToBytes(input: string): Uint8Array {
  if (isBase64(input)) {
    return new Uint8Array(getBase64Encoder().encode(input));
  }
  return new Uint8Array(getBase58Encoder().encode(input));
}

/**
 * Parse a v0 or legacy Solana transaction message from raw bytes.
 * Returns the static account addresses and parsed instructions.
 */
function parseMessageBytes(bytes: Uint8Array): {
  accountKeys: string[];
  instructions: ParsedInstruction[];
  numRequiredSignatures: number;
} {
  const b58Decoder = getBase58Decoder();
  let off = 0;

  // Version prefix: v0 messages start with 0x80
  const isVersioned = (bytes[0] & 0x80) !== 0;
  if (isVersioned) off++;

  // Header
  const numRequiredSignatures = bytes[off++];
  off++; // numReadonlySignerAccounts
  off++; // numReadonlyNonSignerAccounts

  // Static account keys
  const numAccounts = bytes[off++]; // compact-u16 (< 128 for all practical cases)
  const accountKeys: string[] = [];
  for (let i = 0; i < numAccounts; i++) {
    accountKeys.push(b58Decoder.decode(bytes.slice(off, off + 32)));
    off += 32;
  }

  // Skip blockhash (32 bytes)
  off += 32;

  // Instructions
  const numIx = bytes[off++];
  const instructions: ParsedInstruction[] = [];
  for (let i = 0; i < numIx; i++) {
    const programIdIndex = bytes[off++];
    const numIxAccounts = bytes[off++];
    const ixAccountIndices = Array.from(bytes.slice(off, off + numIxAccounts));
    off += numIxAccounts;
    const dataLen = bytes[off++];
    const data = dataLen > 0 ? b58Decoder.decode(bytes.slice(off, off + dataLen)) : "";
    off += dataLen;

    instructions.push({
      programId: accountKeys[programIdIndex] ?? String(programIdIndex),
      accounts: ixAccountIndices.map((idx) => accountKeys[idx] ?? `idx:${idx}`),
      data,
    });
  }

  return { accountKeys, instructions, numRequiredSignatures };
}

/**
 * Wrap raw message bytes into a full transaction wire format (base64).
 * Prepends the signature count + zero-filled signatures so the RPC can deserialize it.
 */
function wrapMessageAsTransaction(messageBytes: Uint8Array, numSignatures: number): string {
  const signaturesSize = numSignatures * 64;
  const wireBytes = new Uint8Array(1 + signaturesSize + messageBytes.length);
  wireBytes[0] = numSignatures; // compact-u16 for values < 128
  // Signature bytes default to 0 (unsigned)
  wireBytes.set(messageBytes, 1 + signaturesSize);
  // Convert to base64 in chunks to avoid stack overflow with large arrays
  let binary = "";
  for (let i = 0; i < wireBytes.length; i++) {
    binary += String.fromCharCode(wireBytes[i]);
  }
  return btoa(binary);
}

export interface SimulationResult {
  parsedTransaction: ParsedTransaction;
  computeUnits?: number;
}

/**
 * Simulate a raw encoded transaction message and return a ParsedTransaction.
 *
 * Accepts either a raw message (as Solana Explorer uses) or a full transaction.
 * Detects the format automatically: if first byte has high bit set (0x80 for v0),
 * it's a message; otherwise it might be a full transaction (starts with sig count).
 */
export async function simulateRawTransaction(
  rawInput: string,
  rpcUrl: string,
): Promise<SimulationResult> {
  const trimmed = rawInput.trim();
  const inputBytes = decodeInputToBytes(trimmed);

  // Detect if input is a message or full transaction.
  // V0 messages start with 0x80; legacy messages start with the header byte (numRequiredSignatures).
  // Full transactions start with a compact-u16 signature count.
  // Heuristic: if first byte has high bit set (≥ 0x80), it's a v0 message.
  // If first byte is small (1-20) and followed by 64*N bytes + 0x80, it could be a transaction.
  // For simplicity: try as message first (parse header), wrap and simulate.
  const isMessage = (inputBytes[0] & 0x80) !== 0 || inputBytes[0] <= 20;

  let messageBytes: Uint8Array;
  let base64Wire: string;

  if (isMessage) {
    messageBytes = inputBytes;
    const { numRequiredSignatures } = parseMessageBytes(messageBytes);
    base64Wire = wrapMessageAsTransaction(messageBytes, numRequiredSignatures);
  } else {
    // Assume full transaction - use as-is
    messageBytes = inputBytes;
    base64Wire = isBase64(trimmed) ? trimmed : btoa(String.fromCharCode(...inputBytes));
  }

  const { accountKeys, instructions } = parseMessageBytes(messageBytes);

  // Call simulateTransaction RPC
  const rpc = getRpc(rpcUrl);
  const simResult = await (rpc.simulateTransaction(base64Wire as Parameters<typeof rpc.simulateTransaction>[0], {
    encoding: "base64",
    replaceRecentBlockhash: true,
    sigVerify: false,
    innerInstructions: true,
    commitment: "confirmed",
  }) as { send(): Promise<{ value: Record<string, unknown>; context: Record<string, unknown> }> }).send();

  const value = simResult.value;

  // Map inner instructions from simulation result.
  // RPC may return jsonParsed or json format depending on the endpoint.
  // Use mapRpcInstruction which handles both.
  const rawInnerIxs = (value.innerInstructions ?? []) as {
    index: number | bigint;
    instructions: Record<string, unknown>[];
  }[];

  const innerInstructions: InnerInstructionSet[] = rawInnerIxs.map((set) => ({
    index: Number(set.index),
    instructions: (set.instructions ?? []).map((ix) => mapRpcInstruction(ix, accountKeys)),
  }));

  const logs = (value.logs as string[] | null) ?? [];
  const unitsConsumed = value.unitsConsumed != null ? Number(value.unitsConsumed) : undefined;

  const parsedTransaction: ParsedTransaction = {
    signature: "(simulated)",
    slot: 0,
    blockTime: null,
    err: value.err ?? null,
    fee: 0,
    accountKeys,
    instructions,
    innerInstructions,
    logMessages: logs,
    preBalances: [],
    postBalances: [],
    preTokenBalances: [],
    postTokenBalances: [],
  };

  return {
    parsedTransaction,
    computeUnits: unitsConsumed,
  };
}
