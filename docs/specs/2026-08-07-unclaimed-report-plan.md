# Unclaimed Report (M7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the organizer privately retrieve the list of recipients who haven't claimed (with unclaimed amounts) by joining the TEE's private allocation table against on-chain `Pool.usedNonce`, returned ECIES-encrypted to the organizer only.

**Architecture:** New `UNCLAIMED_REPORT` op-command. The Go TEE handler recovers the caller from a signed challenge, requires `caller == Pool.organizer()` (read on-chain), iterates the private allocation table, checks `Pool.usedNonce(nonce)` per entry, and ECIES-encrypts `[{recipient, amount}]` to the organizer's pubkey. No on-chain publication; `Pool.sol` is untouched (read-only against existing getters).

**Tech Stack:** Go (go-ethereum: `ethclient`, `crypto`, `accounts`, `ecies`), Solidity (InstructionSender wiring), Foundry, ABI single-tuple struct encoding.

**Design ref:** `docs/specs/2026-08-07-unclaimed-report-design.md`

---

### Task 1: `allocations.Entries` iterator

**Files:**
- Modify: `go/internal/allocations/store.go`
- Test: `go/internal/allocations/store_test.go` (add cases)

- [ ] **Step 1: Write the failing test**

Add to `go/internal/allocations/store_test.go`:

```go
func TestEntriesReturnsAllRowsAndIsCopySafe(t *testing.T) {
	s := New()
	pool := common.HexToAddress("0x1111111111111111111111111111111111111111")
	r1 := common.HexToAddress("0xaaaa000000000000000000000000000000000001")
	r2 := common.HexToAddress("0xaaaa000000000000000000000000000000000002")
	if err := s.Submit(pool, []Input{
		{Recipient: r1, Amount: big.NewInt(10)},
		{Recipient: r2, Amount: big.NewInt(20)},
	}, big.NewInt(100)); err != nil {
		t.Fatalf("submit: %v", err)
	}

	rows, ok := s.Entries(pool)
	if !ok {
		t.Fatal("expected ok")
	}
	if len(rows) != 2 {
		t.Fatalf("want 2 rows, got %d", len(rows))
	}
	// Rows carry recipient, amount, nonce.
	byRcpt := map[common.Address]RecipientEntry{}
	for _, row := range rows {
		byRcpt[row.Recipient] = row
	}
	if byRcpt[r1].Amount.Cmp(big.NewInt(10)) != 0 || byRcpt[r2].Amount.Cmp(big.NewInt(20)) != 0 {
		t.Fatalf("amounts wrong: %+v", byRcpt)
	}

	// Mutating a returned Amount must NOT affect the store.
	rows[0].Amount.SetInt64(999)
	again, _ := s.Entries(pool)
	total := new(big.Int)
	for _, row := range again {
		total.Add(total, row.Amount)
	}
	if total.Cmp(big.NewInt(30)) != 0 {
		t.Fatalf("store mutated via returned copy: total=%s", total)
	}

	if _, ok := s.Entries(common.HexToAddress("0x02")); ok {
		t.Fatal("unknown pool should be ok=false")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd go && go test ./internal/allocations/ -run TestEntries -v`
Expected: FAIL — `s.Entries undefined` / `RecipientEntry undefined`.

- [ ] **Step 3: Write minimal implementation**

Add to `go/internal/allocations/store.go` (after `Totals`):

```go
// RecipientEntry is one row of a pool's table, with the recipient key attached.
type RecipientEntry struct {
	Recipient common.Address
	Amount    *big.Int
	Nonce     *big.Int
}

// Entries returns every allocation row for a pool. Amount/Nonce are copies so
// callers cannot mutate the store. ok=false for an unknown pool.
func (s *Store) Entries(pool common.Address) ([]RecipientEntry, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	table, exists := s.pools[pool]
	if !exists {
		return nil, false
	}
	rows := make([]RecipientEntry, 0, len(table))
	for rcpt, e := range table {
		rows = append(rows, RecipientEntry{
			Recipient: rcpt,
			Amount:    new(big.Int).Set(e.Amount),
			Nonce:     new(big.Int).Set(e.Nonce),
		})
	}
	return rows, true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd go && go test ./internal/allocations/ -run TestEntries -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add go/internal/allocations/store.go go/internal/allocations/store_test.go
git commit -m "feat(m7): add allocations.Entries copy-safe iterator"
```

