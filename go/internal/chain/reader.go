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
