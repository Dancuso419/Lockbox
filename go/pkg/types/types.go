// Package types contains types that could be useful to other apps when interacting with this extension.
package types

import (
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
)

// SubmitAllocationMessage is the ABI payload from sendSubmitAllocation.
type SubmitAllocationMessage struct {
	Ciphertext []byte
	Pool       common.Address
}

// ClaimVerifyMessage is the ABI payload from sendClaimVerify.
type ClaimVerifyMessage struct {
	Payload []byte
	Pool    common.Address
}

// ComplianceReportMessage is the ABI payload from sendComplianceReport.
type ComplianceReportMessage struct {
	Pool common.Address
}

// UnclaimedReportMessage is the ABI payload from sendUnclaimedReport.
type UnclaimedReportMessage struct {
	Payload []byte
	Pool    common.Address
}

// UnclaimedReportPayload is the parsed UNCLAIMED_REPORT request payload.
type UnclaimedReportPayload struct {
	OrganizerPubHex string `json:"organizerPubHex"`
	ChallengeSig    string `json:"challengeSig"`
}

// UnclaimedReportResult carries the ECIES-encrypted non-claimant list.
type UnclaimedReportResult struct {
	Report string `json:"report"` // 0x-hex ECIES ciphertext of []UnclaimedItem
}

// UnclaimedItem is one row inside the encrypted report body.
type UnclaimedItem struct {
	Recipient string `json:"recipient"`
	Amount    string `json:"amount"`
}

type ComplianceReportResult struct {
	TotalAllocated string `json:"totalAllocated"`
	RecipientCount int    `json:"recipientCount"`
	Signature      string `json:"signature"`
}

// AllocationTable is the decrypted SUBMIT_ALLOCATION plaintext.
type AllocationTable struct {
	Allocations []AllocationItem `json:"allocations"`
}
type AllocationItem struct {
	Recipient string `json:"recipient"` // 0x address
	Amount    string `json:"amount"`    // decimal wei
}

// ClaimVerifyPayload is the parsed CLAIM_VERIFY request payload.
type ClaimVerifyPayload struct {
	RecipientPubHex string `json:"recipientPubHex"`
	ChallengeSig    string `json:"challengeSig"`
}

type SubmitAllocationResult struct {
	OK    bool `json:"ok"`
	Count int  `json:"count"`
}
type ClaimVerifyResult struct {
	Voucher string `json:"voucher"`
}

// State is the observable state (no allocations — only the signer identity).
type State struct {
	SignerAddress string `json:"signerAddress"`
	SignerPubKey  string `json:"signerPubKey"`
}

var (
	SubmitAllocationArg abi.Argument
	ClaimVerifyArg      abi.Argument
	ComplianceReportArg abi.Argument
	UnclaimedReportArg  abi.Argument
)

func init() {
	saTy, _ := abi.NewType("tuple", "", []abi.ArgumentMarshaling{
		{Name: "ciphertext", Type: "bytes"},
		{Name: "pool", Type: "address"},
	})
	SubmitAllocationArg = abi.Argument{Type: saTy}

	cvTy, _ := abi.NewType("tuple", "", []abi.ArgumentMarshaling{
		{Name: "payload", Type: "bytes"},
		{Name: "pool", Type: "address"},
	})
	ClaimVerifyArg = abi.Argument{Type: cvTy}

	crTy, _ := abi.NewType("tuple", "", []abi.ArgumentMarshaling{
		{Name: "pool", Type: "address"},
	})
	ComplianceReportArg = abi.Argument{Type: crTy}

	urTy, _ := abi.NewType("tuple", "", []abi.ArgumentMarshaling{
		{Name: "payload", Type: "bytes"},
		{Name: "pool", Type: "address"},
	})
	UnclaimedReportArg = abi.Argument{Type: urTy}
}

// --- DO NOT MODIFY below this line. ---

// StateResponse is the envelope returned by GET /state.
type StateResponse struct {
	StateVersion common.Hash `json:"stateVersion"`
	State        State       `json:"state"`
}
