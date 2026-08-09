package main

import (
	"encoding/json"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
)

// buildAction wraps an ABI-packed originalMessage in the Action envelope the
// extension /action handler expects (Data.Message = JSON-encoded DataFixed).
func buildAction(opType, opCommand string, originalMessage []byte) teetypes.Action {
	df := instruction.DataFixed{
		OPType:          teeutils.ToHash(opType),
		OPCommand:       teeutils.ToHash(opCommand),
		OriginalMessage: originalMessage,
	}
	msg, _ := json.Marshal(df)
	return teetypes.Action{Data: teetypes.ActionData{Message: hexutil.Bytes(msg)}}
}

func pack(arg abi.Argument, v interface{}) ([]byte, error) {
	return abi.Arguments{arg}.Pack(v)
}
