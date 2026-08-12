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
	st := allocations.New([]byte("test-nonce-secret"))
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
	e := &Extension{signer: sgn, store: allocations.New([]byte("test-nonce-secret")), reader: fakeReader{total: big.NewInt(10)}}
	status, _ := e.handleComplianceReport(context.Background(), common.Address{19: 9})
	if status != 0 {
		t.Fatal("expected rejection for pool with no allocations")
	}
}
