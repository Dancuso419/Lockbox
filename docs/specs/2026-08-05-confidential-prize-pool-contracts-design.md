# Confidential Prize Pool — M2/M4 Contract Layer Design

**Date:** 2026-08-05
**Scope:** BUILD.md milestones M2 (pool contracts) and M4 (claim authorization interface).
**Status:** Approved for planning.
**Network:** Coston2 (chain id 114). Solidity, Foundry.

## 1. Purpose & scope

The on-chain layer for the Confidential Prize Pool: an organizer funds a pool
once, recipients each claim their own allocation with a TEE-issued voucher, and
unclaimed funds return to the organizer after a deadline. Individual allocations
are held off-chain in the TEE and are **never** written to these contracts — only
aggregate counters move.

**In scope:** `PoolFactory.sol`, `Pool.sol`, unit tests, a mock ERC-20 for tests.

**Explicitly out of scope (later milestones):**
- The TEE handlers (`SUBMIT_ALLOCATION`, `CLAIM_VERIFY`) that *produce* vouchers — M3/M4 Go side.
- Anonymous/unlinkable claims (hiding that `address A received amount X` at claim time) — **M5**. This design accepts that the claim amount and recipient are visible in the claim transaction. It only guarantees that the *full distribution* (who was allocated what, non-claimants) is never on-chain.
- Compliance attestation (M6), unclaimed report (M7), multi-pool FAsset specifics beyond generic ERC-20 (M8).

## 2. Key decisions (all approved)

1. **Claim authorization = TEE-signed voucher (EIP-712).** No individual allocation is stored on-chain; the TEE signs a per-recipient voucher, the recipient submits it, the contract verifies the signer. Amount visibility at claim time is accepted for M2/M4; unlinkability is an M5 concern.
2. **Factory deploys one `Pool` contract per pool.** Each pool has its own address and isolated balance (clean explorer story, strong isolation).
3. **Generic asset from the start.** `Pool` stores a fixed `asset` address: `address(0)` = native C2FLR, otherwise an ERC-20 (covers FXRP/FAssets in M8). Asset is fixed at creation (FR7).
4. **`authorizedSigner` is immutable** (set at creation). The organizer cannot change it, so the organizer cannot forge vouchers to drain the pool — the trustless model the product promises. Requires registering the TEE signer only after the final node start (see §7 risk).
5. **Contract caps payouts at `totalDeposited`** (defense in depth): every claim requires `totalClaimed + amount <= totalDeposited`, so the pool can never pay out more than was deposited even if the TEE mis-signs.

## 3. Components & interfaces

### PoolFactory.sol
```
createPool(address asset, uint256 totalAmount, uint64 deadline, address authorizedSigner)
    external payable returns (Pool pool)
```
- Deploys a fresh `Pool(organizer = msg.sender, asset, totalAmount, deadline, authorizedSigner)`.
- Funds the pool in the same call:
  - native: `require(msg.value == totalAmount)`, forward value to the new pool.
  - ERC-20: `IERC20(asset).transferFrom(msg.sender, address(pool), totalAmount)` (requires prior `approve`; `msg.value == 0`).
- Validates: `totalAmount > 0`, `deadline > block.timestamp`, `authorizedSigner != address(0)`.
- Records pools for enumeration: `Pool[] public allPools;` + `PoolCreated(address indexed pool, address indexed organizer, address asset, uint256 total, uint64 deadline)`.

### Pool.sol
Public state (all readable — this is the "public observer" view):
`organizer`, `asset`, `totalDeposited`, `totalClaimed`, `deadline`, `authorizedSigner`, `status` (`Open` | `Closed`).

```
claim(uint256 amount, uint256 nonce, bytes calldata signature) external
sweep() external            // organizer-only, after deadline
```
Getters are the public state above plus `remaining() = totalDeposited - totalClaimed`.

Individual allocations, recipient lists, and per-recipient amounts are **absent** from storage by construction.

## 4. Claim voucher scheme (M4 interface)

