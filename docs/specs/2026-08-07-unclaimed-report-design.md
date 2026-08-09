# Confidential Prize Pool — M7 Unclaimed Report Design

**Date:** 2026-08-07
**Scope:** BUILD.md M7 (FR5 / P2) — `UNCLAIMED_REPORT`: organizer privately retrieves the list of recipients who have **not** claimed, with their unclaimed amounts, after the deadline. Nothing is published on-chain.
**Status:** Approved for planning.
**Network:** Coston2 (chain id 114).
**Companions:** contracts `docs/specs/2026-08-05-confidential-prize-pool-contracts-design.md`; TEE handlers `docs/specs/2026-08-05-prize-pool-tee-handlers-design.md`; compliance `docs/specs/2026-08-07-compliance-report-design.md`.

## 1. Purpose & scope

After a distribution runs its course, the organizer wants to know who still hasn't claimed (to remind them, or to plan a sweep). The claimed/unclaimed status is knowable on-chain (`Pool.usedNonce(nonce)`), but the *mapping* nonce→recipient→amount lives only in the TEE. So the TEE joins its private allocation table against on-chain claim status and returns the non-claimant list — **encrypted to the organizer only**.

**In scope:** the `UNCLAIMED_REPORT` Go handler; `chain.Reader` additions `UsedNonce` + `Organizer`; an `Entries` iterator on `allocations.Store`; op-command wiring (`config.go`, `InstructionSender.sol`, `types.go`); Go unit tests.

**Out of scope:** any on-chain publication (this report is private, contract untouched); M5 anonymity; M8 multi-asset; live FTDC registration (blocked Flare-side; unit tests cover correctness now). No new Solidity in `Pool.sol` — M7 is read-only against existing state.

## 2. Key decisions (all approved)

1. **Report contents:** per non-claimant `{recipient, amount}`. The organizer already knows the total; the value is the *who*.
2. **Source of claim status:** on-chain `Pool.usedNonce(nonce)` per allocation entry — the authoritative signal. The unused `Entry.Claimed` in-memory flag is NOT trusted (the TEE never observes claims directly; claims happen on-chain via voucher). Claimed = `usedNonce(entry.Nonce) == true`.
3. **Auth = caller must be the organizer, AND encrypt to them.** The instruction carries a signed challenge; the TEE ecrecovers the caller, reads `Pool.organizer()` on-chain, requires `caller == organizer`, then ECIES-encrypts the result to the caller's pubkey. Two independent guards: identity check + confidentiality.
4. **No TEE deadline enforcement.** This is the organizer's own private data; gating it on a TEE-trusted clock buys nothing (YAGNI) and adds a chain read + clock-trust surface. The organizer decides when to ask.
5. **Nothing on-chain.** No event, no storage, no `Pool.sol` change. The result is returned via the action result, ECIES-encrypted — same confidentiality model as `CLAIM_VERIFY`'s voucher.

## 3. Data flow

```
organizer → InstructionSender.sendUnclaimedReport(pool, payload)     (on-chain instruction)
          → data providers → TEE UNCLAIMED_REPORT handler
              challenge = "ConfidentialPrizePool unclaimed\npool:<pool>\nkey:<organizerPubHex>"
              caller = ecrecover(TextHash(challenge), challengeSig)
              require caller == chain.Organizer(pool)                 (else status 0)
              for each (recipient, entry) in store.Entries(pool):
                  if !chain.UsedNonce(pool, entry.Nonce):
                      unclaimed += {recipient, amount: entry.Amount}
              ciphertext = ECIES.EncryptTo(organizerPubHex, json(unclaimed))
          → result { report: "0x"+hex(ciphertext) }                  (encrypted; nothing readable on-chain)
organizer → ECIES.Decrypt(ciphertext) with their private key → non-claimant list
```

Mirrors `CLAIM_VERIFY` exactly (signed challenge → ecrecover → private-store join → ECIES to caller), with the identity requirement flipped from "recipient in table" to "caller == organizer".

## 4. Components

### go/internal/allocations/store.go (add)
```go
// RecipientEntry is one row of a pool's table, with the recipient key attached.
type RecipientEntry struct {
    Recipient common.Address
    Amount    *big.Int
    Nonce     *big.Int
}

// Entries returns every allocation row for a pool (copies; caller-safe).
func (s *Store) Entries(pool common.Address) ([]RecipientEntry, bool)
```
Read-locked; returns `ok=false` for an unknown pool. Copies `Amount`/`Nonce` so callers can't mutate the store.

### go/internal/chain/reader.go (add)
```go
func (r *Reader) Organizer(ctx context.Context, pool common.Address) (common.Address, error)
// selector("organizer()"); out[12:32] -> address

func (r *Reader) UsedNonce(ctx context.Context, pool common.Address, nonce *big.Int) (bool, error)
// selector("usedNonce(uint256)") ‖ leftPad32(nonce); out[31] != 0 -> true
```
Same `CallContract` + 4-byte-selector pattern as `TotalDeposited`. `usedNonce` is the existing public mapping on `Pool.sol` (auto-getter `usedNonce(uint256)->bool`).

