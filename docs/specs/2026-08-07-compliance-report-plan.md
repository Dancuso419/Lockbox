# Confidential Prize Pool — M6 Compliance Attestation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The TEE computes and signs an EIP-712 aggregate `ComplianceReport` (no line items) that `Pool.publishComplianceReport` verifies on-chain against `authorizedSigner`, with a cross-language test proving the Go-signed report is accepted by Solidity.

**Architecture:** Mirror the proven voucher machinery for an aggregate statement: a new EIP-712 type on the same `ConfidentialPrizePool`/`1` domain; `Pool.sol` verifies it with `_hashTypedDataV4` + `ECDSA.recover == authorizedSigner`, binding `pool=address(this)` and the immutable `totalDeposited` itself; the TEE handler computes totals from its private store and signs. A forge FFI test pins Go≡Solidity.

**Tech Stack:** Solidity/Foundry (OZ EIP712/ECDSA already used by Pool.sol); Go (go-ethereum crypto); forge FFI.

**Spec:** `docs/specs/2026-08-07-compliance-report-design.md`
**Branch:** `feat/prize-pool-contracts` (already checked out).
**Go module dir:** `F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go`; **repo root:** `F:/PROJECTS/LOCKBOX/fce-extension-scaffold`.
**PATH (Git Bash):** `export PATH="$PATH:/c/Program Files/Go/bin:/c/Users/DELL/.foundry/bin:/c/Users/DELL/bin"`.

---

## File Structure

- Modify `contracts/Pool.sol` — `COMPLIANCE_TYPEHASH`, storage, `publishComplianceReport`, event/error.
- Modify `test/Pool.t.sol` — compliance publish tests (reuse existing `_digest` helper + `signer`/`signerPk`).
- Modify `go/internal/signer/signer.go` — `SignComplianceReport` + `ComplianceDigestForTest`.
- Modify `go/internal/allocations/store.go` — `Totals`.
- Modify `go/internal/config/config.go` — `OPCommandComplianceReport`.
- Modify `go/pkg/types/types.go` — `ComplianceReportMessage`/`Arg`/`Result`.
- Modify `go/internal/extension/extension.go` — route + `handleComplianceReport`.
- Modify `contracts/InstructionSender.sol` — `OP_COMMAND_COMPLIANCE_REPORT` + `sendComplianceReport`.
- Create `go/cmd/sign-compliance/main.go` — FFI signer CLI.
- Create `test/ComplianceInterop.t.sol` — forge FFI cross-language test.

> `foundry.toml` already has `ffi = true` + `fs_permissions` scoped to `./bin` (from the voucher work) — no change needed.

---

## Task 1: `Pool.publishComplianceReport` (Solidity + unit tests)

**Files:** Modify `contracts/Pool.sol`; Modify `test/Pool.t.sol`.

- [ ] **Step 1: Write the failing tests**

