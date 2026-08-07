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
