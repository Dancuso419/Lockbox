# Confidential Prize Pool — M9 Frontend Design

**Date:** 2026-08-09
**Scope:** BUILD.md M9 — organizer, recipient, and public web UIs over the deployed contracts and the TEE extension, driving the full demo narrative (PRD §9).
**Status:** Approved for planning.
**Network:** Coston2 (chain id 114).
**Companions:** contracts design `docs/specs/2026-08-05-confidential-prize-pool-contracts-design.md`; TEE handlers `docs/specs/2026-08-05-prize-pool-tee-handlers-design.md`; anonymous claims `docs/specs/2026-08-09-anonymous-claims-design.md`; multi-asset `docs/specs/2026-08-09-multi-asset-fxrp-design.md`.

## 1. Purpose & scope

A web frontend for the three audiences in BUILD.md M9: the **organizer** (create pool, submit allocation, trigger compliance, view the private non-claimant report, sweep), the **recipient** (claim their own allocation, seeing only their own amount), and the **public** (pool address, totals, compliance badge — no individual allocations). It must support the PRD §9 demo, whose wow-moment is on-chain money movement with on-chain-provable absence of allocation disclosure.

**Style:** light "fintech dashboard" — white/neutral surfaces, a blue accent, airy tables, generous whitespace (Stripe/Linear feel). Hidden amounts render as an explicit "hidden" state, not a decorative redaction. Tailwind + shadcn/ui.

**In scope:** the React app (3 views + wallet + contract calls), a `TeeClient` REST seam, and a thin Go **BFF** that speaks the TEE `/action` protocol; the crypto glue (ephemeral ECIES keypair, challenge strings) with cross-language interop tests.

**Out of scope:** the automated E2E walkthrough (that is M10, manual); decimals-aware localization beyond basic formatting; mobile-first polish (desktop demo target); changing any contract or TEE handler; live FTDC registration (blocked Flare-side — see §3).

## 2. Stack

Vite + React + TypeScript, Tailwind + shadcn/ui, viem + wagmi (wallet connect + contract reads/writes, injected/MetaMask, Coston2 chain id 114). ECIES via a browser secp256k1 library (`eciesjs` or `@noble/*`) chosen to interoperate with Go's `go-ethereum/crypto/ecies` (verified by the interop test in §7). BFF: Go, in the existing module (`go/cmd/bff`), reusing `pkg/types` and `internal/config` op constants.

## 3. Architecture & the TEE transport

The confidential ops (SUBMIT_ALLOCATION, CLAIM_VERIFY, COMPLIANCE_REPORT, UNCLAIMED_REPORT) normally travel on-chain: frontend → `InstructionSender.sendX` → data providers → TEE → result polled by `instructionId`. That on-chain delivery is exactly what the FTDC registration blocker breaks, so the demo cannot complete confidential steps through it today.

**Chosen transport: a thin Backend-for-Frontend (BFF).**
- The browser can't cleanly POST to the extension `/action` directly: (1) `/action` expects the full ABI-encoded `Action`/`DataFixed`/`OriginalMessage` envelope the on-chain pipeline produces — reimplementing that in TS duplicates the Go encoding; (2) the extension sets no CORS headers.
- The BFF (Go) exposes simple JSON REST endpoints, builds the `Action` envelope (reusing the Go `instruction`/`structs`/`types` packages), forwards to `EXT_PROXY_URL/action`, decodes the result, returns plain JSON, and handles CORS in one place.
- **Money ops stay client-side:** `createPool`, `claim`, `publishComplianceReport`, `sweep` go straight from the wallet (viem/wagmi) to the contracts. The BFF never holds keys or funds.
- The production on-chain `InstructionSender` transport remains the documented alternative behind the same `TeeClient` seam; only the transport implementation differs.

**The confidential compute is real** (real TEE, real ECIES, real EIP-712) — only the broken on-chain instruction *delivery* is bypassed for the demo.

Three units with clear boundaries: **React app** (UI + wallet + contract calls), **`TeeClient`** (typed REST wrapper), **BFF** (envelope construction + ext-proxy forwarding).

## 4. Crypto model (shapes two flows)

Recipients/organizers cannot ECIES-decrypt with their MetaMask key: wallets expose no secp256k1 ECIES decrypt, and `eth_decrypt` is a different, incompatible scheme (x25519/NaCl) from the Go handler's secp256k1 ECIES. Therefore:

- The browser generates an **ephemeral secp256k1 keypair per session** purely for confidentiality of the TEE response.
- Its pubkey is **bound into the signed challenge** (`key:<ephemeralPub>`), so the TEE encrypts the voucher/report to a key the challenge attests.
- **Identity/eligibility is the wallet `personal_sign`** over the challenge (EIP-191 `TextHash`, matching Go's `accounts.TextHash`); the recovered wallet address is the eligibility identity (recipient) or must equal `pool.organizer()` (unclaimed report).
- The browser decrypts the response with the ephemeral private key, held only in memory.

Allocation submission is encrypted in the **browser** to `/state.SignerPubKey` so the BFF never sees plaintext amounts (P1/P3 preserved end-to-end).

## 5. Views

Shared: wallet connect (Coston2), pool address entered or read from `PoolFactory.allPools`; TEE identity/pubkey from the extension `GET /state` (`SignerAddress`, `SignerPubKey`).

### 5.1 Organizer
- **Create pool** — asset (native or FXRP address), total, deadline; `authorizedSigner` auto-filled from `/state.SignerAddress`. Wallet: `approve` (ERC-20) then `PoolFactory.createPool`.
- **Submit allocation** — recipient→amount table/CSV; browser ECIES-encrypts the JSON table to `/state.SignerPubKey`; `TeeClient.submitAllocation({pool, ciphertext})`; shows returned count only (never the amounts).
- **Trigger compliance** — `TeeClient.complianceReport({pool})` → `{totalAllocated, recipientCount, signature}` → wallet `publishComplianceReport(...)`.
- **After deadline** — **non-claimant report**: ephemeral key + wallet-signed unclaimed challenge → `TeeClient.unclaimedReport` → browser decrypts the ECIES `[{recipient, amount}]`; **sweep**: wallet `pool.sweep()`.

### 5.2 Recipient
Enter pool + connect wallet. Flow: generate ephemeral key → build claim challenge (`pool`, `key:<ephemeralPub>`, optional `claim:<freshAddr>` toggle for M5 unlinkability) → wallet `personal_sign` → `TeeClient.claimVerify({pool, recipientPubHex, challengeSig, claimAddress})` → browser ECIES-decrypts `{amount, nonce, signature}` → shows the recipient **only their own amount** → wallet `pool.claim(amount, nonce, signature)` (from the wallet, or from the fresh address if the toggle is used).

### 5.3 Public (read-only, no wallet)
Pool metadata (address, asset, deadline, status), `totalDeposited`/`totalClaimed`/`remaining`; **compliance badge**: if `complianceReported`, show `reportedRecipientCount` + `reportedTotalAllocated` and **re-verify the attestation signature client-side** against `authorizedSigner` (recompute the EIP-712 digest, `ecrecover`). Individual amounts render as **hidden** — the on-chain-provable point that N recipients were allocated with amounts never on-chain. Recent `Claimed` events show aggregate movement.

## 6. BFF API

`go/cmd/bff` — CORS-enabled JSON over the four ops; each builds the `Action` envelope and forwards to `EXT_PROXY_URL/action`:
```
POST /api/submit-allocation   {pool, ciphertext}            -> {ok, count}
POST /api/claim-verify        {pool, recipientPubHex,
                               challengeSig, claimAddress}   -> {voucher}          (ECIES hex)
POST /api/compliance-report   {pool}                         -> {totalAllocated, recipientCount, signature}
POST /api/unclaimed-report    {pool, organizerPubHex,
                               challengeSig}                 -> {report}           (ECIES hex)
GET  /api/state                                              -> {signerAddress, signerPubKey}   (proxies /state)
```
Config from env: `EXT_PROXY_URL` (the Tailscale funnel), `BFF_PORT`, `ALLOWED_ORIGIN`. The BFF is stateless and key-free.

## 7. Testing

**The #1 risk is cross-language crypto interop** (same class as the EIP-712 voucher risk, and de-risked the same way — an explicit interop test):
- **ECIES:** TS-encrypt to a known pubkey → Go `signer.DecryptWithForTest` recovers the plaintext; Go `EncryptTo` → TS decrypts. Proves `ecies.ts` interoperates with `go-ethereum/crypto/ecies`. If the chosen library's scheme differs, this test fails loudly before anything else is built.
- **Challenge strings:** `challenge.ts` output is byte-identical to the Go handler; a `personal_sign` over it ecrecovers to the expected address (proves EIP-191 `TextHash` parity).

**Unit (Vitest + React Testing Library):** `ecies.ts` (roundtrip + Go interop vectors), `challenge.ts` (byte-match + recover), `teeClient.ts` (against a mocked BFF fetch). Component smoke tests for each form's validation and the public view's compliance re-verification.

**BFF (Go):** unit test that each route builds a well-formed `Action` envelope for its op (asserts OPType/OPCommand hashes and the ABI-encoded `OriginalMessage` decode back to the expected struct via the existing `structs.DecodeTo`); optional integration against a running extension.

**Contract correctness** is already covered by the 28 forge tests; the frontend calls them and is not re-tested for on-chain logic. **E2E** = the M10 manual walkthrough.

## 8. Error handling
- Wrong network → prompt switch to Coston2; rejected/failed tx → surface the revert reason.
- TEE status-0 (`not eligible`, `bad challenge sig`, `not organizer`, `allocation rejected`) → friendly, actionable messages.
- ECIES decrypt failure → "couldn't decrypt — wrong key or corrupted response."
- BFF/ext-proxy unreachable (funnel down) → clear "TEE unavailable" state; retry.
- Public view read failures → graceful empty states.

## 9. Risks / notes
- **BFF `Action` envelope format is the integration unknown:** the exact structure the ext-proxy/tee-node expects must be pinned in the plan by reading the tee-node action handler or capturing a real `/action` request. The BFF reuses the Go `instruction`/`structs`/`types` packages, so the encoding is at least type-safe; the wrapping is what must be confirmed.
- **FTDC still blocks the on-chain instruction path** — the BFF is the demo workaround, not a production replacement; the on-chain `InstructionSender` transport stays documented behind the `TeeClient` seam.
- **ECIES library choice** must match Go's scheme exactly (the §7 interop test is the gate).
- **Ephemeral-key UX:** the recipient's session key lives only in memory; a page refresh mid-claim requires re-running claim-verify (acceptable; documented in UI copy).
- **No new trust/privacy surface on-chain:** the BFF never holds keys or plaintext amounts (allocation encrypted client-side); P1–P5 hold.

## 10. File summary
```
web/                                  (Vite React app; 3 routes, TeeClient, ecies/challenge, contracts)
web/src/lib/{ecies,challenge,teeClient,contracts}.ts
web/src/routes/{Organizer,Recipient,Public}.tsx
web/src/components/*                  (shadcn/ui + view forms/panels)
go/cmd/bff/main.go                    (BFF: CORS + 4 op routes + /api/state, envelope construction)
docs/specs/2026-08-09-frontend-design.md   (this doc)
```
No change to `Pool.sol`, `PoolFactory.sol`, the TEE handlers, or any existing Go package (BFF only imports them). No new EIP-712.