---

### Task 2: `chain.Reader` — `Organizer` + `UsedNonce`

**Files:**
- Modify: `go/internal/chain/reader.go`
- Test: `go/internal/chain/reader_test.go` (create)

There is no live RPC in unit tests, so test only the pure calldata encoding + return decoding via small exported-through-package helpers. Add unexported calldata builders and decoders, and test those directly.

- [ ] **Step 1: Write the failing test**

Create `go/internal/chain/reader_test.go`:

```go
package chain

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

func TestUsedNonceCalldataAndDecode(t *testing.T) {
	// selector = keccak256("usedNonce(uint256)")[:4], then 32-byte big-endian nonce.
	cd := usedNonceCalldata(big.NewInt(5))
	if len(cd) != 4+32 {
		t.Fatalf("calldata len = %d, want 36", len(cd))
	}
	want := selector("usedNonce(uint256)")
	for i := 0; i < 4; i++ {
		if cd[i] != want[i] {
			t.Fatalf("selector mismatch at %d", i)
		}
	}
	if cd[35] != 5 {
		t.Fatalf("nonce not right-aligned: last byte = %d", cd[35])
	}

	// bool decode: last byte 1 => true, 0 => false.
	trueWord := make([]byte, 32)
	trueWord[31] = 1
	if !decodeBool(trueWord) {
		t.Fatal("want true")
	}
	if decodeBool(make([]byte, 32)) {
		t.Fatal("want false")
	}
}

func TestOrganizerCalldataAndDecode(t *testing.T) {
	cd := organizerCalldata()
	if len(cd) != 4 {
		t.Fatalf("organizer() calldata len = %d, want 4", len(cd))
	}
	// address is right-20-bytes of the 32-byte word.
	word := make([]byte, 32)
	addr := common.HexToAddress("0x00000000000000000000000000000000000000ab")
	copy(word[12:], addr.Bytes())
	if decodeAddress(word) != addr {
		t.Fatalf("address decode wrong: %s", decodeAddress(word).Hex())
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd go && go test ./internal/chain/ -v`
Expected: FAIL — `usedNonceCalldata` / `organizerCalldata` / `decodeBool` / `decodeAddress` undefined.

- [ ] **Step 3: Write minimal implementation**

Add to `go/internal/chain/reader.go`:

```go
import (
	// existing imports plus:
	"github.com/ethereum/go-ethereum/common/math"
)

func organizerCalldata() []byte { return selector("organizer()") }

func usedNonceCalldata(nonce *big.Int) []byte {
	cd := selector("usedNonce(uint256)")
	return append(cd, math.U256Bytes(new(big.Int).Set(nonce))...) // 32-byte left-padded
}

func decodeBool(word []byte) bool  { return len(word) >= 32 && word[31] != 0 }
func decodeAddress(word []byte) common.Address {
	return common.BytesToAddress(word[len(word)-20:])
}

// Organizer calls Pool(pool).organizer().
func (r *Reader) Organizer(ctx context.Context, pool common.Address) (common.Address, error) {
	out, err := r.client.CallContract(ctx, ethereum.CallMsg{To: &pool, Data: organizerCalldata()}, nil)
	if err != nil {
		return common.Address{}, err
	}
	if len(out) < 32 {
		return common.Address{}, fmt.Errorf("short return from organizer")
	}
	return decodeAddress(out[:32]), nil
}

// UsedNonce calls Pool(pool).usedNonce(nonce).
func (r *Reader) UsedNonce(ctx context.Context, pool common.Address, nonce *big.Int) (bool, error) {
	out, err := r.client.CallContract(ctx, ethereum.CallMsg{To: &pool, Data: usedNonceCalldata(nonce)}, nil)
	if err != nil {
		return false, err
	}
	if len(out) < 32 {
		return false, fmt.Errorf("short return from usedNonce")
	}
	return decodeBool(out[:32]), nil
}
```

