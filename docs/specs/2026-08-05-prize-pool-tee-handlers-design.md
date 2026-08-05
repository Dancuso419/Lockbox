# Confidential Prize Pool — M1/M3/M4 TEE Handler Design (Go)

**Date:** 2026-08-05
**Scope:** BUILD.md M1 (rename to PRIZEPOOL), M3 (`SUBMIT_ALLOCATION`), M4 (`CLAIM_VERIFY`).
**Status:** Approved for planning.
**Network:** Coston2 (chain id 114). Go extension in `fce-extension-scaffold/go`.
**Companion:** the on-chain layer is already built — `contracts/Pool.sol` verifies an EIP-712 `Voucher{recipient=msg.sender, amount, nonce}` signed by an immutable `authorizedSigner`; `contracts/PoolFactory.sol` deploys + funds. Design spec: `docs/specs/2026-08-05-confidential-prize-pool-contracts-design.md`.

## 1. Purpose & scope

Build the TEE side that holds allocations privately and issues the vouchers the contracts redeem:
- **M1:** rename the GREETING scaffold to `PRIZEPOOL` and wire two op-commands.
- **M3 `SUBMIT_ALLOCATION`:** organizer privately submits a recipient→amount table; the TEE validates and holds it in memory. No individual allocation is ever written on-chain, to logs, or to action results in cleartext.
- **M4 `CLAIM_VERIFY`:** a recipient proves eligibility; the TEE returns a signed voucher (confidentially) that `Pool.claim` accepts. Reveals nothing about other entries.

**Out of scope (later milestones):** `COMPLIANCE_REPORT` (M6), `UNCLAIMED_REPORT` (M7), M5 anonymity/unlinkability hardening, live FTDC registration (blocked Flare-side). Handlers are unit-testable now without registration.

## 2. Key decisions (all approved)

1. **Voucher signing key = configured secp256k1 key** from env `VOUCHER_SIGNING_KEY` (hex), loaded into TEE memory at startup. Its Ethereum address is what the organizer sets as `Pool.authorizedSigner`. **Stable across restarts** (fixes the ephemeral-simulated-TEE-key gotcha). Trade-off: not TEE-sealed — acceptable for the hackathon (simulated TEE); a production deploy would seal/generate in-enclave.
2. **One key, three uses.** The same secp256k1 key: (a) ECDSA-signs vouchers; (b) its pubkey is the ECIES target the organizer encrypts the allocation table to; (c) ECIES-decrypts that table. Recipient results are ECIES-encrypted to a **recipient-supplied** pubkey.
3. **`CLAIM_VERIFY` is invoked on-chain** (recipient pays gas, native FCC flow) and the **voucher is returned ECIES-encrypted** — action results are publicly retrievable by `instructionId`, so the amount must never be in cleartext there.
4. **Recipient auth = signed challenge** in the request payload (robust; no dependency on whether the tee-node `Action` exposes the on-chain caller). The recipient signs a fixed challenge with their allocated wallet key; the TEE `ecrecover`s the address and looks up that allocation.
5. **Deposit check reads on-chain.** `SUBMIT_ALLOCATION` carries the pool address; the extension queries `Pool(pool).totalDeposited()` via RPC and rejects if `sum(allocations) > totalDeposited`. Trustless; same value M6 will attest.
6. **Only two op-commands now:** `SUBMIT_ALLOCATION`, `CLAIM_VERIFY`. `COMPLIANCE_REPORT`/`UNCLAIMED_REPORT` added in their milestones.

## 3. Naming (critical — silent-failure risk)

Byte-identical, case-exact, in all three: `go/internal/config/config.go` (Go string consts), `go/pkg/types/register.go` (decoder registry keys), `contracts/InstructionSender.sol` (`bytes32("...")`).
```
OPType:     PRIZEPOOL
OPCommands: SUBMIT_ALLOCATION
            CLAIM_VERIFY
```
None start with `F_`; none are reserved. **Never** rename to `PAY`/`PROVE` (reserved → instruction silently never delivered).

## 4. Components

New/changed files (small, single-responsibility):

