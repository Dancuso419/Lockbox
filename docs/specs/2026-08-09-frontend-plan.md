# Frontend (M9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the organizer / recipient / public web UIs (light fintech dashboard) over the deployed contracts and the TEE extension, with a thin Go BFF that speaks the TEE `/action` protocol, so the PRD §9 demo runs end-to-end despite the FTDC-blocked on-chain instruction pipeline.

**Architecture:** React (Vite+TS, Tailwind+shadcn, viem/wagmi) → `TeeClient` (REST) → Go BFF (`go/cmd/bff`) → ext-proxy `/action`. Money ops go wallet→contracts directly. The TEE response envelope is hex-encoded JSON `DataFixed` (verified: `processorutils.Parse` = `json.Unmarshal`), `OriginalMessage` = ABI-packed via the existing `types.*Arg`. Confidentiality uses an ephemeral browser secp256k1 keypair (wallets can't ECIES-decrypt); identity is wallet `personal_sign`.

**Tech Stack:** Vite, React, TypeScript, TailwindCSS, shadcn/ui, viem, wagmi, `eciesjs`, `@noble/hashes`/`@noble/curves`; Go (BFF reuses `pkg/types`, `internal/config`). Node ≥ 20. Foundry for ABIs. Coston2: chainId 114, RPC `https://coston2-api.flare.network/ext/C/rpc`, explorer `https://coston2-explorer.flare.network`.

**Design ref:** `docs/specs/2026-08-09-frontend-design.md`

**Sequencing rationale:** Task 1 (crypto interop) is the #1 risk — do it first so a TS↔Go ECIES mismatch surfaces before any UI. Task 2 (BFF) unblocks the browser. Tasks 3–6 build the app. Task 7 memory.

---

### Task 1: Cross-language ECIES + challenge interop (the #1 risk)

Prove a browser ECIES library interoperates with Go `go-ethereum/crypto/ecies`, and that challenge strings + `personal_sign` recovery match Go. No UI yet.

**Files:**
- Create: `web/` (Vite scaffold — minimal, just enough to run Vitest)
- Create: `web/src/lib/ecies.ts`, `web/src/lib/challenge.ts`
- Create: `web/src/lib/ecies.interop.test.ts`, `web/src/lib/challenge.test.ts`
- Create: `go/cmd/eciesharness/main.go` (tiny CLI: encrypt/decrypt with a fixed key so the TS test can cross-check Go)

- [ ] **Step 1: Scaffold the web app + test runner**

```bash
cd F:/PROJECTS/LOCKBOX/fce-extension-scaffold
npm create vite@latest web -- --template react-ts
cd web && npm install && npm install -D vitest && npm install eciesjs @noble/curves @noble/hashes viem
```
Add to `web/package.json` scripts: `"test": "vitest run"`.

- [ ] **Step 2: Write `ecies.ts`**

```ts
// web/src/lib/ecies.ts
import { encrypt, decrypt, PrivateKey } from "eciesjs";

// eciesjs must be configured to match go-ethereum crypto/ecies:
// secp256k1, AES-128-GCM? — go-ethereum ecies default is AES-128-CTR + HMAC-SHA-256, ephemeral key,
// shared-secret via ECDH + KDF (NIST SP 800-56 Concatenation KDF). If eciesjs defaults differ,
// Task 1 Step 6 will FAIL and we pick a library/config that matches (see note in Step 6).

export type EphemeralKey = { privHex: string; pubHex: string };

export function newEphemeralKey(): EphemeralKey {
  const sk = new PrivateKey();
  return {
    privHex: "0x" + sk.secret.toString("hex"),
    pubHex: "0x" + sk.publicKey.toHex(false), // uncompressed 0x04...
  };
}

export function encryptToTee(teePubHex: string, plaintext: Uint8Array): Uint8Array {
  return encrypt(teePubHex.replace(/^0x/, ""), Buffer.from(plaintext));
}

export function decryptWith(privHex: string, ciphertext: Uint8Array): Uint8Array {
  return decrypt(privHex.replace(/^0x/, ""), Buffer.from(ciphertext));
}
```

- [ ] **Step 3: Write the Go interop harness**

```go
// go/cmd/eciesharness/main.go
// Usage:
//   eciesharness pub <privHex>                      -> prints uncompressed 0x04 pubkey
//   eciesharness enc <pubHex> <plaintextHex>        -> prints ciphertext hex (Go-encrypted)
//   eciesharness dec <privHex> <ciphertextHex>      -> prints decrypted plaintext hex
package main

import (
	"fmt"
	"os"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/crypto/ecies"
)

func main() {
	args := os.Args[1:]
	switch args[0] {
	case "pub":
		k, _ := crypto.HexToECDSA(strip(args[1]))
		fmt.Print("0x" + common.Bytes2Hex(crypto.FromECDSAPub(&k.PublicKey)))
	case "enc":
		pub, _ := crypto.UnmarshalPubkey(common.FromHex(args[1]))
		ct, err := ecies.Encrypt(cryptoRand(), ecies.ImportECDSAPublic(pub), common.FromHex(args[2]), nil, nil)
		must(err)
		fmt.Print("0x" + common.Bytes2Hex(ct))
	case "dec":
		k, _ := crypto.HexToECDSA(strip(args[1]))
		pt, err := ecies.ImportECDSA(k).Decrypt(common.FromHex(args[2]), nil, nil)
		must(err)
		fmt.Print("0x" + common.Bytes2Hex(pt))
	}
}

func strip(s string) string { if len(s) >= 2 && s[:2] == "0x" { return s[2:] }; return s }
func must(err error) { if err != nil { panic(err) } }
```
Note: import `crypto/rand` for `cryptoRand()` — replace `cryptoRand()` with `rand.Reader` and add the import. (Build: `cd go && go build -o ../bin/eciesharness.exe ./cmd/eciesharness`.)

- [ ] **Step 4: Write the ECIES interop test (TS ↔ Go both directions)**

```ts
// web/src/lib/ecies.interop.test.ts
import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";
import { encryptToTee, decryptWith, newEphemeralKey } from "./ecies";

const HARNESS = "../bin/eciesharness.exe"; // built from go/cmd/eciesharness
const PRIV = "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
function go(...a: string[]) { return execFileSync(HARNESS, a).toString().trim(); }

describe("ECIES TS<->Go interop", () => {
  const pub = go("pub", PRIV); // Go-derived uncompressed pubkey

  it("TS encrypts -> Go decrypts", () => {
    const msg = new TextEncoder().encode("hello-fxrp");
    const ct = encryptToTee(pub, msg);
    const back = go("dec", PRIV, "0x" + Buffer.from(ct).toString("hex"));
    expect(Buffer.from(back.replace(/^0x/, ""), "hex").toString()).toBe("hello-fxrp");
  });

  it("Go encrypts -> TS decrypts", () => {
    const ptHex = Buffer.from("hello-back").toString("hex");
    const ctHex = go("enc", pub, ptHex);
    const pt = decryptWith("0x" + PRIV, Buffer.from(ctHex.replace(/^0x/, ""), "hex"));
    expect(new TextDecoder().decode(pt)).toBe("hello-back");
  });
});
```

- [ ] **Step 5: Write `challenge.ts` + its test**

```ts
// web/src/lib/challenge.ts
export function claimChallenge(pool: string, ephemeralPubHex: string, claimAddr = ""): string {
  return `ConfidentialPrizePool claim\npool:${pool}\nkey:${ephemeralPubHex}\nclaim:${claimAddr}`;
}
export function unclaimedChallenge(pool: string, organizerPubHex: string): string {
  return `ConfidentialPrizePool unclaimed\npool:${pool}\nkey:${organizerPubHex}`;
}
```
```ts
// web/src/lib/challenge.test.ts
import { describe, it, expect } from "vitest";
import { claimChallenge } from "./challenge";
import { recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

describe("challenge parity", () => {
  it("personal_sign over the claim challenge recovers the signer (EIP-191)", async () => {
    const acct = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
    const pool = "0x0000000000000000000000000000000000000001";
    const msg = claimChallenge(pool, "0x04aa", "");
    const sig = await acct.signMessage({ message: msg });
    const rec = await recoverMessageAddress({ message: msg, signature: sig });
    expect(rec.toLowerCase()).toBe(acct.address.toLowerCase());
  });
});
```
The challenge strings MUST match `go/internal/extension/extension.go` byte-for-byte (claim: `"ConfidentialPrizePool claim\npool:...\nkey:...\nclaim:..."`; unclaimed: `"ConfidentialPrizePool unclaimed\npool:...\nkey:..."`). `pool` is the EIP-55 checksummed address (viem `getAddress`).

- [ ] **Step 6: Run the interop tests**

Run:
```bash
cd go && go build -o ../bin/eciesharness.exe ./cmd/eciesharness && cd ../web && npm test
```
Expected: PASS both directions + challenge parity.
**If ECIES fails:** `eciesjs` defaults do not match go-ethereum's ECIES (AES-128-CTR + HMAC-SHA-256 + NIST concat-KDF, no AEAD). Options in priority order: (a) configure `eciesjs` `ECIES_CONFIG` to secp256k1 + the matching symmetric scheme; (b) if no config matches, implement a minimal ECIES in TS with `@noble/curves/secp256k1` + `@noble/hashes` (ECDH → concat-KDF → AES-128-CTR + HMAC-SHA-256) mirroring go-ethereum. Do NOT proceed to other tasks until this test is green — it is the load-bearing interop guarantee.

- [ ] **Step 7: Commit**

```bash
git add web/ go/cmd/eciesharness/
git commit -m "feat(m9): TS<->Go ECIES + challenge interop (de-risk crypto)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
(`web/node_modules` must be gitignored — ensure `web/.gitignore` from the Vite template covers it.)

---

### Task 2: BFF service (`go/cmd/bff`)

Expose simple JSON REST endpoints, build the `Action` envelope, forward to ext-proxy `/action`, return the handler result.

**Files:**
- Create: `go/cmd/bff/main.go`
- Create: `go/cmd/bff/action.go` (envelope construction, unit-testable)
- Test: `go/cmd/bff/action_test.go`

- [ ] **Step 1: Write the envelope builder + failing test**

The extension expects `Action{ Data: ActionData{ Message: hexJSON(DataFixed{OPType,OPCommand,OriginalMessage,...}) } }`, and `OriginalMessage = abi.Arguments{types.XArg}.Pack(struct)`. Test that a built envelope decodes back correctly:

```go
// go/cmd/bff/action_test.go
package main

import (
	"testing"

	"extension-scaffold/internal/config"
	"extension-scaffold/pkg/types"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	"github.com/flare-foundation/tee-node/pkg/processorutils"
	"github.com/flare-foundation/tee-node/pkg/structs"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

func TestBuildAction_ClaimVerify_RoundTrips(t *testing.T) {
	pool := common.HexToAddress("0x1111111111111111111111111111111111111111")
	payload := []byte(`{"recipientPubHex":"0x04","challengeSig":"0x","claimAddress":""}`)
	msg := types.ClaimVerifyMessage{Payload: payload, Pool: pool}
	orig, err := abi.Arguments{types.ClaimVerifyArg}.Pack(msg)
	if err != nil { t.Fatal(err) }

	act := buildAction(config.OPTypePrizePool, config.OPCommandClaimVerify, orig)
	df, err := processorutils.Parse[instruction.DataFixed](act.Data.Message)
	if err != nil { t.Fatalf("parse DataFixed: %v", err) }
	if df.OPType != teeutils.ToHash(config.OPTypePrizePool) { t.Fatal("optype mismatch") }
	if df.OPCommand != teeutils.ToHash(config.OPCommandClaimVerify) { t.Fatal("opcommand mismatch") }

	var decoded types.ClaimVerifyMessage
	if err := structs.DecodeTo(types.ClaimVerifyArg, df.OriginalMessage, &decoded); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if decoded.Pool != pool || string(decoded.Payload) != string(payload) {
		t.Fatalf("roundtrip mismatch: %+v", decoded)
	}
}
```

- [ ] **Step 2: Run it, verify FAIL** (`buildAction` undefined)

Run: `cd go && go test ./cmd/bff/ -v`  → FAIL.

- [ ] **Step 3: Implement `action.go`**

```go
// go/cmd/bff/action.go
package main

import (
	"encoding/json"

	"extension-scaffold/internal/config"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

// buildAction wraps an ABI-packed originalMessage in the Action envelope the
// extension's /action handler expects (Data.Message = JSON-encoded DataFixed).
func buildAction(opType, opCommand string, originalMessage []byte) teetypes.Action {
	df := instruction.DataFixed{
		OPType:          teeutils.ToHash(opType),
		OPCommand:       teeutils.ToHash(opCommand),
		OriginalMessage: originalMessage,
	}
	msg, _ := json.Marshal(df)
	return teetypes.Action{Data: teetypes.ActionData{Message: msg}}
}

// packClaimVerify etc. pack the message struct via the shared types.*Arg.
func pack(arg abi.Argument, v interface{}) ([]byte, error) {
	return abi.Arguments{arg}.Pack(v)
}

var _ = config.Version // keep import if unused elsewhere
```

- [ ] **Step 4: Run it, verify PASS**

Run: `cd go && go test ./cmd/bff/ -v`  → PASS.

- [ ] **Step 5: Implement `main.go` (routes + forward + CORS)**

```go
// go/cmd/bff/main.go
package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"

	"extension-scaffold/internal/config"
	"extension-scaffold/pkg/types"

	"github.com/ethereum/go-ethereum/common"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
)

func extProxyURL() string { return os.Getenv("EXT_PROXY_URL") }
func allowedOrigin() string { if o := os.Getenv("ALLOWED_ORIGIN"); o != "" { return o }; return "*" }

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/submit-allocation", handleSubmitAllocation)
	mux.HandleFunc("POST /api/claim-verify", handleClaimVerify)
	mux.HandleFunc("POST /api/compliance-report", handleComplianceReport)
	mux.HandleFunc("POST /api/unclaimed-report", handleUnclaimedReport)
	mux.HandleFunc("GET /api/state", handleState)
	port := os.Getenv("BFF_PORT"); if port == "" { port = "8081" }
	log.Printf("BFF on :%s -> %s", port, extProxyURL())
	log.Fatal(http.ListenAndServe(":"+port, cors(mux)))
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", allowedOrigin())
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		if r.Method == http.MethodOptions { w.WriteHeader(http.StatusNoContent); return }
		next.ServeHTTP(w, r)
	})
}