Note: `math.U256Bytes` returns a fixed 32-byte big-endian representation — exactly one ABI word. Verify the import path `github.com/ethereum/go-ethereum/common/math` resolves (it is part of go-ethereum, already a dependency).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd go && go test ./internal/chain/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add go/internal/chain/reader.go go/internal/chain/reader_test.go
git commit -m "feat(m7): add chain reader Organizer + UsedNonce"
```

---

### Task 3: op-command + types wiring

**Files:**
- Modify: `go/internal/config/config.go`
- Modify: `go/pkg/types/types.go`
- Modify: `contracts/InstructionSender.sol`
- Test: none (wiring; exercised by Task 4 handler tests + `go build`/`forge build`)

- [ ] **Step 1: Add the op-command constant (config.go)**

In `go/internal/config/config.go`, add to the const block after `OPCommandComplianceReport`:

```go
	OPCommandUnclaimedReport  = "UNCLAIMED_REPORT"
```

- [ ] **Step 2: Add message/arg/payload/result types (types.go)**

In `go/pkg/types/types.go`, add after `ComplianceReportMessage`:

```go
// UnclaimedReportMessage is the ABI payload from sendUnclaimedReport.
type UnclaimedReportMessage struct {
	Payload []byte
	Pool    common.Address
}

// UnclaimedReportPayload is the parsed UNCLAIMED_REPORT request payload.
type UnclaimedReportPayload struct {
	OrganizerPubHex string `json:"organizerPubHex"`
	ChallengeSig    string `json:"challengeSig"`
}

// UnclaimedReportResult carries the ECIES-encrypted non-claimant list.
type UnclaimedReportResult struct {
	Report string `json:"report"` // 0x-hex ECIES ciphertext of []unclaimedItem
}

// unclaimedItem is one row inside the encrypted report body.
type unclaimedItem struct {
	Recipient string `json:"recipient"`
	Amount    string `json:"amount"`
}
```

Because `unclaimedItem` is unexported and the handler lives in package `extension`, the handler will define its own local item struct with identical JSON tags. To keep them in one place, EXPORT it instead — change `type unclaimedItem` to:

```go
// UnclaimedItem is one row inside the encrypted report body.
type UnclaimedItem struct {
	Recipient string `json:"recipient"`
	Amount    string `json:"amount"`
}
```

Then add the ABI arg in the `init()` of `types.go`, after `ComplianceReportArg`:

```go
	urTy, _ := abi.NewType("tuple", "", []abi.ArgumentMarshaling{
		{Name: "payload", Type: "bytes"},
		{Name: "pool", Type: "address"},
	})
	UnclaimedReportArg = abi.Argument{Type: urTy}
```

And add `UnclaimedReportArg` to the `var (...)` declaration block alongside the other `*Arg` vars:

```go
var (
	SubmitAllocationArg abi.Argument
	ClaimVerifyArg      abi.Argument
	ComplianceReportArg abi.Argument
	UnclaimedReportArg  abi.Argument
)
```

- [ ] **Step 3: Add contract op-command + struct + sender (InstructionSender.sol)**

In `contracts/InstructionSender.sol`:

After the `OP_COMMAND_COMPLIANCE_REPORT` declaration add:

```solidity
    /// @notice Command for the UNCLAIMED_REPORT action.
    // forge-lint: disable-next-line(unsafe-typecast)
    bytes32 public constant OP_COMMAND_UNCLAIMED_REPORT = bytes32("UNCLAIMED_REPORT");
```

After `struct ComplianceReportMessage { address pool; }` add:

```solidity
    struct UnclaimedReportMessage { bytes payload; address pool; }
```

After `sendComplianceReport(...)` add:

```solidity
    /// @notice Ask the TEE for the encrypted non-claimant list for `pool`.
    /// `payload` carries the organizer enc pubkey + challenge sig.
    function sendUnclaimedReport(bytes calldata payload, address pool) external payable {
        address[] memory teeIds = TEE_MACHINE_REGISTRY.getRandomTeeIds(_getExtensionId(), 1);
        address[] memory cosigners = new address[](0);
        ITeeExtensionRegistry.TeeInstructionParams memory params = ITeeExtensionRegistry.TeeInstructionParams({
            opType: OP_TYPE_PRIZEPOOL,
            opCommand: OP_COMMAND_UNCLAIMED_REPORT,
            message: abi.encode(UnclaimedReportMessage({payload: payload, pool: pool})),
            cosigners: cosigners,
            cosignersThreshold: 0,
            claimBackAddress: msg.sender
        });
        TEE_EXTENSION_REGISTRY.sendInstructions{value: msg.value}(teeIds, params);
    }