| File | Responsibility |
| --- | --- |
| `go/internal/config/config.go` | `OPTypePrizePool`, `OPCommandSubmitAllocation`, `OPCommandClaimVerify` consts; bump `Version`; read `VOUCHER_SIGNING_KEY`, `CHAIN_URL`. |
| `go/internal/signer/signer.go` (new) | Load key from env; `Address()`; `PubKeyHex()`; `SignVoucher(pool common.Address, recipient common.Address, amount *big.Int, nonce *big.Int) ([]byte, error)` (EIP-712, V∈{27,28}); `Decrypt(ciphertext []byte) ([]byte, error)` and `EncryptTo(pubHex string, plaintext []byte) ([]byte, error)` (ECIES via `go-ethereum/crypto/ecies`). |
| `go/internal/allocations/store.go` (new) | In-memory `map[common.Address]map[common.Address]Entry` (`Entry{Amount *big.Int; Nonce *big.Int; Claimed bool}`), mutex-guarded. `Submit(pool, entries, onchainTotal) error` (sum check + nonce assignment); `Lookup(pool, recipient) (Entry, bool)`. |
| `go/internal/chain/reader.go` (new) | Minimal `ethclient` reader: `TotalDeposited(pool common.Address) (*big.Int, error)` via a hand-written `totalDeposited()(uint256)` ABI call. |
| `go/internal/extension/extension.go` | Route `PRIZEPOOL` → `SUBMIT_ALLOCATION` / `CLAIM_VERIFY`; embed `*signer.Signer`, `*allocations.Store`, `*chain.Reader`. |
| `go/pkg/types/types.go` | Request/response structs (§5). Expose signer pubkey in `/state`. |
| `go/pkg/types/register.go` | Decoders for the two commands. |
| `contracts/InstructionSender.sol` | Rename to `PrizePoolInstructionSender`; `bytes32` consts; `sendSubmitAllocation(bytes ciphertext, address pool)`, `sendClaimVerify(bytes payload, address pool)`. Keep DO-NOT-MODIFY constructor/`setExtensionId`/`_getExtensionId`. |

## 5. Payloads & data flow

### SUBMIT_ALLOCATION
On-chain: `sendSubmitAllocation(bytes ciphertext, address pool)`. `ciphertext` = ECIES(TEE pubkey, JSON `{"allocations":[{"recipient":"0x..","amount":"<decimal wei>"}...]}`).

TEE handler:
1. Decode `{ciphertext, pool}` from the instruction message.
2. `plain = signer.Decrypt(ciphertext)`; parse table. **Never log `plain`.**
3. `total = chain.TotalDeposited(pool)`.
4. Validate: every amount > 0, no duplicate recipients, `sum <= total`. Reject otherwise (status 0, generic message — no amounts).
5. Assign nonces (sequential per pool starting at 0). `store.Submit(pool, entries, total)`.
6. Result data: `{"ok":true,"count":N}` only. (Re-submission policy: reject if pool already has allocations — allocations are immutable once set, matching the immutable on-chain pool.)

### CLAIM_VERIFY
On-chain: `sendClaimVerify(bytes payload, address pool)`. `payload` = ABI/JSON `{recipientPubHex, challengeSig}` where `challengeSig` signs the EIP-191 message
`"ConfidentialPrizePool claim\npool:<checksum pool>\nkey:<recipientPubHex>"`.

TEE handler:
1. Decode `{payload, pool}`.
2. `recipient = ecrecover(EIP-191(challengeMsg), challengeSig)`.
3. `entry, ok = store.Lookup(pool, recipient)`; if `!ok` → status 0, generic "not eligible".
4. `sig = signer.SignVoucher(pool, recipient, entry.Amount, entry.Nonce)`.
5. `voucher = {amount, nonce, signature}` (JSON); `enc = signer.EncryptTo(recipientPubHex, voucher)`.
6. Result data: `{"voucher": enc}` (ciphertext only — no cleartext amount). Recipient decrypts off-device, calls `Pool.claim(amount, nonce, signature)` from `recipient`.

Idempotent: re-issuing the same voucher is harmless (nonce fixed; `Pool.usedNonce` stops double-redeem). `store` may set `Claimed=true` for the eventual M7 non-claimant report but does not block re-issue.

## 6. EIP-712 voucher — must byte-match Pool.sol

```
domainSeparator = keccak256(abi.encode(
    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
    keccak256("ConfidentialPrizePool"), keccak256("1"), chainId=114, pool))
structHash      = keccak256(abi.encode(
    keccak256("Voucher(address recipient,uint256 amount,uint256 nonce)"),
    recipient, amount, nonce))
digest          = keccak256(0x1901 ‖ domainSeparator ‖ structHash)
signature       = crypto.Sign(digest, key); signature[64] += 27   // V -> {27,28}
```
`chainId` from config (114 on Coston2; configurable for tests). The `+27` normalization is mandatory — OZ `ECDSA.recover` rejects V∈{0,1}.