// forward posts the Action to the ext-proxy and returns the handler's Data bytes.
func forward(w http.ResponseWriter, act teetypes.Action) {
	body, _ := json.Marshal(act)
	resp, err := http.Post(extProxyURL()+"/action", "application/json", bytes.NewReader(body))
	if err != nil { http.Error(w, "tee unavailable", http.StatusBadGateway); return }
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var ar teetypes.ActionResult
	if err := json.Unmarshal(raw, &ar); err != nil {
		// extension may return plain error text on non-OK
		http.Error(w, string(raw), http.StatusBadGateway); return
	}
	if ar.Status != 1 { http.Error(w, ar.Log, http.StatusBadRequest); return }
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(ar.Data) // handler result JSON (e.g. ClaimVerifyResult)
}

func handleClaimVerify(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Pool            string `json:"pool"`
		RecipientPubHex string `json:"recipientPubHex"`
		ChallengeSig    string `json:"challengeSig"`
		ClaimAddress    string `json:"claimAddress"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil { http.Error(w, "bad json", 400); return }
	payload, _ := json.Marshal(types.ClaimVerifyPayload{
		RecipientPubHex: in.RecipientPubHex, ChallengeSig: in.ChallengeSig, ClaimAddress: in.ClaimAddress,
	})
	orig, err := pack(types.ClaimVerifyArg, types.ClaimVerifyMessage{Payload: payload, Pool: common.HexToAddress(in.Pool)})
	if err != nil { http.Error(w, err.Error(), 500); return }
	forward(w, buildAction(config.OPTypePrizePool, config.OPCommandClaimVerify, orig))
}

// handleSubmitAllocation: in {pool, ciphertext(hex)} -> SubmitAllocationMessage{Ciphertext, Pool}
// handleComplianceReport: in {pool} -> ComplianceReportMessage{Pool}
// handleUnclaimedReport: in {pool, organizerPubHex, challengeSig} -> UnclaimedReportMessage{Payload, Pool}
// (each mirrors handleClaimVerify: decode -> pack via the matching types.*Arg -> forward)
// handleState: GET ext-proxy /state, pass through {signerAddress, signerPubKey}.
```
Implement the remaining three POST handlers following the `handleClaimVerify` shape (decode → build the matching message struct → `pack(types.XArg, msg)` → `forward(buildAction(...))`), and `handleState` (GET `extProxyURL()+"/state"`, copy the body through). For submit-allocation, `Ciphertext` is `common.FromHex(in.Ciphertext)`.

- [ ] **Step 6: Build + verify**

Run: `cd go && go build ./... && go test ./cmd/bff/`
Expected: builds, envelope test passes.
Manual smoke (services running): `EXT_PROXY_URL=<funnel> BFF_PORT=8081 go run ./cmd/bff` then `curl localhost:8081/api/state` returns the signer identity. (If the ext-proxy rejects the direct Action — e.g. requires signatures — capture a real `/action` request from the running stack and adjust `buildAction`'s `Data` fields; this is the one integration point flagged in the design.)

- [ ] **Step 7: Commit**

```bash
git add go/cmd/bff/
git commit -m "feat(m9): BFF — TEE action envelope + REST routes + CORS

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: App shell — wallet, contracts, TeeClient, routing, theme

**Files:**
- Create: `web/src/config.ts`, `web/src/lib/contracts.ts`, `web/src/lib/teeClient.ts`, `web/src/wagmi.ts`
- Modify: `web/src/App.tsx`, `web/src/main.tsx`
- Create: `web/src/abi/{Pool,PoolFactory}.json`
- Setup: Tailwind + shadcn/ui

- [ ] **Step 1: Tailwind + shadcn + deps**

```bash
cd web
npm install -D tailwindcss postcss autoprefixer && npx tailwindcss init -p
npm install @tanstack/react-query wagmi viem react-router-dom
npx shadcn@latest init   # choose defaults; light theme (design: light fintech)
npx shadcn@latest add button card input table badge sonner
```
Configure `tailwind.config.js` `content` to `./index.html` + `./src/**/*.{ts,tsx}`.

- [ ] **Step 2: Export ABIs from forge**

```bash
cd F:/PROJECTS/LOCKBOX/fce-extension-scaffold
/c/Users/DELL/.foundry/bin/forge build
# copy the abi arrays:
node -e "const p=require('./out/Pool.sol/Pool.json');require('fs').writeFileSync('web/src/abi/Pool.json',JSON.stringify(p.abi,null,2))"
node -e "const p=require('./out/PoolFactory.sol/PoolFactory.json');require('fs').writeFileSync('web/src/abi/PoolFactory.json',JSON.stringify(p.abi,null,2))"
```

- [ ] **Step 3: `config.ts` + `wagmi.ts` (Coston2)**

```ts
// web/src/config.ts
export const CONFIG = {
  bffUrl: import.meta.env.VITE_BFF_URL ?? "http://localhost:8081",
  poolFactory: import.meta.env.VITE_POOL_FACTORY as `0x${string}`, // deployed via M8 script
  rpcUrl: "https://coston2-api.flare.network/ext/C/rpc",
  explorer: "https://coston2-explorer.flare.network",
  chainId: 114,
};
```
```ts
// web/src/wagmi.ts
import { http, createConfig } from "wagmi";
import { defineChain } from "viem";
import { injected } from "wagmi/connectors";
import { CONFIG } from "./config";

export const coston2 = defineChain({
  id: 114, name: "Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: [CONFIG.rpcUrl] } },
  blockExplorers: { default: { name: "Coston2 Explorer", url: CONFIG.explorer } },
});
export const wagmiConfig = createConfig({
  chains: [coston2], connectors: [injected()], transports: { [coston2.id]: http(CONFIG.rpcUrl) },
});
```

- [ ] **Step 4: `teeClient.ts`**

```ts
// web/src/lib/teeClient.ts
import { CONFIG } from "../config";
async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(CONFIG.bffUrl + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.text()) || `TEE error ${r.status}`);
  return r.json() as Promise<T>;
}
export const TeeClient = {
  state: () => fetch(CONFIG.bffUrl + "/api/state").then(r => r.json()) as Promise<{ signerAddress: string; signerPubKey: string }>,
  submitAllocation: (pool: string, ciphertext: string) => post<{ ok: boolean; count: number }>("/api/submit-allocation", { pool, ciphertext }),
  claimVerify: (b: { pool: string; recipientPubHex: string; challengeSig: string; claimAddress: string }) => post<{ voucher: string }>("/api/claim-verify", b),
  complianceReport: (pool: string) => post<{ totalAllocated: string; recipientCount: number; signature: string }>("/api/compliance-report", { pool }),
  unclaimedReport: (b: { pool: string; organizerPubHex: string; challengeSig: string }) => post<{ report: string }>("/api/unclaimed-report", b),
};
```

- [ ] **Step 5: `contracts.ts` (typed read/write helpers)**

Export `poolFactoryConfig` (address + ABI) and helpers `readPool(address)` returning `{ organizer, asset, totalDeposited, totalClaimed, deadline, status, complianceReported, reportedTotalAllocated, reportedRecipientCount, authorizedSigner }` via viem `readContract` (or wagmi `useReadContracts`). Include write helpers thin-wrapping `writeContract` for `createPool`, `claim`, `publishComplianceReport`, `sweep`. Use the ABIs from Step 2.

- [ ] **Step 6: App shell + routing + providers**

`main.tsx` wraps `<WagmiProvider>` + `<QueryClientProvider>` + `<BrowserRouter>` + `<Toaster/>`. `App.tsx` renders a top bar (title + Connect button via `useConnect`/`useAccount`, with a "switch to Coston2" prompt when `chainId !== 114`) and routes: `/` (Public), `/organizer` (Organizer), `/claim` (Recipient). Light fintech styling: white bg, `bg-blue-600` primary, `font-sans`, cards for panels, `tabular-nums` for amounts.

- [ ] **Step 7: Verify it runs + commit**

Run: `cd web && npm run build` (typechecks + builds). Then `npm run dev` and confirm the shell loads, wallet connects, and network-switch prompt appears on the wrong chain.
```bash
git add web/ && git commit -m "feat(m9): app shell — wallet, contracts, TeeClient, routing, theme

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Public view (read-only)

