// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Test helper only: a payee that refuses ETH, so a payment to it fails.
/// Used to prove a failed transfer rolls back every state change (incl. a window reset).
contract RejectEther {
    receive() external payable {
        revert("I refuse ETH");
    }
}
