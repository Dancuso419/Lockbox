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
