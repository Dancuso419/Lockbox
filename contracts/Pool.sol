// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Pool — one confidential distribution.
/// @notice Holds funds for one pool. Individual allocations live in the TEE and
/// are never stored here; only aggregate counters move on-chain.
contract Pool is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { Open, Closed }

    // keccak256("Voucher(address recipient,uint256 amount,uint256 nonce)")
    bytes32 public constant VOUCHER_TYPEHASH =
        keccak256("Voucher(address recipient,uint256 amount,uint256 nonce)");

    address public immutable organizer;
    address public immutable asset; // address(0) == native
    uint256 public immutable totalDeposited;
    uint64 public immutable deadline;
    address public immutable authorizedSigner;

    uint256 public totalClaimed;
    Status public status;
    mapping(uint256 => bool) public usedNonce;

    error ZeroSigner();
    error ZeroAmount();
    error BadDeadline();
    error WrongNativeValue();
    error NotOpen();
    error PastDeadline();
    error NonceUsed();
    error BadSignature();
    error ExceedsDeposited();
    error NativeTransferFailed();

    event Claimed(address indexed recipient, uint256 amount, uint256 nonce);

    constructor(
        address _organizer,
        address _asset,
        uint256 _totalAmount,
        uint64 _deadline,
        address _authorizedSigner
    ) payable EIP712("ConfidentialPrizePool", "1") {
        if (_authorizedSigner == address(0)) revert ZeroSigner();
        if (_totalAmount == 0) revert ZeroAmount();
        if (_deadline <= block.timestamp) revert BadDeadline();

        organizer = _organizer;
        asset = _asset;
        totalDeposited = _totalAmount;
        deadline = _deadline;
        authorizedSigner = _authorizedSigner;
        status = Status.Open;

        if (_asset == address(0)) {
            if (msg.value != _totalAmount) revert WrongNativeValue();
        } else {
            if (msg.value != 0) revert WrongNativeValue();
            // ERC-20 funding is guaranteed by PoolFactory (later task), which
            // transferFrom's into this contract in the same tx as deploy. A
            // standalone ERC-20 Pool deploy is not a supported entry point.
        }
    }

    function remaining() external view returns (uint256) {
        return totalDeposited - totalClaimed;
    }

    function claim(uint256 amount, uint256 nonce, bytes calldata signature)
        external
        nonReentrant
    {
        if (status != Status.Open) revert NotOpen();
        if (block.timestamp > deadline) revert PastDeadline();
        if (usedNonce[nonce]) revert NonceUsed();

        bytes32 structHash =
            keccak256(abi.encode(VOUCHER_TYPEHASH, msg.sender, amount, nonce));
        bytes32 digest = _hashTypedDataV4(structHash);
        if (ECDSA.recover(digest, signature) != authorizedSigner) revert BadSignature();

        if (totalClaimed + amount > totalDeposited) revert ExceedsDeposited();

        // effects
        usedNonce[nonce] = true;
        totalClaimed += amount;

        // interaction
        _payout(msg.sender, amount);
        emit Claimed(msg.sender, amount, nonce);
    }

    function _payout(address to, uint256 amount) private {
        if (asset == address(0)) {
            (bool ok, ) = payable(to).call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(asset).safeTransfer(to, amount);
        }
    }
}
