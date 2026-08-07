// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Test } from "forge-std/Test.sol";
import { Pool } from "../contracts/Pool.sol";

contract ComplianceInteropTest is Test {
    uint256 constant SIGNER_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    function test_goSignedReport_isAcceptedByPool() public {
        address signerAddr = vm.addr(SIGNER_PK);
        address organizer = address(0xA11CE);
        uint64 deadline = uint64(block.timestamp + 7 days);

        vm.deal(organizer, 10 ether);
        vm.prank(organizer);
        Pool pool = new Pool{value: 10 ether}(organizer, address(0), 10 ether, deadline, signerAddr);

        string[] memory cmd = new string[](7);
        cmd[0] = "./bin/sign-compliance.exe";
        cmd[1] = vm.toString(block.chainid);
        cmd[2] = vm.toString(address(pool));
        cmd[3] = vm.toString(uint256(10 ether)); // totalDeposited
        cmd[4] = vm.toString(uint256(6 ether));  // totalAllocated
        cmd[5] = vm.toString(uint256(4));        // recipientCount
        cmd[6] = vm.toString(bytes32(SIGNER_PK));
        bytes memory sig = vm.ffi(cmd);

        pool.publishComplianceReport(6 ether, 4, sig);

        assertTrue(pool.complianceReported());
        assertEq(pool.reportedTotalAllocated(), 6 ether);
        assertEq(pool.reportedRecipientCount(), 4);
    }
}