## 7. Security & privacy

- **P1/P3:** allocation table only exists ECIES-encrypted on-chain and decrypted in TEE memory; never logged (audit every handler `log`/`fmt` call), never in `/state`, never in action-result cleartext.
- **P5:** a `CLAIM_VERIFY` only returns the caller's own amount, encrypted to their key; lookups reveal nothing about other entries; failures use generic messages (no "amount was X").
- **Signing key:** from env into memory; `/state` exposes only the public address + pubkey.
- **Voucher scoping:** EIP-712 `verifyingContract=pool` + per-pool nonce → a voucher is bound to one pool and one recipient and single-use on-chain.
- **Result confidentiality depends on ECIES**, since results are publicly retrievable — this is the load-bearing privacy mechanism; test the encrypt→decrypt roundtrip and that no cleartext amount appears in the marshaled result.
- Treat the proxy/tunnel as hostile-reachable; the on-chain-invoked path plus ECIES means transport is not trusted for confidentiality.

## 8. Risks / notes

- **EIP-712 cross-language interop is the #1 risk.** Mitigated with a Foundry interop test (§9) that feeds a Go-produced vector into `Pool.claim`.
- **`VOUCHER_SIGNING_KEY` handling:** a funded key is not required (the signer never sends txs — recipients do). It only signs digests. Keep it out of git (`.env`), document setting `Pool.authorizedSigner = signer address` at pool creation.
- **tee-node `Action` caller field:** the signed-challenge design intentionally avoids depending on it. If we later confirm the Action exposes `claimBackAddress`, we may cross-check it equals the recovered recipient (defense in depth) — not required for correctness.
- **ECIES scheme:** use `go-ethereum/crypto/ecies` (`ImportECDSA`, `Encrypt`/`Decrypt`) with the secp256k1 key; recipient pubkeys are 65-byte uncompressed hex. Document the exact scheme so the organizer/recipient tooling matches.
- **Off-chain recipient signer contract:** the CLAIM_VERIFY challenge is `"ConfidentialPrizePool claim\npool:<EIP-55 checksum pool>\nkey:<0x04 uncompressed pubHex>"`, signed as an EIP-191 `personal_sign` message with the challenge-sig `V` normalized to 27/28 (the handler rejects raw `V<27`). Recipient tooling MUST use the checksummed pool address and 27/28 `V`, or recovery yields the wrong address and the claim is rejected as "not eligible".

## 9. Testing

**Go unit tests:**
- `signer`: sign a voucher → `crypto.Ecrecover` yields `Address()`; V normalization to 27/28; ECIES `EncryptTo(pub)` → `Decrypt` roundtrip; wrong-key decrypt fails.
- `allocations`: `Submit` rejects `sum > total`, rejects duplicate recipient, rejects zero amount; assigns distinct sequential nonces; `Lookup` isolates per pool; second `Submit` for a pool rejected.
- `chain.reader`: `totalDeposited` ABI-encodes/decodes correctly (unit test the call data; integration optional).
- handler: `SUBMIT_ALLOCATION` happy path returns `{ok,count}` and stores nothing in `/state`; a decoded allocation never appears in the result bytes; `CLAIM_VERIFY` returns ciphertext, and the marshaled result contains no cleartext amount.

**Cross-language interop (critical):** a Foundry test `test/VoucherInterop.t.sol` with a hardcoded vector produced by a Go helper (`go run ./cmd/gen-voucher` or a committed fixture): `(pool, recipient, amount, nonce, signerAddr, signature)` — deploy a Pool with `authorizedSigner=signerAddr`, call `claim` as `recipient`, assert success. This proves the Go digest == the Solidity digest.

## 10. File/route summary
```
go/internal/signer/signer.go          (new)
go/internal/allocations/store.go      (new)
go/internal/chain/reader.go           (new)
go/internal/config/config.go          (rename consts, version, env)
go/internal/extension/extension.go    (route PRIZEPOOL -> two handlers)
go/pkg/types/types.go                 (request/response/state)
go/pkg/types/register.go              (decoders)
contracts/InstructionSender.sol       (rename + two send fns)
test/VoucherInterop.t.sol             (cross-language voucher test)
go/internal/**/*_test.go              (unit tests)
```
