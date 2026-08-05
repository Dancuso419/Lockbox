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
