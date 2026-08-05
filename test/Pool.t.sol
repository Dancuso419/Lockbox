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
}
