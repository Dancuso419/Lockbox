# Multi-Asset (FXRP) — M8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the already-generic pool contracts work correctly for a 6-decimal FAsset (FXRP) and add Foundry deploy tooling for the demo — no runtime contract or Go change.

**Architecture:** Make `MockERC20` decimals-configurable, add a 6-decimal create→claim→sweep test that reuses the existing `PoolFactory.t.sol` helpers, and add two deploy scripts (`DeployPoolFactory`, `CreatePool`) plus a Coston2 RPC endpoint in `foundry.toml`. Correctness rests on the fact that `Pool`/`PoolFactory`/TEE all work in raw integer token units with no `1e18` assumption.

**Tech Stack:** Solidity (Foundry, forge-std, OZ ERC20/IERC20), forge scripts. Foundry tools at `/c/Users/DELL/.foundry/bin` (PATH-prefix in bash). Commands run from repo root `F:\PROJECTS\LOCKBOX\fce-extension-scaffold`.

**Design ref:** `docs/specs/2026-08-09-multi-asset-fxrp-design.md`

---

### Task 1: 6-decimal FXRP support + end-to-end test

Make `MockERC20` decimals-configurable and prove the full create→claim→sweep path is correct at 6 decimals. TDD: the new test references the new `MockERC20(6)` API, so it fails to compile until the mock is updated.

**Files:**
- Modify: `test/mocks/MockERC20.sol`
- Modify: `test/PoolFactory.t.sol` (existing `new MockERC20()` call sites → `new MockERC20(18)`; add the FXRP test)

- [ ] **Step 1: Write the failing test**

Append to `test/PoolFactory.t.sol` inside the `PoolFactoryTest` contract (it already has `setUp`, `factory`, `organizer`, `signer`/`signerPk`, `deadline`, `_digest`, `_sign`):

```solidity
    function test_fxrp_sixDecimals_claimThenSweep() public {
        MockERC20 fxrp = new MockERC20(6);            // FXRP: 6 decimals
        assertEq(fxrp.decimals(), 6);
        uint256 total = 1000e6;                         // 1000 FXRP
        fxrp.mint(organizer, total);
        vm.startPrank(organizer);
        fxrp.approve(address(factory), total);
        Pool pool = factory.createPool(address(fxrp), total, deadline, signer);
        vm.stopPrank();
        assertEq(fxrp.balanceOf(address(pool)), total);
        assertEq(pool.totalDeposited(), total);

        address recipient = address(0xBEEF);
        uint256 amount = 250e6;                         // 250 FXRP
        bytes memory sig = _sign(pool, recipient, amount, 1); // sign BEFORE prank
        vm.prank(recipient);
        pool.claim(amount, 1, sig);
        assertEq(fxrp.balanceOf(recipient), amount);
        assertEq(pool.totalClaimed(), amount);

        vm.warp(deadline + 1);
        vm.prank(organizer);
        pool.sweep();
        assertEq(fxrp.balanceOf(organizer), total - amount); // 750 FXRP remainder
        assertEq(fxrp.balanceOf(address(pool)), 0);
    }
```

- [ ] **Step 2: Run it, verify it FAILS (compile error)**

Run: `/c/Users/DELL/.foundry/bin/forge build`
Expected: FAIL — `MockERC20` constructor takes no arguments, so `new MockERC20(6)` (and `new MockERC20(18)` once added) does not compile. This is the red state.

- [ ] **Step 3: Make `MockERC20` decimals-configurable**

