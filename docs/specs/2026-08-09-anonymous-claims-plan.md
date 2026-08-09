# Anonymous Claims (M5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a recipient direct their prize payout to a fresh, identity-unlinkable claim address (bound into the signed eligibility challenge), and randomize allocation nonces so the on-chain nonce leaks no position/rank — breaking the public `identity ↔ amount` link with no contract change.

**Architecture:** Two Go changes: (1) `allocations.Store.Submit` assigns a random 256-bit nonce per entry instead of the table index; (2) `handleClaimVerify` accepts an optional `ClaimAddress`, binds it into the challenge string, and signs the voucher for that address (falling back to the identity address). The `Voucher` EIP-712 type is unchanged, so `Pool.sol` and the cross-language interop test are untouched.

**Tech Stack:** Go (crypto/rand, go-ethereum common/crypto/accounts), existing signer/allocations/extension packages. All Go commands run from the `go/` subdir (module `extension-scaffold`).

**Design ref:** `docs/specs/2026-08-09-anonymous-claims-design.md` (Section 5, the threat model, is the weighted M5 deliverable and is already written).

---

### Task 1: Randomized allocation nonces

Randomize the per-entry nonce and fix the two tests that assumed sequential nonce values. Keep every suite green.

**Files:**
- Modify: `go/internal/allocations/store.go` (the `Submit` method + a new `randomNonce` helper)
- Test: `go/internal/allocations/store_test.go` (add a non-sequential assertion)
- Fix (broken by this change): `go/internal/extension/claim_test.go:71`, `go/internal/extension/unclaimed_test.go`

- [ ] **Step 1: Write the failing test (nonces are large & non-sequential)**

Add to `go/internal/allocations/store_test.go`:

```go
func TestSubmit_NoncesAreRandomNotSequential(t *testing.T) {
	s := New()
	pool := addr(1)
	entries := []Input{
		{Recipient: addr(0xA), Amount: big.NewInt(1)},
		{Recipient: addr(0xB), Amount: big.NewInt(1)},
		{Recipient: addr(0xC), Amount: big.NewInt(1)},
	}
	if err := s.Submit(pool, entries, big.NewInt(10)); err != nil {
		t.Fatalf("Submit: %v", err)
	}
	rows, _ := s.Entries(pool)
	seq := big.NewInt(2) // any nonce still equal to a small index would be < this
	small := 0
	seen := map[string]bool{}
	for _, r := range rows {
		if r.Nonce.Cmp(seq) < 0 {
			small++
		}
		if seen[r.Nonce.String()] {
			t.Fatalf("duplicate nonce %s", r.Nonce)
		}
		seen[r.Nonce.String()] = true
	}
	// With random 256-bit nonces, it is astronomically unlikely any equals 0 or 1.
	if small > 0 {
		t.Fatalf("found %d small/sequential-looking nonces; expected random", small)
	}
}
```

- [ ] **Step 2: Run it, verify it FAILS**

Run: `cd go && go test ./internal/allocations/ -run TestSubmit_NoncesAreRandom -v`
Expected: FAIL — current code assigns nonces 0,1,2 so `small == 3`.

- [ ] **Step 3: Implement random nonces in `Submit`**

In `go/internal/allocations/store.go`, add the import `crypto/rand` and this helper (place it above `Submit`):

```go
// randomNonce returns a random 256-bit nonce. Random (not sequential) so the
// on-chain nonce reveals nothing about a recipient's position in the table.
func randomNonce() (*big.Int, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return nil, err
	}
	return new(big.Int).SetBytes(b[:]), nil
}
```

Then change the entry-building loop in `Submit`. Current code:

```go
	table := make(map[common.Address]*Entry, len(entries))
	sum := new(big.Int)
	for i, in := range entries {
		if in.Amount == nil || in.Amount.Sign() <= 0 {
			return fmt.Errorf("amount must be positive")
		}
		if _, dup := table[in.Recipient]; dup {
			return fmt.Errorf("duplicate recipient")
		}
		table[in.Recipient] = &Entry{Amount: new(big.Int).Set(in.Amount), Nonce: big.NewInt(int64(i))}
		sum.Add(sum, in.Amount)
	}
```

