# Confidential Prize Pool Contracts (M2/M4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `PoolFactory.sol` + `Pool.sol` — an organizer funds a pool once, recipients claim their own allocation with a TEE-signed EIP-712 voucher, and the organizer sweeps unclaimed funds after a deadline — with a full red-first Foundry test suite.

**Architecture:** `PoolFactory.createPool(...)` deploys one `Pool` per distribution and funds it in the same call (native or ERC-20). `Pool` stores only aggregate counters (never individual allocations); `claim` verifies an EIP-712 voucher signed by an immutable `authorizedSigner`, guards replay with a used-nonce map, caps cumulative payouts at `totalDeposited`, and follows checks-effects-interactions under a reentrancy guard. `sweep` returns the remainder to the organizer after the deadline.

**Tech Stack:** Solidity ^0.8.27, Foundry (forge 1.7.1, `via-ir`), OpenZeppelin (`ECDSA`, `EIP712`, `SafeERC20`, `IERC20`, `ReentrancyGuard`), forge-std.

**Spec:** `docs/specs/2026-08-05-confidential-prize-pool-contracts-design.md`

**Branch:** `feat/prize-pool-contracts` (already checked out).

**Working directory for all commands:** `F:/PROJECTS/LOCKBOX/fce-extension-scaffold`

**PATH note:** `forge`/`cast` live at `/c/Users/DELL/.foundry/bin`. Prefix shell commands with `export PATH="$PATH:/c/Users/DELL/.foundry/bin"` (Git Bash).

---

## File Structure

- Create: `contracts/Pool.sol` — one distribution: state, `claim`, `sweep`, EIP-712 voucher verification.
- Create: `contracts/PoolFactory.sol` — deploys + funds one `Pool` per pool, enumerates pools.
- Create: `test/mocks/MockERC20.sol` — minimal mintable ERC-20 for tests.
- Create: `test/Pool.t.sol` — unit tests for `Pool` (native + ERC-20 claim/sweep, voucher, invariants).
- Create: `test/PoolFactory.t.sol` — unit tests for factory create+fund.
- Modify: `foundry.toml` — add `test`/`libs` config + OZ remapping.
- Create: `remappings.txt` — remap `@openzeppelin/` and `forge-std/`.
- Add (git submodule/vendored): `lib/forge-std`, `lib/openzeppelin-contracts`.

> Note on `via-ir`: `foundry.toml` already sets `via-ir = true`. Compilation is slower but tests run identically. Do not remove it.

---

## Task 1: Foundry deps + build sanity

**Files:**
- Modify: `foundry.toml`
- Create: `remappings.txt`
- Add: `lib/forge-std`, `lib/openzeppelin-contracts`

- [ ] **Step 1: Install forge-std and OpenZeppelin (no git commit from forge)**

The repo is an existing git repo; `forge install` wants a clean tree and creates submodules. Use `--no-commit`. Pin OZ to a v5 release (has `ECDSA`, `EIP712`, `SafeERC20`, `ReentrancyGuard`).

Run:
```bash
export PATH="$PATH:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge install foundry-rs/forge-std --no-commit
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-commit
```
Expected: two dirs appear under `lib/`. If `forge install` refuses due to a dirty tree, run `git stash -u` is NOT wanted (would hide our other edits) — instead pass `--no-commit` (already) and, if still blocked, `git add -A && git commit -m "wip"` is NOT wanted either; use `forge install ... --no-commit` from a state where `lib/` is empty. If it still refuses, clone manually:
```bash
git clone --depth 1 https://github.com/foundry-rs/forge-std lib/forge-std
git clone --depth 1 --branch v5.1.0 https://github.com/OpenZeppelin/openzeppelin-contracts lib/openzeppelin-contracts
```

- [ ] **Step 2: Create `remappings.txt`**

Create `remappings.txt`:
```
forge-std/=lib/forge-std/src/
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
```

- [ ] **Step 3: Point foundry.toml at tests and libs**

Modify `foundry.toml` to (keep existing `src`, `out`, `via-ir`):
```toml
[profile.default]
src = "contracts"
out = "out"
test = "test"
libs = ["lib"]
via-ir = true
```

