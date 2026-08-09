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

type fakePoolReader struct {
	deposit   *big.Int
	organizer common.Address
	used      map[string]bool
}

func (f *fakePoolReader) TotalDeposited(ctx context.Context, pool common.Address) (*big.Int, error) {
	return f.deposit, nil
}
func (f *fakePoolReader) Organizer(ctx context.Context, pool common.Address) (common.Address, error) {
	return f.organizer, nil
}
func (f *fakePoolReader) UsedNonce(ctx context.Context, pool common.Address, nonce *big.Int) (bool, error) {
	return f.used[nonce.String()], nil
}

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
	orgPkHex := "b71c71a67e1177ad4e901695e1b4b9ee17ae16c6668d313eac2f96dbcda3f291"
	orgPk, _ := crypto.HexToECDSA(orgPkHex)
	organizer := crypto.PubkeyToAddress(orgPk.PublicKey)
	orgPubHex := "0x" + common.Bytes2Hex(crypto.FromECDSAPub(&orgPk.PublicKey))

	sgn, _ := signer.NewFromHex("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", big.NewInt(114))

	store := allocations.New()
	pool := common.HexToAddress("0x1111111111111111111111111111111111111111")
	r1 := common.HexToAddress("0xaaaa000000000000000000000000000000000001")
	r2 := common.HexToAddress("0xaaaa000000000000000000000000000000000002")
	r3 := common.HexToAddress("0xaaaa000000000000000000000000000000000003")
	if err := store.Submit(pool, []allocations.Input{
		{Recipient: r1, Amount: big.NewInt(10)},
		{Recipient: r2, Amount: big.NewInt(20)},
		{Recipient: r3, Amount: big.NewInt(30)},
	}, big.NewInt(100)); err != nil {
		t.Fatalf("submit: %v", err)
	}

	// Nonces are random; mark r2 and r3 claimed by their actual nonces so only r1 remains.
	usedNonces := map[string]bool{}
	storeRows, _ := store.Entries(pool)
	for _, row := range storeRows {
		if row.Recipient == r2 || row.Recipient == r3 {
			usedNonces[row.Nonce.String()] = true
		}
	}

	reader := &fakePoolReader{
		deposit:   big.NewInt(100),
		organizer: organizer,
		used:      usedNonces,
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
	ct := common.FromHex(res.Report)
	plain, err := signer.DecryptWithForTest(orgPkHex, ct)
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
	sgn, _ := signer.NewFromHex("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", big.NewInt(114))
	store := allocations.New()
	pool := common.HexToAddress("0x1111111111111111111111111111111111111111")
	_ = store.Submit(pool, []allocations.Input{
		{Recipient: common.HexToAddress("0xaaaa000000000000000000000000000000000001"), Amount: big.NewInt(10)},
	}, big.NewInt(100))

	reader := &fakePoolReader{
		deposit:   big.NewInt(100),
		organizer: common.HexToAddress("0xdead00000000000000000000000000000000beef"),
		used:      map[string]bool{},
	}
	e := New(0, 0, sgn, store, reader)

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

	sgn, _ := signer.NewFromHex("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", big.NewInt(114))
	store := allocations.New()
	pool := common.HexToAddress("0x2222222222222222222222222222222222222222")
	reader := &fakePoolReader{deposit: big.NewInt(0), organizer: organizer, used: map[string]bool{}}
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