**Files:** Create `web/src/routes/Public.tsx`, `web/src/components/PublicPoolCard.tsx`, `web/src/lib/compliance.ts`

- [ ] **Step 1: Compliance re-verification helper**

`compliance.ts`: `verifyCompliance(pool, totalDeposited, totalAllocated, recipientCount, signature, authorizedSigner)` — recompute the EIP-712 digest for `ComplianceReport(address pool,uint256 totalDeposited,uint256 totalAllocated,uint256 recipientCount)` (domain `ConfidentialPrizePool`/`1`/chainId 114/verifyingContract=pool) with viem `hashTypedData`, then `recoverAddress` and compare to `authorizedSigner`. Returns boolean.

- [ ] **Step 2: PublicPoolCard**

Given a pool address, read on-chain state (`readPool`), render: address (link to explorer), asset, status, deadline, `totalDeposited`/`totalClaimed`/`remaining` (formatted, `tabular-nums`); if `complianceReported`, show `reportedRecipientCount` recipients + `reportedTotalAllocated`, a "Compliance verified ✓/✗" badge from `verifyCompliance`, and render per-recipient amounts as a **"hidden"** row state (there is no on-chain per-recipient data — this is the point). Show recent `Claimed` events (viem `getLogs`) as aggregate activity.

- [ ] **Step 3: Public route**

