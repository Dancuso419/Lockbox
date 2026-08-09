// eciesharness is a CLI test harness for go-ethereum ECIES interop.
// Usage:
//
//	eciesharness pub <privHex>
//	eciesharness enc <pubHexUncompressed> <plaintextHex>
//	eciesharness dec <privHex> <ciphertextHex>
package main

import (
	"crypto/rand"
	"fmt"
	"os"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/crypto/ecies"
)

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "usage: eciesharness <pub|enc|dec> <args...>")
		os.Exit(1)
	}

	switch os.Args[1] {
	case "pub":
		privHex := os.Args[2]
		priv, err := crypto.HexToECDSA(trimHex(privHex))
		if err != nil {
			fmt.Fprintln(os.Stderr, "bad priv:", err)
			os.Exit(1)
		}
		fmt.Print("0x" + common.Bytes2Hex(crypto.FromECDSAPub(&priv.PublicKey)))

	case "enc":
		if len(os.Args) < 4 {
			fmt.Fprintln(os.Stderr, "usage: eciesharness enc <pubHex> <plaintextHex>")
			os.Exit(1)
		}
		pubHex := os.Args[2]
		ptHex := os.Args[3]
		raw := common.FromHex(trimHex(pubHex))
		pub, err := crypto.UnmarshalPubkey(raw)
		if err != nil {
			fmt.Fprintln(os.Stderr, "bad pub:", err)
			os.Exit(1)
		}
		plaintext := common.FromHex(trimHex(ptHex))
		ct, err := ecies.Encrypt(rand.Reader, ecies.ImportECDSAPublic(pub), plaintext, nil, nil)
		if err != nil {
			fmt.Fprintln(os.Stderr, "encrypt:", err)
			os.Exit(1)
		}
		fmt.Print("0x" + common.Bytes2Hex(ct))

	case "dec":
		if len(os.Args) < 4 {
			fmt.Fprintln(os.Stderr, "usage: eciesharness dec <privHex> <ciphertextHex>")
			os.Exit(1)
		}
		privHex := os.Args[2]
		ctHex := os.Args[3]
		priv, err := crypto.HexToECDSA(trimHex(privHex))
		if err != nil {
			fmt.Fprintln(os.Stderr, "bad priv:", err)
			os.Exit(1)
		}
		ct := common.FromHex(trimHex(ctHex))
		plain, err := ecies.ImportECDSA(priv).Decrypt(ct, nil, nil)
		if err != nil {
			fmt.Fprintln(os.Stderr, "decrypt:", err)
			os.Exit(1)
		}
		fmt.Print("0x" + common.Bytes2Hex(plain))

	default:
		fmt.Fprintln(os.Stderr, "unknown subcommand:", os.Args[1])
		os.Exit(1)
	}
}

func trimHex(s string) string {
	if len(s) >= 2 && s[:2] == "0x" {
		return s[2:]
	}
	return s
}
