# Confidential Prize Pool — M5 Anonymous Claims Design

**Date:** 2026-08-09
**Scope:** BUILD.md M5 (FR4 / P5) — break the public link between a recipient's allocation **identity** and the **amount** they receive, and document the scheme's threat model explicitly (the [VERIFY]-tagged, design-weighted deliverable).
**Status:** Approved for planning.
**Network:** Coston2 (chain id 114).
**Companions:** contracts `docs/specs/2026-08-05-confidential-prize-pool-contracts-design.md` (§ "M5 seam"); TEE handlers `docs/specs/2026-08-05-prize-pool-tee-handlers-design.md`.

## 1. Purpose & scope

In M4, a recipient claims via `pool.claim(amount, nonce, sig)` from their **identity address** (the address in the organizer's allocation table, recovered from their signed challenge). The claim transaction is public, so `identityAddr ↔ amount` is publicly linked — violating FR4.

M5 lets the recipient direct the payout to a **fresh claim address C** that is unlinkable to their identity, while still proving eligibility with their identity key inside the TEE. On-chain, observers see `C ↔ amount`; C is not linkable to the identity (subject to the documented residuals in §5).

**Honest statement of the guarantee (§5 is the real deliverable):** M5 provides **identity–payout unlinkability**, NOT amount confidentiality. On a transparent chain the payout amount is always observable (balance delta + event). True amount-hiding requires ZK/mixing, which is out of scope for this hackathon TEE build.

**In scope:** claim-address binding in `CLAIM_VERIFY` (Go); randomized allocation nonces; the threat model doc; test updates for randomized nonces.

**Out of scope:** any contract change (the voucher already commits `recipient = msg.sender`); a gasless relayer (the gas-funding residual is documented as a deployment requirement, not built); amount-hiding; M8 multi-asset; live FTDC registration (blocked Flare-side; unit + interop tests cover correctness now).

## 2. Key decisions (all approved)

1. **Fresh-address claim, TEE-only, no Solidity change.** The recipient names a claim address C; the TEE issues `Voucher(recipient=C, amount, nonce)`. `Pool.claim` is untouched — it already pays `msg.sender` after verifying the voucher signer.
2. **Eligibility unchanged; payout redirected.** Eligibility is still proven by the identity key and looked up by the recovered identity address. Only the voucher's `recipient` field changes to C.
3. **C is bound into the signed challenge** so a man-in-the-middle can't redirect the payout without invalidating the signature.
4. **Backward compatible.** Empty/omitted claim address ⇒ voucher pays the identity address, identical to M4.
5. **Randomized nonces.** The TEE assigns a random 256-bit nonce per allocation entry instead of the sequential table index, so the on-chain `nonce` no longer leaks the recipient's position/rank in the allocation list.
6. **Amount fingerprinting and the gas-funding link are documented residuals, not fixed** (see §5) — consistent with M5 being a "should have" whose weighted deliverable is a documented scheme + threat model.

## 3. Data flow

```
recipient (identity key IK, controls fresh address C)
  → challenge = "ConfidentialPrizePool claim\npool:<pool>\nkey:<recipientPubHex>\nclaim:<C or empty>"
  → sign challenge with IK
  → CLAIM_VERIFY payload { RecipientPubHex, ChallengeSig, ClaimAddress:C }   (travels encrypted via instruction system)
TEE CLAIM_VERIFY handler:
      identityAddr = recoverChallenge(challenge, ChallengeSig)   // eligibility identity
      entry = store.Lookup(pool, identityAddr)                   // eligibility by IDENTITY (unchanged)
      payTo = ClaimAddress if set else identityAddr
      voucher = SignVoucher(pool, recipient=payTo, entry.Amount, entry.Nonce)   // random nonce
      result = ECIES.EncryptTo(RecipientPubHex, voucher)          // encrypted to recipient
recipient → funds C from an INDEPENDENT source (see §5.2) → pool.claim(amount, nonce, voucher) from C
on-chain observer → sees C ↔ amount; C not linkable to identityAddr
```

## 4. Components

### go/internal/allocations/store.go (modify `Submit`)
Replace the sequential nonce assignment with a random 256-bit nonce, guarding against the (astronomically unlikely) in-table collision:
```go
// nonce is a random 256-bit value so the on-chain nonce leaks nothing about the
// recipient's position/rank in the allocation list.
nonce, err := randomNonce()          // crypto/rand, 32 bytes -> *big.Int
if err != nil { return fmt.Errorf("nonce gen: %w", err) }
// dup guard within this table (collision probability ~2^-256; guard is cheap)
for seen[nonce.String()] { nonce, err = randomNonce(); ... }
table[in.Recipient] = &Entry{Amount: new(big.Int).Set(in.Amount), Nonce: nonce}
```
`Lookup`, `Entries`, `Totals` are unchanged — they already return whatever nonce is stored. `randomNonce()` is a small unexported helper using `crypto/rand.Read(32 bytes)` → `new(big.Int).SetBytes`.

### go/pkg/types/types.go (extend `ClaimVerifyPayload`)
```go
type ClaimVerifyPayload struct {
	RecipientPubHex string `json:"recipientPubHex"`
	ChallengeSig    string `json:"challengeSig"`
	ClaimAddress    string `json:"claimAddress"` // optional 0x addr; empty => pay identity address
}
```

### go/internal/extension/extension.go (modify `handleClaimVerify`)
```go
challenge := "ConfidentialPrizePool claim\npool:" + pool.Hex() +
    "\nkey:" + req.RecipientPubHex + "\nclaim:" + req.ClaimAddress
identityAddr, err := recoverChallenge(challenge, req.ChallengeSig)  // unchanged helper
...
entry, ok := e.store.Lookup(pool, identityAddr)                     // eligibility by identity (unchanged)
if !ok { return 0, []byte("not eligible") }
payTo := identityAddr
if req.ClaimAddress != "" {
    if !common.IsHexAddress(req.ClaimAddress) { return 0, []byte("bad claim address") }
    payTo = common.HexToAddress(req.ClaimAddress)
}
vsig, err := e.signer.SignVoucher(pool, payTo, entry.Amount, entry.Nonce)
// voucher.recipient = payTo; ECIES to req.RecipientPubHex as before
```
Note: the challenge always includes the `\nclaim:` line (empty string when omitted), so the client and TEE build byte-identical challenges. Normalize the address in the challenge to exactly the string the client signs — the client sends `ClaimAddress` verbatim and the TEE concatenates it verbatim; both must agree on casing. Simplest contract: the client sends the checksummed hex it will use as `msg.sender`, and the TEE uses that same string in the challenge (it only parses it to an address AFTER recovery succeeds).

## 5. Threat model (the M5 deliverable)

**Property claimed:** a passive chain observer cannot link a recipient's allocation **identity** to the **amount** they received. **Not** claimed: hiding the amount.

**Adversary:** passive chain observer (all txs, calldata, events, balances, timing). Optionally also holds the organizer's list of allocation *identities* (but not amounts — the pool never publishes the identity→amount map).

### 5.1 Amount fingerprinting — NOT mitigated (inherent)
The amount is public (balance delta + `Claimed(recipient, amount, nonce)` event). If allocations are distinct amounts AND the adversary independently obtains the organizer's identity→amount mapping, they can match `amount` back to an identity. Not fixable without corrupting prize amounts (bucketing) or ZK/mixing (out of scope). The pool itself never reveals the mapping, so this bites only if the map leaks off-band. **Documented, accepted.**

### 5.2 Gas-funding link — the load-bearing residual (deployment requirement)
C must pay gas for the claim tx. If C is funded from `identityAddr`, the funding tx re-links them on-chain. **Unlinkability holds only if C is funded from an independent source** — an exchange withdrawal, a faucet, or a separately-funded wallet. A gasless relayer (ERC-2771 `claimFor`) would close this at the cost of a trusted metadata observer; deferred as future work. **Documented as a deployment requirement; recommended in the recipient UI copy (M9).**

### 5.3 Timing / ordering correlation
- **Voucher→claim timing:** claiming from C immediately after the CLAIM_VERIFY instruction correlates the two. Recipients SHOULD jitter/delay between voucher issuance and the on-chain claim.
- **Nonce as position (fixed in M5):** in M4 the nonce was the table index, leaking the recipient's rank/position. M5 randomizes it (§4), removing this leak.
- **Aggregate leakage (unavoidable):** the claim count over time and the residual pool balance are always public. Documented, not fixable.

### 5.4 Off-chain payload
`RecipientPubHex`, `ChallengeSig`, and `ClaimAddress` live only in the CLAIM_VERIFY payload, which travels encrypted through the instruction system and never appears on-chain. The `key:`/`claim:` challenge lines are off-chain only. No on-chain leak.

### 5.5 TEE trust
The TEE observes the full `identity → C → amount` linkage. This is the system's existing trust root (already assumed for holding the allocation table); M5 introduces no new trusted party. Documented.

### 5.6 Scope of the guarantee
Identity↔payout unlinkability holds **provided** the recipient (a) funds C from an independent source and (b) jitters claim timing. Amount confidentiality is not provided. This is an honest, hackathon-appropriate anonymity guarantee.

## 6. Risks / notes
- **Test ripple:** randomizing nonces breaks any test that hardcoded sequential nonce values — specifically the M7 `UNCLAIMED_REPORT` happy-path (`used: {"1","2"}`) and any claim/voucher test using nonce `0`/`1`. These must read the actual nonce from `store.Entries`/`Lookup` rather than assuming a value. This is the main non-obvious work in the plan.
- **Interop unaffected:** no new EIP-712 struct — the `Voucher` type is unchanged (still `recipient, amount, nonce`), so `VoucherInterop.t.sol` continues to prove Go≡Solidity. Rebuild `bin/sign-voucher.exe` before `forge test`.
- **No privacy regression in logs:** the handler must not log `ClaimAddress`, identity, amount, or the voucher in cleartext (existing P3 constraint).
- **Determinism:** random nonces make `Submit` non-deterministic; tests must not assert specific nonce values, only distinctness and round-trip.

## 7. Testing
**Go unit:**
- `allocations`: after `Submit`, entry nonces are distinct and NOT the sequence 0,1,2…; `Lookup`/`Entries` return them; sum/count tests updated to not assume nonce values.
- `extension` claim (fresh address): identity A eligible, `ClaimAddress=C` ⇒ decrypted voucher's recipient == C (≠ A), amount == A's allocation, verified via existing signer recover. Tampered `claim:` line ⇒ recovery yields a different/ineligible identity ⇒ status 0.
- `extension` claim (backward compat): `ClaimAddress=""` ⇒ voucher recipient == A. (Preserves M4 behavior; existing claim tests, updated for random nonce, still pass.)
- `extension` claim: `ClaimAddress` set to a non-hex string ⇒ status 0 "bad claim address".

**Interop (`test/VoucherInterop.t.sol`, forge FFI):** unchanged, still green after rebuilding the Go signer binary — proves the (unchanged) voucher digest still matches across languages.

**Fix nonce-assuming tests** (M7 unclaimed happy-path; any claim/voucher test) to derive nonces from the store.

## 8. File summary
```
go/internal/allocations/store.go     (random nonce in Submit + randomNonce helper)
go/pkg/types/types.go                (ClaimVerifyPayload.ClaimAddress)
go/internal/extension/extension.go   (claim-address binding + payTo in handleClaimVerify)
go/internal/**/*_test.go             (fresh-address + backward-compat + bad-address tests; nonce-assumption fixes)
docs/specs/2026-08-09-anonymous-claims-design.md   (this doc — threat model is the deliverable)
```
No Solidity change. No new EIP-712 struct.