```

- [ ] **Step 4: Verify both sides build**

Run: `cd go && go build ./...`
Expected: builds (types + config compile; handler not yet added — no reference to it yet, so this passes).

Run: `forge build`
Expected: compiles.

`bytes32("UNCLAIMED_REPORT")` — the string is 16 bytes, well under 32; Go `teeutils.ToHash("UNCLAIMED_REPORT")` must equal it (right-padded). This is the same mechanism proven for the other three commands.

- [ ] **Step 5: Commit**

```bash
git add go/internal/config/config.go go/pkg/types/types.go contracts/InstructionSender.sol
git commit -m "feat(m7): wire UNCLAIMED_REPORT op-command + types"
```

---

### Task 4: `recoverChallenge` helper + `handleUnclaimedReport`

**Files:**
- Modify: `go/internal/extension/extension.go`
- Test: `go/internal/extension/unclaimed_test.go` (create)

- [ ] **Step 1: Refactor shared challenge recovery (no behavior change)**

In `go/internal/extension/extension.go`, add this helper:

```go
// recoverChallenge recovers the signer address of a personal_sign challenge.
// sigHex is a 65-byte hex signature with V in {27,28}.
func recoverChallenge(challenge, sigHex string) (common.Address, error) {
	sig := common.FromHex(sigHex)
	if len(sig) != 65 || sig[64] < 27 {
		return common.Address{}, fmt.Errorf("bad challenge sig")
	}
	rec := make([]byte, 65)
	copy(rec, sig)
	rec[64] -= 27
	pub, err := crypto.SigToPub(accounts.TextHash([]byte(challenge)), rec)
	if err != nil {
		return common.Address{}, err
	}
	return crypto.PubkeyToAddress(*pub), nil
}
```

Then replace the inline recovery inside `handleClaimVerify` (lines ~199-214) with:

```go
	challenge := "ConfidentialPrizePool claim\npool:" + pool.Hex() + "\nkey:" + req.RecipientPubHex
	recipient, err := recoverChallenge(challenge, req.ChallengeSig)
	if err != nil {
		return 0, []byte("bad challenge sig")
	}
