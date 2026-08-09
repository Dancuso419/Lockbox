package main

import (
	"testing"

	"extension-scaffold/internal/config"
	"extension-scaffold/pkg/types"

	"github.com/ethereum/go-ethereum/common"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	"github.com/flare-foundation/go-flare-common/pkg/tee/structs"
	"github.com/flare-foundation/tee-node/pkg/processorutils"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

func TestBuildAction_ClaimVerify_RoundTrips(t *testing.T) {
	pool := common.HexToAddress("0x1111111111111111111111111111111111111111")
	payload := []byte(`{"recipientPubHex":"0x04","challengeSig":"0x","claimAddress":""}`)
	orig, err := pack(types.ClaimVerifyArg, types.ClaimVerifyMessage{Payload: payload, Pool: pool})
	if err != nil {
		t.Fatal(err)
	}

	act := buildAction(config.OPTypePrizePool, config.OPCommandClaimVerify, orig)
	df, err := processorutils.Parse[instruction.DataFixed](act.Data.Message)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if df.OPType != teeutils.ToHash(config.OPTypePrizePool) {
		t.Fatal("optype")
	}
	if df.OPCommand != teeutils.ToHash(config.OPCommandClaimVerify) {
		t.Fatal("opcommand")
	}

	var decoded types.ClaimVerifyMessage
	if err := structs.DecodeTo(types.ClaimVerifyArg, df.OriginalMessage, &decoded); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if decoded.Pool != pool || string(decoded.Payload) != string(payload) {
		t.Fatalf("roundtrip mismatch: %+v", decoded)
	}
}
