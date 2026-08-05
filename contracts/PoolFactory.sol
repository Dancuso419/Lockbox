// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Pool } from "./Pool.sol";

/// @title PoolFactory — deploys and funds one Pool per distribution.
contract PoolFactory {
    using SafeERC20 for IERC20;

    Pool[] public allPools;

    error WrongNativeValue();
    error NativeValueWithERC20();

    event PoolCreated(
        address indexed pool,
        address indexed organizer,
        address asset,
        uint256 total,
        uint64 deadline
    );

    /// @notice Create + fund a pool in one call.
    /// @param asset address(0) for native C2FLR, else an ERC-20 (e.g. FXRP).
    /// @param totalAmount amount to lock; native must equal msg.value, ERC-20 pulled via transferFrom.
    /// @param deadline unix seconds after which unclaimed funds can be swept.
    /// @param authorizedSigner immutable TEE voucher signer for this pool.
    function createPool(
        address asset,
        uint256 totalAmount,
        uint64 deadline,
        address authorizedSigner
    ) external payable returns (Pool pool) {
        if (asset == address(0)) {
            if (msg.value != totalAmount) revert WrongNativeValue();
            pool = new Pool{value: totalAmount}(
                msg.sender, asset, totalAmount, deadline, authorizedSigner
            );
        } else {
            if (msg.value != 0) revert NativeValueWithERC20();
            pool = new Pool(msg.sender, asset, totalAmount, deadline, authorizedSigner);
            IERC20(asset).safeTransferFrom(msg.sender, address(pool), totalAmount);
        }

        allPools.push(pool);
        emit PoolCreated(address(pool), msg.sender, asset, totalAmount, deadline);
    }

    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }
}
