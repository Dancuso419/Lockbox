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