Append to `test/Pool.t.sol` inside `PoolTest` (reuse existing `_digest(pool, structHash)`, `signer`, `signerPk`, `_deployNativePool`):
```solidity
    function _signCompliance(Pool pool, uint256 totalDeposited, uint256 totalAllocated, uint256 recipientCount)
        internal view returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(
            pool.COMPLIANCE_TYPEHASH(), address(pool), totalDeposited, totalAllocated, recipientCount));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, _digest(pool, structHash));
        return abi.encodePacked(r, s, v);
    }

    event ComplianceReported(uint256 totalDeposited, uint256 totalAllocated, uint256 recipientCount);

    function test_publishCompliance_validReportStored() public {
        Pool pool = _deployNativePool(10 ether);
        bytes memory sig = _signCompliance(pool, 10 ether, 8 ether, 3);
        vm.expectEmit(false, false, false, true, address(pool));
        emit ComplianceReported(10 ether, 8 ether, 3);
        pool.publishComplianceReport(8 ether, 3, sig);
        assertTrue(pool.complianceReported());
        assertEq(pool.reportedTotalAllocated(), 8 ether);
        assertEq(pool.reportedRecipientCount(), 3);
    }

    function test_publishCompliance_wrongSignerReverts() public {
        Pool pool = _deployNativePool(10 ether);
        (, uint256 attackerPk) = makeAddrAndKey("attacker");
        bytes32 structHash = keccak256(abi.encode(
            pool.COMPLIANCE_TYPEHASH(), address(pool), uint256(10 ether), uint256(8 ether), uint256(3)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attackerPk, _digest(pool, structHash));
        bytes memory bad = abi.encodePacked(r, s, v);
        vm.expectRevert(Pool.BadSignature.selector);
        pool.publishComplianceReport(8 ether, 3, bad);
    }

    function test_publishCompliance_overDepositReverts() public {
        Pool pool = _deployNativePool(10 ether);
        bytes memory sig = _signCompliance(pool, 10 ether, 11 ether, 3);
        vm.expectRevert(Pool.ExceedsDeposited.selector);
        pool.publishComplianceReport(11 ether, 3, sig);
    }

    function test_publishCompliance_secondPublishReverts() public {
        Pool pool = _deployNativePool(10 ether);
        bytes memory sig = _signCompliance(pool, 10 ether, 8 ether, 3);
        pool.publishComplianceReport(8 ether, 3, sig);
        vm.expectRevert(Pool.AlreadyReported.selector);
        pool.publishComplianceReport(8 ether, 3, sig);
    }
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
export PATH="$PATH:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge test --match-test test_publishCompliance -vv
```
Expected: FAIL — `COMPLIANCE_TYPEHASH`, `publishComplianceReport`, `complianceReported`, `AlreadyReported` undefined.

- [ ] **Step 3: Implement in `contracts/Pool.sol`**

Add the typehash constant near `VOUCHER_TYPEHASH`:
```solidity
    // keccak256("ComplianceReport(address pool,uint256 totalDeposited,uint256 totalAllocated,uint256 recipientCount)")
    bytes32 public constant COMPLIANCE_TYPEHASH = keccak256(
        "ComplianceReport(address pool,uint256 totalDeposited,uint256 totalAllocated,uint256 recipientCount)");
```
Add storage near `totalClaimed`/`status`:
```solidity
    bool public complianceReported;
    uint256 public reportedTotalAllocated;
    uint256 public reportedRecipientCount;
```
Add the error near the others (reuse `BadSignature`/`ExceedsDeposited`):
```solidity
    error AlreadyReported();
```
Add the event near the others:
```solidity
    event ComplianceReported(uint256 totalDeposited, uint256 totalAllocated, uint256 recipientCount);
```
Add the function (after `sweep`, before `_payout`):
```solidity
    /// @notice Publish a TEE-signed attestation that `recipientCount` recipients were
    /// allocated `totalAllocated` in aggregate, with `totalAllocated <= totalDeposited`.
    /// No individual allocation data is revealed. Publishable once.
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

- [ ] **Step 4: Run to verify it passes + no regression**

Run:
```bash
export PATH="$PATH:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge test --match-contract PoolTest -vv
```
Expected: all PoolTest tests PASS (the prior 16 + 4 new = 20).

- [ ] **Step 5: Commit**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add contracts/Pool.sol test/Pool.t.sol
git commit -m "feat(pool): publishComplianceReport verifies TEE-signed aggregate attestation"
```

---

## Task 2: `signer.SignComplianceReport`

**Files:** Modify `go/internal/signer/signer.go`, `go/internal/signer/signer_test.go`.

- [ ] **Step 1: Write the failing test**