### go/internal/extension/extension.go (extend reader interface + add handler)
Widen the internal `depositReader` interface (rename → `poolReader`) to add `Organizer` and `UsedNonce`; `*chain.Reader` already satisfies it.
```go
func (e *Extension) handleUnclaimedReport(ctx, pool, payload) (uint8, []byte) {
    // req: {OrganizerPubHex, ChallengeSig}
    challenge := "ConfidentialPrizePool unclaimed\npool:"+pool.Hex()+"\nkey:"+req.OrganizerPubHex
    caller := ecrecover(TextHash(challenge), req.ChallengeSig)   // same 65-byte / V-=27 handling as claim
    organizer := reader.Organizer(ctx, pool)
    if caller != organizer { return 0, "not organizer" }
    entries, ok := store.Entries(pool); if !ok { return 0, "no allocations for pool" }
    unclaimed := []{recipient, amount}
    for _, en := range entries {
        used, err := reader.UsedNonce(ctx, pool, en.Nonce); if err { return 0, "nonce read failed" }
        if !used { unclaimed = append(..., {en.Recipient.Hex(), en.Amount.String()}) }
    }
    ct := EncryptTo(req.OrganizerPubHex, json(unclaimed))
    return 1, json(UnclaimedReportResult{Report: "0x"+hex(ct)})
}
```
Route `OPCommandUnclaimedReport` → `processUnclaimedReport` → `handleUnclaimedReport`, following the `ClaimVerify` processor shape (decode `UnclaimedReportArg`, call handler, `buildResult`).

### go/internal/config/config.go, contracts/InstructionSender.sol, go/pkg/types/types.go
- `OPCommandUnclaimedReport = "UNCLAIMED_REPORT"` (byte-identical in `config.go` and `InstructionSender.sol` `bytes32("UNCLAIMED_REPORT")`; ≤32 bytes — it's 16).
- `InstructionSender`: `struct UnclaimedReportMessage { bytes payload; address pool; }`, `sendUnclaimedReport(bytes calldata payload, address pool)` → `abi.encode(UnclaimedReportMessage({payload, pool}))` (single-tuple, matching the Go decoder — same `(payload, pool)` order as the proven `ClaimVerifyMessage`).
- `types.go`: `UnclaimedReportMessage{Payload []byte; Pool common.Address}`, `UnclaimedReportArg` (tuple(bytes payload, address pool)), `UnclaimedReportPayload{OrganizerPubHex, ChallengeSig string}`, `UnclaimedReportResult{Report string}`, and an exported `UnclaimedItem{Recipient, Amount string}` (shared types package) for the encrypted body.

## 5. Security & privacy

- **P1/P4:** the non-claimant list (recipients + amounts) is assembled inside the TEE from the private store and **only** leaves ECIES-encrypted to the organizer's pubkey. Nothing readable is logged or put on-chain.
- **Identity:** `caller == Pool.organizer()` (on-chain, authoritative), recovered from a signed challenge bound to `pool` + `organizerPubHex`. A non-organizer instruction is rejected before any data is assembled.
- **Confidentiality even if auth were bypassed:** result is encrypted to `organizerPubHex`; the challenge binds that key, and only the true organizer holds the matching private key to decrypt. (Defense in depth: identity guard + encryption to a key the challenge attests.)
- **Claim status trust:** taken from on-chain `usedNonce`, not the in-memory flag — can't be spoofed by a stale/soft TEE state.
- **Replay / cross-pool:** challenge string embeds `pool.Hex()`; a signature for pool A won't recover the organizer of pool B (different `organizer()` and different challenge text).

## 6. Risks / notes

- **In-memory store lifetime:** `Entries` reads the same ephemeral table as claims; `UNCLAIMED_REPORT` must run in the same TEE session as `SUBMIT_ALLOCATION`. Same documented constraint as claim/compliance.
- **N chain reads:** one `UsedNonce` call per allocation entry. Fine for hackathon-scale pools (tens of recipients). `// ponytail: one eth_call per entry; batch via multicall only if pools grow to hundreds.`
- **Challenge-sig handling is duplicated** from `handleClaimVerify` (65-byte len, `sig[64]>=27`, `rec[64]-=27`, `SigToPub(TextHash(...))`). Extract a small `recoverChallenge(challenge, sigHex) (common.Address, error)` helper in `extension.go` and use it in both handlers — lazy = one implementation, and it de-risks the second copy drifting.

## 7. Testing

**Go unit (`extension` + `chain` + `allocations`):**
- `allocations.Entries`: returns all rows with correct recipient/amount/nonce; `ok=false` unknown pool; mutating a returned `Amount` does not affect the store.
- handler happy path (fake reader): 3 allocations, nonces 1 and 2 marked used on-chain → report contains exactly the nonce-0 recipient+amount, ECIES-decryptable with the organizer key.
- handler auth: challenge signed by a non-organizer → status 0 `not organizer`; nothing assembled.
- handler unknown pool → status 0.
- `recoverChallenge` helper: round-trips an address from a personal_sign challenge (shared by claim + unclaimed).

No Solidity/interop test needed — M7 adds no cross-language digest (no new EIP-712 struct; it reuses `usedNonce`/`organizer` getters and the existing challenge/ECIES scheme already proven for `CLAIM_VERIFY`).

## 8. File summary
```
go/internal/allocations/store.go     (add RecipientEntry + Entries)
go/internal/chain/reader.go          (add Organizer + UsedNonce)
go/internal/extension/extension.go   (widen reader iface, recoverChallenge helper, processUnclaimedReport + handleUnclaimedReport)
go/internal/config/config.go         (OPCommandUnclaimedReport)
go/pkg/types/types.go                (UnclaimedReportMessage/Arg/Payload/Result + unclaimedItem)
contracts/InstructionSender.sol      (OP_COMMAND_UNCLAIMED_REPORT + sendUnclaimedReport)
go/internal/**/*_test.go             (unit tests above)
```