- [ ] **Step 4: Add a trivial compile check**

Create `test/mocks/MockERC20.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

- [ ] **Step 5: Verify the toolchain compiles OZ**

Run:
```bash
export PATH="$PATH:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge build
```
Expected: `Compiler run successful` (the scaffold's `InstructionSender.sol` + `MockERC20` compile). If OZ path errors, re-check `remappings.txt`.

- [ ] **Step 6: Commit**

`lib/` is gitignored by the scaffold in many setups; check first. If `lib/` is ignored, only commit config + mock (submodules resolve via `forge install` on a fresh clone — but since we vendored/cloned, ensure `.gitmodules` or a note exists). For the hackathon, commit the toml/remappings/mock; document that contributors run the two `forge install` commands.
```bash
export PATH="$PATH:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add foundry.toml remappings.txt test/mocks/MockERC20.sol .gitmodules lib 2>/dev/null; git add foundry.toml remappings.txt test/mocks/MockERC20.sol
git commit -m "build: add forge-std + OpenZeppelin, foundry test config, MockERC20"
```

---

## Task 2: `Pool` skeleton + immutable state (create + fund)

**Files:**
- Create: `contracts/Pool.sol`
- Test: `test/Pool.t.sol`

- [ ] **Step 1: Write the failing test for construction + native funding**

Create `test/Pool.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test } from "forge-std/Test.sol";
import { Pool } from "../contracts/Pool.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";

