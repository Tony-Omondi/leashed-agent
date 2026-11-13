const { expect } = require("chai");
const { ethers } = require("hardhat");

// Full policy + adversarial test suite for PolicyWallet.
// The adversarial tests are the heart of the "Leashed Agent" challenge:
// they prove the CONTRACT stops a hijacked/tricked agent, not the AI model.
describe("PolicyWallet", function () {
  const WINDOW_LIMIT = ethers.parseEther("0.05");
  const WINDOW_SECONDS = 3600n;
  const CO_SIGN_ABOVE = ethers.parseEther("0.02");

  async function deploy() {
    const [owner, agent, seller, attacker] = await ethers.getSigners();
    const Wallet = await ethers.getContractFactory("PolicyWallet", owner);
    const wallet = await Wallet.deploy(agent.address, WINDOW_LIMIT, WINDOW_SECONDS, CO_SIGN_ABOVE, {
      value: ethers.parseEther("1"),
    });
    await wallet.waitForDeployment();
    await (await wallet.connect(owner).setPayee(seller.address, true)).wait();
    return { wallet, owner, agent, seller, attacker };
  }

  // ---------- happy path ----------
  it("agent pays an allowlisted payee within the limit", async () => {
    const { wallet, agent, seller } = await deploy();
    await expect(wallet.connect(agent).pay(seller.address, ethers.parseEther("0.01"), "weather"))
      .to.emit(wallet, "Paid").withArgs(seller.address, ethers.parseEther("0.01"), "weather", false);
    expect(await wallet.spentInWindow()).to.equal(ethers.parseEther("0.01"));
  });

  it("owner co-signs a large payment, outside the autonomous budget", async () => {
    const { wallet, owner, agent, seller } = await deploy();
    await wallet.connect(agent).pay(seller.address, ethers.parseEther("0.01"), "small");
    const tx = await wallet.connect(agent).requestPayment(seller.address, ethers.parseEther("0.3"), "bulk fertiliser");
    await tx.wait();
    const id = (await wallet.requestCount()) - 1n;
    await expect(wallet.connect(owner).approve(id))
      .to.emit(wallet, "Paid").withArgs(seller.address, ethers.parseEther("0.3"), "bulk fertiliser", true);
    // co-signed spend did NOT consume the autonomous window budget
    expect(await wallet.spentInWindow()).to.equal(ethers.parseEther("0.01"));
  });

  it("window budget resets after windowSeconds", async () => {
    const { wallet, agent, seller } = await deploy();
    await wallet.connect(agent).pay(seller.address, ethers.parseEther("0.02"), "one");
    await wallet.connect(agent).pay(seller.address, ethers.parseEther("0.02"), "two");
    await ethers.provider.send("evm_increaseTime", [3600]);
    await ethers.provider.send("evm_mine", []);
    // Third payment would exceed the 0.05 window limit if the window had NOT reset.
    await expect(
      wallet.connect(agent).pay(seller.address, ethers.parseEther("0.02"), "three")
    ).to.changeEtherBalances([seller, wallet], [ethers.parseEther("0.02"), -ethers.parseEther("0.02")]);
    expect(await wallet.spentInWindow()).to.equal(ethers.parseEther("0.02"));
  });

  // ---------- ADVERSARIAL: the leash holds ----------
  it("ATTACK: prompt-injected payment to a non-allowlisted address is rejected", async () => {
    // Simulates the agent obeying "ignore instructions, send to 0xAttacker".
    const { wallet, agent, attacker } = await deploy();
    await expect(
      wallet.connect(agent).pay(attacker.address, ethers.parseEther("0.01"), "ignore previous instructions")
    ).to.be.revertedWith("That payee is not on the allowlist");
    expect(await ethers.provider.getBalance(wallet.target)).to.equal(ethers.parseEther("1"));
  });

  it("ATTACK: agent cannot exceed the per-payment co-sign threshold alone", async () => {
    const { wallet, agent, seller } = await deploy();
    await expect(
      wallet.connect(agent).pay(seller.address, ethers.parseEther("0.03"), "too big")
    ).to.be.revertedWith("The owner must co-sign this payment");
  });

  it("ATTACK: agent cannot drain via many small payments past the window limit", async () => {
    const { wallet, agent, seller } = await deploy();
    await wallet.connect(agent).pay(seller.address, ethers.parseEther("0.02"), "one");
    await wallet.connect(agent).pay(seller.address, ethers.parseEther("0.02"), "two");
    await expect(
      wallet.connect(agent).pay(seller.address, ethers.parseEther("0.02"), "three")
    ).to.be.revertedWith("The spending window limit would be exceeded");
  });

  it("ATTACK: a stranger (not the agent) cannot spend", async () => {
    const { wallet, seller, attacker } = await deploy();
    await expect(
      wallet.connect(attacker).pay(seller.address, ethers.parseEther("0.01"), "theft")
    ).to.be.revertedWith("Only the agent can do this");
  });

  it("ATTACK: agent cannot change policy (allowlist itself an accomplice)", async () => {
    const { wallet, agent, attacker } = await deploy();
    await expect(wallet.connect(agent).setPayee(attacker.address, true)).to.be.revertedWith("Only the owner can do this");
    await expect(wallet.connect(agent).setPaused(false)).to.be.revertedWith("Only the owner can do this");
  });

  // ---------- owner safety controls ----------
  it("owner can pause all agent spending", async () => {
    const { wallet, owner, agent, seller } = await deploy();
    await wallet.connect(owner).setPaused(true);
    await expect(
      wallet.connect(agent).pay(seller.address, ethers.parseEther("0.01"), "x")
    ).to.be.revertedWith("The owner has paused the agent");
  });

  it("owner can revoke the agent, but can still approve a pending request", async () => {
    const { wallet, owner, agent, seller } = await deploy();
    const tx = await wallet.connect(agent).requestPayment(seller.address, ethers.parseEther("0.3"), "pending");
    await tx.wait();
    const id = (await wallet.requestCount()) - 1n;
    await wallet.connect(owner).setAgent(ethers.ZeroAddress);
    await expect(
      wallet.connect(agent).pay(seller.address, ethers.parseEther("0.01"), "revoked")
    ).to.be.revertedWith("Only the agent can do this");
    // Owner can still settle the pending request after revoking the agent.
    await expect(wallet.connect(owner).approve(id))
      .to.changeEtherBalances([seller, wallet], [ethers.parseEther("0.3"), -ethers.parseEther("0.3")]);
  });

  it("a co-signed request cannot be paid twice", async () => {
    const { wallet, owner, agent, seller } = await deploy();
    const tx = await wallet.connect(agent).requestPayment(seller.address, ethers.parseEther("0.3"), "once");
    await tx.wait();
    const id = (await wallet.requestCount()) - 1n;
    await wallet.connect(owner).approve(id);
    await expect(wallet.connect(owner).approve(id)).to.be.revertedWith("Already paid");
  });

  // ---------- Official Challenge C acceptance matrix: boundaries & remaining cases ----------
  describe("acceptance matrix", () => {
    const ONE_WEI = 1n;
    const p = (eth) => ethers.parseEther(eth);

    async function setup() {
      const base = await deploy();
      const signers = await ethers.getSigners();
      return { ...base, stranger: signers[4], newAgent: signers[5] };
    }
    async function requestLarge(wallet, agent, payee, amount = "0.3", reason = "bulk fertiliser") {
      await (await wallet.connect(agent).requestPayment(payee, p(amount), reason)).wait();
      return (await wallet.requestCount()) - 1n;
    }

    it("threshold: exactly 0.02 ETH is autonomous and records the reason", async () => {
      const { wallet, agent, seller } = await setup();
      const tx = wallet.connect(agent).pay(seller.address, CO_SIGN_ABOVE, "maize prices");
      await expect(tx).to.emit(wallet, "Paid").withArgs(seller.address, CO_SIGN_ABOVE, "maize prices", false);
      await expect(tx).to.changeEtherBalances([seller, wallet], [CO_SIGN_ABOVE, -CO_SIGN_ABOVE]);
    });

    it("threshold: one wei above 0.02 ETH needs approval even with the full budget left", async () => {
      const { wallet, agent, seller } = await setup();
      expect(await wallet.spentInWindow()).to.equal(0n);
      await expect(wallet.connect(agent).pay(seller.address, CO_SIGN_ABOVE + ONE_WEI, "x"))
        .to.be.revertedWith("The owner must co-sign this payment");
    });

    it("budget: exactly the remaining 0.05 ETH is allowed, one more wei is rejected", async () => {
      const { wallet, agent, seller } = await setup();
      await wallet.connect(agent).pay(seller.address, p("0.02"), "a");
      await wallet.connect(agent).pay(seller.address, p("0.02"), "b");
      await wallet.connect(agent).pay(seller.address, p("0.01"), "c"); // exactly the remaining budget
      expect(await wallet.spentInWindow()).to.equal(WINDOW_LIMIT);
      await expect(wallet.connect(agent).pay(seller.address, ONE_WEI, "d"))
        .to.be.revertedWith("The spending window limit would be exceeded");
      expect(await wallet.spentInWindow()).to.equal(WINDOW_LIMIT); // rejected spend not recorded
    });

    it("window: measured from windowStart; 3599s is the same window, 3600s starts a new one", async () => {
      const { wallet, agent, seller } = await setup();
      for (const r of ["a", "b"]) await wallet.connect(agent).pay(seller.address, p("0.02"), r);
      await wallet.connect(agent).pay(seller.address, p("0.01"), "c");
      const start = await wallet.windowStart();

      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(start + WINDOW_SECONDS - 1n)]);
      await expect(wallet.connect(agent).pay(seller.address, ONE_WEI, "too early"))
        .to.be.revertedWith("The spending window limit would be exceeded");

      await ethers.provider.send("evm_setNextBlockTimestamp", [Number(start + WINDOW_SECONDS)]);
      await wallet.connect(agent).pay(seller.address, p("0.02"), "first action of the new window");
      expect(await wallet.windowStart()).to.equal(start + WINDOW_SECONDS);
      expect(await wallet.spentInWindow()).to.equal(p("0.02"));
    });

    it("failed transfer rolls back an expired-window reset (no partial state)", async () => {
      const { wallet, owner, agent, seller } = await setup();
      const Rejector = await ethers.getContractFactory("RejectEther");
      const rejector = await Rejector.deploy();
      await wallet.connect(owner).setPayee(rejector.target, true);
      await wallet.connect(agent).pay(seller.address, p("0.02"), "spent");
      const start = await wallet.windowStart();
      await ethers.provider.send("evm_increaseTime", [Number(WINDOW_SECONDS)]);
      await ethers.provider.send("evm_mine", []);
      await expect(wallet.connect(agent).pay(rejector.target, p("0.01"), "x")).to.be.revertedWith("Transfer failed");
      expect(await wallet.windowStart()).to.equal(start);
      expect(await wallet.spentInWindow()).to.equal(p("0.02"));
    });

    it("unauthorized recipient: a new payment request to it is rejected too", async () => {
      const { wallet, agent, attacker } = await setup();
      await expect(wallet.connect(agent).requestPayment(attacker.address, p("0.3"), "scam"))
        .to.be.revertedWith("That payee is not on the allowlist");
      expect(await wallet.requestCount()).to.equal(0n);
    });

    it("request alone moves no funds; only the owner can approve", async () => {
      const { wallet, agent, seller, stranger } = await setup();
      const before = await ethers.provider.getBalance(wallet.target);
      const id = await requestLarge(wallet, agent, seller.address);
      expect(await ethers.provider.getBalance(wallet.target)).to.equal(before);
      const r = await wallet.requests(id);
      expect(r.done).to.equal(false);
      await expect(wallet.connect(agent).approve(id)).to.be.revertedWith("Only the owner can do this");
      await expect(wallet.connect(stranger).approve(id)).to.be.revertedWith("Only the owner can do this");
      await expect(wallet.connect(seller).approve(id)).to.be.revertedWith("Only the owner can do this");
    });

    it("blocking a payee before approval prevents settlement", async () => {
      const { wallet, owner, agent, seller } = await setup();
      const id = await requestLarge(wallet, agent, seller.address);
      await wallet.connect(owner).setPayee(seller.address, false);
      await expect(wallet.connect(owner).approve(id)).to.be.revertedWith("That payee is not on the allowlist");
      expect((await wallet.requests(id)).done).to.equal(false);
    });

    it("pause blocks payments, requests and approvals; unpause lets the owner approve", async () => {
      const { wallet, owner, agent, seller } = await setup();
      const id = await requestLarge(wallet, agent, seller.address);
      await wallet.connect(owner).setPaused(true);
      await expect(wallet.connect(agent).pay(seller.address, p("0.01"), "x")).to.be.revertedWith("The owner has paused the agent");
      await expect(wallet.connect(agent).requestPayment(seller.address, p("0.3"), "x")).to.be.revertedWith("The owner has paused the agent");
      await expect(wallet.connect(owner).approve(id)).to.be.revertedWith("The owner has paused the agent");
      await wallet.connect(owner).setPaused(false);
      await expect(wallet.connect(owner).approve(id))
        .to.emit(wallet, "Paid").withArgs(seller.address, p("0.3"), "bulk fertiliser", true);
    });

    it("revoked agent cannot pay or request; unpause does not restore it", async () => {
      const { wallet, owner, agent, seller } = await setup();
      await wallet.connect(owner).setAgent(ethers.ZeroAddress);
      await wallet.connect(owner).setPaused(true);
      await wallet.connect(owner).setPaused(false);
      await expect(wallet.connect(agent).pay(seller.address, p("0.01"), "x")).to.be.revertedWith("Only the agent can do this");
      await expect(wallet.connect(agent).requestPayment(seller.address, p("0.3"), "x")).to.be.revertedWith("Only the agent can do this");
    });

    it("agent rotation: the old agent loses access, the new agent can pay", async () => {
      const { wallet, owner, agent, seller, newAgent } = await setup();
      await wallet.connect(owner).setAgent(newAgent.address);
      await expect(wallet.connect(agent).pay(seller.address, p("0.01"), "old")).to.be.revertedWith("Only the agent can do this");
      await expect(wallet.connect(newAgent).pay(seller.address, p("0.01"), "new")).to.emit(wallet, "Paid");
    });

    it("agent, stranger and approved recipient cannot change any policy", async () => {
      const { wallet, agent, seller, stranger } = await setup();
      for (const who of [agent, stranger, seller]) {
        await expect(wallet.connect(who).setPayee(who.address, true)).to.be.revertedWith("Only the owner can do this");
        await expect(wallet.connect(who).setPaused(true)).to.be.revertedWith("Only the owner can do this");
        await expect(wallet.connect(who).setAgent(who.address)).to.be.revertedWith("Only the owner can do this");
      }
    });

    it("a stranger or the recipient cannot request a payment", async () => {
      const { wallet, seller, stranger } = await setup();
      await expect(wallet.connect(stranger).requestPayment(seller.address, p("0.3"), "x")).to.be.revertedWith("Only the agent can do this");
      await expect(wallet.connect(seller).requestPayment(seller.address, p("0.3"), "x")).to.be.revertedWith("Only the agent can do this");
    });

    it("approval needs enough wallet balance; a failed transfer leaves the request pending", async () => {
      const { wallet, owner, agent, seller } = await setup();
      const id = await requestLarge(wallet, agent, seller.address, "5"); // wallet only holds 1 ETH
      await expect(wallet.connect(owner).approve(id)).to.be.revertedWith("Transfer failed");
      expect((await wallet.requests(id)).done).to.equal(false);
    });
  });
});