Replace with (note: `i` is dropped; a `seenNonce` guard prevents the astronomically-unlikely collision):

```go
	table := make(map[common.Address]*Entry, len(entries))
	seenNonce := make(map[string]bool, len(entries))
	sum := new(big.Int)
	for _, in := range entries {
		if in.Amount == nil || in.Amount.Sign() <= 0 {
			return fmt.Errorf("amount must be positive")
		}
		if _, dup := table[in.Recipient]; dup {
			return fmt.Errorf("duplicate recipient")
		}
		nonce, err := randomNonce()
		if err != nil {
			return fmt.Errorf("nonce gen: %w", err)
		}
		for seenNonce[nonce.String()] {
			if nonce, err = randomNonce(); err != nil {
				return fmt.Errorf("nonce gen: %w", err)
			}
		}
		seenNonce[nonce.String()] = true
		table[in.Recipient] = &Entry{Amount: new(big.Int).Set(in.Amount), Nonce: nonce}
		sum.Add(sum, in.Amount)
	}
```

- [ ] **Step 4: Run the allocations suite, verify PASS**

Run: `cd go && go test ./internal/allocations/ -v`
Expected: PASS (the new test + all existing; `TestSubmit_HappyPath` already only asserts nonces differ).

- [ ] **Step 5: Fix `claim_test.go` (hardcoded nonce 0)**

In `go/internal/extension/claim_test.go`, the digest check at line ~71 hardcodes `big.NewInt(0)`. The test already unmarshals the voucher into `v` (with `v.Nonce`). Replace the hardcoded-nonce block:

```go
	digest := sgn.VoucherDigestForTest(pool, recipient, big.NewInt(3), big.NewInt(0))
```

with (parse the actual nonce the TEE used, from the decrypted voucher):

```go
	nonce, ok := new(big.Int).SetString(v.Nonce, 10)
	if !ok {
		t.Fatalf("bad nonce in voucher: %q", v.Nonce)
	}
	digest := sgn.VoucherDigestForTest(pool, recipient, big.NewInt(3), nonce)
```

- [ ] **Step 6: Fix `unclaimed_test.go` (used-nonce map assumed sequential)**

In `go/internal/extension/unclaimed_test.go`, `TestUnclaimedReportHappyPath` currently hardcodes `used: map[string]bool{"1": true, "2": true}` assuming r1/r2/r3 got nonces 0/1/2. Rewrite so it marks the ACTUAL nonces of r2 and r3 as used (leaving r1 unclaimed), by reading the store. After the `store.Submit(...)` call and before constructing `reader`, insert:

```go
	// Nonces are random; mark r2 and r3 claimed by their actual nonces so only r1 remains.
	usedNonces := map[string]bool{}
	rows, _ := store.Entries(pool)
	for _, row := range rows {
		if row.Recipient == r2 || row.Recipient == r3 {
			usedNonces[row.Nonce.String()] = true
		}
	}
```

Then change the reader construction from `used: map[string]bool{"1": true, "2": true}` to `used: usedNonces`. The rest of the test (asserting the report decrypts to exactly r1/10) is unchanged and still proves claimed recipients are excluded.

- [ ] **Step 7: Run the full Go suite, verify PASS**

Run: `cd go && go build ./... && go test ./...`
Expected: PASS across all packages (allocations, extension incl. claim + unclaimed, signer, chain).

- [ ] **Step 8: Commit**

