package extension

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"

	"extension-scaffold/internal/allocations"
	"extension-scaffold/internal/chain"
	"extension-scaffold/internal/config"
	"extension-scaffold/internal/signer"
	"extension-scaffold/pkg/types"

	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"

	"github.com/flare-foundation/tee-node/pkg/processorutils"
)

type Extension struct {
	mu     sync.RWMutex
	Server *http.Server

	signer *signer.Signer
	store  *allocations.Store
	reader *chain.Reader
}

func New(extensionPort, signPort int, s *signer.Signer, store *allocations.Store, reader *chain.Reader) *Extension {
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
	return buildResult(action, df, nil, 0, fmt.Errorf("not implemented"))
}
func (e *Extension) processClaimVerify(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	return buildResult(action, df, nil, 0, fmt.Errorf("not implemented"))
}
