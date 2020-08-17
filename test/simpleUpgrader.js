/* global artifacts */

const ethers = require("ethers");
const {
  keccak256, toUtf8Bytes, formatBytes32String, parseBytes32String,
} = require("ethers").utils;
const utils = require("../utils/utilities.js");

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const OnlyOwnerModule = artifacts.require("TestOnlyOwnerModule");
const Module = artifacts.require("TestModule");
const SimpleUpgrader = artifacts.require("SimpleUpgrader");
const GuardianManager = artifacts.require("GuardianManager");
const LockManager = artifacts.require("LockManager");
const GuardianStorage = artifacts.require("GuardianStorage");
const Registry = artifacts.require("ModuleRegistry");
const RecoveryManager = artifacts.require("RecoveryManager");

const RelayerModule = artifacts.require("RelayerModule");
const RelayManager = require("../utils/relay-manager");

const IS_ONLY_OWNER_MODULE = keccak256(toUtf8Bytes("isOnlyOwnerModule()")).slice(0, 10);

contract("SimpleUpgrader", (accounts) => {
  const manager = new RelayManager();

  const owner = accounts[1];
  let registry;
  let guardianStorage;
  let walletImplementation;
  let wallet;
  let relayerModule;

  before(async () => {
    walletImplementation = await BaseWallet.new();
  });

  beforeEach(async () => {
    registry = await Registry.new();
    guardianStorage = await GuardianStorage.new();

    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);
    relayerModule = await RelayerModule.new(
      registry.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
    );
    manager.setRelayerModule(relayerModule);
  });

  describe("Registering modules", () => {
    it("should register modules in the registry", async () => {
      const name = "test_1.1";
      const initialModule = await Module.new(registry.address, guardianStorage.address, false, 0);
      await registry.registerModule(initialModule.address, formatBytes32String(name));
      // Here we adjust how we call isRegisteredModule which has 2 overlaods, one accepting a single address
      // and a second accepting an array of addresses. Behaviour as to which overload is selected to run
      // differs between CI and Coverage environments, adjusted for this here
      const isRegistered = await registry["isRegisteredModule(address)"](initialModule.address);

      assert.equal(isRegistered, true, "module1 should be registered");
      const info = await registry.moduleInfo(initialModule.address);
      assert.equal(parseBytes32String(info), name, "module1 should be registered with the correct name");
    });

    it("should add registered modules to a wallet", async () => {
      // create modules
      const initialModule = await Module.new(registry.address, guardianStorage.address, false, 0);
      const moduleToAdd = await Module.new(registry.address, guardianStorage.address, false, 0);
      // register module
      await registry.registerModule(initialModule.address, formatBytes32String("initial"));
      await registry.registerModule(moduleToAdd.address, formatBytes32String("added"));

      await wallet.init(owner, [initialModule.address]);
      let isAuthorised = await wallet.authorised(initialModule.address);
      assert.equal(isAuthorised, true, "initial module should be authorised");
      // add module to wallet
      await initialModule.addModule(wallet.address, moduleToAdd.address, { from: owner });

      isAuthorised = await wallet.authorised(moduleToAdd.address);
      assert.equal(isAuthorised, true, "added module should be authorised");
    });

    it("should block addition of unregistered modules to a wallet", async () => {
      // create modules
      const initialModule = await Module.new(registry.address, guardianStorage.address, false, 0);
      const moduleToAdd = await Module.new(registry.address, guardianStorage.address, false, 0);
      // register initial module only
      await registry.registerModule(initialModule.address, formatBytes32String("initial"));

      await wallet.init(owner, [initialModule.address]);
      let isAuthorised = await wallet.authorised(initialModule.address);
      assert.equal(isAuthorised, true, "initial module should be authorised");
      // try (and fail) to add moduleToAdd to wallet
      await assert.revert(initialModule.addModule(wallet.address, moduleToAdd.address, { from: owner }));
      isAuthorised = await wallet.authorised(moduleToAdd.address);
      assert.equal(isAuthorised, false, "unregistered module should not be authorised");
    });

    it("should not be able to upgrade to unregistered module", async () => {
      // create module V1
      const moduleV1 = await Module.new(registry.address, guardianStorage.address, false, 0);
      // register module V1
      await registry.registerModule(moduleV1.address, formatBytes32String("V1"));

      await wallet.init(owner, [moduleV1.address]);
      // create module V2
      const moduleV2 = await Module.new(registry.address, guardianStorage.address, false, 0);
      // create upgrader
      const upgrader = await SimpleUpgrader.new(registry.address, [moduleV1.address], [moduleV2.address]);
      await registry.registerModule(upgrader.address, formatBytes32String("V1toV2"));

      // check we can't upgrade from V1 to V2
      await assert.revertWith(moduleV1.addModule(wallet.address, upgrader.address, { from: owner }), "SU: Not all modules are registered");
      // register module V2
      await registry.registerModule(moduleV2.address, formatBytes32String("V2"));
      // now we can upgrade
      await moduleV1.addModule(wallet.address, upgrader.address, { from: owner });

      // test if the upgrade worked
      const isV1Authorised = await wallet.authorised(moduleV1.address);
      const isV2Authorised = await wallet.authorised(moduleV2.address);
      const isUpgraderAuthorised = await wallet.authorised(upgrader.address);
      const numModules = await wallet.modules();
      assert.isFalse(isV1Authorised, "moduleV1 should be unauthorised");
      assert.isTrue(isV2Authorised, "moduleV2 should be authorised");
      assert.equal(isUpgraderAuthorised, false, "upgrader should not be authorised");
      assert.equal(numModules, 1, "only one module (moduleV2) should be authorised");
    });
  });

  describe("Upgrading modules", () => {
    async function testUpgradeModule({ relayed, useOnlyOwnerModule, modulesToAdd = (moduleV2) => [moduleV2] }) {
      // create module V1
      let moduleV1;
      if (useOnlyOwnerModule) {
        moduleV1 = await OnlyOwnerModule.new(registry.address, guardianStorage.address);
      } else {
        moduleV1 = await Module.new(registry.address, guardianStorage.address, false, 0);
      }
      // register module V1
      await registry.registerModule(moduleV1.address, formatBytes32String("V1"));
      // create wallet with module V1 and relayer module
      const proxy = await Proxy.new(walletImplementation.address);
      wallet = await BaseWallet.at(proxy.address);
      await wallet.init(owner, [moduleV1.address, relayerModule.address]);
      // create module V2
      const moduleV2 = await Module.new(registry.address, guardianStorage.address, false, 0);
      // register module V2
      await registry.registerModule(moduleV2.address, formatBytes32String("V2"));
      // create upgraders
      const toAdd = modulesToAdd(moduleV2.address);
      const upgrader1 = await SimpleUpgrader.new(registry.address, [moduleV1.address], toAdd);
      const upgrader2 = await SimpleUpgrader.new(
        registry.address,
        [moduleV1.address, relayerModule.address],
        toAdd,
      );
      await registry.registerModule(upgrader1.address, formatBytes32String("V1toV2_1"));
      await registry.registerModule(upgrader2.address, formatBytes32String("V1toV2_2"));
      // check that module V1 can be used to add the upgrader module
      if (useOnlyOwnerModule) {
        assert.equal(await moduleV1.isOnlyOwnerModule(), IS_ONLY_OWNER_MODULE);
      }

      // upgrade from V1 to V2
      let txReceipt;
      const params1 = [wallet.address, upgrader1.address];
      const params2 = [wallet.address, upgrader2.address];

      // if no module is added and all modules are removed, the upgrade should fail
      if (toAdd.length === 0) {
        if (relayed) {
          txReceipt = await manager.relay(moduleV1, "addModule", params2, wallet, [owner]);
          const { success } = (await utils.parseLogs(txReceipt, relayerModule, "TransactionExecuted"))[0];
          assert.isTrue(!success, "Relayed upgrade to 0 module should have failed.");
        } else {
          assert.revert(moduleV1.addModule(...params2, { from: owner }));
        }
        return;
      }

      if (relayed) {
        txReceipt = await manager.relay(moduleV1, "addModule", params1, wallet, [owner]);
        const { success } = (await utils.parseLogs(txReceipt, relayerModule, "TransactionExecuted"))[0];
        assert.equal(success, useOnlyOwnerModule, "Relayed tx should only have succeeded if an OnlyOwnerModule was used");
      } else {
        const tx = await moduleV1.addModule(...params1, { from: owner });
        txReceipt = await moduleV1.verboseWaitForTransaction(tx);
      }

      // test event ordering
      const logs = utils.parseLogs(txReceipt, wallet, "AuthorisedModule");
      const upgraderAuthorisedLogIndex = logs.findIndex((e) => e.module === upgrader1.address && e.value === true);
      const upgraderUnauthorisedLogIndex = logs.findIndex((e) => e.module === upgrader1.address && e.value === false);
      if (!relayed || useOnlyOwnerModule) {
        assert.isBelow(upgraderAuthorisedLogIndex, upgraderUnauthorisedLogIndex,
          "AuthorisedModule(upgrader, false) should come after AuthorisedModule(upgrader, true)");
      } else {
        assert.equal(upgraderUnauthorisedLogIndex, -1, "AuthorisedModule(upgrader, false) should not have been emitted");
        assert.equal(upgraderAuthorisedLogIndex, -1, "AuthorisedModule(upgrader, true) should not have been emitted");
      }

      // test if the upgrade worked
      const isV1Authorised = await wallet.authorised(moduleV1.address);
      const isV2Authorised = await wallet.authorised(moduleV2.address);
      const isUpgraderAuthorised = await wallet.authorised(upgrader1.address);
      const numModules = await wallet.modules();
      assert.equal(isV1Authorised, relayed && !useOnlyOwnerModule, "moduleV1 should only be unauthorised if the upgrade went through");
      assert.equal(isV2Authorised, !relayed || useOnlyOwnerModule, "moduleV2 should only be authorised if the upgrade went through");
      assert.equal(isUpgraderAuthorised, false, "upgrader should not be authorised");
      assert.equal(numModules, 2, "only two module (moduleV2 and relayerModule) should be authorised");
    }

    it("should upgrade modules (blockchain tx)", async () => {
      await testUpgradeModule({ relayed: false, useOnlyOwnerModule: false });
    });

    it("should upgrade modules (not using OnlyOwnerModule, relayed tx)", async () => {
      await testUpgradeModule({ relayed: true, useOnlyOwnerModule: false });
    });

    it("should upgrade modules (using OnlyOwnerModule, relayed tx)", async () => {
      await testUpgradeModule({ relayed: true, useOnlyOwnerModule: true });
    });

    it("should ignore duplicate modules in upgrader (blockchain tx)", async () => {
      // we intentionally try to add moduleV2 twice to check that it will only be authorised once
      await testUpgradeModule({ relayed: false, useOnlyOwnerModule: false, modulesToAdd: (v2) => [v2, v2] });
    });

    it("should not upgrade to 0 module (blockchain tx)", async () => {
      // we intentionally try to add 0 module, this should fail
      await testUpgradeModule({ relayed: false, useOnlyOwnerModule: true, modulesToAdd: (v2) => [] }); // eslint-disable-line no-unused-vars
    });

    it("should not upgrade to 0 module (relayed tx)", async () => {
      // we intentionally try to add 0 module, this should fail
      await testUpgradeModule({ relayed: true, useOnlyOwnerModule: true, modulesToAdd: (v2) => [] }); // eslint-disable-line no-unused-vars
    });
  });

  describe("Upgrading when wallet is locked", () => {
    let guardianManager;
    let lockManager;
    let recoveryManager;
    let moduleV2;
    const guardian = accounts[2];
    const newowner = accounts[3];

    beforeEach(async () => {
      // Setup the modules for wallet
      guardianManager = await GuardianManager.new(registry.address, guardianStorage.address, 24, 12);
      lockManager = await LockManager.new(registry.address, guardianStorage.address, 24 * 5);
      recoveryManager = await RecoveryManager.new(registry.address, guardianStorage.address, 36, 24 * 5);

      // Setup the wallet with the initial set of modules
      await wallet.init(owner,
        [
          relayerModule.address,
          guardianManager.address,
          lockManager.address,
          recoveryManager.address,
        ]);
      await guardianManager.addGuardian(wallet.address, guardian, { from: owner });

      // Setup module v2 for the upgrade
      moduleV2 = await Module.new(registry.address, guardianStorage.address, false, 0);
      await registry.registerModule(moduleV2.address, formatBytes32String("V2"));
    });

    it("should not be able to upgrade if wallet is locked by guardian", async () => {
      const upgrader = await SimpleUpgrader.new(registry.address, [lockManager.address], [moduleV2.address]);
      await registry.registerModule(upgrader.address, formatBytes32String("V1toV2"));

      // Guardian locks the wallet
      await lockManager.lock(wallet.address, { from: guardian });

      // Try to upgrade while wallet is locked
      await assert.revertWith(lockManager.addModule(wallet.address, upgrader.address, { from: owner }), "BM: wallet locked");

      // Check wallet is still locked
      const locked = await lockManager.isLocked(wallet.address);
      assert.isTrue(locked);
      // Check upgrade failed
      const isV1Authorised = await wallet.authorised(lockManager.address);
      const isV2Authorised = await wallet.authorised(moduleV2.address);
      assert.isTrue(isV1Authorised);
      assert.isFalse(isV2Authorised);
    });

    it("should not be able to upgrade if wallet is under recovery", async () => {
      const upgrader = await SimpleUpgrader.new(
        registry.address,
        [recoveryManager.address],
        [moduleV2.address],
      );
      await registry.registerModule(upgrader.address, formatBytes32String("V1toV2"));

      // Put the wallet under recovery
      await manager.relay(recoveryManager, "executeRecovery", [wallet.address, newowner.address], wallet, [guardian]);
      // check that the wallet is locked
      let locked = await lockManager.isLocked(wallet.address);
      assert.isTrue(locked, "wallet should be locked");

      // Try to upgrade while wallet is under recovery
      await assert.revertWith(recoveryManager.addModule(wallet.address, upgrader.address, { from: owner }), "BM: wallet locked");

      // Check wallet is still locked
      locked = await lockManager.isLocked(wallet.address);
      assert.isTrue(locked, "wallet should still be locked");

      // Check upgrade failed
      const isV1Authorised = await wallet.authorised(recoveryManager.address);
      const isV2Authorised = await wallet.authorised(moduleV2.address);
      assert.isTrue(isV1Authorised);
      assert.isFalse(isV2Authorised);
    });
  });
});
