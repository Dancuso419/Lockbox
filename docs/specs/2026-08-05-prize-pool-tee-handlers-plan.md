# Confidential Prize Pool — M1/M3/M4 TEE Handlers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Go TEE handlers that privately hold prize-pool allocations (`SUBMIT_ALLOCATION`) and issue confidential EIP-712 vouchers (`CLAIM_VERIFY`) that the already-built `Pool.sol` redeems, plus the `GREETING`→`PRIZEPOOL` rename — with a cross-language test proving Go-signed vouchers pass on-chain.

**Architecture:** Three focused Go packages — `signer` (secp256k1 from env: EIP-712 voucher signing + ECIES encrypt/decrypt), `allocations` (in-memory per-pool store with on-chain deposit-cap check), `chain` (ethclient reader for `Pool.totalDeposited()`) — wired into the existing route-by-OPType→OPCommand handler. A Foundry FFI test signs a voucher via the Go binary against a freshly-deployed Pool and asserts `claim` succeeds.

**Tech Stack:** Go (go-ethereum v1.17.4: `crypto`, `crypto/ecies`, `ethclient`, `common`), the Flare tee-node/go-flare-common libs already imported; Solidity/Foundry for the interop test.

**Spec:** `docs/specs/2026-08-05-prize-pool-tee-handlers-design.md`
**Branch:** `feat/prize-pool-contracts` (already checked out).
**Go module dir:** `F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go` (run `go test`/`go build` from here).
**Repo root:** `F:/PROJECTS/LOCKBOX/fce-extension-scaffold` (run `forge` from here).
**PATH note (Git Bash):** `export PATH="$PATH:/c/Program Files/Go/bin:/c/Users/DELL/.foundry/bin:/c/Users/DELL/bin"` before go/forge commands.

---

## File Structure

- Create `go/internal/signer/signer.go` + `signer_test.go` — key load, EIP-712 `SignVoucher`, ECIES `EncryptTo`/`Decrypt`.
- Create `go/internal/allocations/store.go` + `store_test.go` — per-pool in-memory allocation store.
- Create `go/internal/chain/reader.go` + `reader_test.go` — `totalDeposited()` reader (unit-test the calldata).
- Modify `go/internal/config/config.go` — PRIZEPOOL consts, `Version`, env accessors.
- Modify `go/pkg/types/types.go` — request/response structs, ABI args, `/state` signer address.
- Modify `go/internal/extension/extension.go` — route PRIZEPOOL → two handlers; embed deps.
- Create `go/cmd/sign-voucher/main.go` — tiny CLI used by the Foundry FFI test (reuses `signer`).
- Modify `contracts/InstructionSender.sol` — rename to `PrizePoolInstructionSender`, `bytes32` consts, two send fns.
- Modify `foundry.toml` — enable `ffi = true`.
- Create `test/VoucherInterop.t.sol` — FFI cross-language voucher test.

> The tee-node `Action` message payload is decoded from `df.OriginalMessage`; our two commands carry their own `pool` address + blobs in the payload, so no dependency on the Action exposing the on-chain caller (recipient auth = signed challenge).

---

## Task 1: `signer` — EIP-712 voucher signing

**Files:** Create `go/internal/signer/signer.go`, `go/internal/signer/signer_test.go`.

- [ ] **Step 1: Write the failing test**

Create `go/internal/signer/signer_test.go`:
```go
package signer

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// A fixed test key (NOT for real funds).
const testKeyHex = "353c43dada1ebc390f9594ed91753446e19389ae545fc7fada020816346efb73"

func TestSignVoucher_RecoversToSignerAddress(t *testing.T) {
	s, err := NewFromHex(testKeyHex, big.NewInt(114))
	if err != nil {
		t.Fatalf("NewFromHex: %v", err)
	}

	pool := common.HexToAddress("0xB91c743E0c9FD6068f1833759a146E950312955B")
	recipient := common.HexToAddress("0x000000000000000000000000000000000000bEEF")
	amount := big.NewInt(3_000_000_000_000_000_000)
	nonce := big.NewInt(1)

	sig, err := s.SignVoucher(pool, recipient, amount, nonce)
	if err != nil {
		t.Fatalf("SignVoucher: %v", err)
	}
	if len(sig) != 65 {
		t.Fatalf("sig len = %d, want 65", len(sig))
	}
	if v := sig[64]; v != 27 && v != 28 {
		t.Fatalf("V = %d, want 27 or 28", v)
	}

	// Recompute digest the same way and ecrecover; must equal s.Address().
	digest := s.voucherDigest(pool, recipient, amount, nonce)
	recovered, err := crypto.SigToPub(digest, sigWithV0(sig))
	if err != nil {
		t.Fatalf("SigToPub: %v", err)
	}
	if got := crypto.PubkeyToAddress(*recovered); got != s.Address() {
		t.Fatalf("recovered %s, want %s", got, s.Address())
	}
}

// helper: crypto.SigToPub needs V in {0,1}
func sigWithV0(sig []byte) []byte {
	c := make([]byte, 65)
	copy(c, sig)
	c[64] -= 27
	return c
}
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go test ./internal/signer/ -run TestSignVoucher -v
```
Expected: FAIL — package/symbols undefined.

- [ ] **Step 3: Write minimal implementation**

