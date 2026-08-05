package extension

import (
	"context"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"sync"

	"extension-scaffold/internal/allocations"
	"extension-scaffold/internal/config"
	"extension-scaffold/internal/signer"
	"extension-scaffold/pkg/types"

	"github.com/ethereum/go-ethereum/common"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	"github.com/flare-foundation/go-flare-common/pkg/tee/structs"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"

	"github.com/flare-foundation/tee-node/pkg/processorutils"
)

type depositReader interface {
	TotalDeposited(ctx context.Context, pool common.Address) (*big.Int, error)
}

type Extension struct {
	mu     sync.RWMutex
	Server *http.Server

	signer *signer.Signer
	store  *allocations.Store
	reader depositReader
}

func New(extensionPort, signPort int, s *signer.Signer, store *allocations.Store, reader depositReader) *Extension {
	e := &Extension{signer: s, store: store, reader: reader}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /state", e.stateHandler)
	mux.HandleFunc("POST /action", e.actionHandler)
	e.Server = &http.Server{Addr: fmt.Sprintf(":%d", extensionPort), Handler: mux}
	return e
}

// stateHandler returns the extension's observable state.
func (e *Extension) stateHandler(w http.ResponseWriter, r *http.Request) {
	e.mu.RLock()
	stateResponse := types.StateResponse{
		StateVersion: teeutils.ToHash(config.Version),
		State: types.State{
			SignerAddress: e.signer.Address().Hex(),
			SignerPubKey:  e.signer.PubKeyHex(),
		},
	}
	e.mu.RUnlock()

	err := json.NewEncoder(w).Encode(stateResponse)
	if err != nil {
		http.Error(w, fmt.Sprintf("sending response: %v", err), http.StatusInternalServerError)
		return
	}
}

func (e *Extension) processAction(action teetypes.Action) (int, []byte) {
	dataFixed, err := processorutils.Parse[instruction.DataFixed](action.Data.Message)
	if err != nil {
		return http.StatusBadRequest, []byte(fmt.Sprintf("decoding fixed data: %v", err))
	}

	switch {
	case dataFixed.OPType == teeutils.ToHash(config.OPTypePrizePool):
		return e.processPrizePool(action, dataFixed)

	default:
		return http.StatusNotImplemented, []byte(fmt.Sprintf(
			"unsupported op type: received %s, expected %s (%s)",
			dataFixed.OPType.Hex(), teeutils.ToHash(config.OPTypePrizePool).Hex(), config.OPTypePrizePool,
		))
	}
}

func (e *Extension) processPrizePool(action teetypes.Action, df *instruction.DataFixed) (int, []byte) {
	switch {
	case df.OPCommand == teeutils.ToHash(config.OPCommandSubmitAllocation):
		b, _ := json.Marshal(e.processSubmitAllocation(action, df))
		return http.StatusOK, b
	case df.OPCommand == teeutils.ToHash(config.OPCommandClaimVerify):
		b, _ := json.Marshal(e.processClaimVerify(action, df))
		return http.StatusOK, b
	default:
		return http.StatusNotImplemented, []byte(fmt.Sprintf("unsupported op command: %s", df.OPCommand.Hex()))
	}
}

func (e *Extension) processSubmitAllocation(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	var msg types.SubmitAllocationMessage
	if err := structs.DecodeTo(types.SubmitAllocationArg, df.OriginalMessage, &msg); err != nil {
		return buildResult(action, df, nil, 0, fmt.Errorf("decoding message: %w", err))
	}
	status, data := e.handleSubmitAllocation(context.Background(), msg.Pool, msg.Ciphertext)
	return buildResult(action, df, data, status, resultErr(status, data))
}

// handleSubmitAllocation decrypts, validates against the on-chain deposit, and
// stores. status 1=ok, 0=error. Never logs the decrypted plaintext.
func (e *Extension) handleSubmitAllocation(ctx context.Context, pool common.Address, ciphertext []byte) (uint8, []byte) {
	plain, err := e.signer.Decrypt(ciphertext)
	if err != nil {
		return 0, []byte("decrypt failed")
	}
	var table types.AllocationTable
	if err := json.Unmarshal(plain, &table); err != nil {
		return 0, []byte("bad allocation payload")
	}
	inputs := make([]allocations.Input, 0, len(table.Allocations))
	for _, a := range table.Allocations {
		amt, ok := new(big.Int).SetString(a.Amount, 10)
		if !ok {
			return 0, []byte("bad amount")
		}
		inputs = append(inputs, allocations.Input{Recipient: common.HexToAddress(a.Recipient), Amount: amt})
	}
	total, err := e.reader.TotalDeposited(ctx, pool)
	if err != nil {
		return 0, []byte("deposit read failed")
	}
	if err := e.store.Submit(pool, inputs, total); err != nil {
		return 0, []byte("allocation rejected")
	}
	out, _ := json.Marshal(types.SubmitAllocationResult{OK: true, Count: len(inputs)})
	return 1, out
}

// resultErr synthesizes buildResult's Log error on failure.
func resultErr(status uint8, data []byte) error {
	if status == 1 {
		return nil
	}
	return fmt.Errorf("%s", string(data))
}

func (e *Extension) processClaimVerify(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	return buildResult(action, df, nil, 0, fmt.Errorf("not implemented"))
}
