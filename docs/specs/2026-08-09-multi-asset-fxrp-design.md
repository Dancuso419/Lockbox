# Confidential Prize Pool — M8 Multi-Asset (FXRP) Design

**Date:** 2026-08-09
**Scope:** BUILD.md M8 (FR7) — support pools denominated in assets beyond native C2FLR, specifically the FAsset **FXRP**; prove non-18-decimal correctness, document the verified FXRP integration path, and add deploy tooling.
**Status:** Approved for planning.
**Network:** Coston2 (chain id 114).
**Companions:** contracts `docs/specs/2026-08-05-confidential-prize-pool-contracts-design.md` (§3 "generic asset from the start", §"fee-on-transfer out of scope").

## 1. Purpose & scope

FR7 requires pools to support more than one asset denomination, including at least one FAsset (FXRP). The contract layer was built asset-generic in M2 (`Pool.asset`: `address(0)` = native C2FLR, else an ERC-20 moved via `SafeERC20`; `PoolFactory` funds ERC-20 pools via `safeTransferFrom`). So M8 is not a contract build — it is **proving** the ERC-20 path is correct for a 6-decimal token, **documenting** the verified FXRP facts, and adding **deploy tooling** for the M10 demo.

**In scope:** make `MockERC20` decimals-configurable; a 6-decimal FXRP-like end-to-end test (create → claim → sweep); two Foundry deploy scripts (`DeployPoolFactory`, `CreatePool`); the verified-FXRP documentation (this doc).

**Out of scope:** any change to `Pool.sol`/`PoolFactory.sol` logic (already generic); the Go/TEE layer (allocation store handles arbitrary raw amounts; a 6-decimal FXRP is just smaller big.Ints — no new EIP-712, interop unaffected); a live on-chain FXRP deploy (deferred — scripts + faucet make it a demo-time step); fee-on-transfer/rebasing tokens (already documented out of scope; FXRP is neither); decimals-aware display (M9 frontend); live FTDC registration (blocked Flare-side).

## 2. Verified FXRP facts (the [VERIFY] deliverable)

Verified against the Flare developer hub (dev.flare.network/fxrp, /fassets) and Coston2 tooling:

- **FXRP is a standard ERC-20**, a 1:1 representation of XRP bridged from the XRPL. Plain `transfer`/`transferFrom`; **no transfer fees or hooks** — not fee-on-transfer, not rebasing. It therefore fits the pool's existing over-allocation cap logic unchanged.
- **Decimals = 6** (XRP's precision), versus native C2FLR's 18. This is the only material difference from the existing ERC-20 tests, which used an 18-decimal mock.
- **Coston2 availability:** FXRP is dispensed directly by the Coston2 faucet (`https://faucet.flare.network/coston2`) — no FAsset minting flow needed for testing.
- **Address resolution:** FXRP's address is obtained from **`FlareContractRegistry`** at `0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019` (same address on all Flare networks) via `getContractAddressByName(<name>)`. The exact name string is NOT hardcoded in this design because the docs did not pin it authoritatively; it MUST be confirmed on-chain at deploy time, e.g.:
  ```
  cast call 0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019 \
    "getContractAddressByName(string)(address)" "FXRP" \
    --rpc-url https://coston2-api.flare.network/ext/C/rpc
  ```
  Treat a zero-address return as "wrong name" and try the registry's `getAllContracts()` to find the correct entry.

**Decimals correctness argument:** `Pool`, `PoolFactory`, the TEE allocation store, compliance, and vouchers all operate in **raw integer token units**. Nothing multiplies by or assumes `1e18`. A 6-decimal amount is simply a smaller integer; all invariants (`sum(allocations) <= totalDeposited`, `totalClaimed + amount <= totalDeposited`, nonce/replay) hold identically. Decimals affect only human-readable display, which is a frontend (M9) concern.

## 3. Components

### test/mocks/MockERC20.sol (modify — configurable decimals)
```solidity
contract MockERC20 is ERC20 {
    uint8 private immutable _dec;
    constructor(uint8 dec) ERC20("Mock", "MOCK") { _dec = dec; }
    function decimals() public view override returns (uint8) { return _dec; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
```
The three existing call sites in `test/PoolFactory.t.sol` (`new MockERC20()` at the current lines 42, 55, 90) become `new MockERC20(18)` — preserving today's behavior, no assertion changes. (`Pool.t.sol` does not instantiate `MockERC20`.)

### test/PoolFactory.t.sol (add — 6-decimal FXRP end-to-end test)
Co-located here to reuse the existing `setUp`, `signer`/`signerPk`, `_digest`, and `_sign` helpers (a standalone `FxrpPool.t.sol` would duplicate all of them). New test mirrors `test_erc20_claimThenSweep` but with `MockERC20(6)` and 6-decimal amounts:
```solidity
function test_fxrp_sixDecimals_claimThenSweep() public {
    MockERC20 fxrp = new MockERC20(6);           // FXRP: 6 decimals
    assertEq(fxrp.decimals(), 6);
    uint256 total = 1000e6;                        // 1000 FXRP
    fxrp.mint(organizer, total);
    vm.startPrank(organizer);
    fxrp.approve(address(factory), total);
    Pool pool = factory.createPool(address(fxrp), total, deadline, signer);
    vm.stopPrank();
    assertEq(fxrp.balanceOf(address(pool)), total);
    assertEq(pool.totalDeposited(), total);

    address recipient = address(0xBEEF);
    uint256 amount = 250e6;                        // 250 FXRP
    bytes memory sig = _sign(pool, recipient, amount, 1); // sign BEFORE prank (typehash call consumes prank)
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

### script/DeployPoolFactory.s.sol (new — Foundry deploy script)
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;
import { Script, console2 } from "forge-std/Script.sol";
import { PoolFactory } from "../contracts/PoolFactory.sol";

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

### script/CreatePool.s.sol (new — asset-parametrized pool creation)
Reads config from env; funds native or ERC-20 (approve + createPool). Used by the M10 demo to create an FXRP pool.
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;
import { Script, console2 } from "forge-std/Script.sol";
import { PoolFactory } from "../contracts/PoolFactory.sol";
import { Pool } from "../contracts/Pool.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract CreatePool is Script {
    function run() external returns (Pool pool) {
        uint256 pk        = vm.envUint("DEPLOYER_PRIVATE_KEY");
        PoolFactory factory = PoolFactory(vm.envAddress("POOL_FACTORY"));
        address asset     = vm.envAddress("ASSET");        // address(0) => native
        uint256 total     = vm.envUint("TOTAL");
        uint64  deadline  = uint64(vm.envUint("DEADLINE"));
        address signer    = vm.envAddress("AUTHORIZED_SIGNER");

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

### foundry.toml (verify/extend)
Confirm a Coston2 RPC endpoint is available for `--rpc-url` (either passed on the CLI or as an `[rpc_endpoints]` alias). The scripts do not need `ffi`/`fs_permissions` beyond what already exists. If `[rpc_endpoints]` has no `coston2`, add:
```toml
[rpc_endpoints]
coston2 = "https://coston2-api.flare.network/ext/C/rpc"
```

## 4. Testing
- **Existing 27 forge tests stay green** after the `MockERC20(18)` constructor update (mechanical).
- **New `test_fxrp_sixDecimals_claimThenSweep`:** asserts `decimals()==6`, ERC-20 funding at `1000e6`, a `250e6` TEE-voucher claim credited to the recipient, and a `750e6` sweep remainder to the organizer — proving the full create→claim→sweep path is correct at 6 decimals. Total after this task: **28 forge tests**.
- **Scripts:** verified by `forge build` only (deploy tooling is not unit-tested). Confirm both compile.
- **No Go tests** — the TEE layer is unchanged.

## 5. Risks / notes
- **Deploy-time address risk:** the FXRP registry name is confirmed procedurally (§2 `cast call`), not hardcoded — a wrong name yields `address(0)`, caught before pool creation.
- **`_sign`-before-`prank` gotcha:** `_sign` calls `pool.VOUCHER_TYPEHASH()`, which consumes a preceding `vm.prank`; the new test assigns `sig` before `vm.prank(recipient)` (baked in above). Same gotcha documented for M2/M4.
- **FXRP amounts are small integers:** `250e6` not `250e18`. The test uses 6-decimal literals throughout to catch any accidental `1e18` assumption.
- **No new trust or privacy surface:** M8 changes no runtime logic; the confidentiality guarantees (P1–P5) are unaffected.

## 6. File summary
```
test/mocks/MockERC20.sol      (configurable decimals: constructor(uint8) + decimals() override)
test/PoolFactory.t.sol        (MockERC20(18) at existing call sites; add test_fxrp_sixDecimals_claimThenSweep)
script/DeployPoolFactory.s.sol (new — deploy PoolFactory)
script/CreatePool.s.sol        (new — asset-parametrized pool creation for the demo)
foundry.toml                   (ensure a coston2 rpc endpoint)
docs/specs/2026-08-09-multi-asset-fxrp-design.md  (this doc — verified FXRP facts)
```
No change to `Pool.sol`, `PoolFactory.sol`, or any Go file. No new EIP-712.