`Public.tsx`: an input for a pool address (default from `?pool=` query or `PoolFactory.allPools(0)`), renders `PublicPoolCard`.

- [ ] **Step 4: Smoke test + commit**

`npm run build` passes; manual: paste a pool address, see totals + compliance badge. Component test (Vitest) for `verifyCompliance` with a known-good and a tampered signature.
```bash
git add web/ && git commit -m "feat(m9): public view — totals + client-verified compliance badge

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Recipient claim view

**Files:** Create `web/src/routes/Recipient.tsx`, `web/src/components/ClaimForm.tsx`

- [ ] **Step 1: Claim flow logic**

`ClaimForm`: inputs = pool address (+ optional "claim to a fresh address" toggle → address input, for M5 unlinkability). On "Get my prize":
1. `TeeClient.state()` → not needed for claim; skip.
2. `eph = newEphemeralKey()`.
3. `msg = claimChallenge(getAddress(pool), eph.pubHex, claimAddr)`.
4. `sig = await signMessageAsync({ message: msg })` (wagmi `useSignMessage`) — recovers to the connected wallet = identity.
5. `{ voucher } = await TeeClient.claimVerify({ pool, recipientPubHex: eph.pubHex, challengeSig: sig, claimAddress: claimAddr })`.
6. `vjson = decryptWith(eph.privHex, fromHex(voucher))` → `{ amount, nonce, signature }`.
7. Show the recipient **only their own amount** (formatted).
8. "Claim on-chain" → `writeContract` `pool.claim(amount, nonce, signature)` (from wallet, or instruct the user to switch to the fresh address if the toggle was used). Link the tx to the explorer.

- [ ] **Step 2: Errors**

Map BFF 400s (`not eligible`, `bad challenge sig`) to friendly messages; decrypt failure → "couldn't decrypt your voucher"; wrong network → prompt switch.

- [ ] **Step 3: Route + smoke + commit**

`Recipient.tsx` renders `ClaimForm`. `npm run build` passes.
```bash
git add web/ && git commit -m "feat(m9): recipient claim view — ephemeral key + voucher decrypt + claim

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Organizer view

