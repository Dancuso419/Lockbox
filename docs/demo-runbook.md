# Lockbox — demo runbook (wallet-driven end-to-end)

Everything up to the wallet boundary is verified working. This is the half that
needs a human: allocate, claim, attest and sweep each require a signature, so
they can only be driven from a browser with MetaMask.

Read the whole of §0 before starting. Two of those steps are irreversible in a
way that costs you a redeployed pool if you get them wrong.

---

## 0. Before you touch the UI

### 0.1 The two rules that will bite

1. **Never restart `extension-tee` mid-run.** Allocations live in memory inside
   the enclave. A restart wipes them, and `SUBMIT_ALLOCATION` → `CLAIM_VERIFY` →
   `COMPLIANCE_REPORT` must all happen in one enclave session. If you restart,
   start again from §2.
2. **The organizer is the deploy key, not your everyday wallet.** Publishing the
   attestation and sweeping both check `msg.sender == organizer` on-chain. For
   the pool below that is `0x96514797C40C4A11617C6c60ac75edD676b81De0`, whose
   private key is `DEPLOYMENT_PRIVATE_KEY` in the gitignored `.env`. Import it
   into MetaMask as a throwaway account, or create your own pool from the UI in
   §2 so your own wallet is the organizer.

### 0.2 MetaMask

Add Coston2 if you haven't:

| Field | Value |
| --- | --- |
| Network name | Flare Testnet Coston2 |
| RPC URL | `https://coston2-api.flare.network/ext/C/rpc` |
| Chain ID | `114` |
| Currency | `C2FLR` |
| Explorer | `https://coston2-explorer.flare.network` |

You need **two accounts** with a little C2FLR each:

- **Organizer** — the deploy key above, or your own if you create a fresh pool.
- **Recipient** — any second account. This is who claims. Fund it from
  <https://faucet.flare.network/coston2>; it needs gas to submit the claim.

### 0.3 Bring the stack up, in this order

```bash
# 1. Docker Desktop must be running first
cd fce-extension-scaffold
./scripts/start-services.sh --chain coston2      # redis, ext-proxy, extension-tee

# 2. Confirm the enclave is alive and holding the signing key
curl -s http://localhost:7702/state
#    → {"stateVersion":"0x…","state":{"signerAddress":"0xBbc90Fa5…","signerPubKey":"0x04…"}}

# 3. BFF (rebuild only if you changed Go)
cd go && go build -o ../bin/bff.exe ./cmd/bff && cd ..
EXT_PROXY_URL=http://localhost:6674 \
EXT_NODE_URL=http://localhost:7702 \
BFF_PORT=8081 ./bin/bff.exe

# 4. Web
cd web && npm run dev
```

Sanity check before opening the UI — this must return the signer **flat**, not
wrapped in a `state` envelope:

```bash
curl -s http://localhost:8081/api/state
# → {"signerAddress":"0xBbc90Fa542c9665262abdE3b0d15e116e8AefBcC","signerPubKey":"0x04…"}
```

If it 404s, the BFF is pointing at the proxy instead of the node — check
`EXT_NODE_URL`.

### 0.4 The pool

Already deployed and bound to the running enclave:

```
0x0d7BfC5E951Ff70fb441BC40155D1f0C5C5d47f7   5 C2FLR, deadline 11 Sep 2026
```

⚠️ **Do not use `0x70106D39248458Fa19991dD5e2C9bf3593248D52`.** Its
`authorizedSigner` is the deployer, not the enclave, so no voucher it issues will
ever verify. It exists only for read-only Explore testing.

---

## 1. Explore — no wallet needed (30 seconds)

1. Go to **`/pool?pool=0x0d7BfC5E951Ff70fb441BC40155D1f0C5C5d47f7`**.
2. Confirm: **OPEN** chip, `DEPOSITED 5 C2FLR`, `CLAIMED 0`, `REMAINING 5`,
   and **Not attested yet**.

Leave this tab open. You'll come back to it after each on-chain step to show the
public view changing — that contrast *is* the demo.

---

## 2. (Optional) Create your own pool

Skip if you're using the pool above.

1. **`/organizer`** → connect the wallet you want as organizer → **Connect**.
2. **Asset**: `Native (C2FLR)`.
3. **Total amount**: e.g. `5` — parsed as 18-decimal C2FLR here, so `5` = 5 C2FLR.
4. **Deadline**: turn the dial, or click `7D`. Check the `CLOSES` line reads a
   date in the future.
5. **Authorized signer (TEE, read-only)** must already show
   `0xBbc90Fa542c9665262abdE3b0d15e116e8AefBcC`. If it shows an error, the BFF
   or enclave isn't up — stop and fix §0.3. Creating a pool while this is broken
   produces a pool nobody can ever claim from.
6. **Create pool** → confirm in MetaMask.
7. The new address becomes the **Active pool** in the left rail and unlocks
   steps 02–04.

---

## 3. Submit the allocation — organizer wallet

1. **`/organizer`** → paste the pool address into **Work on an existing pool** →
   **Load**. Steps 02–04 unlock.
