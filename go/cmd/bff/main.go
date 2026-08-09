package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"

	"extension-scaffold/internal/config"
	"extension-scaffold/pkg/types"

	"github.com/ethereum/go-ethereum/common"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
)

func extProxyURL() string {
	if v := os.Getenv("EXT_PROXY_URL"); v != "" {
		return v
	}
	return "http://localhost:8080"
}

func allowedOrigin() string {
	if v := os.Getenv("ALLOWED_ORIGIN"); v != "" {
		return v
	}
	return "*"
}

func bffPort() string {
	if v := os.Getenv("BFF_PORT"); v != "" {
		return v
	}
	return "8081"
}

// cors middleware: handles preflight + injects CORS headers.
func cors(next http.Handler) http.Handler {
	origin := allowedOrigin()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// forward POSTs the action to the extension proxy and writes the handler result
// JSON to w, or an error response on failure.
func forward(w http.ResponseWriter, action teetypes.Action) {
	body, err := json.Marshal(action)
	if err != nil {
		http.Error(w, "marshal action: "+err.Error(), http.StatusInternalServerError)
		return
	}

	resp, err := http.Post(extProxyURL()+"/action", "application/json", bytes.NewReader(body)) //nolint:gosec
	if err != nil {
		http.Error(w, "tee unavailable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	var result teetypes.ActionResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		http.Error(w, "bad response from tee: "+err.Error(), http.StatusBadGateway)
		return
	}

	if result.Status != 1 {
		http.Error(w, result.Log, http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(result.Data) //nolint:errcheck
}

func handleGetState(w http.ResponseWriter, r *http.Request) {
	resp, err := http.Get(extProxyURL() + "/state") //nolint:gosec
	if err != nil {
		http.Error(w, "tee unavailable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body) //nolint:errcheck
}

func handleSubmitAllocation(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Pool       string `json:"pool"`
		Ciphertext string `json:"ciphertext"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	msg := types.SubmitAllocationMessage{
		Ciphertext: common.FromHex(req.Ciphertext),
		Pool:       common.HexToAddress(req.Pool),
	}
	orig, err := pack(types.SubmitAllocationArg, msg)
	if err != nil {
		http.Error(w, "pack: "+err.Error(), http.StatusBadRequest)
		return
	}
	forward(w, buildAction(config.OPTypePrizePool, config.OPCommandSubmitAllocation, orig))
}

func handleClaimVerify(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Pool            string `json:"pool"`
		RecipientPubHex string `json:"recipientPubHex"`
		ChallengeSig    string `json:"challengeSig"`
		ClaimAddress    string `json:"claimAddress"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	payload, err := json.Marshal(types.ClaimVerifyPayload{
		RecipientPubHex: req.RecipientPubHex,
		ChallengeSig:    req.ChallengeSig,
		ClaimAddress:    req.ClaimAddress,
	})
	if err != nil {
		http.Error(w, "marshal payload: "+err.Error(), http.StatusInternalServerError)
		return
	}
	msg := types.ClaimVerifyMessage{Payload: payload, Pool: common.HexToAddress(req.Pool)}
	orig, err := pack(types.ClaimVerifyArg, msg)
	if err != nil {
		http.Error(w, "pack: "+err.Error(), http.StatusBadRequest)
		return
	}
	forward(w, buildAction(config.OPTypePrizePool, config.OPCommandClaimVerify, orig))
}

func handleComplianceReport(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Pool string `json:"pool"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	msg := types.ComplianceReportMessage{Pool: common.HexToAddress(req.Pool)}
	orig, err := pack(types.ComplianceReportArg, msg)
	if err != nil {
		http.Error(w, "pack: "+err.Error(), http.StatusBadRequest)
		return
	}
	forward(w, buildAction(config.OPTypePrizePool, config.OPCommandComplianceReport, orig))
}

func handleUnclaimedReport(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Pool            string `json:"pool"`
		OrganizerPubHex string `json:"organizerPubHex"`
		ChallengeSig    string `json:"challengeSig"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad request: "+err.Error(), http.StatusBadRequest)
		return
	}
	payload, err := json.Marshal(types.UnclaimedReportPayload{
		OrganizerPubHex: req.OrganizerPubHex,
		ChallengeSig:    req.ChallengeSig,
	})
	if err != nil {
		http.Error(w, "marshal payload: "+err.Error(), http.StatusInternalServerError)
		return
	}
	msg := types.UnclaimedReportMessage{Payload: payload, Pool: common.HexToAddress(req.Pool)}
	orig, err := pack(types.UnclaimedReportArg, msg)
	if err != nil {
		http.Error(w, "pack: "+err.Error(), http.StatusBadRequest)
		return
	}
	forward(w, buildAction(config.OPTypePrizePool, config.OPCommandUnclaimedReport, orig))
}

func main() {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/state", handleGetState)
	mux.HandleFunc("POST /api/submit-allocation", handleSubmitAllocation)
	mux.HandleFunc("POST /api/claim-verify", handleClaimVerify)
	mux.HandleFunc("POST /api/compliance-report", handleComplianceReport)
	mux.HandleFunc("POST /api/unclaimed-report", handleUnclaimedReport)

	port := bffPort()
	addr := fmt.Sprintf(":%s", port)
	log.Printf("BFF listening on %s → %s", addr, extProxyURL())
	if err := http.ListenAndServe(addr, cors(mux)); err != nil { //nolint:gosec
		log.Fatalf("server: %v", err)
	}
}
