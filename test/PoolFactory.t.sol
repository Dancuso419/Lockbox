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