Append to `go/internal/signer/signer_test.go`:
```go
func TestSignComplianceReport_RecoversToSignerAddress(t *testing.T) {
	s, _ := NewFromHex(testKeyHex, big.NewInt(114))
	pool := common.HexToAddress("0xB91c743E0c9FD6068f1833759a146E950312955B")
	totalDeposited := big.NewInt(10)
	totalAllocated := big.NewInt(8)
	recipientCount := big.NewInt(3)

	sig, err := s.SignComplianceReport(pool, totalDeposited, totalAllocated, recipientCount)
	if err != nil {
		t.Fatalf("SignComplianceReport: %v", err)
	}
	if len(sig) != 65 || (sig[64] != 27 && sig[64] != 28) {
		t.Fatalf("bad sig: len=%d v=%d", len(sig), sig[64])
	}
	digest := s.ComplianceDigestForTest(pool, totalDeposited, totalAllocated, recipientCount)
	rec, err := crypto.SigToPub(digest, sigWithV0(sig))
	if err != nil {
		t.Fatalf("SigToPub: %v", err)
	}
	if crypto.PubkeyToAddress(*rec) != s.Address() {
		t.Fatal("compliance sig does not recover to signer address")
	}
}
```
(`sigWithV0`, `testKeyHex`, imports already exist in this file from the voucher tests.)

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go test ./internal/signer/ -run TestSignComplianceReport -v
```
Expected: FAIL — `SignComplianceReport`/`ComplianceDigestForTest` undefined.

- [ ] **Step 3: Implement in `go/internal/signer/signer.go`**

Add the typehash var near the others:
```go
var complianceTypehash = crypto.Keccak256([]byte("ComplianceReport(address pool,uint256 totalDeposited,uint256 totalAllocated,uint256 recipientCount)"))
```
Add the digest + sign methods (reuse `domainSeparator`, `word`):
```go
func (s *Signer) complianceDigest(pool common.Address, totalDeposited, totalAllocated, recipientCount *big.Int) []byte {
	structEnc := make([]byte, 0, 160)
	structEnc = append(structEnc, complianceTypehash...)
	structEnc = append(structEnc, word(pool.Bytes())...)
	structEnc = append(structEnc, word(totalDeposited.Bytes())...)
	structEnc = append(structEnc, word(totalAllocated.Bytes())...)
	structEnc = append(structEnc, word(recipientCount.Bytes())...)
	structHash := crypto.Keccak256(structEnc)

	pre := make([]byte, 0, 66)
	pre = append(pre, 0x19, 0x01)
	pre = append(pre, s.domainSeparator(pool)...)
	pre = append(pre, structHash...)
	return crypto.Keccak256(pre)
}

// SignComplianceReport signs the EIP-712 ComplianceReport; V normalized to 27/28.
func (s *Signer) SignComplianceReport(pool common.Address, totalDeposited, totalAllocated, recipientCount *big.Int) ([]byte, error) {
	digest := s.complianceDigest(pool, totalDeposited, totalAllocated, recipientCount)
	sig, err := crypto.Sign(digest, s.key)
	if err != nil {
		return nil, err
	}
	sig[64] += 27
	return sig, nil
}

// ComplianceDigestForTest exposes the digest for tests/tools only.
func (s *Signer) ComplianceDigestForTest(pool common.Address, totalDeposited, totalAllocated, recipientCount *big.Int) []byte {
	return s.complianceDigest(pool, totalDeposited, totalAllocated, recipientCount)
}
```

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go test ./internal/signer/ -v
```
Expected: all signer tests PASS.

