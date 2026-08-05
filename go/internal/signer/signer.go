// Package signer holds the extension's secp256k1 key and produces the EIP-712
// vouchers Pool.sol verifies, plus ECIES encrypt/decrypt for confidential I/O.
package signer

import (
	"crypto/ecdsa"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// Must byte-match Pool.sol: EIP712("ConfidentialPrizePool","1") and
// Voucher(address recipient,uint256 amount,uint256 nonce).
var (
	domainTypehash  = crypto.Keccak256([]byte("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"))
	nameHash        = crypto.Keccak256([]byte("ConfidentialPrizePool"))
	versionHash     = crypto.Keccak256([]byte("1"))
	voucherTypehash = crypto.Keccak256([]byte("Voucher(address recipient,uint256 amount,uint256 nonce)"))
)

type Signer struct {
	key     *ecdsa.PrivateKey
	addr    common.Address
	chainID *big.Int
}

// NewFromHex loads a secp256k1 key from hex (no 0x prefix required).
func NewFromHex(hexKey string, chainID *big.Int) (*Signer, error) {
	if len(hexKey) >= 2 && hexKey[0:2] == "0x" {
		hexKey = hexKey[2:]
	}
	key, err := crypto.HexToECDSA(hexKey)
	if err != nil {
		return nil, err
	}
	return &Signer{key: key, addr: crypto.PubkeyToAddress(key.PublicKey), chainID: chainID}, nil
}

func (s *Signer) Address() common.Address { return s.addr }

func word(b []byte) []byte { return common.LeftPadBytes(b, 32) }

func (s *Signer) domainSeparator(pool common.Address) []byte {
	enc := make([]byte, 0, 160)
	enc = append(enc, domainTypehash...)
	enc = append(enc, nameHash...)
	enc = append(enc, versionHash...)
	enc = append(enc, word(s.chainID.Bytes())...)
	enc = append(enc, word(pool.Bytes())...)
	return crypto.Keccak256(enc)
}

func (s *Signer) voucherDigest(pool, recipient common.Address, amount, nonce *big.Int) []byte {
	structEnc := make([]byte, 0, 128)
	structEnc = append(structEnc, voucherTypehash...)
	structEnc = append(structEnc, word(recipient.Bytes())...)
	structEnc = append(structEnc, word(amount.Bytes())...)
	structEnc = append(structEnc, word(nonce.Bytes())...)
	structHash := crypto.Keccak256(structEnc)

	pre := make([]byte, 0, 66)
	pre = append(pre, 0x19, 0x01)
	pre = append(pre, s.domainSeparator(pool)...)
	pre = append(pre, structHash...)
	return crypto.Keccak256(pre)
}

// SignVoucher returns a 65-byte [R||S||V] signature with V normalized to 27/28
// (OZ ECDSA.recover rejects V in {0,1}).
func (s *Signer) SignVoucher(pool, recipient common.Address, amount, nonce *big.Int) ([]byte, error) {
	digest := s.voucherDigest(pool, recipient, amount, nonce)
	sig, err := crypto.Sign(digest, s.key)
	if err != nil {
		return nil, err
	}
	sig[64] += 27
	return sig, nil
}