2. Scroll to **02 Submit allocation**.
3. **Amounts are in base units — and this is the opposite of the create form.**
   Watch out: §2 step 3 takes a *human* amount (`5` means 5 C2FLR, it scales for
   you), while this form takes raw integers and scales nothing. Native C2FLR has
   18 decimals, so 1 C2FLR is `1000000000000000000`. Type `5` here and you
   allocate 5 wei. The enclave allocates exactly the integer you give it.
4. Enter your **recipient account** address and an amount. Two rows is a better
   demo than one, because it shows that a claimant sees only their own row:

   | Recipient address | Amount (base units) |
   | --- | --- |
   | `0x…your recipient` | `2000000000000000000` (2 C2FLR) |
   | `0x…any other addr` | `1000000000000000000` (1 C2FLR) |

   The sum must be ≤ the deposit; the contract rejects over-allocation.
5. **Submit allocation.**

   No MetaMask prompt here — this is the confidential step. The amounts are
   ECIES-encrypted **in your browser** to the enclave's public key, so the BFF
   only ever forwards ciphertext.
6. Expect: **TEE confirmed 2 recipient(s) allocated.**
7. Refresh the Explore tab. Still `CLAIMED 0`, still **Not attested yet** —
   nothing about the split reached the chain. That's the point; say it out loud
   if you're recording.

---

## 4. Claim — recipient wallet

1. Switch MetaMask to the **recipient** account.
2. Go to **`/claim`** → **Connect wallet**.
3. **Pool address**: paste the pool.
4. Leave *"Claim to a fresh address"* unticked for the first run.
5. **Get my prize** → MetaMask asks you to **sign a message** (not a
   transaction, no gas). That signature is what proves the allocation is yours.
6. The voucher appears with **your amount only**. The other recipient's row is
   never sent to your browser.
7. **Claim on-chain** → confirm the transaction in MetaMask.
8. Refresh Explore: `CLAIMED` rises, `REMAINING` falls, and your address appears
   in the **Claims** table.

Claim amounts are public — money moved. What stays sealed is who was *allocated*
what, and who never claimed.

### 4b. The unlinkability variant (optional, the strongest part of the demo)

1. Tick **Claim to a fresh address** and paste a third, empty account.
2. **Get my prize** → sign with the *allocated* account (eligibility is still
   checked against it).
3. Switch MetaMask to the fresh account, then **Claim on-chain**.

The payout now lands on an address with no on-chain link to the recipient — as
long as that account was funded independently. If you fund it from the recipient
account, you've just recreated the link on-chain in front of your audience.

---

## 5. Publish the attestation — organizer wallet

1. Switch MetaMask back to the **organizer**.
2. **`/organizer`** → **03 Publish attestation** → **Publish compliance report**.
3. The enclave returns a signed report and the browser writes it on-chain;
   confirm in MetaMask.
4. Refresh Explore. The attestation panel now shows **Signature verified**, with
   the recipient count and total allocated.

Worth pointing at: that badge is not the server's word. The browser re-derives
the EIP-712 digest from the on-chain values, recovers the signer from the
signature in the transaction's calldata, and compares it against the pool's
`authorizedSigner`. Per-recipient amounts still appear nowhere.

---

## 6. Unclaimed + sweep — organizer wallet, after the deadline

Both revert before the deadline; the contract enforces it. With a 30-day
deadline you can't demo this live — create a pool in §2 with a deadline a few
minutes out if you want it on camera.

1. **04 Unclaimed funds** → **Reveal non-claimants**.
   The enclave joins its private table against on-chain claim status and
   encrypts the result to you. The list renders **in your browser only** —
   nothing about it is written on-chain.
2. **Sweep remaining funds** → confirm. The remainder returns to the organizer.

---

## Recovery

| Symptom | Cause | Fix |
| --- | --- | --- |
| `TEE signer unavailable` on /organizer | BFF down, or pointing at the proxy for `/state` | Check `curl localhost:8081/api/state`; set `EXT_NODE_URL=http://localhost:7702` |
| Container exits: `signer: invalid length, need 256 bits` | `VOUCHER_SIGNING_KEY` missing from `.env` | Add a 32-byte hex key (no `0x`), restart services |
| `not eligible` on claim | Wrong wallet, wrong pool, or the enclave restarted since §3 | Confirm the account matches a row from §3; if the enclave restarted, redo §3 |
| Claim reverts on-chain | Pool's `authorizedSigner` isn't the running enclave | `cast call <pool> 'authorizedSigner()(address)'` must equal `/api/state`'s `signerAddress` |
| Attestation says invalid signature | Pool bound to a different signer | Same check as above |
| Sweep/attest reverts | Wrong wallet, or before the deadline | Switch to the organizer account; check the deadline |

## What this does not demonstrate

The instruction path is the BFF, not on-chain delivery through
`InstructionSender`. TEE registration on Coston2 is blocked upstream: the FDC
availability proof is never produced, so the machine never promotes. The
transport sits behind the `TeeClient` seam, so the swap is one implementation —
but be straight about it if you're asked. Everything else here is real:
real ECIES, real EIP-712 vouchers, real on-chain verification.
