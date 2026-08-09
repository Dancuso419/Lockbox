package chain

import (
	"math/big"
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

func TestTotalDepositedCalldata(t *testing.T) {
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

func TestUsedNonceCalldataAndDecode(t *testing.T) {
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
	word := make([]byte, 32)
	addr := common.HexToAddress("0x00000000000000000000000000000000000000ab")
	copy(word[12:], addr.Bytes())
	if decodeAddress(word) != addr {
		t.Fatalf("address decode wrong: %s", decodeAddress(word).Hex())
	}
}