Replace the entire body of `test/mocks/MockERC20.sol` with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable _dec;

    constructor(uint8 dec) ERC20("Mock", "MOCK") {
        _dec = dec;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
```

- [ ] **Step 4: Update the existing call sites to preserve 18-decimal behavior**

In `test/PoolFactory.t.sol`, the three existing `new MockERC20()` calls (in `test_createPool_erc20_pullsFunds`, `test_createPool_erc20_withValueReverts`, `test_erc20_claimThenSweep` — currently around lines 42, 55, 90) must become `new MockERC20(18)`. Do a find-and-replace of `new MockERC20()` → `new MockERC20(18)` in this file. (No other file instantiates `MockERC20`.)

- [ ] **Step 5: Run tests, verify PASS**

Run: `/c/Users/DELL/.foundry/bin/forge test`
Expected: PASS — 28 tests total (the prior 27 plus `test_fxrp_sixDecimals_claimThenSweep`). The FFI interop tests (`VoucherInterop`, `ComplianceInterop`) need the Go binaries; if they fail with a missing-binary error, build them first:
```bash
cd go && go build -o ../bin/sign-voucher.exe ./cmd/sign-voucher && go build -o ../bin/sign-compliance.exe ./cmd/sign-compliance && cd ..
```
then re-run `forge test`.

- [ ] **Step 6: Commit**

```bash
git add test/mocks/MockERC20.sol test/PoolFactory.t.sol
git commit -m "feat(m8): configurable MockERC20 decimals + 6-decimal FXRP e2e test

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

Do NOT `git add -A` — unrelated modified files exist in the tree; add only the two named files.

---

### Task 2: Foundry deploy scripts + Coston2 RPC endpoint

Add deploy tooling the M10 demo will use to deploy `PoolFactory` and create an asset-parametrized (FXRP) pool. Scripts are verified by `forge build` (not unit-tested).

**Files:**
- Create: `script/DeployPoolFactory.s.sol`
- Create: `script/CreatePool.s.sol`
- Modify: `foundry.toml` (add `[rpc_endpoints]` with `coston2`)

- [ ] **Step 1: Create `script/DeployPoolFactory.s.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Script, console2 } from "forge-std/Script.sol";
import { PoolFactory } from "../contracts/PoolFactory.sol";

/// @notice Deploys PoolFactory. Requires env DEPLOYER_PRIVATE_KEY.
contract DeployPoolFactory is Script {
    function run() external returns (PoolFactory factory) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(pk);
        factory = new PoolFactory();
        vm.stopBroadcast();
        console2.log("PoolFactory deployed at", address(factory));
    }
}
```

- [ ] **Step 2: Create `script/CreatePool.s.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Script, console2 } from "forge-std/Script.sol";
import { PoolFactory } from "../contracts/PoolFactory.sol";
import { Pool } from "../contracts/Pool.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Creates one pool via an existing PoolFactory. Reads config from env:
///   DEPLOYER_PRIVATE_KEY, POOL_FACTORY, ASSET (address(0)=native), TOTAL,
///   DEADLINE (unix seconds), AUTHORIZED_SIGNER.
/// For an FXRP pool, resolve ASSET from FlareContractRegistry first (see design doc §2).
contract CreatePool is Script {
    function run() external returns (Pool pool) {
        uint256 pk          = vm.envUint("DEPLOYER_PRIVATE_KEY");
        PoolFactory factory = PoolFactory(vm.envAddress("POOL_FACTORY"));
        address asset       = vm.envAddress("ASSET");
        uint256 total       = vm.envUint("TOTAL");
        uint64  deadline    = uint64(vm.envUint("DEADLINE"));
        address signer      = vm.envAddress("AUTHORIZED_SIGNER");

        vm.startBroadcast(pk);
        if (asset == address(0)) {
            pool = factory.createPool{value: total}(asset, total, deadline, signer);
        } else {
            IERC20(asset).approve(address(factory), total);
            pool = factory.createPool(asset, total, deadline, signer);
        }
        vm.stopBroadcast();
        console2.log("Pool created at", address(pool));
    }
}
```

- [ ] **Step 3: Add the Coston2 RPC endpoint to `foundry.toml`**

Append to `foundry.toml` (it currently has only `[profile.default]`):

```toml
[rpc_endpoints]
coston2 = "https://coston2-api.flare.network/ext/C/rpc"
```

- [ ] **Step 4: Verify both scripts compile**

Run: `/c/Users/DELL/.foundry/bin/forge build`
Expected: clean compile (both scripts build; only the pre-existing `block.timestamp` warnings in `Pool.sol`).

- [ ] **Step 5: Verify the full test suite is still green**

Run: `/c/Users/DELL/.foundry/bin/forge test`
Expected: 28 tests pass (adding scripts must not affect tests).

- [ ] **Step 6: Commit**

```bash
git add script/DeployPoolFactory.s.sol script/CreatePool.s.sol foundry.toml
git commit -m "feat(m8): deploy scripts (PoolFactory + asset-parametrized CreatePool) + coston2 rpc

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Update memory

**Files:**
- Modify: `C:/Users/DELL/.claude/projects/F--PROJECTS-LOCKBOX/memory/confidential-prize-pool.md`

- [ ] **Step 1: Record M8 completion**

Append an M8 status paragraph covering: M8 multi-asset FXRP done — contracts were already asset-generic (M2), so M8 = proof + tooling + verified facts. VERIFIED: FXRP is a standard ERC-20, 6 decimals, no fees/hooks, Coston2 faucet-dispensed (faucet.flare.network/coston2), address via FlareContractRegistry 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019 getContractAddressByName (confirm name on-chain via cast). Decimals are display-only — everything works in raw integer units, no 1e18 assumption. Built: MockERC20 now `constructor(uint8 dec)`+decimals() override; `test_fxrp_sixDecimals_claimThenSweep` in PoolFactory.t.sol (create→claim→sweep at 6 decimals, 28 forge tests total); Foundry scripts `script/DeployPoolFactory.s.sol` + `script/CreatePool.s.sol` (asset-parametrized, for M10 demo); foundry.toml `[rpc_endpoints] coston2`. No Pool.sol/PoolFactory.sol/Go change, no new EIP-712. Milestones done: M1–M8. Remaining: M9 frontend, M10 demo. Live E2E still gated on FTDC registration blocker (Flare-side); note that PoolFactory/Pool deploy is NOT FTDC-gated (only TEE registration is), so a live FXRP pool deploy is feasible at demo time via the faucet + CreatePool script.

- [ ] **Step 2: No commit** (memory is outside the repo tree).

---

## Self-Review Notes

- **Spec coverage:** §2 verified facts → documented in design + carried to memory (Task 3) and CreatePool script comment; §3 MockERC20 config → Task 1 steps 3-4; §3 6-decimal test → Task 1 step 1; §3 DeployPoolFactory + CreatePool → Task 2 steps 1-2; §3 foundry.toml rpc → Task 2 step 3. All mapped.
- **Placeholder scan:** none — every code step shows full file/edit content.
- **Type consistency:** `MockERC20(uint8 dec)` used identically in the new test (`MockERC20(6)`), the updated call sites (`MockERC20(18)`), and the mock definition. Env var names (`DEPLOYER_PRIVATE_KEY`, `POOL_FACTORY`, `ASSET`, `TOTAL`, `DEADLINE`, `AUTHORIZED_SIGNER`) are consistent between the CreatePool script and its doc comment. RPC alias `coston2` matches the design.
- **Green-at-every-commit:** Task 1 updates all `MockERC20` call sites in the same commit as the constructor change (no intermediate broken build); Task 2 is additive (scripts + toml) and re-verifies the suite.
- **No Go/runtime-contract change** — consistent with the design's out-of-scope list; interop tests remain green (rebuild the Go binaries before `forge test` if needed).
