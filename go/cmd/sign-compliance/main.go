// Command sign-compliance prints an EIP-712 ComplianceReport signature.
// Used by the Foundry FFI interop test.
// Args: <chainID> <pool> <totalDeposited> <totalAllocated> <recipientCount> <privkeyHex>
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
		fmt.Fprintln(os.Stderr, "usage: sign-compliance <chainID> <pool> <totalDeposited> <totalAllocated> <recipientCount> <privkeyHex>")
		os.Exit(2)
	}
	chainID, _ := new(big.Int).SetString(os.Args[1], 10)
	pool := common.HexToAddress(os.Args[2])
	totalDeposited, _ := new(big.Int).SetString(os.Args[3], 10)
	totalAllocated, _ := new(big.Int).SetString(os.Args[4], 10)
	recipientCount, _ := new(big.Int).SetString(os.Args[5], 10)

	s, err := signer.NewFromHex(os.Args[6], chainID)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	sig, err := s.SignComplianceReport(pool, totalDeposited, totalAllocated, recipientCount)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Print("0x" + common.Bytes2Hex(sig))
}
