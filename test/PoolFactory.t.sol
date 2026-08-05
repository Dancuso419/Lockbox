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
        bytes memory sig = _sign(pool, recipient, 40 ether, 1); // sign before prank
        vm.prank(recipient);
        pool.claim(40 ether, 1, sig);
        assertEq(token.balanceOf(recipient), 40 ether);

        vm.warp(deadline + 1);
        vm.prank(organizer);
        pool.sweep();
        assertEq(token.balanceOf(organizer), 60 ether); // remainder back
        assertEq(token.balanceOf(address(pool)), 0);
    }
}