**Files:** Create `web/src/routes/Organizer.tsx`, `web/src/components/{CreatePoolForm,AllocationForm,CompliancePanel,UnclaimedPanel}.tsx`

- [ ] **Step 1: CreatePoolForm**

Fields: asset (radio native / FXRP-or-custom-address), total (parse to token units — 18 for native, fetch `decimals()` for ERC-20), deadline (datetime → unix), `authorizedSigner` auto-filled from `TeeClient.state().signerAddress` (read-only display). On submit: if ERC-20, `writeContract` `approve(factory, total)` then `createPool(asset, total, deadline, signer)`; if native, `createPool` with `value`. Show the new pool address (from the tx receipt logs / `PoolCreated`) + explorer link.

- [ ] **Step 2: AllocationForm**

A table editor (recipient address, amount) + CSV paste. On submit: build `{ allocations: [{recipient, amount(base units)}] }`, `ct = encryptToTee(state.signerPubKey, utf8(json))`, `TeeClient.submitAllocation(pool, "0x"+hex(ct))`. Show returned count only. Never display amounts back from the server. Warn that amounts must be in base units (6 decimals for FXRP).

- [ ] **Step 3: CompliancePanel**

Button → `TeeClient.complianceReport(pool)` → `{ totalAllocated, recipientCount, signature }` → `writeContract` `publishComplianceReport(totalAllocated, recipientCount, signature)`. Show the resulting on-chain badge + explorer link.

