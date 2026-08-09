// Package chain reads on-chain pool facts the TEE needs (the deposited total),
// so allocation validation is trustless rather than organizer-declared.
package chain

import (
	"context"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/math"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

func selector(sig string) []byte { return crypto.Keccak256([]byte(sig))[:4] }
func totalDepositedCalldata() []byte { return selector("totalDeposited()") }
func organizerCalldata() []byte      { return selector("organizer()") }

func usedNonceCalldata(nonce *big.Int) []byte {
	cd := selector("usedNonce(uint256)")
	return append(cd, math.U256Bytes(new(big.Int).Set(nonce))...) // 32-byte big-endian word
}

func decodeBool(word []byte) bool { return len(word) >= 32 && word[31] != 0 }
func decodeAddress(word []byte) common.Address {
	return common.BytesToAddress(word[len(word)-20:])
}

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
