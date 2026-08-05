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