```

(Delete the now-dead `sig := common.FromHex(...)` block through `recipient := crypto.PubkeyToAddress(*pub)`.)

- [ ] **Step 2: Verify existing claim tests still pass**

Run: `cd go && go test ./internal/extension/ -v`
Expected: PASS (claim tests unchanged in behavior).

- [ ] **Step 3: Write the failing test for the handler**

Create `go/internal/extension/unclaimed_test.go`. This uses a fake reader implementing the widened interface, plus a real signer + ECIES round-trip.

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

	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// fakeReader implements the widened poolReader interface for tests.
type fakeReader struct {
	deposit   *big.Int
	organizer common.Address
	used      map[string]bool // nonce.String() -> used
}

func (f *fakeReader) TotalDeposited(ctx context.Context, pool common.Address) (*big.Int, error) {
	return f.deposit, nil
}
func (f *fakeReader) Organizer(ctx context.Context, pool common.Address) (common.Address, error) {
	return f.organizer, nil
}
func (f *fakeReader) UsedNonce(ctx context.Context, pool common.Address, nonce *big.Int) (bool, error) {
	return f.used[nonce.String()], nil
}

// signChallenge mimics a personal_sign over the challenge with key `pk`.
func signChallenge(t *testing.T, pkHex, challenge string) string {
	t.Helper()
	pk, _ := crypto.HexToECDSA(pkHex)
	sig, err := crypto.Sign(accounts.TextHash([]byte(challenge)), pk)
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	sig[64] += 27
	return "0x" + common.Bytes2Hex(sig)
}

func TestUnclaimedReportHappyPath(t *testing.T) {
	// Organizer key.
	orgPkHex := "b71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291"
	orgPk, _ := crypto.HexToECDSA(orgPkHex)
	organizer := crypto.PubkeyToAddress(orgPk.PublicKey)
	orgPubHex := "0x" + common.Bytes2Hex(crypto.FromECDSAPub(&orgPk.PublicKey))

	// TEE signer (arbitrary).
	sgn, _ := signer.NewFromHex("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", 114)

	store := allocations.New()
	pool := common.HexToAddress("0x1111111111111111111111111111111111111111")
	r1 := common.HexToAddress("0xaaaa000000000000000000000000000000000001") // nonce 0
	r2 := common.HexToAddress("0xaaaa000000000000000000000000000000000002") // nonce 1
	r3 := common.HexToAddress("0xaaaa000000000000000000000000000000000003") // nonce 2
	if err := store.Submit(pool, []allocations.Input{
		{Recipient: r1, Amount: big.NewInt(10)},
		{Recipient: r2, Amount: big.NewInt(20)},
		{Recipient: r3, Amount: big.NewInt(30)},
	}, big.NewInt(100)); err != nil {
		t.Fatalf("submit: %v", err)
	}

	reader := &fakeReader{
		deposit:   big.NewInt(100),
		organizer: organizer,
		used:      map[string]bool{"1": true, "2": true}, // r2, r3 claimed; r1 not
	}
	e := New(0, 0, sgn, store, reader)

	challenge := "ConfidentialPrizePool unclaimed\npool:" + pool.Hex() + "\nkey:" + orgPubHex
	payload, _ := json.Marshal(types.UnclaimedReportPayload{
		OrganizerPubHex: orgPubHex,
		ChallengeSig:    signChallenge(t, orgPkHex, challenge),
	})

	status, data := e.handleUnclaimedReport(context.Background(), pool, payload)
	if status != 1 {
		t.Fatalf("status=%d data=%s", status, data)
	}
	var res types.UnclaimedReportResult
	if err := json.Unmarshal(data, &res); err != nil {
		t.Fatalf("unmarshal result: %v", err)
	}

	// Decrypt with organizer private key.
	ct := common.FromHex(res.Report)
	plain, err := signer.DecryptWith(orgPkHex, ct)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	var rows []types.UnclaimedItem
	if err := json.Unmarshal(plain, &rows); err != nil {
		t.Fatalf("unmarshal rows: %v", err)
	}
	if len(rows) != 1 || common.HexToAddress(rows[0].Recipient) != r1 || rows[0].Amount != "10" {
		t.Fatalf("want only r1/10, got %+v", rows)
	}
}

func TestUnclaimedReportRejectsNonOrganizer(t *testing.T) {
	sgn, _ := signer.NewFromHex("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", 114)
	store := allocations.New()
	pool := common.HexToAddress("0x1111111111111111111111111111111111111111")
	_ = store.Submit(pool, []allocations.Input{
		{Recipient: common.HexToAddress("0xaaaa000000000000000000000000000000000001"), Amount: big.NewInt(10)},
	}, big.NewInt(100))

	// Reader says organizer is someone else.
	reader := &fakeReader{
		deposit:   big.NewInt(100),
		organizer: common.HexToAddress("0xdead00000000000000000000000000000000beef"),
		used:      map[string]bool{},
	}
	e := New(0, 0, sgn, store, reader)

	// Attacker signs with their own key.
	atkPkHex := "b71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291"
	atkPk, _ := crypto.HexToECDSA(atkPkHex)
	atkPubHex := "0x" + common.Bytes2Hex(crypto.FromECDSAPub(&atkPk.PublicKey))
	challenge := "ConfidentialPrizePool unclaimed\npool:" + pool.Hex() + "\nkey:" + atkPubHex
	payload, _ := json.Marshal(types.UnclaimedReportPayload{
		OrganizerPubHex: atkPubHex,
		ChallengeSig:    signChallenge(t, atkPkHex, challenge),
	})

	status, data := e.handleUnclaimedReport(context.Background(), pool, payload)
	if status != 0 {
		t.Fatalf("expected rejection, got status=1 data=%s", data)
	}
}

func TestUnclaimedReportUnknownPool(t *testing.T) {
	orgPkHex := "b71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291"
	orgPk, _ := crypto.HexToECDSA(orgPkHex)
	organizer := crypto.PubkeyToAddress(orgPk.PublicKey)
	orgPubHex := "0x" + common.Bytes2Hex(crypto.FromECDSAPub(&orgPk.PublicKey))

	sgn, _ := signer.NewFromHex("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", 114)
	store := allocations.New()
	pool := common.HexToAddress("0x2222222222222222222222222222222222222222")
	reader := &fakeReader{deposit: big.NewInt(0), organizer: organizer, used: map[string]bool{}}
	e := New(0, 0, sgn, store, reader)

	challenge := "ConfidentialPrizePool unclaimed\npool:" + pool.Hex() + "\nkey:" + orgPubHex
	payload, _ := json.Marshal(types.UnclaimedReportPayload{
		OrganizerPubHex: orgPubHex,
		ChallengeSig:    signChallenge(t, orgPkHex, challenge),
	})
	status, _ := e.handleUnclaimedReport(context.Background(), pool, payload)
	if status != 0 {
		t.Fatal("unknown pool should return status 0")
	}
}
```