contract PoolTest is Test {
    address organizer = address(0xA11CE);
    address signer;
    uint256 signerPk;
    uint64 deadline;

    function setUp() public {
        (signer, signerPk) = makeAddrAndKey("teeSigner");
        deadline = uint64(block.timestamp + 7 days);
    }

    function _deployNativePool(uint256 total) internal returns (Pool) {
        vm.deal(organizer, total);
        vm.prank(organizer);
        return new Pool{value: total}(organizer, address(0), total, deadline, signer);
    }

    function test_constructor_setsNativeState() public {
        Pool pool = _deployNativePool(10 ether);
        assertEq(pool.organizer(), organizer);
        assertEq(pool.asset(), address(0));
        assertEq(pool.totalDeposited(), 10 ether);
        assertEq(pool.totalClaimed(), 0);
        assertEq(pool.deadline(), deadline);
        assertEq(pool.authorizedSigner(), signer);
        assertEq(uint256(pool.status()), 0); // Open
        assertEq(address(pool).balance, 10 ether);
        assertEq(pool.remaining(), 10 ether);
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
export PATH="$PATH:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge test --match-contract PoolTest -vv
```
Expected: FAIL — `Pool.sol` does not exist / compile error.

- [ ] **Step 3: Write minimal `Pool.sol` (state + native constructor)**

Create `contracts/Pool.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Pool — one confidential distribution.
/// @notice Holds funds for one pool. Individual allocations live in the TEE and
/// are never stored here; only aggregate counters move on-chain.
contract Pool is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { Open, Closed }

    // keccak256("Voucher(address recipient,uint256 amount,uint256 nonce)")
    bytes32 public constant VOUCHER_TYPEHASH =
        keccak256("Voucher(address recipient,uint256 amount,uint256 nonce)");

    address public immutable organizer;
    address public immutable asset; // address(0) == native
    uint256 public immutable totalDeposited;
    uint64 public immutable deadline;
    address public immutable authorizedSigner;

    uint256 public totalClaimed;
    Status public status;
    mapping(uint256 => bool) public usedNonce;

    error ZeroSigner();
    error ZeroAmount();
    error BadDeadline();
    error WrongNativeValue();

    constructor(
        address _organizer,
        address _asset,
        uint256 _totalAmount,
        uint64 _deadline,
        address _authorizedSigner
    ) payable EIP712("ConfidentialPrizePool", "1") {
        if (_authorizedSigner == address(0)) revert ZeroSigner();
        if (_totalAmount == 0) revert ZeroAmount();
        if (_deadline <= block.timestamp) revert BadDeadline();

        organizer = _organizer;
        asset = _asset;
        totalDeposited = _totalAmount;
        deadline = _deadline;
        authorizedSigner = _authorizedSigner;
        status = Status.Open;

        if (_asset == address(0)) {
            if (msg.value != _totalAmount) revert WrongNativeValue();
        } else {
            if (msg.value != 0) revert WrongNativeValue();
            // ERC-20 funds are pulled by the factory/creator into this contract
            // via transferFrom before/after deploy; see PoolFactory. For a direct
            // ERC-20 deploy, the deployer must transfer _totalAmount to this
            // address; verified lazily on first claim/sweep via balance checks is
            // avoided — instead the factory guarantees funding (Task 6).
        }
    }

    function remaining() external view returns (uint256) {
        return totalDeposited - totalClaimed;
    }
}
```

> Note: for ERC-20, funding is guaranteed by `PoolFactory` (Task 6), which `transferFrom`s into the pool in the same transaction as deploy. A standalone ERC-20 `Pool` deploy is not a supported entry point.

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
export PATH="$PATH:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge test --match-test test_constructor_setsNativeState -vv
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add contracts/Pool.sol test/Pool.t.sol
git commit -m "feat(pool): Pool skeleton with immutable state + native funding"
```

---

## Task 3: `claim` — valid EIP-712 voucher pays exactly once

**Files:**
- Modify: `contracts/Pool.sol`
- Test: `test/Pool.t.sol`

- [ ] **Step 1: Add a voucher-signing helper + happy-path test**

Append to `test/Pool.t.sol` (inside `PoolTest`):
```solidity
    // EIP-712 digest matching Pool's domain; sign with signerPk.
    function _sign(Pool pool, address recipient, uint256 amount, uint256 nonce)
        internal view returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(pool.VOUCHER_TYPEHASH(), recipient, amount, nonce)
        );
        bytes32 digest = _digest(pool, structHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, digest);
        return abi.encodePacked(r, s, v);
    }

    // Rebuild EIP-712 domain separator the way OZ EIP712 does.
    function _digest(Pool pool, bytes32 structHash) internal view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("ConfidentialPrizePool")),
                keccak256(bytes("1")),
                block.chainid,
                address(pool)
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function test_claim_native_paysRecipientOnce() public {
        Pool pool = _deployNativePool(10 ether);
        address recipient = address(0xBEEF);
        bytes memory sig = _sign(pool, recipient, 3 ether, 1);

        vm.prank(recipient);
        pool.claim(3 ether, 1, sig);

        assertEq(recipient.balance, 3 ether);
        assertEq(pool.totalClaimed(), 3 ether);
        assertEq(pool.remaining(), 7 ether);
        assertTrue(pool.usedNonce(1));
    }
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
export PATH="$PATH:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge test --match-test test_claim_native_paysRecipientOnce -vv
```
Expected: FAIL — `claim` not defined.

- [ ] **Step 3: Implement `claim`**

Add to `contracts/Pool.sol` (new errors near the others, `claim` after `remaining`):
```solidity
    error NotOpen();
    error PastDeadline();
    error NonceUsed();
    error BadSignature();
    error ExceedsDeposited();
    error NativeTransferFailed();

    event Claimed(address indexed recipient, uint256 amount, uint256 nonce);

    function claim(uint256 amount, uint256 nonce, bytes calldata signature)
        external
        nonReentrant
    {
        if (status != Status.Open) revert NotOpen();
        if (block.timestamp > deadline) revert PastDeadline();
        if (usedNonce[nonce]) revert NonceUsed();

        bytes32 structHash =
            keccak256(abi.encode(VOUCHER_TYPEHASH, msg.sender, amount, nonce));
        bytes32 digest = _hashTypedDataV4(structHash);
        if (ECDSA.recover(digest, signature) != authorizedSigner) revert BadSignature();

        if (totalClaimed + amount > totalDeposited) revert ExceedsDeposited();

        // effects
        usedNonce[nonce] = true;
        totalClaimed += amount;

        // interaction
        _payout(msg.sender, amount);
        emit Claimed(msg.sender, amount, nonce);
    }

    function _payout(address to, uint256 amount) private {
        if (asset == address(0)) {
            (bool ok, ) = payable(to).call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
    }
```

- [ ] **Step 4: Run to verify it passes**

Run:
```bash
export PATH="$PATH:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge test --match-test test_claim_native_paysRecipientOnce -vv
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add contracts/Pool.sol test/Pool.t.sol
git commit -m "feat(pool): EIP-712 voucher claim with native payout"
```

---

## Task 4: `claim` guards — replay, wrong signer, voucher theft, over-allocation, deadline

**Files:**
- Modify: `test/Pool.t.sol`
- (No contract change expected — these assert existing reverts. If any fails, fix `Pool.sol`.)

- [ ] **Step 1: Write the guard tests**

Append to `test/Pool.t.sol`:
```solidity
    function test_claim_replayReverts() public {
        Pool pool = _deployNativePool(10 ether);
        address recipient = address(0xBEEF);
        bytes memory sig = _sign(pool, recipient, 3 ether, 1);
        vm.prank(recipient);
        pool.claim(3 ether, 1, sig);

        vm.prank(recipient);
        vm.expectRevert(Pool.NonceUsed.selector);
        pool.claim(3 ether, 1, sig);
    }

    function test_claim_wrongSignerReverts() public {
        Pool pool = _deployNativePool(10 ether);
        address recipient = address(0xBEEF);
        (, uint256 attackerPk) = makeAddrAndKey("attacker");
        bytes32 structHash =
            keccak256(abi.encode(pool.VOUCHER_TYPEHASH(), recipient, uint256(3 ether), uint256(1)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attackerPk, _digest(pool, structHash));
        bytes memory badSig = abi.encodePacked(r, s, v);

        vm.prank(recipient);
        vm.expectRevert(Pool.BadSignature.selector);
        pool.claim(3 ether, 1, badSig);
    }

    function test_claim_stolenVoucherByOtherAddressReverts() public {
        Pool pool = _deployNativePool(10 ether);
        address recipient = address(0xBEEF);
        bytes memory sig = _sign(pool, recipient, 3 ether, 1); // bound to 0xBEEF

        address thief = address(0xBAD);
        vm.prank(thief);
        vm.expectRevert(Pool.BadSignature.selector); // digest uses msg.sender=thief
        pool.claim(3 ether, 1, sig);
    }

    function test_claim_overAllocationReverts() public {
        Pool pool = _deployNativePool(10 ether);
        address r1 = makeAddr("r1");
        address r2 = makeAddr("r2");
        // Sign BEFORE pranking: _sign() calls pool.VOUCHER_TYPEHASH(), which would
        // otherwise consume the prank and leave claim() with the wrong msg.sender.
        // Also: never use precompile addresses (0x1, 0x2) as EOAs in tests.
        bytes memory sig1 = _sign(pool, r1, 7 ether, 1);
        bytes memory sig2 = _sign(pool, r2, 4 ether, 2);

        vm.prank(r1);
        pool.claim(7 ether, 1, sig1);

        // second claim of 4 would exceed 10 total
        vm.prank(r2);
        vm.expectRevert(Pool.ExceedsDeposited.selector);
        pool.claim(4 ether, 2, sig2);
    }

    function test_claim_afterDeadlineReverts() public {
        Pool pool = _deployNativePool(10 ether);
        address recipient = address(0xBEEF);
        bytes memory sig = _sign(pool, recipient, 3 ether, 1);
        vm.warp(deadline + 1);
        vm.prank(recipient);
        vm.expectRevert(Pool.PastDeadline.selector);
        pool.claim(3 ether, 1, sig);
    }

    function test_claim_crossPoolVoucherReverts() public {
        Pool poolA = _deployNativePool(10 ether);
        Pool poolB = _deployNativePool(10 ether);
        address recipient = address(0xBEEF);
        bytes memory sigForA = _sign(poolA, recipient, 3 ether, 1);

        vm.prank(recipient);
        vm.expectRevert(Pool.BadSignature.selector); // poolB domain differs
        poolB.claim(3 ether, 1, sigForA);
    }
```

- [ ] **Step 2: Run to verify all pass (guards already implemented)**

Run:
```bash
export PATH="$PATH:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge test --match-contract PoolTest -vv
```
Expected: all PASS. If `test_claim_overAllocationReverts` fails, verify the cap check ordering in `Pool.claim`.

- [ ] **Step 3: Commit**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add test/Pool.t.sol
git commit -m "test(pool): claim guard coverage (replay, signer, theft, over-alloc, deadline, cross-pool)"
```

---

## Task 5: `sweep` — organizer-only, after deadline, returns remainder

**Files:**
- Modify: `contracts/Pool.sol`
- Test: `test/Pool.t.sol`

- [ ] **Step 1: Write sweep tests**

Append to `test/Pool.t.sol`:
```solidity
    function test_sweep_returnsRemainderToOrganizer() public {
        Pool pool = _deployNativePool(10 ether);
        address recipient = address(0xBEEF);
        vm.prank(recipient);
        pool.claim(3 ether, 1, _sign(pool, recipient, 3 ether, 1));

        uint256 orgBefore = organizer.balance;
        vm.warp(deadline + 1);
        vm.prank(organizer);
        pool.sweep();

        assertEq(organizer.balance, orgBefore + 7 ether);
        assertEq(uint256(pool.status()), 1); // Closed
        assertEq(address(pool).balance, 0);
    }

    function test_sweep_beforeDeadlineReverts() public {
        Pool pool = _deployNativePool(10 ether);
        vm.prank(organizer);
        vm.expectRevert(Pool.BeforeDeadline.selector);
        pool.sweep();
    }

    function test_sweep_nonOrganizerReverts() public {
        Pool pool = _deployNativePool(10 ether);
        vm.warp(deadline + 1);
        vm.prank(address(0xBAD));
        vm.expectRevert(Pool.NotOrganizer.selector);
        pool.sweep();
    }

    function test_sweep_secondSweepReverts() public {
        Pool pool = _deployNativePool(10 ether);
        vm.warp(deadline + 1);
        vm.prank(organizer);
        pool.sweep();
        vm.prank(organizer);
        vm.expectRevert(Pool.NotOpen.selector);
        pool.sweep();
    }

    function test_claim_afterSweepReverts() public {
        Pool pool = _deployNativePool(10 ether);
        vm.warp(deadline + 1);
        vm.prank(organizer);
        pool.sweep();
        // even though claim also checks deadline, assert Closed path
        address recipient = address(0xBEEF);
        vm.prank(recipient);
        vm.expectRevert(); // PastDeadline or NotOpen — both acceptable here
        pool.claim(1 ether, 1, _sign(pool, recipient, 1 ether, 1));
    }
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
export PATH="$PATH:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge test --match-test test_sweep_returnsRemainderToOrganizer -vv
```
Expected: FAIL — `sweep` / `BeforeDeadline` / `NotOrganizer` not defined.

- [ ] **Step 3: Implement `sweep`**

Add to `contracts/Pool.sol` (errors + function):
```solidity
    error NotOrganizer();
    error BeforeDeadline();

    event Swept(address indexed organizer, uint256 amount);

    function sweep() external nonReentrant {
        if (status != Status.Open) revert NotOpen();
        if (msg.sender != organizer) revert NotOrganizer();
        if (block.timestamp <= deadline) revert BeforeDeadline();

        uint256 amount = totalDeposited - totalClaimed;
        status = Status.Closed;
        _payout(organizer, amount);
        emit Swept(organizer, amount);
    }
```

- [ ] **Step 4: Run to verify all sweep tests pass**

Run:
```bash
export PATH="$PATH:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge test --match-contract PoolTest -vv
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add contracts/Pool.sol test/Pool.t.sol
git commit -m "feat(pool): organizer deadline sweep of remaining funds"
```

---

## Task 6: `PoolFactory` — deploy + fund one pool per call

**Files:**
- Create: `contracts/PoolFactory.sol`
- Test: `test/PoolFactory.t.sol`

- [ ] **Step 1: Write factory tests (native + ERC-20)**

Create `test/PoolFactory.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test } from "forge-std/Test.sol";
import { PoolFactory } from "../contracts/PoolFactory.sol";
import { Pool } from "../contracts/Pool.sol";
import { MockERC20 } from "./mocks/MockERC20.sol";