```bash
git add go/internal/allocations/store.go go/internal/allocations/store_test.go go/internal/extension/claim_test.go go/internal/extension/unclaimed_test.go
git commit -m "feat(m5): randomize allocation nonces (hide list position)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Do NOT `git add -A` — unrelated modified files exist in the tree; add only the four named files.

---

### Task 2: Fresh claim-address binding in CLAIM_VERIFY

Add an optional `ClaimAddress` to the claim payload, bind it into the signed challenge, and sign the voucher for it (falling back to the identity address). Backward compatible.

**Files:**
- Modify: `go/pkg/types/types.go` (`ClaimVerifyPayload`)
- Modify: `go/internal/extension/extension.go` (`handleClaimVerify`)
- Test: `go/internal/extension/claim_test.go` (update the shared challenge helper; add fresh-address, backward-compat, and bad-address cases)

- [ ] **Step 1: Add the `ClaimAddress` field**

In `go/pkg/types/types.go`, the current struct is:

```go
// ClaimVerifyPayload is the parsed CLAIM_VERIFY request payload.
type ClaimVerifyPayload struct {
	RecipientPubHex string `json:"recipientPubHex"`
	ChallengeSig    string `json:"challengeSig"`
}
```

Change it to:

```go
// ClaimVerifyPayload is the parsed CLAIM_VERIFY request payload.
type ClaimVerifyPayload struct {
	RecipientPubHex string `json:"recipientPubHex"`
	ChallengeSig    string `json:"challengeSig"`
	ClaimAddress    string `json:"claimAddress"` // optional 0x addr; empty => pay identity address
}
```

- [ ] **Step 2: Update the shared challenge helper + add the failing fresh-address test**

In `go/internal/extension/claim_test.go`, the helper at the top currently is:

```go
func challengeMessage(pool common.Address, recipientPubHex string) string {
	return "ConfidentialPrizePool claim\npool:" + pool.Hex() + "\nkey:" + recipientPubHex
}
```

Replace it with a version that binds the claim address (empty string reproduces the M4 challenge shape, matching what the handler will build):

```go
func challengeMessage(pool common.Address, recipientPubHex, claimAddr string) string {
	return "ConfidentialPrizePool claim\npool:" + pool.Hex() +
		"\nkey:" + recipientPubHex + "\nclaim:" + claimAddr
}
```

Update the three EXISTING call sites in this file to pass `""` as the new arg:
- `TestClaimVerify_ReturnsEncryptedVoucher`: `msg := challengeMessage(pool, recipientPub, "")`
- `TestClaimVerify_UnknownRecipientRejected`: `msg := challengeMessage(pool, recipientPub, "")`
- `TestClaimVerify_WrongPoolChallengeRejected`: `msg := challengeMessage(poolA, recipientPub, "")`

Now append the new fresh-address test (identity A eligible, payout directed to C):

```go
func TestClaimVerify_FreshClaimAddress(t *testing.T) {
	teeKey := "353c43dada1ebc390f9594ed91753446e19389ae545fc7fada020816346efb73"
	sgn, _ := signer.NewFromHex(teeKey, big.NewInt(114))
	st := allocations.New()
	e := &Extension{signer: sgn, store: st, reader: fakeReader{total: big.NewInt(10)}}

	rk, _ := crypto.HexToECDSA("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
	identity := crypto.PubkeyToAddress(rk.PublicKey)
	recipientPub := "0x" + common.Bytes2Hex(crypto.FromECDSAPub(&rk.PublicKey))

	pool := common.Address{19: 1}
	if err := st.Submit(pool, []allocations.Input{{Recipient: identity, Amount: big.NewInt(3)}}, big.NewInt(10)); err != nil {
		t.Fatal(err)
	}

	// Fresh, unlinked claim address.
	claim := common.HexToAddress("0x00000000000000000000000000000000cafe0001")
	msg := challengeMessage(pool, recipientPub, claim.Hex())
	sig, _ := crypto.Sign(accounts.TextHash([]byte(msg)), rk)
	sig[64] += 27
	pb, _ := json.Marshal(types.ClaimVerifyPayload{
		RecipientPubHex: recipientPub,
		ChallengeSig:    "0x" + common.Bytes2Hex(sig),
		ClaimAddress:    claim.Hex(),
	})

	status, body := e.handleClaimVerify(context.Background(), pool, pb)
	if status != 1 {
		t.Fatalf("status=%d body=%s", status, body)
	}
	var res types.ClaimVerifyResult
	_ = json.Unmarshal(body, &res)
	rEcies, _ := signer.NewFromHex("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", big.NewInt(114))
	voucherJSON, err := rEcies.Decrypt(common.FromHex(res.Voucher))
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	var v struct {
		Amount    string `json:"amount"`
		Nonce     string `json:"nonce"`
		Signature string `json:"signature"`
	}
	_ = json.Unmarshal(voucherJSON, &v)

	// Voucher must be signed for the CLAIM address, not the identity address.
	nonce, _ := new(big.Int).SetString(v.Nonce, 10)
	vsig := common.FromHex(v.Signature)
	vsig[64] -= 27
	digestClaim := sgn.VoucherDigestForTest(pool, claim, big.NewInt(3), nonce)
	pub, _ := crypto.SigToPub(digestClaim, vsig)
	if crypto.PubkeyToAddress(*pub) != sgn.Address() {
		t.Fatal("voucher does not verify for the fresh claim address")
	}
	// And must NOT verify for the identity address.
	digestIdentity := sgn.VoucherDigestForTest(pool, identity, big.NewInt(3), nonce)
	pubI, _ := crypto.SigToPub(digestIdentity, vsig)
	if crypto.PubkeyToAddress(*pubI) == sgn.Address() {
		t.Fatal("voucher should not verify for the identity address when a claim address is set")
	}
}

func TestClaimVerify_BadClaimAddressRejected(t *testing.T) {
	sgn, _ := signer.NewFromHex("353c43dada1ebc390f9594ed91753446e19389ae545fc7fada020816346efb73", big.NewInt(114))
	st := allocations.New()
	e := &Extension{signer: sgn, store: st, reader: fakeReader{total: big.NewInt(10)}}
	rk, _ := crypto.HexToECDSA("ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
	identity := crypto.PubkeyToAddress(rk.PublicKey)
	recipientPub := "0x" + common.Bytes2Hex(crypto.FromECDSAPub(&rk.PublicKey))
	pool := common.Address{19: 1}
	_ = st.Submit(pool, []allocations.Input{{Recipient: identity, Amount: big.NewInt(3)}}, big.NewInt(10))

	bad := "not-an-address"
	msg := challengeMessage(pool, recipientPub, bad)
	sig, _ := crypto.Sign(accounts.TextHash([]byte(msg)), rk)
	sig[64] += 27
	pb, _ := json.Marshal(types.ClaimVerifyPayload{
		RecipientPubHex: recipientPub, ChallengeSig: "0x" + common.Bytes2Hex(sig), ClaimAddress: bad,
	})
	if status, _ := e.handleClaimVerify(context.Background(), pool, pb); status != 0 {
		t.Fatal("expected bad claim address to be rejected")
	}
}
```

(`TestClaimVerify_ReturnsEncryptedVoucher` is the backward-compat case — it sends no `ClaimAddress`, so the voucher must still verify for the identity address. After the helper update it exercises the empty-`claim:` path.)

- [ ] **Step 3: Run the new tests, verify they FAIL**

Run: `cd go && go test ./internal/extension/ -run 'TestClaimVerify_FreshClaimAddress|TestClaimVerify_BadClaimAddress' -v`
Expected: FAIL — the handler doesn't build the `\nclaim:` challenge or honor `ClaimAddress` yet, so `FreshClaimAddress` recovers a mismatched identity (not eligible → status 0) and `BadClaimAddress` returns status 1.

- [ ] **Step 4: Implement claim-address binding in `handleClaimVerify`**

In `go/internal/extension/extension.go`, the current head of `handleClaimVerify` is:

```go
	challenge := "ConfidentialPrizePool claim\npool:" + pool.Hex() + "\nkey:" + req.RecipientPubHex
	recipient, err := recoverChallenge(challenge, req.ChallengeSig)
	if err != nil {
		return 0, []byte("bad challenge sig")
	}

	entry, ok := e.store.Lookup(pool, recipient)
	if !ok {
		return 0, []byte("not eligible")
	}
	vsig, err := e.signer.SignVoucher(pool, recipient, entry.Amount, entry.Nonce)
```

Replace that block with (bind the claim address into the challenge; look up eligibility by the recovered IDENTITY; sign the voucher for `payTo`):

```go
	challenge := "ConfidentialPrizePool claim\npool:" + pool.Hex() +
		"\nkey:" + req.RecipientPubHex + "\nclaim:" + req.ClaimAddress
	identityAddr, err := recoverChallenge(challenge, req.ChallengeSig)
	if err != nil {
		return 0, []byte("bad challenge sig")
	}

	entry, ok := e.store.Lookup(pool, identityAddr)
	if !ok {
		return 0, []byte("not eligible")
	}

	// Redirect payout to a fresh, identity-unlinkable claim address when supplied.
	payTo := identityAddr
	if req.ClaimAddress != "" {
		if !common.IsHexAddress(req.ClaimAddress) {
			return 0, []byte("bad claim address")
		}
		payTo = common.HexToAddress(req.ClaimAddress)
	}

	vsig, err := e.signer.SignVoucher(pool, payTo, entry.Amount, entry.Nonce)
```

Leave the rest of the function (voucher JSON assembly, ECIES `EncryptTo(req.RecipientPubHex, ...)`, result) unchanged. Do NOT log `req.ClaimAddress`, `identityAddr`, `payTo`, `entry.Amount`, or the voucher.

- [ ] **Step 5: Run the extension suite, verify PASS**

Run: `cd go && go test ./internal/extension/ -v`
Expected: PASS — fresh-address + bad-address + backward-compat (`ReturnsEncryptedVoucher`) + all existing claim/compliance/unclaimed/submit tests.

- [ ] **Step 6: Full Go + interop verify**

Run: `cd go && go build ./... && go vet ./... && go test ./...`
Expected: all green.

Rebuild the FFI binaries and run forge (the voucher type is unchanged, so interop must still pass):

```bash
cd go && go build -o ../bin/sign-voucher.exe ./cmd/sign-voucher && go build -o ../bin/sign-compliance.exe ./cmd/sign-compliance
cd .. && /c/Users/DELL/.foundry/bin/forge test
```
Expected: 27/27 forge tests pass (no Solidity change).

- [ ] **Step 7: Commit**

```bash
git add go/pkg/types/types.go go/internal/extension/extension.go go/internal/extension/claim_test.go
git commit -m "feat(m5): fresh claim-address binding in CLAIM_VERIFY

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Update memory

**Files:**
- Modify: `C:/Users/DELL/.claude/projects/F--PROJECTS-LOCKBOX/memory/confidential-prize-pool.md`

- [ ] **Step 1: Record M5 completion**

Append an M5 status paragraph: M5 anonymous claims done — identity↔payout unlinkability (NOT amount confidentiality) via fresh claim-address binding in CLAIM_VERIFY (`ClaimAddress` in payload bound into challenge `\nclaim:` line, voucher signed for payTo, backward-compatible empty=identity) + randomized 256-bit allocation nonces (hide list position). No contract change, no new EIP-712 (Voucher unchanged → VoucherInterop still green). Threat model doc `docs/specs/2026-08-09-anonymous-claims-design.md` §5 is the weighted deliverable; residuals documented: amount fingerprinting (inherent), gas-funding link (fund C independently — deployment requirement, relayer deferred), timing/ordering (jitter guidance). Milestones done: M1,M2,M3,M4,M5,M6,M7. Remaining: M8 FXRP, M9 frontend, M10 demo.

- [ ] **Step 2: No commit** (memory is outside the repo tree).

---

## Self-Review Notes

- **Spec §2 decisions coverage:** fresh-address + no contract change (Task 2), eligibility-by-identity/payout-redirect (Task 2 step 4), C bound in challenge (Task 2 step 4), backward compat empty=identity (Task 2, `ReturnsEncryptedVoucher`), randomized nonces (Task 1), residuals documented (design §5, already committed). All mapped.
- **Spec §7 testing coverage:** nonces distinct & non-sequential (Task 1 step 1); fresh-address voucher==C and ≠identity (Task 2); backward-compat (existing test through updated helper); bad claim address → status 0 (Task 2); interop unchanged & green after rebuild (Task 2 step 6); nonce-assumption fixes (Task 1 steps 5-6). All mapped.
- **Placeholder scan:** none — every code step shows full before/after.
- **Type consistency:** `ClaimVerifyPayload.ClaimAddress` (json `claimAddress`) used identically in types.go, handler, and all tests. `challengeMessage(pool, recipientPubHex, claimAddr)` signature updated at all four call sites. Challenge string `"...\nkey:<pub>\nclaim:<addr>"` byte-identical between handler (extension.go) and helper (claim_test.go). `randomNonce()` defined in Task 1, used only there.
- **Green-at-every-commit:** Task 1 fixes the tests it breaks (claim_test nonce, unclaimed_test used-map) before committing; Task 2 updates the challenge helper in lockstep with the handler. No intermediate red state.
