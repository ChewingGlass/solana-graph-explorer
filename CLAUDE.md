# Solana Account Graph Explorer

## Quick Reference
- **Stack**: Vite + React + TypeScript, @solana/kit, @xyflow/react (v12), fflate, Tailwind CSS v4 + shadcn/ui
- **Test**: `npx vitest run` — TDD for all engine/ and solana/ code
- **Dev**: `npm run dev`
- **No web3.js** — use @solana/kit exclusively
- **No zustand/redux** — React Context + useReducer only
- **Read-only** — no wallet connection

## Architecture
- `src/types/` — shared TypeScript types (idl.ts, graph.ts, relationships.ts)
- `src/solana/` — RPC, account fetching, IDL fetching/caching
- `src/engine/` — Borsh decoding, relationship inference, graph building
- `src/components/` — React components (SearchBar, GraphCanvas, AccountNode, etc.)
- `src/contexts/` — GraphContext (graph state), SettingsContext (RPC endpoint + user rels)
- `tests/` — vitest tests with fixtures

## Key Conventions
- Path alias: `@/` maps to `src/`
- Anchor IDL PDA seeds: `["anchor:idl", programId]`
- Anchor v1 IDLs live in the Program Metadata program (`ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S`); canonical PDA seeds `[programId, "idl" zero-padded to 16 bytes]`, 96-byte header (see `src/solana/fetchIdl.ts`) — preferred over the legacy IDL account when both exist
- IDL v0.30+ detection: presence of `metadata.spec` field
- Relationship types: has_one, pda_seed, token, user_defined
- BorshReader uses @solana/kit codecs (getU8Decoder, getAddressDecoder, etc.)
- fflate for IDL decompression (not pako)

## PDA Explorer Feature
A "Program Browser" panel that remembers visited programs and lets users derive + look up accounts via PDA seeds.

### Data Model
- `ProgramEntry`: { programId, programName, idlFetchedAt, idl (cached) }
- `PdaDefinition`: extracted from IDL instruction accounts that have `pda` field — unique by seeds signature
- Persisted to localStorage via `src/utils/localStorage.ts`

### Seed Input Handling
- Each PDA seed rendered as a form field based on its `kind`:
  - `const` → pre-filled, read-only
  - `account` → pubkey input (base58 address field)
  - `arg` → typed input based on the arg's type from the instruction
- **Buffer/bytes seeds**: input field + encoding selector dropdown (utf8, hex, base58, base64)
  - Encoding conversion happens at derivation time in `src/engine/pdaDeriver.ts`

### Files
- `src/types/pdaExplorer.ts` — ProgramEntry, PdaDefinition, SeedInput types
- `src/engine/pdaDeriver.ts` — extract unique PDAs from IDL, derive address from seed inputs, buffer encoding
- `src/utils/localStorage.ts` — persist/load ProgramEntry[] (extended from existing)
- `src/components/ProgramBrowser.tsx` — sidebar list of saved programs, refresh button, delete
- `src/components/PdaExplorer.tsx` — select PDA, fill seed form, derive + fetch + add to graph
- `src/components/SeedInput.tsx` — single seed field component (handles pubkey, number, buffer+encoding)
- `src/contexts/SettingsContext.tsx` — extended with savedPrograms state
- `tests/engine/pdaDeriver.test.ts` — TDD for PDA extraction, derivation, buffer encoding

### Flow
1. User explores an account → program IDL fetched → program auto-saved to browser
2. User opens Program Browser → sees list of visited programs with names
3. User clicks program → sees all unique PDA definitions (deduplicated across instructions)
4. User selects a PDA → seed form rendered dynamically
5. User fills seeds (buffer fields get encoding selector) → "Derive & Fetch" button
6. Derived address fetched, decoded, added to graph

## Settings Import/Export
- All settings (rules, programs, address labels, PDA searches, bytes encodings, RPC config) can be exported as JSON via the download button in the header and imported via the upload button.
- `useSettings().exportSettings()` returns JSON string, `importSettings(json)` restores all state + localStorage.

## Puppeteer / Browser Testing
When using puppeteer to test the app, the browser session has its own localStorage that is separate from the user's real browser. **Before clearing the session or restarting the browser**, you MUST:
1. Export the current configuration: run `exportSettings()` via puppeteer evaluate and save the result to `test-configuration.json` in the project root
2. After the new session starts, import it back by reading `test-configuration.json` and calling `importSettings(json)` via puppeteer evaluate

This prevents loss of the user's saved programs, rules, address labels, and PDA searches during testing.

## Patterns
- All engine code is pure/deterministic — test with vitest
- React Flow nodes typed as `AccountNode`, edges as `AccountEdge`
- Graph state managed via useReducer in GraphContext
- RPC endpoint selector stores in SettingsContext + localStorage