Create `go/internal/signer/signer.go`:
```go
// Package signer holds the extension's secp256k1 key and produces the EIP-712
// vouchers Pool.sol verifies, plus ECIES encrypt/decrypt for confidential I/O.
package signer

import (
	"crypto/ecdsa"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// Must byte-match Pool.sol: EIP712("ConfidentialPrizePool","1") and
// Voucher(address recipient,uint256 amount,uint256 nonce).
var (
	domainTypehash  = crypto.Keccak256([]byte("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"))
	nameHash        = crypto.Keccak256([]byte("ConfidentialPrizePool"))
	versionHash     = crypto.Keccak256([]byte("1"))
	voucherTypehash = crypto.Keccak256([]byte("Voucher(address recipient,uint256 amount,uint256 nonce)"))
)

type Signer struct {
	key     *ecdsa.PrivateKey
	addr    common.Address
	chainID *big.Int
}

// NewFromHex loads a secp256k1 key from hex (no 0x prefix required).
func NewFromHex(hexKey string, chainID *big.Int) (*Signer, error) {
	if len(hexKey) >= 2 && hexKey[0:2] == "0x" {
		hexKey = hexKey[2:]
	}
	key, err := crypto.HexToECDSA(hexKey)
	if err != nil {
		return nil, err
	}
	return &Signer{key: key, addr: crypto.PubkeyToAddress(key.PublicKey), chainID: chainID}, nil
}

func (s *Signer) Address() common.Address { return s.addr }

func word(b []byte) []byte { return common.LeftPadBytes(b, 32) }

func (s *Signer) domainSeparator(pool common.Address) []byte {
	enc := make([]byte, 0, 160)
	enc = append(enc, domainTypehash...)
	enc = append(enc, nameHash...)
	enc = append(enc, versionHash...)
	enc = append(enc, word(s.chainID.Bytes())...)
	enc = append(enc, word(pool.Bytes())...)
	return crypto.Keccak256(enc)
}

func (s *Signer) voucherDigest(pool, recipient common.Address, amount, nonce *big.Int) []byte {
	structEnc := make([]byte, 0, 128)
	structEnc = append(structEnc, voucherTypehash...)
	structEnc = append(structEnc, word(recipient.Bytes())...)
	structEnc = append(structEnc, word(amount.Bytes())...)
	structEnc = append(structEnc, word(nonce.Bytes())...)
	structHash := crypto.Keccak256(structEnc)

	pre := make([]byte, 0, 66)
	pre = append(pre, 0x19, 0x01)
	pre = append(pre, s.domainSeparator(pool)...)
	pre = append(pre, structHash...)
	return crypto.Keccak256(pre)
}

// SignVoucher returns a 65-byte [R||S||V] signature with V normalized to 27/28
// (OZ ECDSA.recover rejects V in {0,1}).
func (s *Signer) SignVoucher(pool, recipient common.Address, amount, nonce *big.Int) ([]byte, error) {
	digest := s.voucherDigest(pool, recipient, amount, nonce)
	sig, err := crypto.Sign(digest, s.key)
	if err != nil {
		return nil, err
	}
	sig[64] += 27
	return sig, nil
}
```

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go test ./internal/signer/ -run TestSignVoucher -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add go/internal/signer/signer.go go/internal/signer/signer_test.go
git commit -m "feat(signer): EIP-712 voucher signing matching Pool.sol domain"
```

---

## Task 2: `signer` — ECIES encrypt/decrypt

**Files:** Modify `go/internal/signer/signer.go`; add to `go/internal/signer/signer_test.go`.

- [ ] **Step 1: Write the failing test**

Append to `go/internal/signer/signer_test.go`:
```go
func TestECIES_Roundtrip(t *testing.T) {
	s, _ := NewFromHex(testKeyHex, big.NewInt(114))
	msg := []byte(`{"allocations":[{"recipient":"0x00..bEEF","amount":"3"}]}`)

	// Encrypt to the signer's own pubkey, then decrypt with its private key.
	ct, err := EncryptTo(s.PubKeyHex(), msg)
	if err != nil {
		t.Fatalf("EncryptTo: %v", err)
	}
	if len(ct) == 0 || string(ct) == string(msg) {
		t.Fatal("ciphertext not produced")
	}
	pt, err := s.Decrypt(ct)
	if err != nil {
		t.Fatalf("Decrypt: %v", err)
	}
	if string(pt) != string(msg) {
		t.Fatalf("roundtrip mismatch: %q != %q", pt, msg)
	}
}