This test references `signer.DecryptWith(pkHex, ct)` — a test-oriented decrypt-by-arbitrary-key helper. If `signer` already exposes an equivalent (e.g. a `DecryptWith`/`decryptWith`), reuse it; otherwise add it in Step 5.

- [ ] **Step 4: Run test to verify it fails**

Run: `cd go && go test ./internal/extension/ -run TestUnclaimedReport -v`
Expected: FAIL — `handleUnclaimedReport undefined`, `poolReader` interface too narrow, and possibly `signer.DecryptWith undefined`.

- [ ] **Step 5: Widen the reader interface, add the handler + routing**

In `go/internal/extension/extension.go`:

Replace the `depositReader` interface with a widened one (keep the field name `reader`):

```go
type poolReader interface {
	TotalDeposited(ctx context.Context, pool common.Address) (*big.Int, error)
	Organizer(ctx context.Context, pool common.Address) (common.Address, error)
	UsedNonce(ctx context.Context, pool common.Address, nonce *big.Int) (bool, error)
}
```

Update the struct field and `New` signature to use `poolReader` instead of `depositReader`:

```go
	reader poolReader
```
```go
func New(extensionPort, signPort int, s *signer.Signer, store *allocations.Store, reader poolReader) *Extension {
```

Add the route in `processPrizePool` (after the compliance case):

```go
	case df.OPCommand == teeutils.ToHash(config.OPCommandUnclaimedReport):
		b, _ := json.Marshal(e.processUnclaimedReport(action, df))
		return http.StatusOK, b
```

Add the processor + handler:

```go
func (e *Extension) processUnclaimedReport(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	var msg types.UnclaimedReportMessage
	if err := structs.DecodeTo(types.UnclaimedReportArg, df.OriginalMessage, &msg); err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decoding message: %w", err))
	}
	status, data := e.handleUnclaimedReport(context.Background(), msg.Pool, msg.Payload)
	return buildResult(action, df, data, status, resultErr(status, data))
}

// handleUnclaimedReport verifies the caller is the pool organizer, joins the
// private allocation table against on-chain usedNonce, and returns the
// non-claimant list ECIES-encrypted to the organizer. Nothing is logged or
// published on-chain.
func (e *Extension) handleUnclaimedReport(ctx context.Context, pool common.Address, payload []byte) (uint8, []byte) {
	var req types.UnclaimedReportPayload
	if err := json.Unmarshal(payload, &req); err != nil {
		return 0, []byte("bad payload")
	}
	challenge := "ConfidentialPrizePool unclaimed\npool:" + pool.Hex() + "\nkey:" + req.OrganizerPubHex
	caller, err := recoverChallenge(challenge, req.ChallengeSig)
	if err != nil {
		return 0, []byte("bad challenge sig")
	}
	organizer, err := e.reader.Organizer(ctx, pool)
	if err != nil {
		return 0, []byte("organizer read failed")
	}
	if caller != organizer {
		return 0, []byte("not organizer")
	}

	rows, ok := e.store.Entries(pool)
	if !ok {
		return 0, []byte("no allocations for pool")
	}
	unclaimed := make([]types.UnclaimedItem, 0, len(rows))
	for _, row := range rows {
		used, err := e.reader.UsedNonce(ctx, pool, row.Nonce)
		if err != nil {
			return 0, []byte("nonce read failed")
		}
		if !used {
			unclaimed = append(unclaimed, types.UnclaimedItem{
				Recipient: row.Recipient.Hex(),
				Amount:    row.Amount.String(),
			})
		}
	}

	body, _ := json.Marshal(unclaimed)
	ct, err := signer.EncryptTo(req.OrganizerPubHex, body)
	if err != nil {
		return 0, []byte("encrypt failed")
	}
	out, _ := json.Marshal(types.UnclaimedReportResult{Report: "0x" + common.Bytes2Hex(ct)})
	return 1, out
}
```