contract PoolFactoryTest is Test {
    PoolFactory factory;
    address organizer = address(0xA11CE);
    address signer;
    uint256 signerPk;
    uint64 deadline;

    function setUp() public {
        factory = new PoolFactory();
        (signer, signerPk) = makeAddrAndKey("teeSigner");
        deadline = uint64(block.timestamp + 7 days);
    }

    function test_createPool_native_fundsAndRecords() public {
        vm.deal(organizer, 5 ether);
        vm.prank(organizer);
        Pool pool = factory.createPool{value: 5 ether}(address(0), 5 ether, deadline, signer);

        assertEq(address(pool).balance, 5 ether);
        assertEq(pool.organizer(), organizer);
        assertEq(pool.totalDeposited(), 5 ether);
        assertEq(factory.allPoolsLength(), 1);
        assertEq(address(factory.allPools(0)), address(pool));
    }

    function test_createPool_native_wrongValueReverts() public {
        vm.deal(organizer, 5 ether);
        vm.prank(organizer);
        vm.expectRevert(PoolFactory.WrongNativeValue.selector);
        factory.createPool{value: 4 ether}(address(0), 5 ether, deadline, signer);
    }

    function test_createPool_erc20_pullsFunds() public {
        MockERC20 token = new MockERC20();
        token.mint(organizer, 100 ether);
        vm.startPrank(organizer);
        token.approve(address(factory), 100 ether);
        Pool pool = factory.createPool(address(token), 100 ether, deadline, signer);
        vm.stopPrank();

        assertEq(token.balanceOf(address(pool)), 100 ether);
        assertEq(pool.asset(), address(token));
        assertEq(pool.totalDeposited(), 100 ether);
    }

    function test_createPool_erc20_withValueReverts() public {
        MockERC20 token = new MockERC20();
        token.mint(organizer, 100 ether);
        vm.deal(organizer, 1 ether);
        vm.startPrank(organizer);
        token.approve(address(factory), 100 ether);
        vm.expectRevert(PoolFactory.NativeValueWithERC20.selector);
        factory.createPool{value: 1 ether}(address(token), 100 ether, deadline, signer);
        vm.stopPrank();
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run:
```bash
export PATH="$PATH:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge test --match-contract PoolFactoryTest -vv
```
Expected: FAIL — `PoolFactory.sol` not defined.

- [ ] **Step 3: Implement `PoolFactory.sol`**

Create `contracts/PoolFactory.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Pool } from "./Pool.sol";

/// @title PoolFactory — deploys and funds one Pool per distribution.
contract PoolFactory {
    using SafeERC20 for IERC20;

    Pool[] public allPools;

    error WrongNativeValue();
    error NativeValueWithERC20();

    event PoolCreated(
        address indexed pool,
        address indexed organizer,
        address asset,
        uint256 total,
        uint64 deadline
    );

    /// @notice Create + fund a pool in one call.
    /// @param asset address(0) for native C2FLR, else an ERC-20 (e.g. FXRP).
    /// @param totalAmount amount to lock; native must equal msg.value, ERC-20 pulled via transferFrom.
    /// @param deadline unix seconds after which unclaimed funds can be swept.
    /// @param authorizedSigner immutable TEE voucher signer for this pool.
    function createPool(
        address asset,
        uint256 totalAmount,
        uint64 deadline,
        address authorizedSigner
    ) external payable returns (Pool pool) {
        if (asset == address(0)) {
            if (msg.value != totalAmount) revert WrongNativeValue();
            pool = new Pool{value: totalAmount}(
                msg.sender, asset, totalAmount, deadline, authorizedSigner
            );
        } else {
            if (msg.value != 0) revert NativeValueWithERC20();
            pool = new Pool(msg.sender, asset, totalAmount, deadline, authorizedSigner);
            IERC20(asset).safeTransferFrom(msg.sender, address(pool), totalAmount);
        }

        allPools.push(pool);
        emit PoolCreated(address(pool), msg.sender, asset, totalAmount, deadline);
    }

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }
}
```

- [ ] **Step 4: Run to verify all factory tests pass**

Run:
```bash
export PATH="$PATH:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge test --match-contract PoolFactoryTest -vv
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add contracts/PoolFactory.sol test/PoolFactory.t.sol
git commit -m "feat(factory): PoolFactory deploys and funds one Pool per call (native + ERC-20)"
```

---

## Task 7: ERC-20 end-to-end claim + sweep through a factory-created pool

**Files:**
- Modify: `test/PoolFactory.t.sol`

- [ ] **Step 1: Write ERC-20 claim + sweep test**

Append to `test/PoolFactoryTest`:
```solidity
    function _digest(Pool pool, bytes32 structHash) internal view returns (bytes32) {
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("ConfidentialPrizePool")),
                keccak256(bytes("1")),
                block.chainid,
                address(pool)
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _sign(Pool pool, address recipient, uint256 amount, uint256 nonce)
        internal view returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(pool.VOUCHER_TYPEHASH(), recipient, amount, nonce));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, _digest(pool, structHash));
        return abi.encodePacked(r, s, v);
    }

    function test_erc20_claimThenSweep() public {
        MockERC20 token = new MockERC20();
        token.mint(organizer, 100 ether);
        vm.startPrank(organizer);
        token.approve(address(factory), 100 ether);
        Pool pool = factory.createPool(address(token), 100 ether, deadline, signer);
        vm.stopPrank();

        address recipient = address(0xBEEF);
        vm.prank(recipient);
        pool.claim(40 ether, 1, _sign(pool, recipient, 40 ether, 1));
        assertEq(token.balanceOf(recipient), 40 ether);

        vm.warp(deadline + 1);
        vm.prank(organizer);
        pool.sweep();
        assertEq(token.balanceOf(organizer), 60 ether); // remainder back
        assertEq(token.balanceOf(address(pool)), 0);
    }
```

- [ ] **Step 2: Run to verify it passes**

Run:
```bash
export PATH="$PATH:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge test --match-test test_erc20_claimThenSweep -vv
```
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
git add test/PoolFactory.t.sol
git commit -m "test(factory): ERC-20 end-to-end claim then sweep"
```

---

## Task 8: Full suite + gas snapshot + final commit

**Files:** none (verification)

- [ ] **Step 1: Run the entire suite**

Run:
```bash
export PATH="$PATH:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge test -vv
```
Expected: all `PoolTest` + `PoolFactoryTest` tests PASS. The scaffold's existing tests (if any under `test/`) unaffected.

- [ ] **Step 2: Confirm the scaffold still builds (no regressions to InstructionSender)**

Run:
```bash
export PATH="$PATH:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge build
```
Expected: `Compiler run successful`.

- [ ] **Step 3: Write a gas snapshot (optional, useful for the submission)**

Run:
```bash
export PATH="$PATH:/c/Users/DELL/.foundry/bin"
cd "F:/PROJECTS/LOCKBOX/fce-extension-scaffold"
forge snapshot
git add .gas-snapshot
git commit -m "chore: gas snapshot for pool contracts"
```

---

## Definition of Done

- `forge test` green: construction, native + ERC-20 claim, replay/signer/theft/over-alloc/deadline/cross-pool guards, organizer-only deadline sweep returning exact remainder, factory create+fund for native + ERC-20.
- No individual allocation/recipient/amount stored in contract storage (only `totalDeposited`, `totalClaimed`, `usedNonce`).
- `authorizedSigner` immutable; over-allocation capped at `totalDeposited`; CEI + `nonReentrant` on `claim`/`sweep`.
- Branch `feat/prize-pool-contracts` holds the commits.

## Out of scope (do not implement here)

- Anonymous/unlinkable claims (M5).
- TEE Go handlers `SUBMIT_ALLOCATION` / `CLAIM_VERIFY` that produce vouchers (M3/M4 Go side).
- Compliance attestation (M6), unclaimed report (M7), on-chain deployment scripts.