func TestECIES_WrongKeyFails(t *testing.T) {
	s1, _ := NewFromHex(testKeyHex, big.NewInt(114))
	s2, _ := NewFromHex("983760a4ebf75b2ac3a93531168a0f225d01e5dc6e3568adbd46233ba1fb4fa4", big.NewInt(114))
	ct, _ := EncryptTo(s1.PubKeyHex(), []byte("secret"))
	if _, err := s2.Decrypt(ct); err == nil {
		t.Fatal("expected decrypt with wrong key to fail")
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go test ./internal/signer/ -run TestECIES -v
```
Expected: FAIL — `EncryptTo`/`Decrypt`/`PubKeyHex` undefined.

- [ ] **Step 3: Write minimal implementation**

Add to `go/internal/signer/signer.go` (new import + methods):
```go
// add to imports:
//   "crypto/rand"
//   "github.com/ethereum/go-ethereum/crypto/ecies"

// PubKeyHex returns the uncompressed public key as 0x-prefixed hex (65 bytes:
// 0x04||X||Y) — what callers ECIES-encrypt to.
func (s *Signer) PubKeyHex() string {
	return "0x" + common.Bytes2Hex(crypto.FromECDSAPub(&s.key.PublicKey))
}

// EncryptTo ECIES-encrypts plaintext to a secp256k1 uncompressed pubkey hex.
func EncryptTo(pubHex string, plaintext []byte) ([]byte, error) {
	raw := common.FromHex(pubHex)
	pub, err := crypto.UnmarshalPubkey(raw)
	if err != nil {
		return nil, err
	}
	epub := ecies.ImportECDSAPublic(pub)
	return ecies.Encrypt(rand.Reader, epub, plaintext, nil, nil)
}

// Decrypt ECIES-decrypts ciphertext with the signer's private key.
func (s *Signer) Decrypt(ciphertext []byte) ([]byte, error) {
	epriv := ecies.ImportECDSA(s.key)
	return epriv.Decrypt(ciphertext, nil, nil)
}
```

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go test ./internal/signer/ -v
```
Expected: PASS (all signer tests).

- [ ] **Step 5: Commit**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add go/internal/signer/signer.go go/internal/signer/signer_test.go
git commit -m "feat(signer): ECIES encrypt/decrypt for confidential allocation and voucher I/O"
```

---

## Task 3: `allocations` — in-memory per-pool store

**Files:** Create `go/internal/allocations/store.go`, `go/internal/allocations/store_test.go`.

- [ ] **Step 1: Write the failing test**

Create `go/internal/allocations/store_test.go`:
```go
package allocations

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

func addr(b byte) common.Address { return common.Address{19: b} }

func TestSubmit_HappyPath(t *testing.T) {
	s := New()
	pool := addr(1)
	entries := []Input{{Recipient: addr(0xA), Amount: big.NewInt(3)}, {Recipient: addr(0xB), Amount: big.NewInt(5)}}
	if err := s.Submit(pool, entries, big.NewInt(10)); err != nil {
		t.Fatalf("Submit: %v", err)
	}
	ea, ok := s.Lookup(pool, addr(0xA))
	if !ok || ea.Amount.Cmp(big.NewInt(3)) != 0 {
		t.Fatalf("lookup A: %+v ok=%v", ea, ok)
	}
	eb, _ := s.Lookup(pool, addr(0xB))
	if ea.Nonce.Cmp(eb.Nonce) == 0 {
		t.Fatal("nonces must differ")
	}
}

func TestSubmit_RejectsOverDeposit(t *testing.T) {
	s := New()
	entries := []Input{{Recipient: addr(0xA), Amount: big.NewInt(11)}}
	if err := s.Submit(addr(1), entries, big.NewInt(10)); err == nil {
		t.Fatal("expected over-deposit rejection")
	}
}

func TestSubmit_RejectsZeroAmountAndDuplicate(t *testing.T) {
	s := New()
	if err := s.Submit(addr(1), []Input{{Recipient: addr(0xA), Amount: big.NewInt(0)}}, big.NewInt(10)); err == nil {
		t.Fatal("expected zero-amount rejection")
	}
	dup := []Input{{Recipient: addr(0xA), Amount: big.NewInt(1)}, {Recipient: addr(0xA), Amount: big.NewInt(1)}}
	if err := s.Submit(addr(2), dup, big.NewInt(10)); err == nil {
		t.Fatal("expected duplicate-recipient rejection")
	}
}

func TestSubmit_SecondSubmitRejected(t *testing.T) {
	s := New()
	pool := addr(1)
	_ = s.Submit(pool, []Input{{Recipient: addr(0xA), Amount: big.NewInt(1)}}, big.NewInt(10))
	if err := s.Submit(pool, []Input{{Recipient: addr(0xB), Amount: big.NewInt(1)}}, big.NewInt(10)); err == nil {
		t.Fatal("expected second submit for same pool to be rejected")
	}
}

func TestLookup_IsolatesPools(t *testing.T) {
	s := New()
	_ = s.Submit(addr(1), []Input{{Recipient: addr(0xA), Amount: big.NewInt(1)}}, big.NewInt(10))
	if _, ok := s.Lookup(addr(2), addr(0xA)); ok {
		t.Fatal("lookup should not cross pools")
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go test ./internal/allocations/ -v
```
Expected: FAIL — undefined `New`, `Input`, `Submit`, `Lookup`.

- [ ] **Step 3: Write minimal implementation**

Create `go/internal/allocations/store.go`:
```go
// Package allocations holds prize-pool allocation tables in TEE memory only.
// Nothing here is ever persisted or logged in cleartext.
package allocations

import (
	"fmt"
	"math/big"
	"sync"

	"github.com/ethereum/go-ethereum/common"
)

type Input struct {
	Recipient common.Address
	Amount    *big.Int
}

type Entry struct {
	Amount  *big.Int
	Nonce   *big.Int
	Claimed bool
}

type Store struct {
	mu    sync.RWMutex
	pools map[common.Address]map[common.Address]*Entry
}

func New() *Store {
	return &Store{pools: make(map[common.Address]map[common.Address]*Entry)}
}

// Submit validates and stores a pool's allocations. Allocations are immutable:
// a pool that already has a table is rejected. sum(amounts) must be <= total.
func (s *Store) Submit(pool common.Address, entries []Input, total *big.Int) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.pools[pool]; exists {
		return fmt.Errorf("allocations already set for pool")
	}

	table := make(map[common.Address]*Entry, len(entries))
	sum := new(big.Int)
	for i, in := range entries {
		if in.Amount == nil || in.Amount.Sign() <= 0 {
			return fmt.Errorf("amount must be positive")
		}
		if _, dup := table[in.Recipient]; dup {
			return fmt.Errorf("duplicate recipient")
		}
		table[in.Recipient] = &Entry{Amount: new(big.Int).Set(in.Amount), Nonce: big.NewInt(int64(i))}
		sum.Add(sum, in.Amount)
	}
	if sum.Cmp(total) > 0 {
		return fmt.Errorf("allocation total exceeds deposit")
	}

	s.pools[pool] = table
	return nil
}

func (s *Store) Lookup(pool, recipient common.Address) (Entry, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	table, ok := s.pools[pool]
	if !ok {
		return Entry{}, false
	}
	e, ok := table[recipient]
	if !ok {
		return Entry{}, false
	}
	return *e, true
}
```
Then delete the stray empty `TestSubmit_AssignsNoncesAndLooksUp() {}` line from the test file (it was a scaffolding artifact — remove it so the file compiles).

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go test ./internal/allocations/ -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add go/internal/allocations/store.go go/internal/allocations/store_test.go
git commit -m "feat(allocations): in-memory per-pool store with deposit cap and nonce assignment"
```

---

## Task 4: `chain` — totalDeposited reader

**Files:** Create `go/internal/chain/reader.go`, `go/internal/chain/reader_test.go`.

- [ ] **Step 1: Write the failing test (unit-test the calldata; no live RPC)**

Create `go/internal/chain/reader_test.go`:
```go
package chain

import (
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

func TestTotalDepositedCalldata(t *testing.T) {
	// selector of totalDeposited() == first 4 bytes of keccak256("totalDeposited()")
	cd := totalDepositedCalldata()
	if len(cd) != 4 {
		t.Fatalf("calldata len %d, want 4", len(cd))
	}
	// Recompute the expected 4-byte selector independently and compare.
	exp := selector("totalDeposited()")
	if common.Bytes2Hex(cd) != common.Bytes2Hex(exp) {
		t.Fatalf("selector %x != %x", cd, exp)
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go test ./internal/chain/ -v
```
Expected: FAIL — undefined `totalDepositedCalldata`, `selector`.

- [ ] **Step 3: Write minimal implementation**

Create `go/internal/chain/reader.go`:
```go
// Package chain reads on-chain pool facts the TEE needs (the deposited total),
// so allocation validation is trustless rather than organizer-declared.
package chain

import (
	"context"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

func selector(sig string) []byte { return crypto.Keccak256([]byte(sig))[:4] }
func totalDepositedCalldata() []byte { return selector("totalDeposited()") }

type Reader struct {
	client *ethclient.Client
}

func Dial(rpcURL string) (*Reader, error) {
	c, err := ethclient.Dial(rpcURL)
	if err != nil {
		return nil, err
	}
	return &Reader{client: c}, nil
}

// TotalDeposited calls Pool(pool).totalDeposited() and returns the uint256.
func (r *Reader) TotalDeposited(ctx context.Context, pool common.Address) (*big.Int, error) {
	out, err := r.client.CallContract(ctx, ethereum.CallMsg{
		To:   &pool,
		Data: totalDepositedCalldata(),
	}, nil)
	if err != nil {
		return nil, err
	}
	if len(out) < 32 {
		return nil, fmt.Errorf("short return from totalDeposited")
	}
	return new(big.Int).SetBytes(out[:32]), nil
}
```

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go test ./internal/chain/ -v
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add go/internal/chain/reader.go go/internal/chain/reader_test.go
git commit -m "feat(chain): totalDeposited reader for trustless allocation validation"
```

---

## Task 5: M1 rename — config, types, InstructionSender, routing skeleton

**Files:** Modify `go/internal/config/config.go`, `go/pkg/types/types.go`, `go/internal/extension/extension.go`, `contracts/InstructionSender.sol`.

- [ ] **Step 1: Update `config.go` constants + env accessors**

In `go/internal/config/config.go`, replace the GREETING consts and bump Version:
```go
	Version = "0.2.0"

	OPTypePrizePool          = "PRIZEPOOL"
	OPCommandSubmitAllocation = "SUBMIT_ALLOCATION"
	OPCommandClaimVerify      = "CLAIM_VERIFY"
```
Add, in the same file, env helpers (after the existing `init()`):
```go
// SigningKeyHex returns the configured voucher signing key (hex, no 0x needed).
func SigningKeyHex() string { return os.Getenv("VOUCHER_SIGNING_KEY") }

// ChainURL returns the RPC endpoint for on-chain reads.
func ChainURL() string {
	if v := os.Getenv("CHAIN_URL"); v != "" {
		return v
	}
	return "https://coston2-api.flare.network/ext/C/rpc"
}

// ChainID is the EVM chain id vouchers are bound to (Coston2 = 114).
func ChainID() int64 {
	if v := os.Getenv("CHAIN_ID"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n
		}
	}
	return 114
}
```

- [ ] **Step 2: Replace GREETING structs in `types.go` with PRIZEPOOL payloads**

In `go/pkg/types/types.go`, replace the `SayHello*`/`SayGoodbye*` types and `State` with:
```go
// SubmitAllocationMessage is the ABI payload from sendSubmitAllocation(bytes,address).
type SubmitAllocationMessage struct {
	Ciphertext []byte
	Pool       common.Address
}

// ClaimVerifyMessage is the ABI payload from sendClaimVerify(bytes,address).
type ClaimVerifyMessage struct {
	Payload []byte
	Pool    common.Address
}

// AllocationTable is the decrypted SUBMIT_ALLOCATION plaintext.
type AllocationTable struct {
	Allocations []AllocationItem `json:"allocations"`
}
type AllocationItem struct {
	Recipient string `json:"recipient"` // 0x address
	Amount    string `json:"amount"`    // decimal wei
}

// ClaimVerifyPayload is the decrypted/parsed CLAIM_VERIFY request payload.
type ClaimVerifyPayload struct {
	RecipientPubHex string `json:"recipientPubHex"` // 0x04.. uncompressed
	ChallengeSig    string `json:"challengeSig"`    // 0x.. 65-byte EIP-191 sig
}

// SubmitAllocationResult / ClaimVerifyResult are the (public) action-result bodies.
type SubmitAllocationResult struct {
	OK    bool `json:"ok"`
	Count int  `json:"count"`
}
type ClaimVerifyResult struct {
	Voucher string `json:"voucher"` // 0x.. ECIES ciphertext (amount stays confidential)
}

// State is the observable state (no allocations — only the signer address/pubkey).
type State struct {
	SignerAddress string `json:"signerAddress"`
	SignerPubKey  string `json:"signerPubKey"`
}
```
Add ABI args (replace the `SayGoodbyeMessageArg` init block):
```go
var (
	SubmitAllocationArg abi.Argument
	ClaimVerifyArg      abi.Argument
)

func init() {
	saTy, _ := abi.NewType("tuple", "", []abi.ArgumentMarshaling{
		{Name: "ciphertext", Type: "bytes"},
		{Name: "pool", Type: "address"},
	})
	SubmitAllocationArg = abi.Argument{Type: saTy}

	cvTy, _ := abi.NewType("tuple", "", []abi.ArgumentMarshaling{
		{Name: "payload", Type: "bytes"},
		{Name: "pool", Type: "address"},
	})
	ClaimVerifyArg = abi.Argument{Type: cvTy}
}
```
Keep the `StateResponse` (DO NOT MODIFY) struct and its imports; ensure `common` and `abi` remain imported.

- [ ] **Step 3: Rewrite routing in `extension.go` (handlers stubbed to return not-implemented for now)**

In `go/internal/extension/extension.go`: change the `Extension` struct to hold deps and stub the two handlers so this task compiles; real bodies land in Tasks 6–7.
```go
type Extension struct {
	mu     sync.RWMutex
	Server *http.Server

	signer *signer.Signer
	store  *allocations.Store
	reader *chain.Reader
}
```
Update `New` to accept deps (the DO-NOT-MODIFY note is about the HTTP wiring; adding constructor params is expected when customizing):
```go
func New(extensionPort, signPort int, s *signer.Signer, store *allocations.Store, reader *chain.Reader) *Extension {
	e := &Extension{signer: s, store: store, reader: reader}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /state", e.stateHandler)
	mux.HandleFunc("POST /action", e.actionHandler)
	e.Server = &http.Server{Addr: fmt.Sprintf(":%d", extensionPort), Handler: mux}
	return e
}
```
Replace `stateHandler` body's `State{...}` with:
```go
		State: types.State{
			SignerAddress: e.signer.Address().Hex(),
			SignerPubKey:  e.signer.PubKeyHex(),
		},
```
Replace `processAction`'s switch to route PRIZEPOOL:
```go
	case dataFixed.OPType == teeutils.ToHash(config.OPTypePrizePool):
		return e.processPrizePool(action, dataFixed)
```
Add the command router + two stubs (real bodies in Tasks 6–7):
```go
func (e *Extension) processPrizePool(action teetypes.Action, df *instruction.DataFixed) (int, []byte) {
	switch {
	case df.OPCommand == teeutils.ToHash(config.OPCommandSubmitAllocation):
		b, _ := json.Marshal(e.processSubmitAllocation(action, df))
		return http.StatusOK, b
	case df.OPCommand == teeutils.ToHash(config.OPCommandClaimVerify):
		b, _ := json.Marshal(e.processClaimVerify(action, df))
		return http.StatusOK, b
	default:
		return http.StatusNotImplemented, []byte(fmt.Sprintf("unsupported op command: %s", df.OPCommand.Hex()))
	}
}

func (e *Extension) processSubmitAllocation(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	return buildResult(action, df, nil, 0, fmt.Errorf("not implemented"))
}
func (e *Extension) processClaimVerify(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	return buildResult(action, df, nil, 0, fmt.Errorf("not implemented"))
}
```
Add imports: `extension-scaffold/internal/signer`, `extension-scaffold/internal/allocations`, `extension-scaffold/internal/chain`. Remove now-unused GREETING handler funcs (`processGreeting`, `processSayHello`, `processSayGoodbye`) and the `greetingCount`/`lastGreeting`/... fields. Update any caller of `New(...)` (search `extension.New(`) in `cmd/` to pass the new deps — construct signer/store/reader from config there:
```go
sgn, err := signer.NewFromHex(config.SigningKeyHex(), big.NewInt(config.ChainID()))
// handle err
store := allocations.New()
rdr, err := chain.Dial(config.ChainURL())
// handle err
ext := extension.New(config.ExtensionPort, config.SignPort, sgn, store, rdr)
```

- [ ] **Step 4: Rename + extend `InstructionSender.sol`**

In `contracts/InstructionSender.sol`, rename the contract to `PrizePoolInstructionSender`, replace the op constants and add two send functions (keep the DO-NOT-MODIFY constructor/`setExtensionId`/`_getExtensionId`, and the two registry immutables/`_getExtensionId` usage):
```solidity
    bytes32 public constant OP_TYPE_PRIZEPOOL = bytes32("PRIZEPOOL");
    bytes32 public constant OP_COMMAND_SUBMIT_ALLOCATION = bytes32("SUBMIT_ALLOCATION");
    bytes32 public constant OP_COMMAND_CLAIM_VERIFY = bytes32("CLAIM_VERIFY");
```
Define message structs and `abi.encode` them as a SINGLE argument. This matters: the Go decoders (`SubmitAllocationArg`/`ClaimVerifyArg`) are single tuple `abi.Argument`s, and `abi.encode(struct)` produces the tuple-with-outer-offset encoding they expect — `abi.encode(a, b)` (two top-level args) would NOT match. This mirrors the scaffold's proven `SayGoodbyeMessage` pattern.
```solidity
    struct SubmitAllocationMessage { bytes ciphertext; address pool; }
    struct ClaimVerifyMessage { bytes payload; address pool; }

    /// @notice Submit an encrypted allocation table for `pool` to the TEE.
    function sendSubmitAllocation(bytes calldata ciphertext, address pool) external payable {
        address[] memory teeIds = TEE_MACHINE_REGISTRY.getRandomTeeIds(_getExtensionId(), 1);
        address[] memory cosigners = new address[](0);
        ITeeExtensionRegistry.TeeInstructionParams memory params = ITeeExtensionRegistry.TeeInstructionParams({
            opType: OP_TYPE_PRIZEPOOL,
            opCommand: OP_COMMAND_SUBMIT_ALLOCATION,
            message: abi.encode(SubmitAllocationMessage({ciphertext: ciphertext, pool: pool})),
            cosigners: cosigners,
            cosignersThreshold: 0,
            claimBackAddress: msg.sender
        });
        TEE_EXTENSION_REGISTRY.sendInstructions{value: msg.value}(teeIds, params);
    }

    /// @notice Request a voucher for `pool`; `payload` carries the recipient enc pubkey + challenge sig.
    function sendClaimVerify(bytes calldata payload, address pool) external payable {
        address[] memory teeIds = TEE_MACHINE_REGISTRY.getRandomTeeIds(_getExtensionId(), 1);
        address[] memory cosigners = new address[](0);
        ITeeExtensionRegistry.TeeInstructionParams memory params = ITeeExtensionRegistry.TeeInstructionParams({
            opType: OP_TYPE_PRIZEPOOL,
            opCommand: OP_COMMAND_CLAIM_VERIFY,
            message: abi.encode(ClaimVerifyMessage({payload: payload, pool: pool})),
            cosigners: cosigners,
            cosignersThreshold: 0,
            claimBackAddress: msg.sender
        });
        TEE_EXTENSION_REGISTRY.sendInstructions{value: msg.value}(teeIds, params);
    }
```
Also update the `@title`/NatSpec name and remove the `SayGoodbyeMessage` struct + `sendSayHello`/`sendSayGoodbye`.

- [ ] **Step 5: Build both toolchains**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go" && go build ./... && go vet ./...
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold" && forge build
```
Expected: Go builds clean; `forge build` → `Compiler run successful`. Fix any leftover references to removed GREETING symbols (check `cmd/*/main.go`, `extension_test.go` — replace/remove GREETING-specific tests; a follow-up handler test replaces them in Tasks 6–7). If `go/internal/extension/extension_test.go` references removed symbols, delete the obsolete GREETING test cases now so the package compiles.

- [ ] **Step 6: Commit**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add go/internal/config/config.go go/pkg/types/types.go go/internal/extension/ go/cmd contracts/InstructionSender.sol
git commit -m "feat(m1): rename GREETING->PRIZEPOOL, wire signer/store/reader, add send functions"
```

---

## Task 6: `SUBMIT_ALLOCATION` handler

**Files:** Modify `go/internal/extension/extension.go`; Create `go/internal/extension/submit_test.go`.

- [ ] **Step 1: Write the failing test**

Create `go/internal/extension/submit_test.go`. It builds an encrypted allocation payload, invokes the handler with a store + a stubbed total, and asserts the store holds the entries and the result body contains no cleartext amount. Because the handler reads `totalDeposited` from chain, inject it via a small interface (add `TotalDeposited` to an interface the handler uses; the test passes a fake).
```go
package extension

import (
	"context"
	"encoding/json"
	"math/big"
	"strings"
	"testing"

	"extension-scaffold/internal/allocations"
	"extension-scaffold/internal/signer"
	"extension-scaffold/pkg/types"

	"github.com/ethereum/go-ethereum/common"
)

type fakeReader struct{ total *big.Int }

func (f fakeReader) TotalDeposited(ctx context.Context, pool common.Address) (*big.Int, error) {
	return f.total, nil
}

func TestSubmitAllocation_StoresAndHidesAmounts(t *testing.T) {
	sgn, _ := signer.NewFromHex("353c43dada1ebc390f9594ed91753446e19389ae545fc7fada020816346efb73", big.NewInt(114))
	st := allocations.New()
	e := &Extension{signer: sgn, store: st, reader: fakeReader{total: big.NewInt(10)}}

	pool := common.Address{19: 1}
	table := types.AllocationTable{Allocations: []types.AllocationItem{
		{Recipient: common.Address{19: 0xA}.Hex(), Amount: "3"},
		{Recipient: common.Address{19: 0xB}.Hex(), Amount: "5"},
	}}
	plain, _ := json.Marshal(table)
	ct, _ := signer.EncryptTo(sgn.PubKeyHex(), plain)

	status, body := e.handleSubmitAllocation(context.Background(), pool, ct)
	if status != 1 {
		t.Fatalf("status=%d body=%s", status, body)
	}
	if _, ok := st.Lookup(pool, common.Address{19: 0xA}); !ok {
		t.Fatal("A not stored")
	}
	// result must not leak amounts
	if strings.Contains(string(body), "\"3\"") || strings.Contains(string(body), "amount") {
		t.Fatalf("result leaked allocation data: %s", body)
	}
}

func TestSubmitAllocation_RejectsOverDeposit(t *testing.T) {
	sgn, _ := signer.NewFromHex("353c43dada1ebc390f9594ed91753446e19389ae545fc7fada020816346efb73", big.NewInt(114))
	e := &Extension{signer: sgn, store: allocations.New(), reader: fakeReader{total: big.NewInt(2)}}
	pool := common.Address{19: 1}
	table := types.AllocationTable{Allocations: []types.AllocationItem{{Recipient: common.Address{19: 0xA}.Hex(), Amount: "5"}}}
	plain, _ := json.Marshal(table)
	ct, _ := signer.EncryptTo(sgn.PubKeyHex(), plain)
	status, _ := e.handleSubmitAllocation(context.Background(), pool, ct)
	if status != 0 {
		t.Fatal("expected rejection status 0")
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go test ./internal/extension/ -run TestSubmitAllocation -v
```
Expected: FAIL — `handleSubmitAllocation` undefined; `reader` field type mismatch (it's `*chain.Reader`, test passes `fakeReader`).

- [ ] **Step 3: Implement handler + reader interface**

In `extension.go`: change the `reader` field to an interface so it's testable, and implement the core logic split from the wire handler.
```go
// depositReader is the slice of chain.Reader the handler needs (testable).
type depositReader interface {
	TotalDeposited(ctx context.Context, pool common.Address) (*big.Int, error)
}

// change struct field:
//   reader depositReader
```
Update `New(...)` param type to `depositReader` (a `*chain.Reader` satisfies it). Add imports: `context`, `math/big`, `strings` as needed, `extension-scaffold/pkg/types`, `github.com/ethereum/go-ethereum/common`.

Replace the `processSubmitAllocation` stub with:
```go
func (e *Extension) processSubmitAllocation(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	var msg types.SubmitAllocationMessage
	if err := structs.DecodeTo(types.SubmitAllocationArg, df.OriginalMessage, &msg); err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decoding message: %w", err))
	}
	status, data := e.handleSubmitAllocation(context.Background(), msg.Pool, msg.Ciphertext)
	return buildResult(action, df, data, status, resultErr(status, data))
}

// handleSubmitAllocation decrypts, validates against the on-chain deposit, and stores.
// Returns (status, resultBody). status 1 = ok, 0 = error. Never logs the plaintext.
func (e *Extension) handleSubmitAllocation(ctx context.Context, pool common.Address, ciphertext []byte) (uint8, []byte) {
	plain, err := e.signer.Decrypt(ciphertext)
	if err != nil {
		return 0, []byte("decrypt failed")
	}
	var table types.AllocationTable
	if err := json.Unmarshal(plain, &table); err != nil {
		return 0, []byte("bad allocation payload")
	}
	inputs := make([]allocations.Input, 0, len(table.Allocations))
	for _, a := range table.Allocations {
		amt, ok := new(big.Int).SetString(a.Amount, 10)
		if !ok {
			return 0, []byte("bad amount")
		}
		inputs = append(inputs, allocations.Input{Recipient: common.HexToAddress(a.Recipient), Amount: amt})
	}
	total, err := e.reader.TotalDeposited(ctx, pool)
	if err != nil {
		return 0, []byte("deposit read failed")
	}
	if err := e.store.Submit(pool, inputs, total); err != nil {
		return 0, []byte("allocation rejected")
	}
	out, _ := json.Marshal(types.SubmitAllocationResult{OK: true, Count: len(inputs)})
	return 1, out
}

// resultErr synthesizes an error for buildResult's Log field on failure.
func resultErr(status uint8, data []byte) error {
	if status == 1 {
		return nil
	}
	return fmt.Errorf("%s", string(data))
}
```
Add import `github.com/flare-foundation/go-flare-common/pkg/tee/structs` (already used by GREETING previously). Do NOT log `plain` anywhere.

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go test ./internal/extension/ -run TestSubmitAllocation -v && go build ./...
```
Expected: PASS + clean build.

- [ ] **Step 5: Commit**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add go/internal/extension/
git commit -m "feat(m3): SUBMIT_ALLOCATION handler (ECIES decrypt, on-chain deposit cap, in-memory store)"
```

---

## Task 7: `CLAIM_VERIFY` handler

**Files:** Modify `go/internal/extension/extension.go`; Create `go/internal/extension/claim_test.go`.

- [ ] **Step 1: Write the failing test**

Create `go/internal/extension/claim_test.go`. It seeds an allocation, builds a challenge signed by the recipient's key, invokes the handler, decrypts the returned voucher, and asserts the voucher's signature recovers to the TEE signer for `(pool, recipient, amount, nonce)`.
```go
package extension

import (
	"context"
	"encoding/json"
	"math/big"
	"strings"
	"testing"

	"extension-scaffold/internal/allocations"
	"extension-scaffold/internal/signer"
	"extension-scaffold/pkg/types"

	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

func challengeMessage(pool common.Address, recipientPubHex string) string {
	return "ConfidentialPrizePool claim\npool:" + pool.Hex() + "\nkey:" + recipientPubHex
}

func TestClaimVerify_ReturnsEncryptedVoucher(t *testing.T) {
	teeKey := "353c43dada1ebc390f9594ed91753446e19389ae545fc7fada020816346efb73"
	sgn, _ := signer.NewFromHex(teeKey, big.NewInt(114))
	st := allocations.New()
	e := &Extension{signer: sgn, store: st, reader: fakeReader{total: big.NewInt(10)}}

	// recipient key
	rk, _ := crypto.HexToECDSA("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
	recipient := crypto.PubkeyToAddress(rk.PublicKey)
	recipientPub := "0x" + common.Bytes2Hex(crypto.FromECDSAPub(&rk.PublicKey))

	pool := common.Address{19: 1}
	if err := st.Submit(pool, []allocations.Input{{Recipient: recipient, Amount: big.NewInt(3)}}, big.NewInt(10)); err != nil {
		t.Fatal(err)
	}

	// recipient signs the EIP-191 challenge
	msg := challengeMessage(pool, recipientPub)
	sig, _ := crypto.Sign(accounts.TextHash([]byte(msg)), rk)
	sig[64] += 27
	payload := types.ClaimVerifyPayload{RecipientPubHex: recipientPub, ChallengeSig: "0x" + common.Bytes2Hex(sig)}
	pb, _ := json.Marshal(payload)

	status, body := e.handleClaimVerify(context.Background(), pool, pb)
	if status != 1 {
		t.Fatalf("status=%d body=%s", status, body)
	}
	if strings.Contains(string(body), "\"3\"") {
		t.Fatalf("result leaked amount: %s", body)
	}

	var res types.ClaimVerifyResult
	_ = json.Unmarshal(body, &res)
	ct := common.FromHex(res.Voucher)
	rEcies, _ := signer.NewFromHex("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", big.NewInt(114))
	voucherJSON, err := rEcies.Decrypt(ct)
	if err != nil {
		t.Fatalf("recipient decrypt: %v", err)
	}
	var v struct {
		Amount    string `json:"amount"`
		Nonce     string `json:"nonce"`
		Signature string `json:"signature"`
	}
	_ = json.Unmarshal(voucherJSON, &v)
	if v.Amount != "3" {
		t.Fatalf("voucher amount %s want 3", v.Amount)
	}
	// verify the voucher signature recovers to the TEE signer
	vsig := common.FromHex(v.Signature)
	vsig[64] -= 27
	digest := sgn.VoucherDigestForTest(pool, recipient, big.NewInt(3), big.NewInt(0))
	pub, _ := crypto.SigToPub(digest, vsig)
	if crypto.PubkeyToAddress(*pub) != sgn.Address() {
		t.Fatal("voucher sig does not recover to TEE signer")
	}
}

func TestClaimVerify_UnknownRecipientRejected(t *testing.T) {
	sgn, _ := signer.NewFromHex("353c43dada1ebc390f9594ed91753446e19389ae545fc7fada020816346efb73", big.NewInt(114))
	e := &Extension{signer: sgn, store: allocations.New(), reader: fakeReader{total: big.NewInt(10)}}
	rk, _ := crypto.HexToECDSA("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
	recipientPub := "0x" + common.Bytes2Hex(crypto.FromECDSAPub(&rk.PublicKey))
	pool := common.Address{19: 9}
	msg := challengeMessage(pool, recipientPub)
	sig, _ := crypto.Sign(accounts.TextHash([]byte(msg)), rk)
	sig[64] += 27
	pb, _ := json.Marshal(types.ClaimVerifyPayload{RecipientPubHex: recipientPub, ChallengeSig: "0x" + common.Bytes2Hex(sig)})
	status, _ := e.handleClaimVerify(context.Background(), pool, pb)
	if status != 0 {
		t.Fatal("expected rejection for unknown recipient")
	}
}
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go test ./internal/extension/ -run TestClaimVerify -v
```
Expected: FAIL — `handleClaimVerify`, `VoucherDigestForTest` undefined.

- [ ] **Step 3: Implement handler + test-only digest exporter**

In `signer/signer.go`, add a small exported wrapper so tests can recompute the digest (keep `voucherDigest` private):
```go
// VoucherDigestForTest exposes the EIP-712 digest for tests/tools only.
func (s *Signer) VoucherDigestForTest(pool, recipient common.Address, amount, nonce *big.Int) []byte {
	return s.voucherDigest(pool, recipient, amount, nonce)
}
```
In `extension.go`, replace the `processClaimVerify` stub:
```go
func (e *Extension) processClaimVerify(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	var msg types.ClaimVerifyMessage
	if err := structs.DecodeTo(types.ClaimVerifyArg, df.OriginalMessage, &msg); err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decoding message: %w", err))
	}
	status, data := e.handleClaimVerify(context.Background(), msg.Pool, msg.Payload)
	return buildResult(action, df, data, status, resultErr(status, data))
}

func (e *Extension) handleClaimVerify(ctx context.Context, pool common.Address, payload []byte) (uint8, []byte) {
	var req types.ClaimVerifyPayload
	if err := json.Unmarshal(payload, &req); err != nil {
		return 0, []byte("bad payload")
	}
	// Recover the recipient from the signed challenge (proves wallet control).
	challenge := "ConfidentialPrizePool claim\npool:" + pool.Hex() + "\nkey:" + req.RecipientPubHex
	sig := common.FromHex(req.ChallengeSig)
	if len(sig) != 65 {
		return 0, []byte("bad challenge sig")
	}
	rec := make([]byte, 65)
	copy(rec, sig)
	rec[64] -= 27
	pub, err := crypto.SigToPub(accounts.TextHash([]byte(challenge)), rec)
	if err != nil {
		return 0, []byte("challenge recover failed")
	}
	recipient := crypto.PubkeyToAddress(*pub)

	entry, ok := e.store.Lookup(pool, recipient)
	if !ok {
		return 0, []byte("not eligible")
	}
	vsig, err := e.signer.SignVoucher(pool, recipient, entry.Amount, entry.Nonce)
	if err != nil {
		return 0, []byte("sign failed")
	}
	voucher := struct {
		Amount    string `json:"amount"`
		Nonce     string `json:"nonce"`
		Signature string `json:"signature"`
	}{entry.Amount.String(), entry.Nonce.String(), "0x" + common.Bytes2Hex(vsig)}
	vjson, _ := json.Marshal(voucher)
	ct, err := signer.EncryptTo(req.RecipientPubHex, vjson)
	if err != nil {
		return 0, []byte("encrypt failed")
	}
	out, _ := json.Marshal(types.ClaimVerifyResult{Voucher: "0x" + common.Bytes2Hex(ct)})
	return 1, out
}
```
Add imports: `github.com/ethereum/go-ethereum/accounts`, `github.com/ethereum/go-ethereum/crypto`.

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go test ./internal/extension/ -v && go build ./...
```
Expected: PASS (submit + claim) + clean build.

- [ ] **Step 5: Commit**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add go/internal/extension/ go/internal/signer/signer.go
git commit -m "feat(m4): CLAIM_VERIFY handler (signed-challenge auth, EIP-712 voucher, ECIES result)"
```

---

## Task 8: Cross-language interop — Go-signed voucher passes `Pool.claim` (Foundry FFI)

**Files:** Create `go/cmd/sign-voucher/main.go`; Modify `foundry.toml`; Create `test/VoucherInterop.t.sol`.

- [ ] **Step 1: Write the Go signer CLI**

Create `go/cmd/sign-voucher/main.go`:
```go
// Command sign-voucher prints an EIP-712 voucher signature for the given inputs.
// Used by the Foundry FFI interop test. Args: <chainID> <pool> <recipient> <amount> <nonce> <privkeyHex>
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
		fmt.Fprintln(os.Stderr, "usage: sign-voucher <chainID> <pool> <recipient> <amount> <nonce> <privkeyHex>")
		os.Exit(2)
	}
	chainID, _ := new(big.Int).SetString(os.Args[1], 10)
	pool := common.HexToAddress(os.Args[2])
	recipient := common.HexToAddress(os.Args[3])
	amount, _ := new(big.Int).SetString(os.Args[4], 10)
	nonce, _ := new(big.Int).SetString(os.Args[5], 10)

	s, err := signer.NewFromHex(os.Args[6], chainID)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	sig, err := s.SignVoucher(pool, recipient, amount, nonce)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	// forge FFI expects hex on stdout
	fmt.Print("0x" + common.Bytes2Hex(sig))
}
```

- [ ] **Step 2: Build the binary + enable FFI**

Build the signer binary (FFI will call it — faster/deterministic than `go run`):
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go build -o ../bin/sign-voucher.exe ./cmd/sign-voucher
```
In `foundry.toml`, add `ffi = true` and allow reading the bin dir:
```toml
[profile.default]
src = "contracts"
out = "out"
test = "test"
libs = ["lib"]
via-ir = true
ffi = true
fs_permissions = [{ access = "read", path = "./bin" }]
```

- [ ] **Step 3: Write the failing interop test**

Create `test/VoucherInterop.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test } from "forge-std/Test.sol";
import { Pool } from "../contracts/Pool.sol";

contract VoucherInteropTest is Test {
    // Anvil test key #0 — its address is the authorizedSigner.
    uint256 constant SIGNER_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    function test_goSignedVoucher_isAcceptedByPool() public {
        address signerAddr = vm.addr(SIGNER_PK);
        address organizer = address(0xA11CE);
        address recipient = address(0xBEEF);
        uint64 deadline = uint64(block.timestamp + 7 days);

        vm.deal(organizer, 10 ether);
        vm.prank(organizer);
        Pool pool = new Pool{value: 10 ether}(organizer, address(0), 10 ether, deadline, signerAddr);

        // Ask the Go signer to sign a voucher for THIS pool address.
        string[] memory cmd = new string[](7);
        cmd[0] = "./bin/sign-voucher.exe";
        cmd[1] = vm.toString(block.chainid);
        cmd[2] = vm.toString(address(pool));
        cmd[3] = vm.toString(recipient);
        cmd[4] = vm.toString(uint256(3 ether));
        cmd[5] = vm.toString(uint256(1));
        cmd[6] = vm.toString(bytes32(SIGNER_PK)); // 0x-prefixed 32-byte hex
        bytes memory sig = vm.ffi(cmd);

        vm.prank(recipient);
        pool.claim(3 ether, 1, sig);

        assertEq(recipient.balance, 3 ether);
        assertEq(pool.totalClaimed(), 3 ether);
    }
}
```
Note: `vm.toString(bytes32(SIGNER_PK))` yields a 0x-prefixed 64-hex-char string the Go CLI parses via `HexToECDSA` (it strips `0x`). `block.chainid` in forge defaults to 31337 — the Go signer uses whatever chainId is passed, so the domain matches regardless.

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge test --match-contract VoucherInteropTest -vvv
```
Expected: PASS — the Go-produced signature is accepted by `Pool.claim`, proving Go and Solidity compute the identical EIP-712 digest. If it reverts `BadSignature`, the Go digest disagrees with Solidity — recheck domain/type strings and V normalization (do NOT weaken the contract).

- [ ] **Step 5: Commit**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add go/cmd/sign-voucher/main.go foundry.toml test/VoucherInterop.t.sol
git commit -m "test(interop): Go-signed EIP-712 voucher accepted by Pool.claim via forge FFI"
```

---

## Task 9: Full verification

**Files:** none (verification).

- [ ] **Step 1: Go — all tests + vet + build**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
go test ./... && go vet ./... && go build ./...
```
Expected: all packages PASS, no vet issues, clean build.

- [ ] **Step 2: Forge — contracts + interop unaffected**

Run:
```bash
export PATH="$PATH:/c/Program Files/Go/bin:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge test
```
Expected: all Pool/PoolFactory/VoucherInterop tests PASS.

- [ ] **Step 3: Privacy grep — no allocation leakage**

Confirm handlers never log plaintext allocations:
```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold/go"
grep -rnE "logger\.|log\.|fmt\.Print" internal/extension internal/allocations internal/signer | grep -iE "plain|amount|alloc|voucher|table" || echo "no plaintext logging found"
```
Expected: `no plaintext logging found` (or only benign matches). Fix any real leak.

- [ ] **Step 4: Final commit (if grep prompted fixes; else skip)**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add -A go/ && git commit -m "chore: privacy audit fixes for allocation handlers" || echo "nothing to commit"
```

---

## Definition of Done

- `go test ./...` green: signer (sign→recover, V∈{27,28}, ECIES roundtrip + wrong-key), allocations (deposit cap, nonce, dup/zero reject, pool isolation, immutability), chain (selector), handlers (submit stores + hides amounts + rejects over-deposit; claim returns encrypted voucher recoverable to the TEE signer + rejects unknown recipient).
- **`forge test` green including `VoucherInteropTest`** — a Go-signed voucher is accepted by `Pool.claim` (cross-language digest proven).
- `GREETING` fully replaced by `PRIZEPOOL`; `SUBMIT_ALLOCATION`/`CLAIM_VERIFY` byte-identical in `config.go` and `InstructionSender.sol`.
- No allocation/recipient/amount in cleartext in logs, `/state`, or action-result bodies.

## Out of scope (do not implement here)

- `COMPLIANCE_REPORT` (M6), `UNCLAIMED_REPORT` (M7).
- M5 anonymity/unlinkability.
- Live FTDC registration / on-chain deploy of the renamed InstructionSender (blocked Flare-side; unit tests + FFI interop cover correctness now).
