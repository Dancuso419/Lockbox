package allocations

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

func addr(b byte) common.Address { return common.Address{19: b} }

func TestSubmit_HappyPath(t *testing.T) {
	s := New([]byte("test-nonce-secret"))
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
	s := New([]byte("test-nonce-secret"))
	entries := []Input{{Recipient: addr(0xA), Amount: big.NewInt(11)}}
	if err := s.Submit(addr(1), entries, big.NewInt(10)); err == nil {
		t.Fatal("expected over-deposit rejection")
	}
}

func TestSubmit_RejectsZeroAmountAndDuplicate(t *testing.T) {
	s := New([]byte("test-nonce-secret"))
	if err := s.Submit(addr(1), []Input{{Recipient: addr(0xA), Amount: big.NewInt(0)}}, big.NewInt(10)); err == nil {
		t.Fatal("expected zero-amount rejection")
	}
	dup := []Input{{Recipient: addr(0xA), Amount: big.NewInt(1)}, {Recipient: addr(0xA), Amount: big.NewInt(1)}}
	if err := s.Submit(addr(2), dup, big.NewInt(10)); err == nil {
		t.Fatal("expected duplicate-recipient rejection")
	}
}

func TestSubmit_SecondSubmitRejected(t *testing.T) {
	s := New([]byte("test-nonce-secret"))
	pool := addr(1)
	_ = s.Submit(pool, []Input{{Recipient: addr(0xA), Amount: big.NewInt(1)}}, big.NewInt(10))
	if err := s.Submit(pool, []Input{{Recipient: addr(0xB), Amount: big.NewInt(1)}}, big.NewInt(10)); err == nil {
		t.Fatal("expected second submit for same pool to be rejected")
	}
}

func TestSubmit_NoncesAreRandomNotSequential(t *testing.T) {
	s := New([]byte("test-nonce-secret"))
	pool := addr(1)
	entries := []Input{
		{Recipient: addr(0xA), Amount: big.NewInt(1)},
		{Recipient: addr(0xB), Amount: big.NewInt(1)},
		{Recipient: addr(0xC), Amount: big.NewInt(1)},
	}
	if err := s.Submit(pool, entries, big.NewInt(10)); err != nil {
		t.Fatalf("Submit: %v", err)
	}
	rows, _ := s.Entries(pool)
	seq := big.NewInt(2)
	small := 0
	seen := map[string]bool{}
	for _, r := range rows {
		if r.Nonce.Cmp(seq) < 0 {
			small++
		}
		if seen[r.Nonce.String()] {
			t.Fatalf("duplicate nonce %s", r.Nonce)
		}
		seen[r.Nonce.String()] = true
	}
	if small > 0 {
		t.Fatalf("found %d small/sequential-looking nonces; expected random", small)
	}
}

func TestLookup_IsolatesPools(t *testing.T) {
	s := New([]byte("test-nonce-secret"))
	_ = s.Submit(addr(1), []Input{{Recipient: addr(0xA), Amount: big.NewInt(1)}}, big.NewInt(10))
	if _, ok := s.Lookup(addr(2), addr(0xA)); ok {
		t.Fatal("lookup should not cross pools")
	}
}

func TestTotals_SumsAndCounts(t *testing.T) {
	s := New([]byte("test-nonce-secret"))
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

func TestEntriesReturnsAllRowsAndIsCopySafe(t *testing.T) {
	s := New([]byte("test-nonce-secret"))
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

// The table lives in enclave memory, so a restart loses it and the organizer
// re-submits. These are the properties that make that safe.
func TestNoncesSurviveARestart(t *testing.T) {
	secret := []byte("enclave-secret")
	pool := common.HexToAddress("0x1111111111111111111111111111111111111111")
	alice := common.HexToAddress("0xa11ce00000000000000000000000000000000000")
	bob := common.HexToAddress("0xb0b0000000000000000000000000000000000000")
	entries := []Input{
		{Recipient: alice, Amount: big.NewInt(3)},
		{Recipient: bob, Amount: big.NewInt(2)},
	}

	first := New(secret)
	if err := first.Submit(pool, entries, big.NewInt(5)); err != nil {
		t.Fatalf("submit: %v", err)
	}
	before, _ := first.Lookup(pool, alice)

	// A fresh store is exactly what a restarted enclave has.
	second := New(secret)
	if err := second.Submit(pool, entries, big.NewInt(5)); err != nil {
		t.Fatalf("resubmit: %v", err)
	}
	after, _ := second.Lookup(pool, alice)

	if before.Nonce.Cmp(after.Nonce) != 0 {
		t.Fatalf("nonce changed across restart: %s then %s — a spent voucher would come back to life",
			before.Nonce, after.Nonce)
	}
}

func TestNoncesDifferPerRecipientPoolAndEnclave(t *testing.T) {
	poolA := common.HexToAddress("0x1111111111111111111111111111111111111111")
	poolB := common.HexToAddress("0x2222222222222222222222222222222222222222")
	alice := common.HexToAddress("0xa11ce00000000000000000000000000000000000")
	bob := common.HexToAddress("0xb0b0000000000000000000000000000000000000")

	s := New([]byte("secret-one"))
	other := New([]byte("secret-two"))

	aliceA := s.deriveNonce(poolA, alice)
	bobA := s.deriveNonce(poolA, bob)
	aliceB := s.deriveNonce(poolB, alice)
	aliceOther := other.deriveNonce(poolA, alice)

	if aliceA.Cmp(bobA) == 0 {
		t.Fatal("two recipients in one pool share a nonce")
	}
	if aliceA.Cmp(aliceB) == 0 {
		t.Fatal("the same recipient reuses a nonce across pools")
	}
	if aliceA.Cmp(aliceOther) == 0 {
		t.Fatal("nonce does not depend on the enclave secret — it would be guessable")
	}
}