- [ ] **Step 4: UnclaimedPanel (after deadline)**

`eph = newEphemeralKey()`; `msg = unclaimedChallenge(getAddress(pool), eph.pubHex)`; `sig = signMessage(msg)` (recovers to organizer); `{ report } = TeeClient.unclaimedReport({ pool, organizerPubHex: eph.pubHex, challengeSig: sig })`; `rows = JSON.parse(decryptWith(eph.privHex, fromHex(report)))` → render `{recipient, amount}` privately in the organizer's browser. Plus a **Sweep** button → `pool.sweep()`.

- [ ] **Step 5: Route + smoke + commit**

`Organizer.tsx` composes the four panels for a selected/created pool. `npm run build` passes.
```bash
git add web/ && git commit -m "feat(m9): organizer view — create/allocate/compliance/unclaimed/sweep

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Update memory

**Files:** Modify `C:/Users/DELL/.claude/projects/F--PROJECTS-LOCKBOX/memory/confidential-prize-pool.md`

- [ ] **Step 1: Record M9 completion**

Append an M9 status paragraph: M9 frontend done — light fintech dashboard (Vite+React+TS, Tailwind+shadcn, viem/wagmi), 3 views (organizer/recipient/public). Transport: Go BFF `go/cmd/bff` speaks the TEE /action protocol (envelope = hex JSON DataFixed, verified processorutils.Parse=json.Unmarshal; OriginalMessage = abi.Arguments{types.*Arg}.Pack) + CORS; money ops go wallet→contracts. Confidentiality: ephemeral browser secp256k1 key (wallets can't ECIES-decrypt), identity via wallet personal_sign (EIP-191 matches Go accounts.TextHash); allocation ECIES-encrypted client-side so BFF never sees amounts. #1 risk (TS↔Go ECIES interop) de-risked with `go/cmd/eciesharness` + web ecies.interop.test.ts. FTDC still blocks the on-chain InstructionSender path — BFF is the demo workaround, on-chain transport documented behind TeeClient seam. NOTE any ECIES-config adjustment made in Task 1 Step 6 (which library/scheme matched go-ethereum). Milestones done: M1–M9. Remaining: M10 demo. Deploy PoolFactory (M8 CreatePool/DeployPoolFactory scripts) + set VITE_POOL_FACTORY/VITE_BFF_URL for the demo.

- [ ] **Step 2: No commit** (memory is outside the repo tree).

---

## Self-Review Notes

- **Spec coverage:** §2 stack → Task 3; §3 BFF transport → Task 2; §4 crypto model → Task 1 (+ used in 5/6); §5.1 organizer → Task 6; §5.2 recipient → Task 5; §5.3 public → Task 4; §6 BFF API → Task 2; §7 testing (ECIES/challenge interop, BFF envelope, compliance verify) → Tasks 1, 2, 4. All mapped.
- **Placeholder scan:** high-risk modules (ecies, challenge, buildAction, teeClient, contracts, flows) have full code; UI component steps give exact wiring calls + libraries + acceptance checks rather than every JSX line (deliberate, since styling follows the approved fintech direction and shadcn primitives) — no "TBD"/"handle errors"-style gaps.
- **Type consistency:** `TeeClient` method shapes match the BFF routes (§6) and the Go handler result JSON (`{voucher}`, `{ok,count}`, `{totalAllocated,recipientCount,signature}`, `{report}`); `claimChallenge(pool,ephemeralPubHex,claimAddr)` matches the Go challenge string incl. the `\nclaim:` line; ECIES `newEphemeralKey/encryptToTee/decryptWith` used consistently in Tasks 5/6.
- **Sequencing/risk:** Task 1 gates everything on the ECIES interop test; Task 2's envelope is verified by round-trip through the real `processorutils.Parse`/`structs.DecodeTo`; the only residual integration unknown (ext-proxy accepting a direct Action) is isolated to Task 2 Step 6 with a concrete fallback (capture a real request).
- **No change to contracts/TEE handlers/existing Go packages** — BFF and eciesharness only import them; consistent with the design's out-of-scope list.
