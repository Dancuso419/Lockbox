# Where Lockbox runs

| Piece | URL | What it is |
| --- | --- | --- |
| Web app | https://lockbox-eight-orcin.vercel.app | Vercel, built from `web/` on every push to `main` |
| BFF | https://lockbox-bff.onrender.com | Render, `deploy/Dockerfile.bff` — speaks the TEE action protocol, holds no keys |
| Enclave node | https://lockbox-node.onrender.com | Render, `deploy/Dockerfile.node` — signs vouchers, holds the allocation table |
| Contracts | Coston2 (chain 114) | factory `0x8F2eb4B78877DD6052609E5815FfCb583d19053F` |

Demo pool: `0x0d7BfC5E951Ff70fb441BC40155D1f0C5C5d47f7` — 5 C2FLR, bound to the
hosted enclave's signer `0xBbc90Fa542c9665262abdE3b0d15e116e8AefBcC`.

## Two things to do before showing it to anyone

**Wake both services.** The free tier sleeps after ~15 minutes idle, and the
first request then takes 15-60s. Hit these once, a couple of minutes ahead:

    curl https://lockbox-node.onrender.com/state
    curl https://lockbox-bff.onrender.com/api/state

Both must return `signerAddress`. If the BFF answers `tee state unavailable`,
the node is still waking — call the node directly and try again.

**Re-seed the allocations.** They live in the node's memory, so any sleep or
redeploy empties them. The pool and its money are on-chain and unaffected, but
claims fail with "not eligible" until the organizer re-runs step 02. Doing so is
safe: nonces are derived from the enclave secret, so a re-submission reproduces
the nonces already on-chain and an already-spent voucher stays spent.

## What is not hosted, and why

`tee-proxy` and `redis` carry on-chain instruction delivery through
`InstructionSender`. That path is blocked upstream — TEE registration on Coston2
never completes, the FDC availability proof is never produced — so the browser
reaches the handlers through the BFF instead. The transport sits behind the
`TeeClient` seam, so swapping it back is one implementation.

The hosted node is the simulated-TEE posture, exactly as in local development:
a container, not an enclave. Confidentiality here rests on the host rather than
on hardware attestation. Say so plainly when presenting it.

## Configuration that must not drift

`VOUCHER_SIGNING_KEY` on **lockbox-node** is what every pool is bound to as its
immutable `authorizedSigner`. Change it and every existing pool becomes
permanently unclaimable. It is set directly in the Render dashboard and is not
in git.

`ALLOWED_ORIGIN` on **lockbox-bff** is the Vercel origin. A new Vercel domain
means updating it, or the browser blocks every call.
