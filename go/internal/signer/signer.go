// Package signer holds the extension's secp256k1 key and produces the EIP-712
// vouchers Pool.sol verifies, plus ECIES encrypt/decrypt for confidential I/O.
package signer

import (
	"crypto/ecdsa"
	"crypto/rand"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/crypto/ecies"
)

// Must byte-match Pool.sol: EIP712("ConfidentialPrizePool","1") and
// Voucher(address recipient,uint256 amount,uint256 nonce).
var (
	domainTypehash     = crypto.Keccak256([]byte("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"))
	nameHash           = crypto.Keccak256([]byte("ConfidentialPrizePool"))
	versionHash        = crypto.Keccak256([]byte("1"))
	voucherTypehash    = crypto.Keccak256([]byte("Voucher(address recipient,uint256 amount,uint256 nonce)"))
	complianceTypehash = crypto.Keccak256([]byte("ComplianceReport(address pool,uint256 totalDeposited,uint256 totalAllocated,uint256 recipientCount)"))
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

// PubKeyHex returns the uncompressed public key as 0x-prefixed hex (65 bytes:
// 0x04||X||Y) — what callers ECIES-encrypt to.
func (s *Signer) PubKeyHex() string {
	return "0x" + common.Bytes2Hex(crypto.FromECDSAPub(&s.key.PublicKey))
}

// EncryptTo ECIES-encrypts plaintext to a secp256k1 uncompressed pubkey hex.
func EncryptTo(pubHex string, plaintext []byte) ([]byte, error) {
	raw := common.FromHex(pubHex)
	pub, err := crypto.UnmarshalPubkey(raw)
	if err != nil {
		return nil, err
	}
	epub := ecies.ImportECDSAPublic(pub)
	return ecies.Encrypt(rand.Reader, epub, plaintext, nil, nil)
}

// Decrypt ECIES-decrypts ciphertext with the signer's private key.
func (s *Signer) Decrypt(ciphertext []byte) ([]byte, error) {
	epriv := ecies.ImportECDSA(s.key)
	return epriv.Decrypt(ciphertext, nil, nil)
}

// VoucherDigestForTest exposes the EIP-712 digest for tests/tools only.
func (s *Signer) VoucherDigestForTest(pool, recipient common.Address, amount, nonce *big.Int) []byte {
	return s.voucherDigest(pool, recipient, amount, nonce)
}

func (s *Signer) complianceDigest(pool common.Address, totalDeposited, totalAllocated, recipientCount *big.Int) []byte {
	structEnc := make([]byte, 0, 160)
	structEnc = append(structEnc, complianceTypehash...)
	structEnc = append(structEnc, word(pool.Bytes())...)
	structEnc = append(structEnc, word(totalDeposited.Bytes())...)
	structEnc = append(structEnc, word(totalAllocated.Bytes())...)
	structEnc = append(structEnc, word(recipientCount.Bytes())...)
	structHash := crypto.Keccak256(structEnc)

	pre := make([]byte, 0, 66)
	pre = append(pre, 0x19, 0x01)
	pre = append(pre, s.domainSeparator(pool)...)
	pre = append(pre, structHash...)
	return crypto.Keccak256(pre)
}

// SignComplianceReport signs the EIP-712 ComplianceReport; V normalized to 27/28.
func (s *Signer) SignComplianceReport(pool common.Address, totalDeposited, totalAllocated, recipientCount *big.Int) ([]byte, error) {
	digest := s.complianceDigest(pool, totalDeposited, totalAllocated, recipientCount)
	sig, err := crypto.Sign(digest, s.key)
	if err != nil {
		return nil, err
	}
	sig[64] += 27
	return sig, nil
}

// ComplianceDigestForTest exposes the digest for tests/tools only.
func (s *Signer) ComplianceDigestForTest(pool common.Address, totalDeposited, totalAllocated, recipientCount *big.Int) []byte {
	return s.complianceDigest(pool, totalDeposited, totalAllocated, recipientCount)
}

// DecryptWith decrypts ECIES ciphertext with an arbitrary private key (hex).
// Helper for tests; production decrypt uses the signer's own key via Decrypt.
func DecryptWith(privHex string, ct []byte) ([]byte, error) {
	priv, err := crypto.HexToECDSA(strings.TrimPrefix(privHex, "0x"))
	if err != nil {
		return nil, err
	}
	return ecies.ImportECDSA(priv).Decrypt(ct, nil, nil)
}