Digest (EIP-712 typed data), domain-separated by `chainId` and the pool address:
```
domain  = { name: "ConfidentialPrizePool", version: "1", chainId, verifyingContract: address(this) }
Voucher = { address recipient, uint256 amount, uint256 nonce }
digest  = _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH, recipient, amount, nonce)))
```
`claim(amount, nonce, signature)`: the contract reconstructs the digest using
`recipient = msg.sender` (recipient is **not** a separate parameter — it is bound
to the caller), then:
1. `require(status == Open && block.timestamp <= deadline)`.
2. `require(!usedNonce[nonce])`.
3. `signer = ECDSA.recover(digest, signature); require(signer == authorizedSigner)`.
4. `require(totalClaimed + amount <= totalDeposited)` (over-allocation cap).
5. Effects: `usedNonce[nonce] = true; totalClaimed += amount`.
6. Interaction: pay `msg.sender` (`amount`), native via `call`, ERC-20 via `safeTransfer`.

Binding the digest to `verifyingContract = address(this)` prevents cross-pool voucher reuse; binding to `recipient == msg.sender` prevents another address from redeeming a stolen voucher. `nonce` prevents replay within a pool.

**Note (M5 seam):** the voucher commits to `recipient = msg.sender`. Anonymity work in M5 layers on top (e.g. claim to a fresh/stealth address, or a relayer) without changing this interface's shape.

## 5. Lifecycle

```
createPool ──> Open ──(claims allowed while block.timestamp <= deadline)──> Open
                 │
                 └── organizer sweep() after deadline ──> Closed (remaining -> organizer)
```
- Claims revert once `status != Open` or past `deadline`.
- `sweep()`: organizer-only, `require(block.timestamp > deadline)`, transfers `remaining()` to organizer, sets `Closed`. Idempotency: reverts if already `Closed`.
- No vesting / scheduled release (out of scope).

## 6. Security

- **Reentrancy:** checks-effects-interactions on `claim` and `sweep`, plus a minimal `nonReentrant` guard. Native payout uses `call` with success check; ERC-20 uses OpenZeppelin `SafeERC20`.
- **Over-payment:** capped at `totalDeposited` (§2.5).
- **Voucher forgery:** immutable `authorizedSigner`; organizer has no signer control.
- **Replay / cross-pool / theft:** nonce + `verifyingContract` + `recipient==msg.sender` binding (§4).
- **Griefing on sweep:** only organizer, only after deadline.
- Use OpenZeppelin `ECDSA`, `EIP712`, `SafeERC20`, `ReentrancyGuard` (audited, already-solved primitives — do not hand-roll).

## 7. Risks / operational notes

- **Ephemeral TEE key (known gotcha):** the simulated TEE regenerates its signing key on every container restart. Because `authorizedSigner` is immutable, a pool must be created only *after* the final TEE start, and the node must not be restarted for that pool's lifetime, or its vouchers become unverifiable. Documented for the M3/M4 integration and the demo runbook.
- The TEE's voucher-signing key vs. the ephemeral node key: M4 (Go side) must define which key signs vouchers and expose its address so the organizer sets it as `authorizedSigner` at pool creation. Design assumption: a single ECDSA signer address the contract can `ecrecover`.

## 8. Testing (TDD, Foundry)

Add `forge-std` + a `MockERC20`. Red-first tests:
- create + fund: native (`msg.value` exact) and ERC-20 (`transferFrom`); wrong `msg.value` reverts.
- valid claim pays exactly `amount` once; balances move; `totalClaimed` updates.
- replayed nonce reverts; wrong-signer voucher reverts; other address using A's voucher reverts; voucher from another pool reverts.
- claim after deadline reverts; claim when `Closed` reverts.
- over-allocation: cumulative claims cannot exceed `totalDeposited` (last claim that would exceed reverts).
- `sweep`: only organizer, only after deadline, returns exact `remaining()`, sets `Closed`, second `sweep` reverts.
- native and ERC-20 variants for claim + sweep.

## 9. File layout
```
contracts/
  PoolFactory.sol
  Pool.sol
test/
  Pool.t.sol
  PoolFactory.t.sol
  mocks/MockERC20.sol
lib/
  forge-std/            (added)
  openzeppelin-contracts/ (added)
```