- [ ] **Step 5: Commit**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add go/internal/signer/signer.go go/internal/signer/signer_test.go
git commit -m "feat(signer): SignComplianceReport EIP-712 aggregate attestation"
```

---

## Task 3: `allocations.Totals`

**Files:** Modify `go/internal/allocations/store.go`, `go/internal/allocations/store_test.go`.

- [ ] **Step 1: Write the failing test**

Append to `go/internal/allocations/store_test.go`:
```go
func TestTotals_SumsAndCounts(t *testing.T) {
	s := New()
	pool := addr(1)
	_ = s.Submit(pool, []Input{
		{Recipient: addr(0xA), Amount: big.NewInt(3)},
		{Recipient: addr(0xB), Amount: big.NewInt(5)},
	}, big.NewInt(10))

	total, count, ok := s.Totals(pool)
	if !ok || count != 2 || total.Cmp(big.NewInt(8)) != 0 {
		t.Fatalf("Totals = (%v, %d, %v), want (8, 2, true)", total, count, ok)
	}
	if _, _, ok := s.Totals(addr(9)); ok {
		t.Fatal("unknown pool should return ok=false")
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go test ./internal/allocations/ -run TestTotals -v
```
Expected: FAIL — `Totals` undefined.

- [ ] **Step 3: Implement in `go/internal/allocations/store.go`**

Add:
```go
// Totals returns the aggregate allocated amount and recipient count for a pool.
func (s *Store) Totals(pool common.Address) (totalAllocated *big.Int, count int, ok bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	table, exists := s.pools[pool]
	if !exists {
		return nil, 0, false
	}
	sum := new(big.Int)
	for _, e := range table {
		sum.Add(sum, e.Amount)
	}
	return sum, len(table), true
}
```

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go test ./internal/allocations/ -v
```
Expected: all allocations tests PASS.

- [ ] **Step 5: Commit**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add go/internal/allocations/store.go go/internal/allocations/store_test.go
git commit -m "feat(allocations): Totals aggregate helper for compliance report"
```

---

## Task 4: Op-command wiring (config, types, InstructionSender)

**Files:** Modify `go/internal/config/config.go`, `go/pkg/types/types.go`, `contracts/InstructionSender.sol`.

- [ ] **Step 1: Add the config constant**

In `go/internal/config/config.go`, add to the const block with the other OP commands:
```go
	OPCommandComplianceReport = "COMPLIANCE_REPORT"
```

- [ ] **Step 2: Add the types**

In `go/pkg/types/types.go`, add the message struct + result near the other PrizePool types:
```go
// ComplianceReportMessage is the ABI payload from sendComplianceReport.
type ComplianceReportMessage struct {
	Pool common.Address
}

type ComplianceReportResult struct {
	TotalAllocated string `json:"totalAllocated"`
	RecipientCount int    `json:"recipientCount"`
	Signature      string `json:"signature"`
}
```
And add the ABI arg — extend the existing `var (...)` block and `init()`:
```go
// in the var block with SubmitAllocationArg/ClaimVerifyArg:
	ComplianceReportArg abi.Argument

// in init():
	crTy, _ := abi.NewType("tuple", "", []abi.ArgumentMarshaling{
		{Name: "pool", Type: "address"},
	})
	ComplianceReportArg = abi.Argument{Type: crTy}
```

- [ ] **Step 3: Add the send function + op constant in `contracts/InstructionSender.sol`**

Add the op constant near the others:
```solidity
    bytes32 public constant OP_COMMAND_COMPLIANCE_REPORT = bytes32("COMPLIANCE_REPORT");
```
Add the message struct near the other message structs:
```solidity
    struct ComplianceReportMessage { address pool; }
```
Add the send function:
```solidity
    /// @notice Ask the TEE to produce a signed compliance attestation for `pool`.
    function sendComplianceReport(address pool) external payable {
        address[] memory teeIds = TEE_MACHINE_REGISTRY.getRandomTeeIds(_getExtensionId(), 1);
        address[] memory cosigners = new address[](0);
        ITeeExtensionRegistry.TeeInstructionParams memory params = ITeeExtensionRegistry.TeeInstructionParams({
            opType: OP_TYPE_PRIZEPOOL,
            opCommand: OP_COMMAND_COMPLIANCE_REPORT,
            message: abi.encode(ComplianceReportMessage({pool: pool})),
            cosigners: cosigners,
            cosignersThreshold: 0,
            claimBackAddress: msg.sender
        });
        TEE_EXTENSION_REGISTRY.sendInstructions{value: msg.value}(teeIds, params);
    }
```

- [ ] **Step 4: Build both toolchains**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go" && go build ./... && go vet ./...
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold" && forge build
```
Expected: Go builds clean; `forge build` → `Compiler run successful`.

- [ ] **Step 5: Commit**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add go/internal/config/config.go go/pkg/types/types.go contracts/InstructionSender.sol
git commit -m "feat(m6): wire COMPLIANCE_REPORT op-command + sendComplianceReport"
```

---

## Task 5: `COMPLIANCE_REPORT` handler

**Files:** Modify `go/internal/extension/extension.go`; Create `go/internal/extension/compliance_test.go`.

- [ ] **Step 1: Write the failing test**

Create `go/internal/extension/compliance_test.go` (reuse `fakeReader` from `submit_test.go`):
```go
package extension

import (
	"context"
	"encoding/json"
	"math/big"
	"testing"

	"extension-scaffold/internal/allocations"
	"extension-scaffold/internal/signer"
	"extension-scaffold/pkg/types"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

func TestComplianceReport_SignsAggregate(t *testing.T) {
	sgn, _ := signer.NewFromHex("353c43dada1ebc390f9594ed91753446e19389ae545fc7fada020816346efb73", big.NewInt(114))
	st := allocations.New()
	e := &Extension{signer: sgn, store: st, reader: fakeReader{total: big.NewInt(10)}}

	pool := common.Address{19: 1}
	_ = st.Submit(pool, []allocations.Input{
		{Recipient: common.Address{19: 0xA}, Amount: big.NewInt(3)},
		{Recipient: common.Address{19: 0xB}, Amount: big.NewInt(5)},
	}, big.NewInt(10))

	status, body := e.handleComplianceReport(context.Background(), pool)
	if status != 1 {
		t.Fatalf("status=%d body=%s", status, body)
	}
	var res types.ComplianceReportResult
	if err := json.Unmarshal(body, &res); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if res.TotalAllocated != "8" || res.RecipientCount != 2 {
		t.Fatalf("res=%+v want totalAllocated=8 count=2", res)
	}
	// signature recovers to the TEE signer for (pool, 10, 8, 2)
	sig := common.FromHex(res.Signature)
	sig[64] -= 27
	digest := sgn.ComplianceDigestForTest(pool, big.NewInt(10), big.NewInt(8), big.NewInt(2))
	pub, _ := crypto.SigToPub(digest, sig)
	if crypto.PubkeyToAddress(*pub) != sgn.Address() {
		t.Fatal("report sig does not recover to TEE signer")
	}
}

func TestComplianceReport_UnknownPoolRejected(t *testing.T) {
	sgn, _ := signer.NewFromHex("353c43dada1ebc390f9594ed91753446e19389ae545fc7fada020816346efb73", big.NewInt(114))
	e := &Extension{signer: sgn, store: allocations.New(), reader: fakeReader{total: big.NewInt(10)}}
	status, _ := e.handleComplianceReport(context.Background(), common.Address{19: 9})
	if status != 0 {
		t.Fatal("expected rejection for pool with no allocations")
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go test ./internal/extension/ -run TestComplianceReport -v
```
Expected: FAIL — `handleComplianceReport` undefined.

- [ ] **Step 3: Implement in `go/internal/extension/extension.go`**

Add the command route inside `processPrizePool`'s switch (alongside the existing cases):
```go
	case df.OPCommand == teeutils.ToHash(config.OPCommandComplianceReport):
		b, _ := json.Marshal(e.processComplianceReport(action, df))
		return http.StatusOK, b
```
Add the handler functions:
```go
func (e *Extension) processComplianceReport(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	var msg types.ComplianceReportMessage
	if err := structs.DecodeTo(types.ComplianceReportArg, df.OriginalMessage, &msg); err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decoding message: %w", err))
	}
	status, data := e.handleComplianceReport(context.Background(), msg.Pool)
	return buildResult(action, df, data, status, resultErr(status, data))
}

// handleComplianceReport computes the aggregate from the private store, reads the
// on-chain deposit, and returns a TEE-signed attestation. No line items.
func (e *Extension) handleComplianceReport(ctx context.Context, pool common.Address) (uint8, []byte) {
	totalAllocated, count, ok := e.store.Totals(pool)
	if !ok {
		return 0, []byte("no allocations for pool")
	}
	totalDeposited, err := e.reader.TotalDeposited(ctx, pool)
	if err != nil {
		return 0, []byte("deposit read failed")
	}
	if totalAllocated.Cmp(totalDeposited) > 0 {
		return 0, []byte("allocation exceeds deposit")
	}
	recipientCount := big.NewInt(int64(count))
	sig, err := e.signer.SignComplianceReport(pool, totalDeposited, totalAllocated, recipientCount)
	if err != nil {
		return 0, []byte("sign failed")
	}
	out, _ := json.Marshal(types.ComplianceReportResult{
		TotalAllocated: totalAllocated.String(),
		RecipientCount: count,
		Signature:      "0x" + common.Bytes2Hex(sig),
	})
	return 1, out
}
```
(imports `context`, `math/big`, `common`, `types`, `structs` already present from the other handlers.)

- [ ] **Step 4: Run to verify it passes + build/vet**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go test ./internal/extension/ -v && go build ./... && go vet ./...
```
Expected: all extension tests PASS; clean build/vet.

- [ ] **Step 5: Commit**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add go/internal/extension/
git commit -m "feat(m6): COMPLIANCE_REPORT handler signs aggregate from private store"
```

---

## Task 6: `sign-compliance` CLI + forge FFI interop test

**Files:** Create `go/cmd/sign-compliance/main.go`; Create `test/ComplianceInterop.t.sol`.

- [ ] **Step 1: Create the CLI**

Create `go/cmd/sign-compliance/main.go`:
```go
// Command sign-compliance prints an EIP-712 ComplianceReport signature.
// Used by the Foundry FFI interop test.
// Args: <chainID> <pool> <totalDeposited> <totalAllocated> <recipientCount> <privkeyHex>
package main

import (
	"fmt"
	"math/big"
	"os"

	"extension-scaffold/internal/signer"

	"github.com/ethereum/go-ethereum/common"
)

func main() {
	if len(os.Args) != 7 {
		fmt.Fprintln(os.Stderr, "usage: sign-compliance <chainID> <pool> <totalDeposited> <totalAllocated> <recipientCount> <privkeyHex>")
		os.Exit(2)
	}
	chainID, _ := new(big.Int).SetString(os.Args[1], 10)
	pool := common.HexToAddress(os.Args[2])
	totalDeposited, _ := new(big.Int).SetString(os.Args[3], 10)
	totalAllocated, _ := new(big.Int).SetString(os.Args[4], 10)
	recipientCount, _ := new(big.Int).SetString(os.Args[5], 10)

	s, err := signer.NewFromHex(os.Args[6], chainID)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	sig, err := s.SignComplianceReport(pool, totalDeposited, totalAllocated, recipientCount)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Print("0x" + common.Bytes2Hex(sig))
}
```

- [ ] **Step 2: Build the binary**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go build -o ../bin/sign-compliance.exe ./cmd/sign-compliance
ls -la ../bin/sign-compliance.exe
```
(`bin/` is already gitignored; `foundry.toml` already has `ffi=true` + `fs_permissions` read `./bin`.)

- [ ] **Step 3: Create the interop test**

Create `test/ComplianceInterop.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test } from "forge-std/Test.sol";
import { Pool } from "../contracts/Pool.sol";

contract ComplianceInteropTest is Test {
    uint256 constant SIGNER_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    function test_goSignedReport_isAcceptedByPool() public {
        address signerAddr = vm.addr(SIGNER_PK);
        address organizer = address(0xA11CE);
        uint64 deadline = uint64(block.timestamp + 7 days);

        vm.deal(organizer, 10 ether);
        vm.prank(organizer);
        Pool pool = new Pool{value: 10 ether}(organizer, address(0), 10 ether, deadline, signerAddr);

        string[] memory cmd = new string[](7);
        cmd[0] = "./bin/sign-compliance.exe";
        cmd[1] = vm.toString(block.chainid);
        cmd[2] = vm.toString(address(pool));
        cmd[3] = vm.toString(uint256(10 ether)); // totalDeposited
        cmd[4] = vm.toString(uint256(6 ether));  // totalAllocated
        cmd[5] = vm.toString(uint256(4));        // recipientCount
        cmd[6] = vm.toString(bytes32(SIGNER_PK));
        bytes memory sig = vm.ffi(cmd);

        pool.publishComplianceReport(6 ether, 4, sig);

        assertTrue(pool.complianceReported());
        assertEq(pool.reportedTotalAllocated(), 6 ether);
        assertEq(pool.reportedRecipientCount(), 4);
    }
}
```

- [ ] **Step 4: Run the interop test**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge test --match-contract ComplianceInteropTest -vvv
```
Expected: PASS — the Go-signed report is accepted by `publishComplianceReport`, proving Go≡Solidity for the report digest. If it reverts `BadSignature`, the Go digest disagrees with Solidity — do NOT weaken the contract; recheck the `ComplianceReport` type string / field order / `word` encoding. Confirm the standalone binary prints a 132-char `0x` hex:
```bash
./bin/sign-compliance.exe 31337 0x0000000000000000000000000000000000000001 10000000000000000000 6000000000000000000 4 ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

- [ ] **Step 5: Commit (source + test only; binary is gitignored)**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add go/cmd/sign-compliance/main.go test/ComplianceInterop.t.sol
git commit -m "test(interop): Go-signed compliance report accepted by publishComplianceReport via FFI"
```

---

## Task 7: Full verification

**Files:** none (verification).

- [ ] **Step 1: Go — all tests + vet + build**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go test ./... && go vet ./... && go build ./...
```
Expected: all packages PASS, no vet issues, clean build.

- [ ] **Step 2: Forge — full suite (build both FFI binaries first)**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go build -o ../bin/sign-voucher.exe ./cmd/sign-voucher
go build -o ../bin/sign-compliance.exe ./cmd/sign-compliance
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge test
```
Expected: all suites PASS (Pool + PoolFactory + VoucherInterop + ComplianceInterop).

- [ ] **Step 3: Privacy grep — no leakage in the compliance path**

Run:
```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
grep -rnE "logger\.|log\.|fmt\.Print" internal/extension internal/allocations internal/signer | grep -iE "plain|amount|alloc|voucher|table|recipient|report" || echo "no plaintext logging found"
```
Expected: `no plaintext logging found` (the report carries only aggregates anyway — confirm no per-recipient logging crept in).

---

## Definition of Done

- `forge test` green including the new `test_publishCompliance_*` cases and `ComplianceInteropTest` (Go-signed report accepted on-chain).
- `go test ./...` green: `SignComplianceReport` sign→recover, `Totals` sum/count, `handleComplianceReport` returns signed aggregate + rejects unknown pool.
- `COMPLIANCE_REPORT` byte-identical in `config.go` and `InstructionSender.sol`.
- Attestation is aggregate-only (no line items) and computed+signed inside the TEE; `publishComplianceReport` binds `pool`+`totalDeposited` from the contract, enforces `totalAllocated <= totalDeposited`, and is publishable once.

## Out of scope (do not implement here)

- M5 anonymity, M7 unclaimed report, M8 multi-asset.
- Live FTDC registration / on-chain deploy (blocked; unit + FFI interop cover correctness now).
