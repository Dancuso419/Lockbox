// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test } from "forge-std/Test.sol";
import { Pool } from "../contracts/Pool.sol";

contract VoucherInteropTest is Test {
    // Anvil test key #0 — its address is the authorizedSigner.
    uint256 constant SIGNER_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    function test_goSignedVoucher_isAcceptedByPool() public {
        address signerAddr = vm.addr(SIGNER_PK);
        address organizer = address(0xA11CE);
        address recipient = address(0xBEEF);
        uint64 deadline = uint64(block.timestamp + 7 days);

        vm.deal(organizer, 10 ether);
        vm.prank(organizer);
        Pool pool = new Pool{value: 10 ether}(organizer, address(0), 10 ether, deadline, signerAddr);

        string[] memory cmd = new string[](7);
        cmd[0] = "./bin/sign-voucher.exe";
        cmd[1] = vm.toString(block.chainid);
        cmd[2] = vm.toString(address(pool));
        cmd[3] = vm.toString(recipient);
        cmd[4] = vm.toString(uint256(3 ether));
        cmd[5] = vm.toString(uint256(1));
        cmd[6] = vm.toString(bytes32(SIGNER_PK));
        bytes memory sig = vm.ffi(cmd);

        vm.prank(recipient);
        pool.claim(3 ether, 1, sig);

        assertEq(recipient.balance, 3 ether);
        assertEq(pool.totalClaimed(), 3 ether);
    }
}
