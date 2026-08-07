# Confidential Prize Pool — M6 Compliance Attestation Design

**Date:** 2026-08-07
**Scope:** BUILD.md M6 — `COMPLIANCE_REPORT`: TEE-computed, TEE-signed distribution-integrity attestation, published + verified on-chain, with no line items.
**Status:** Approved for planning.
**Network:** Coston2 (chain id 114).
**Companions:** contract layer `docs/specs/2026-08-05-confidential-prize-pool-contracts-design.md`; TEE handlers `docs/specs/2026-08-05-prize-pool-tee-handlers-design.md`.

## 1. Purpose & scope

Let a public observer confirm that a pool's distribution is internally consistent — the aggregate allocated fits within the deposit — **without** seeing any individual recipient or amount. The TEE (which alone holds the allocation table) computes the aggregate and signs an attestation; the pool contract verifies that signature on-chain and records the result.

**In scope:** the `COMPLIANCE_REPORT` Go handler; `SignComplianceReport` in `internal/signer`; a `Totals` helper in `internal/allocations`; `publishComplianceReport` on `Pool.sol`; op-command wiring (`config.go`, `InstructionSender.sol`, `types.go`); Go unit tests + a Solidity + a cross-language interop test.

**Out of scope:** M5 anonymity, M7 unclaimed report, M8 multi-asset, live FTDC registration (blocked Flare-side; unit + interop tests cover correctness now).

## 2. Key decisions (all approved)

1. **Attestation contents:** `ComplianceReport(address pool, uint256 totalDeposited, uint256 totalAllocated, uint256 recipientCount)`. Asserts that `recipientCount` recipients were allocated `totalAllocated` in aggregate, and `totalAllocated <= totalDeposited`. No line items.
2. **EIP-712, same domain as vouchers** (`ConfidentialPrizePool`/`1`, `verifyingContract = pool`) — verifies with the same machinery and the same immutable `authorizedSigner`.
3. **Verification lives on `Pool.sol`** (`publishComplianceReport`) — reuses the pool's EIP712 domain, `authorizedSigner`, and authoritative immutable `totalDeposited`. Least code, strongest binding (the two fields an attacker would forge — pool + deposit — are supplied by the contract itself, not the caller).
4. **Integrity rule:** enforce `totalAllocated <= totalDeposited` (allow legitimate under-allocation + sweep). Not `==`.
5. **Organizer-triggered:** an on-chain `COMPLIANCE_REPORT` instruction; the TEE returns the signed aggregate; anyone submits `publishComplianceReport` with the public values + signature.
6. **Publishable once** per pool (`AlreadyReported` on re-publish) — the attestation is deterministic given the immutable allocation table.

## 3. Data flow

```
organizer → InstructionSender.sendComplianceReport(pool)         (on-chain instruction)
          → data providers → TEE COMPLIANCE_REPORT handler
              store.Totals(pool) -> (totalAllocated, recipientCount)
              chain.TotalDeposited(pool) -> totalDeposited
              signer.SignComplianceReport(pool, totalDeposited, totalAllocated, recipientCount)
          → result {totalAllocated, recipientCount, signature}   (public aggregates; no line items)
anyone    → Pool.publishComplianceReport(totalAllocated, recipientCount, signature)
              digest = EIP712(ComplianceReport(address(this), totalDeposited, totalAllocated, recipientCount))
              require ECDSA.recover(digest, signature) == authorizedSigner
              require totalAllocated <= totalDeposited
              store + emit ComplianceReported(totalDeposited, totalAllocated, recipientCount)
observer  → recompute the digest from on-chain values, confirm ecrecover == authorizedSigner
```

The action result is public (retrievable by `instructionId`); that is fine — it carries only aggregates, never per-recipient data.

## 4. Components

### contracts/Pool.sol (extend)
```solidity
// keccak256("ComplianceReport(address pool,uint256 totalDeposited,uint256 totalAllocated,uint256 recipientCount)")
bytes32 public constant COMPLIANCE_TYPEHASH = keccak256(
    "ComplianceReport(address pool,uint256 totalDeposited,uint256 totalAllocated,uint256 recipientCount)");

bool public complianceReported;
uint256 public reportedTotalAllocated;
uint256 public reportedRecipientCount;

error AlreadyReported();
event ComplianceReported(uint256 totalDeposited, uint256 totalAllocated, uint256 recipientCount);

function publishComplianceReport(
    uint256 totalAllocated,
    uint256 recipientCount,
    bytes calldata signature
) external {
    if (complianceReported) revert AlreadyReported();
    if (totalAllocated > totalDeposited) revert ExceedsDeposited();

    bytes32 structHash = keccak256(abi.encode(
        COMPLIANCE_TYPEHASH, address(this), totalDeposited, totalAllocated, recipientCount));
    bytes32 digest = _hashTypedDataV4(structHash);
    if (ECDSA.recover(digest, signature) != authorizedSigner) revert BadSignature();

    complianceReported = true;
    reportedTotalAllocated = totalAllocated;
    reportedRecipientCount = recipientCount;
    emit ComplianceReported(totalDeposited, totalAllocated, recipientCount);
}
```
Note: `pool` is bound as `address(this)` and `totalDeposited` is the immutable — the caller only supplies the signed aggregates, which must match what the TEE signed for THIS pool.

