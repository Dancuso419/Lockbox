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

	rk, _ := crypto.HexToECDSA("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
	recipient := crypto.PubkeyToAddress(rk.PublicKey)
	recipientPub := "0x" + common.Bytes2Hex(crypto.FromECDSAPub(&rk.PublicKey))

	pool := common.Address{19: 1}
	if err := st.Submit(pool, []allocations.Input{{Recipient: recipient, Amount: big.NewInt(3)}}, big.NewInt(10)); err != nil {
		t.Fatal(err)
	}

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
