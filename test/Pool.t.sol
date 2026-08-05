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
}