### go/internal/signer/signer.go (add)
```go
var complianceTypehash = crypto.Keccak256([]byte(
    "ComplianceReport(address pool,uint256 totalDeposited,uint256 totalAllocated,uint256 recipientCount)"))

func (s *Signer) SignComplianceReport(pool common.Address, totalDeposited, totalAllocated, recipientCount *big.Int) ([]byte, error)
// digest = keccak(0x1901 ‖ domainSeparator(pool) ‖
//   keccak(complianceTypehash ‖ word(pool) ‖ word(totalDeposited) ‖ word(totalAllocated) ‖ word(recipientCount)))
// crypto.Sign(digest, key); sig[64] += 27
```
Plus `ComplianceDigestForTest(...)` mirroring `VoucherDigestForTest`.

### go/internal/allocations/store.go (add)
```go
// Totals returns the aggregate allocated amount and recipient count for a pool.
func (s *Store) Totals(pool common.Address) (totalAllocated *big.Int, count int, ok bool)
```

### go/internal/extension/extension.go (add)
Route `COMPLIANCE_REPORT` → `handleComplianceReport(ctx, pool)`:
```
totalAllocated, count, ok := store.Totals(pool); if !ok -> status 0 "no allocations"
totalDeposited := reader.TotalDeposited(ctx, pool)          // (defensive: also require totalAllocated<=totalDeposited here)
sig := signer.SignComplianceReport(pool, totalDeposited, totalAllocated, big.NewInt(count))
result {TotalAllocated: totalAllocated.String(), RecipientCount: count, Signature: "0x"+hex(sig)}  // status 1
```

### go/internal/config/config.go, contracts/InstructionSender.sol, go/pkg/types/types.go
- `OPCommandComplianceReport = "COMPLIANCE_REPORT"` (byte-identical in `config.go` and `InstructionSender.sol` `bytes32("COMPLIANCE_REPORT")`).
- `InstructionSender`: `struct ComplianceReportMessage { address pool; }`, `sendComplianceReport(address pool)` → `abi.encode(ComplianceReportMessage({pool: pool}))` (single-tuple, matching the Go decoder).
- `types.go`: `ComplianceReportMessage{ Pool common.Address }`, `ComplianceReportArg` (tuple(address pool)), `ComplianceReportResult{ TotalAllocated string; RecipientCount int; Signature string }`.

## 5. Security & privacy

- **P1/P4:** the report holds only aggregates; it is computed and signed inside the TEE handler from the private store, never client-side. No individual data in the result, logs, or on-chain.
- **Forgery:** the contract binds `pool = address(this)` and `totalDeposited` = immutable; a valid signature must have been produced by the TEE for exactly this pool + deposit. `authorizedSigner` is immutable.
- **Over-allocation:** `totalAllocated <= totalDeposited` enforced on-chain (and defensively in the handler). Since SUBMIT_ALLOCATION already enforced `sum <= deposit`, a valid report is consistent by construction; the on-chain check is defense in depth.
- **Replay / cross-pool:** EIP-712 `verifyingContract = pool` binds the report to one pool; `publishComplianceReport` is single-shot per pool.

## 6. Risks / notes

- **In-memory store lifetime:** `store.Totals` reads the same ephemeral in-memory allocation table used for claims. `COMPLIANCE_REPORT` must be triggered in the same TEE session as `SUBMIT_ALLOCATION` (before any restart). Documented alongside the existing claim/voucher lifetime constraint.
- **Cross-language digest interop is the recurring risk** — pinned by a forge FFI test (§7), same approach that de-risked the voucher.
- `recipientCount` is passed as `uint256` on-chain but is a Go `int` in the handler — convert via `big.NewInt(int64(count))`; fine for realistic counts.

## 7. Testing

**Go unit:**
- `signer`: `SignComplianceReport` → `crypto.Ecrecover` yields `Address()`; V∈{27,28}.
- `allocations`: `Totals` sums amounts + counts recipients correctly; `ok=false` for an unknown pool.
- handler: `COMPLIANCE_REPORT` returns `{totalAllocated, recipientCount, signature}`; unknown pool → status 0; result contains no per-recipient data (there is none to leak, but assert the shape).

**Solidity (`test/Pool.t.sol` additions):**
- valid TEE-signed report published: stores values, sets `complianceReported`, emits `ComplianceReported`.
- rejects a wrong-signer signature (`BadSignature`).
- rejects `totalAllocated > totalDeposited` (`ExceedsDeposited`).
- rejects a second publish (`AlreadyReported`).

**Cross-language interop (`test/ComplianceInterop.t.sol`, forge FFI):** a NEW `go/cmd/sign-compliance` CLI (separate from `sign-voucher` so the working voucher interop test/binary is untouched) that prints a Go-signed report signature for `<chainID> <pool> <totalDeposited> <totalAllocated> <recipientCount> <privkeyHex>`; forge deploys a pool, FFI-signs for its real address, and asserts `publishComplianceReport` succeeds and the stored values match. Proves Go≡Solidity for the report digest.

## 8. File summary
```
contracts/Pool.sol                         (add COMPLIANCE_TYPEHASH, storage, publishComplianceReport, event/error)
go/internal/signer/signer.go               (add SignComplianceReport + ComplianceDigestForTest)
go/internal/allocations/store.go           (add Totals)
go/internal/extension/extension.go         (route + handleComplianceReport)
go/internal/config/config.go               (OPCommandComplianceReport)
go/pkg/types/types.go                       (ComplianceReportMessage/Arg/Result)
contracts/InstructionSender.sol            (OP_COMMAND_COMPLIANCE_REPORT + sendComplianceReport)
go/cmd/sign-compliance/main.go             (new FFI CLI for report signatures; sign-voucher untouched)
test/Pool.t.sol                            (compliance publish tests)
test/ComplianceInterop.t.sol               (forge FFI cross-language report test)
go/internal/**/*_test.go                   (unit tests)
```
