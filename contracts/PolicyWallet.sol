// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * PolicyWallet — from the official zetech-forge/web3_starter-kit. Logic unchanged;
 * Team Shamba Shield added these comments only.
 *
 * A "leashed agent" wallet (SDG 2: Zero Hunger).
 *
 * An OWNER funds this wallet and appoints an AGENT (an AI purchasing agent
 * acting for a smallholder farmer). The agent can spend autonomously, but the
 * CONTRACT — not the AI model — enforces the policy, so a hijacked or tricked
 * agent still cannot move funds outside the rules:
 *
 *   1. Only the agent may spend (owner can revoke by setting agent = 0).
 *   2. The payee must be on the owner's allowlist.
 *   3. A single autonomous payment must be <= coSignAbove.
 *   4. Total autonomous spend per window must be <= windowLimit. The window is
 *      fixed (not sliding): it starts at deployment and resets on the next
 *      successful payment once windowSeconds have passed since windowStart.
 *   5. Anything larger needs an explicit owner approve() (co-sign), which is
 *      OUTSIDE the autonomous budget.
 *   6. Owner can pause() everything at any time.
 *
 * Self-contained, no imports — deploys straight from Hardhat or Remix.
 */
contract PolicyWallet {
    struct Request {
        address payee;
        uint256 amount;
        string reason;
        bool done;
    }

    address public immutable owner;
    uint256 public immutable windowLimit;   // max autonomous wei per window
    uint256 public immutable windowSeconds;  // window length
    uint256 public immutable coSignAbove;    // max wei the agent may pay alone

    address public agent;
    bool public paused;
    mapping(address => bool) public isAllowedPayee;
    uint256 public windowStart;
    uint256 public spentInWindow;
    Request[] public requests;

    event Paid(address indexed payee, uint256 amount, string reason, bool coSigned);
    event PaymentRequested(uint256 indexed id, address indexed payee, uint256 amount, string reason);
    event PayeeSet(address indexed payee, bool allowed);
    event AgentSet(address indexed agent);
    event PausedSet(bool paused);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only the owner can do this");
        _;
    }

    modifier onlyAgent() {
        require(msg.sender == agent && agent != address(0), "Only the agent can do this");
        _;
    }

    constructor(address agent_, uint256 windowLimit_, uint256 windowSeconds_, uint256 coSignAbove_) payable {
        owner = msg.sender;
        agent = agent_;
        windowLimit = windowLimit_;
        windowSeconds = windowSeconds_;
        coSignAbove = coSignAbove_;
        windowStart = block.timestamp;
    }

    receive() external payable {}

    // ---------- owner controls ----------
    function setPayee(address payee, bool allowed) external onlyOwner {
        isAllowedPayee[payee] = allowed;
        emit PayeeSet(payee, allowed);
    }

    function setAgent(address newAgent) external onlyOwner {
        agent = newAgent;
        emit AgentSet(newAgent);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    // ---------- autonomous agent spending ----------
    function pay(address payee, uint256 amount, string calldata reason) external onlyAgent {
        require(!paused, "The owner has paused the agent");
        require(isAllowedPayee[payee], "That payee is not on the allowlist");
        require(amount <= coSignAbove, "The owner must co-sign this payment");
        if (block.timestamp - windowStart >= windowSeconds) {
            windowStart = block.timestamp;
            spentInWindow = 0;
        }
        require(spentInWindow + amount <= windowLimit, "The spending window limit would be exceeded");
        spentInWindow += amount;
        emit Paid(payee, amount, reason, false);
        _send(payee, amount);
    }

    // ---------- owner co-sign flow for large payments ----------
    function requestPayment(address payee, uint256 amount, string calldata reason)
        external
        onlyAgent
        returns (uint256 id)
    {
        require(!paused, "The owner has paused the agent");
        require(isAllowedPayee[payee], "That payee is not on the allowlist");
        id = requests.length;
        requests.push(Request(payee, amount, reason, false));
        emit PaymentRequested(id, payee, amount, reason);
    }

    function approve(uint256 id) external onlyOwner {
        require(!paused, "The owner has paused the agent");
        Request storage r = requests[id];
        require(!r.done, "Already paid");
        require(isAllowedPayee[r.payee], "That payee is not on the allowlist");
        r.done = true; // mark before transfer (no double settlement / reentrancy)
        // Owner co-signed payments are OUTSIDE the autonomous budget.
        emit Paid(r.payee, r.amount, r.reason, true);
        _send(r.payee, r.amount);
    }

    function requestCount() external view returns (uint256) {
        return requests.length;
    }

    function _send(address to, uint256 amount) private {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "Transfer failed");
    }
}