If `signer.DecryptWith` does not already exist, add to `go/internal/signer/signer.go`:

```go
// DecryptWith decrypts ECIES ciphertext with an arbitrary private key (hex).
// Test/helper use — production decrypt uses the signer's own key via Decrypt.
func DecryptWith(privHex string, ct []byte) ([]byte, error) {
	priv, err := crypto.HexToECDSA(strings.TrimPrefix(privHex, "0x"))
	if err != nil {
		return nil, err
	}
	return ecies.ImportECDSA(priv).Decrypt(ct, nil, nil)
}
```
(Add `"strings"` and the `ecies` import if not present — mirror the existing `EncryptTo`/`Decrypt` in the file.)

- [ ] **Step 6: Run test to verify it passes**

Run: `cd go && go test ./internal/extension/ -run TestUnclaimedReport -v`
Expected: PASS (all three cases).

- [ ] **Step 7: Run the full Go + Solidity suites**

Run: `cd go && go build ./... && go test ./...`
Expected: PASS (claim/compliance/allocation tests still green after the interface widen + refactor).

Run: `forge build && forge test`
Expected: PASS (InstructionSender additions compile; existing 27 tests green).

- [ ] **Step 8: Commit**

```bash
git add go/internal/extension/ go/internal/signer/signer.go
git commit -m "feat(m7): UNCLAIMED_REPORT handler + shared recoverChallenge helper"
```

---

### Task 5: Update memory + milestone doc

**Files:**
- Modify: `C:/Users/DELL/.claude/projects/F--PROJECTS-LOCKBOX/memory/confidential-prize-pool.md`

- [ ] **Step 1: Record M7 completion**

Append to the milestone status in the memory file: M7 UNCLAIMED_REPORT done — private non-claimant report (organizer-auth via signed challenge + `caller==Pool.organizer()`, joins store vs on-chain `usedNonce`, ECIES to organizer, nothing on-chain). New: `store.Entries`, `reader.Organizer`/`UsedNonce`, `recoverChallenge` helper, op-command wiring. No new EIP-712 → no interop test. Note remaining: M5 anonymity, M8 FXRP, M9 frontend, M10 demo; FTDC live-registration still blocked Flare-side.

- [ ] **Step 2: No commit needed** (memory is outside the repo tree).

---

## Self-Review Notes

- **Spec §4 coverage:** Task 1 = `Entries`; Task 2 = `Organizer`/`UsedNonce`; Task 3 = config/types/InstructionSender wiring; Task 4 = handler + `recoverChallenge` + interface widen. All §4 components mapped.
- **Spec §7 testing coverage:** `Entries` copy-safety (Task 1); happy path w/ nonce join + ECIES decrypt (Task 4); non-organizer rejection (Task 4); unknown pool (Task 4); `recoverChallenge` exercised transitively by both claim (existing tests) and unclaimed happy path. No interop test — consistent with §7 ("no new EIP-712").
- **Type consistency:** `UnclaimedItem` (exported) used identically in types.go + handler + test. `UnclaimedReportPayload{OrganizerPubHex,ChallengeSig}`, `UnclaimedReportResult{Report}`, `UnclaimedReportArg` tuple `(bytes payload, address pool)` matches Solidity `struct UnclaimedReportMessage { bytes payload; address pool; }` and Go `UnclaimedReportMessage{Payload []byte; Pool common.Address}` — same field order as the proven `ClaimVerify` pairing.
- **No on-chain change:** `Pool.sol` untouched, per design §1.
```
