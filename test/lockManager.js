/* global artifacts */
const ethers = require("ethers");

const RelayerModule = artifacts.require("RelayerModule");
const GuardianManager = artifacts.require("GuardianManager");
const LockManager = artifacts.require("LockManager");
const GuardianStorage = artifacts.require("GuardianStorage");
const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const RecoveryManager = artifacts.require("RecoveryManager");

const RelayManager = require("../utils/relay-manager");

const utilities = require("../utils/utilities.js");

contract("LockManager", (accounts) => {
  const manager = new RelayManager();

  const owner = accounts[1];
  const guardian1 = accounts[2];
  const nonguardian = accounts[3];

  let guardianManager;
  let guardianStorage;
  let registry;
  let lockManager;
  let recoveryManager;
  let wallet;
  let walletImplementation;
  let relayerModule;

  before(async () => {
    walletImplementation = await BaseWallet.new();
  });

  beforeEach(async () => {
    registry = await Registry.new();
    guardianStorage = await GuardianStorage.new();
    guardianManager = await GuardianManager.new(registry.address, guardianStorage.address, 24, 12);
    lockManager = await LockManager.new(registry.address, guardianStorage.address, 24 * 5);
    recoveryManager = await RecoveryManager.new(registry.address, guardianStorage.address, 36, 24 * 5);
    relayerModule = await RelayerModule.new(
      registry.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
    );
    manager.setRelayerModule(relayerModule);
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    await wallet.init(owner,
      [guardianManager.address,
        lockManager.address,
        recoveryManager.address,
        relayerModule.address]);
  });

  describe("(Un)Lock by EOA guardians", () => {
    beforeEach(async () => {
      await guardianManager.addGuardian(wallet.address, guardian1, { from: owner });
      const count = (await guardianManager.guardianCount(wallet.address)).toNumber();
      assert.equal(count, 1, "1 guardian should be added");
      const isGuardian = await guardianManager.isGuardian(wallet.address, guardian1);
      assert.isTrue(isGuardian, "guardian1 should be a guardian of the wallet");
      const isLocked = await lockManager.isLocked(wallet.address);
      assert.isFalse(isLocked, "should be unlocked by default");
    });

    it("should be locked/unlocked by EOA guardians (blockchain transaction)", async () => {
      // lock
      await lockManager.lock(wallet.address, { from: guardian1 });
      let state = await lockManager.isLocked(wallet.address);
      assert.isTrue(state, "should be locked by guardian");
      let releaseTime = await lockManager.getLock(wallet.address);
      assert.isTrue(releaseTime > 0, "releaseTime should be positive");
      // unlock
      await lockManager.unlock(wallet.address, { from: guardian1 });
      state = await lockManager.isLocked(wallet.address);
      assert.isFalse(state, "should be unlocked by guardian");
      releaseTime = await lockManager.getLock(wallet.address);
      assert.equal(releaseTime, 0, "releaseTime should be zero");
    });

    it("should be locked/unlocked by EOA guardians (relayed transaction)", async () => {
      await manager.relay(lockManager, "lock", [wallet.address], wallet, [guardian1]);
      let state = await lockManager.isLocked(wallet.address);
      assert.isTrue(state, "should be locked by guardian");

      await manager.relay(lockManager, "unlock", [wallet.address], wallet, [guardian1]);
      state = await lockManager.isLocked(wallet.address);
      assert.isFalse(state, "should be unlocked by guardian");
    });

    it("should fail to lock/unlock by non-guardian EOAs (blockchain transaction)", async () => {
      await utilities.assertRevert(lockManager.lock(wallet.address, { from: nonguardian }), "locking from non-guardian should fail");

      await lockManager.lock(wallet.address, { from: guardian1 });
      const state = await lockManager.isLocked(wallet.address);
      assert.isTrue(state, "should be locked by guardian1");

      await utilities.assertRevert(lockManager.unlock(wallet.address, { from: nonguardian }));
    });
  });

  describe("(Un)Lock by Smart Contract guardians", () => {
    beforeEach(async () => {
      const proxy = await Proxy.at(walletImplementation.address);
      const guardianWallet = await BaseWallet.at(proxy.address);

      await guardianWallet.init(guardian1, [guardianManager.address, lockManager.address]);
      await guardianManager.addGuardian(wallet.address, guardianWallet.address, { from: owner });
      const count = (await guardianManager.guardianCount(wallet.address)).toNumber();
      assert.equal(count, 1, "1 guardian should be added");
      const isGuardian = await guardianManager.isGuardian(wallet.address, guardianWallet.address);
      assert.isTrue(isGuardian, "guardian1 should be a guardian of the wallet");
      const isLocked = await lockManager.isLocked(wallet.address);
      assert.isFalse(isLocked, "should be unlocked by default");
    });

    it("should be locked/unlocked by Smart Contract guardians (relayed transaction)", async () => {
      await manager.relay(lockManager, "lock", [wallet.address], wallet, [guardian1]);
      let state = await lockManager.isLocked(wallet.address);
      assert.isTrue(state, "should be locked by guardian");

      await manager.relay(lockManager, "unlock", [wallet.address], wallet, [guardian1]);
      state = await lockManager.isLocked(wallet.address);
      assert.isFalse(state, "should be unlocked by locker");
    });

    it("should fail to lock/unlock by Smart Contract guardians when signer is not authorized (relayed transaction)", async () => {
      await utilities.assertRevert(manager.relay(lockManager, "lock", [wallet.address], wallet, [nonguardian]), "RM: Invalid signatures");
    });
  });

  describe("Auto-unlock", () => {
    it("should auto-unlock after lock period", async () => {
      await guardianManager.addGuardian(wallet.address, guardian1, { from: owner });
      await lockManager.lock(wallet.address, { from: guardian1 });
      let state = await lockManager.isLocked(wallet.address);
      assert.isTrue(state, "should be locked by guardian");
      let releaseTime = await lockManager.getLock(wallet.address);
      assert.isTrue(releaseTime > 0, "releaseTime should be positive");

      await utilities.increaseTime(24 * 5 + 5);
      state = await lockManager.isLocked(wallet.address);
      assert.isFalse(state, "should be unlocked by guardian");
      releaseTime = await lockManager.getLock(wallet.address);
      assert.equal(releaseTime, 0, "releaseTime should be zero");
    });
  });

  describe("Unlocking wallets", () => {
    beforeEach(async () => {
      await guardianManager.addGuardian(wallet.address, guardian1, { from: owner });
    });

    it("should not be able to unlock, an already unlocked wallet", async () => {
      // lock
      await lockManager.lock(wallet.address, { from: guardian1 });
      // unlock
      await lockManager.unlock(wallet.address, { from: guardian1 });
      // try to unlock again
      await utilities.assertRevert(lockManager.unlock(wallet.address, { from: guardian1 }),
        "VM Exception while processing transaction: revert LM: wallet must be locked");
    });

    it("should not be able to unlock a wallet, locked by another module", async () => {
      // lock by putting the wallet in recovery mode
      await manager.relay(recoveryManager, "executeRecovery", [wallet.address, accounts[5]], wallet, [guardian1]);

      // try to unlock
      await utilities.assertRevert(lockManager.unlock(wallet.address, { from: guardian1 }),
        "LM: cannot unlock a wallet that was locked by another module");
    });
  });
});
