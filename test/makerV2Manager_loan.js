/* global artifacts */

const ethers = require("ethers");
const { bigNumToBytes32, ETH_TOKEN, parseLogs, increaseTime, getBalance, assertRevert } = require("../utils/utilities.js");
const {
  deployMaker, deployUniswap, RAY, ETH_PER_DAI, ETH_PER_MKR,
} = require("../utils/defi-deployer");

const { parseEther, formatBytes32String } = ethers.utils;
const { HashZero, AddressZero } = ethers.constants;

const RelayManager = require("../utils/relay-manager");

const GemJoin = artifacts.require("GemJoin");
const Registry = artifacts.require("ModuleRegistry");
const MakerV1Manager = require("../build-legacy/v1.6.0/MakerManager");

const MakerV2Manager = artifacts.require("MakerV2Manager");
const UpgradedMakerV2Manager = artifacts.require("TestUpgradedMakerV2Manager");
const MakerRegistry = artifacts.require("MakerRegistry");
const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const FakeWallet = artifacts.require("FakeWallet");
const GuardianStorage = artifacts.require("GuardianStorage");
const TransferStorage = artifacts.require("TransferStorage");
const LimitStorage = artifacts.require("LimitStorage");
const TokenPriceStorage = artifacts.require("TokenPriceStorage");
const TransferManager = artifacts.require("TransferManager");
const BadModule = artifacts.require("TestModule");
const RelayerModule = artifacts.require("RelayerModule");

contract("MakerV2Loan", (accounts) => {
  const manager = new RelayManager();
  const { deployer } = manager;

  const infrastructure = accounts[0];
  const owner = accounts[1];
  const owner2 = accounts[2];

  let sai;
  let dai;
  let gov;
  let bat;
  let weth;
  let vat;
  let batJoin;
  let cdpManager;
  let pot;
  let jug;
  let migration;
  let registry;
  let transferManager;
  let guardianStorage;
  let makerV1;
  let makerV2;
  let wallet;
  let walletImplementation;
  let walletAddress;
  let makerRegistry;
  let uniswapFactory;
  let relayerModule;

  before(async () => {
    // Deploy Maker
    const mk = await deployMaker(deployer, infrastructure);
    [sai, dai, gov, bat, weth, vat, batJoin, cdpManager, pot, jug, migration] = [
      mk.sai, mk.dai, mk.gov, mk.bat, mk.weth, mk.vat, mk.batJoin, mk.cdpManager, mk.pot, mk.jug, mk.migration,
    ];
    const { wethJoin, tub } = mk;

    // Deploy Uniswap
    const uni = await deployUniswap(deployer, manager, infrastructure, [gov, dai], [ETH_PER_MKR, ETH_PER_DAI]);
    uniswapFactory = uni.uniswapFactory;

    // Deploy MakerV2Manager
    registry = await Registry.new();
    guardianStorage = await GuardianStorage.new();
    makerRegistry = await MakerRegistry.new(vat.address);
    await makerRegistry.addCollateral(wethJoin.address);
    makerV2 = await MakerV2Manager.new(
      registry.address,
      guardianStorage.address,
      migration.address,
      pot.address,
      jug.address,
      makerRegistry.address,
      uniswapFactory.address,
    );

    // Deploy MakerManager
    makerV1 = await MakerV1Manager.new(
      registry.address,
      guardianStorage.address,
      tub.address,
      uniswapFactory.address,
    );

    // Deploy TransferManager
    const transferStorage = await TransferStorage.new();
    const limitStorage = await LimitStorage.new();
    const tokenPriceStorage = await TokenPriceStorage.new();
    transferManager = await TransferManager.new(
      AddressZero,
      transferStorage.address,
      guardianStorage.address,
      limitStorage.address,
      tokenPriceStorage.address,
      3600,
      3600,
      10000,
      AddressZero,
      AddressZero,
    );

    walletImplementation = await BaseWallet.new();

    relayerModule = await RelayerModule.new(
      registry.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero,
    );
    manager.setRelayerModule(relayerModule);
  });

  beforeEach(async () => {
    const proxy = await Proxy.new(walletImplementation.address);
    wallet = await BaseWallet.at(proxy.address);

    await wallet.init(owner,
      [
        makerV1.address,
        makerV2.address,
        transferManager.address,
        relayerModule.address,
      ]);
    walletAddress = wallet.address;
    await wallet.send(parseEther("2.0"));
  });

  async function getTestAmounts(tokenAddress) {
    const tokenAddress_ = (tokenAddress === ETH_TOKEN) ? weth.address : tokenAddress;
    const { ilk } = await makerRegistry.collaterals(tokenAddress_);
    const { spot, dust } = await vat.ilks(ilk);
    const daiAmount = dust.div(RAY);
    const collateralAmount = dust.div(spot).mul(2);
    return { daiAmount, collateralAmount };
  }

  async function testOpenLoan({
    collateralAmount, daiAmount, relayed, collateral = { contractAddress: ETH_TOKEN },
  }) {
    const beforeCollateral = (collateral.address === ETH_TOKEN)
      ? await getBalance(walletAddress)
      : await collateral.balanceOf(walletAddress);

    const beforeDAI = await dai.balanceOf(walletAddress);
    const beforeDAISupply = await dai.totalSupply();

    const method = "openLoan";
    const params = [walletAddress, collateral.address, collateralAmount, dai.address, daiAmount];
    let txReceipt;
    if (relayed) {
      txReceipt = await manager.relay(makerV2, method, params, wallet, [owner]);
      const { success } = (await parseLogs(txReceipt, relayerModule, "TransactionExecuted"))[0];
      assert.isTrue(success, "Relayed tx should succeed");
    } else {
      txReceipt = await (await makerV2[method](...params, { gasLimit: 2000000, from: owner })).wait();
    }
    const loanId = (await parseLogs(txReceipt, makerV2, "LoanOpened"))[0]._loanId;
    assert.isDefined(loanId, "Loan ID should be defined");

    const afterCollateral = (collateral.address === ETH_TOKEN)
      ? await getBalance(walletAddress)
      : await collateral.balanceOf(walletAddress);
    const afterDAI = await dai.balanceOf(walletAddress);
    const afterDAISupply = await dai.totalSupply();

    assert.equal(
      beforeCollateral.sub(afterCollateral).toString(),
      collateralAmount.toString(),
      `wallet should have ${collateralAmount} less collateral (relayed: ${relayed})`,
    );
    assert.equal(
      afterDAI.sub(beforeDAI).toString(),
      daiAmount.toString(),
      `wallet should have ${daiAmount} more DAI (relayed: ${relayed})`,
    );
    assert.equal(
      afterDAISupply.sub(beforeDAISupply).toString(),
      daiAmount.toString(),
      `${daiAmount} DAI should have been minted (relayed: ${relayed})`,
    );

    return loanId;
  }

  describe("Open Loan", () => {
    let daiAmount;
    let collateralAmount;
    before(async () => {
      const testAmounts = await getTestAmounts(ETH_TOKEN);
      daiAmount = testAmounts.daiAmount;
      collateralAmount = testAmounts.collateralAmount;
    });

    it("should open a Loan (blockchain tx)", async () => {
      await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
    });

    it("should open a Loan (relayed tx)", async () => {
      await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
    });

    it("should open>close>reopen a Loan (blockchain tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      await makerV2.closeLoan(walletAddress, loanId, { gasLimit: 4500000, from: owner });
      await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
    });

    it("should open>close>reopen a Loan (relayed tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
      await (await makerV2.closeLoan(walletAddress, loanId, { gasLimit: 4500000, from: owner })).wait();
      await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
    });

    it("should not open a loan for the wrong debt token", async () => {
      await assertRevert(
        makerV2.openLoan(walletAddress, ETH_TOKEN, collateralAmount, sai.address, daiAmount, { from: owner }),
        "MV2: debt token not DAI",
      );
    });

    it("should not open a loan for an unsupported collateral token", async () => {
      await assertRevert(
        makerV2.openLoan(walletAddress, sai.address, collateralAmount, dai.address, daiAmount, { from: owner }),
        "MV2: unsupported collateral",
      );
    });
  });

  async function testChangeCollateral({
    loanId, collateralAmount, add, relayed, collateral = { contractAddress: ETH_TOKEN }, makerV2Manager = makerV2,
  }) {
    const beforeCollateral = (collateral.address === ETH_TOKEN)
      ? await getBalance(walletAddress)
      : await collateral.balanceOf(walletAddress);

    const method = add ? "addCollateral" : "removeCollateral";
    const params = [wallet.address, loanId, collateral.address, collateralAmount];
    if (relayed) {
      const txR = await manager.relay(makerV2Manager, method, params, wallet, [owner]);
      assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
    } else {
      await makerV2Manager[method](...params, { gasLimit: 2000000, from: owner });
    }

    const afterCollateral = (collateral.address === ETH_TOKEN)
      ? await getBalance(walletAddress)
      : await collateral.balanceOf(walletAddress);

    const expectedCollateralChange = collateralAmount.mul(add ? -1 : 1).toString();
    assert.equal(
      afterCollateral.sub(beforeCollateral).toString(),
      expectedCollateralChange,
      `wallet collateral should have changed by ${expectedCollateralChange} (relayed: ${relayed})`,
    );
  }

  describe("Add/Remove Collateral", () => {
    let daiAmount;
    let collateralAmount;

    before(async () => {
      const testAmounts = await getTestAmounts(ETH_TOKEN);
      daiAmount = testAmounts.daiAmount;
      collateralAmount = testAmounts.collateralAmount;
    });

    it("should add collateral (blockchain tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      await testChangeCollateral({
        loanId, collateralAmount: parseEther("0.010"), add: true, relayed: false,
      });
    });

    it("should add collateral (relayed tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
      await testChangeCollateral({
        loanId, collateralAmount: parseEther("0.010"), add: true, relayed: true,
      });
    });

    it("should not add collateral for the wrong loan owner", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      const proxy = await Proxy.new(walletImplementation.address);
      const wallet2 = await BaseWallet.at(proxy.address);

      await wallet2.init(owner2, [makerV2.address]);
      await assertRevert(
        makerV2.addCollateral(wallet2.address, loanId, ETH_TOKEN, parseEther("0.010"), { from: owner2 }),
        "MV2: unauthorized loanId",
      );
    });

    it("should remove collateral (blockchain tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      await testChangeCollateral({
        loanId, collateralAmount: parseEther("0.010"), add: false, relayed: false,
      });
    });

    it("should remove collateral (relayed tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
      await testChangeCollateral({
        loanId, collateralAmount: parseEther("0.010"), add: false, relayed: true,
      });
    });

    it("should not remove collateral with invalid collateral amount", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      await assertRevert(
        makerV2.removeCollateral(walletAddress, loanId, ETH_TOKEN, ethers.BigNumber.from(2).pow(255), { from: owner }),
        "MV2: int overflow",
      );
    });

    it("should not remove collateral for the wrong loan owner", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      const proxy = await Proxy.new(walletImplementation.address);
      const wallet2 = await BaseWallet.at(proxy.address);

      await wallet2.init(owner2, [makerV2.address]);
      await assertRevert(
        makerV2.removeCollateral(wallet2.address, loanId, ETH_TOKEN, parseEther("0.010"), { from: owner2 }),
        "MV2: unauthorized loanId",
      );
    });
  });

  async function testChangeDebt({
    loanId, daiAmount, add, relayed,
  }) {
    const beforeDAI = await dai.balanceOf(wallet.address);
    const beforeETH = await getBalance(wallet.address);
    const method = add ? "addDebt" : "removeDebt";
    const params = [wallet.address, loanId, dai.address, daiAmount];
    if (relayed) {
      const txR = await manager.relay(makerV2, method, params, { contractAddress: walletAddress }, [owner]);
      assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
    } else {
      await makerV2[method](...params, { gasLimit: 2000000, from: owner });
    }
    const afterDAI = await dai.balanceOf(wallet.address);
    const afterETH = await getBalance(wallet.address);
    if (add) {
      assert.equal(
        afterDAI.sub(beforeDAI).toString(),
        daiAmount.toString(),
        `wallet DAI should have increased by ${daiAmount.toString()} (relayed: ${relayed})`,
      );
    } else {
      assert.isTrue(
        afterDAI.lt(beforeDAI) || afterETH.lt(beforeETH),
        `wallet DAI or ETH should have decreased (relayed: ${relayed})`,
      );
    }
  }

  describe("Increase Debt", () => {
    let daiAmount;
    let collateralAmount;

    before(async () => {
      const testAmounts = await getTestAmounts(ETH_TOKEN);
      daiAmount = testAmounts.daiAmount;
      collateralAmount = testAmounts.collateralAmount;
    });

    it("should increase debt (blockchain tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      await testChangeDebt({
        loanId, daiAmount: parseEther("0.5"), add: true, relayed: false,
      });
    });

    it("should increase debt (relayed tx)", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
      await testChangeDebt({
        loanId, daiAmount: parseEther("0.5"), add: true, relayed: true,
      });
    });

    it("should not increase debt for the wrong loan owner", async () => {
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      const proxy = await Proxy.new(walletImplementation.address);
      const wallet2 = await BaseWallet.at(proxy.address);

      await wallet2.init(owner2, [makerV2.address]);
      await assertRevert(
        makerV2.addDebt(wallet2.address, loanId, ETH_TOKEN, parseEther("0.010"), { from: owner2 }),
        "MV2: unauthorized loanId",
      );
    });
  });

  async function testRepayDebt({ useDai, relayed }) {
    const { collateralAmount, daiAmount: daiAmount_ } = await getTestAmounts(ETH_TOKEN);
    const daiAmount = daiAmount_.add(parseEther("0.3"));

    const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed });
    if (!useDai) {
      // move the borrowed DAI from the wallet to the owner
      await transferManager.transferToken(walletAddress, dai.address, owner, daiAmount, HashZero, { gasLimit: 3000000, from: owner });
      // give some ETH to the wallet to be used for repayment
      await wallet.send(collateralAmount);
    }
    await increaseTime(3); // wait 3 seconds
    const beforeDAI = await dai.balanceOf(wallet.address);
    const beforeETH = await getBalance(wallet.address);
    await testChangeDebt({
      loanId, daiAmount: parseEther("0.2"), add: false, relayed,
    });

    const afterDAI = await dai.balanceOf(wallet.address);
    const afterETH = await getBalance(wallet.address);

    if (useDai) assert.isTrue(afterDAI.lt(beforeDAI) && afterETH.eq(beforeETH), "should have less DAI");
    else assert.isTrue(afterDAI.eq(beforeDAI) && afterETH.lt(beforeETH), "should have less ETH");
  }

  describe("Repay Debt", () => {
    it("should repay debt when paying fee in DAI (blockchain tx)", async () => {
      await testRepayDebt({ useDai: true, relayed: false });
    });

    it("should repay debt when paying fee in DAI (relayed tx)", async () => {
      await testRepayDebt({ useDai: true, relayed: true });
    });

    it("should repay debt when paying fee in ETH (blockchain tx)", async () => {
      await testRepayDebt({ useDai: false, relayed: false });
    });

    it("should repay debt when paying fee in ETH (relayed tx)", async () => {
      await testRepayDebt({ useDai: false, relayed: true });
    });

    it("should not repay debt when only dust left", async () => {
      const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      await assertRevert(
        makerV2.removeDebt(walletAddress, loanId, dai.address, daiAmount.sub(1), { from: owner }),
        "MV2: repay less or full",
      );
    });

    it("should not repay debt for the wrong loan owner", async () => {
      const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      const proxy = await Proxy.new(walletImplementation.address);
      const wallet2 = await BaseWallet.at(proxy.address);

      await wallet2.init(owner2, [makerV2.address]);
      await assertRevert(
        makerV2.removeDebt(wallet2.address, loanId, ETH_TOKEN, parseEther("0.010"), { from: owner2 }),
        "MV2: unauthorized loanId",
      );
    });
  });

  async function testCloseLoan({ useDai, relayed }) {
    const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
    const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed });
    // give some ETH to the wallet to be used for repayment
    await wallet.send(collateralAmount.mul(2));
    if (!useDai) {
      // move the borrowed DAI from the wallet to the owner
      await transferManager.transferToken(walletAddress, dai.address, owner, daiAmount, HashZero, { gasLimit: 3000000, from: owner });
    }
    await increaseTime(3); // wait 3 seconds
    const beforeDAI = await dai.balanceOf(wallet.address);
    const beforeETH = await getBalance(wallet.address);
    const method = "closeLoan";
    const params = [wallet.address, loanId];
    if (relayed) {
      const txR = await manager.relay(makerV2, method, params, { contractAddress: walletAddress }, [owner]);
      assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
    } else {
      await makerV2[method](...params, { gasLimit: 3000000, from: owner });
    }
    const afterDAI = await dai.balanceOf(wallet.address);
    const afterETH = await getBalance(wallet.address);

    if (useDai) assert.isTrue(afterDAI.lt(beforeDAI) && afterETH.sub(collateralAmount).lt(beforeETH), "should have spent some DAI and some ETH");
    else assert.isTrue(afterDAI.eq(beforeDAI) && afterETH.sub(collateralAmount).lt(beforeETH), "should have spent some ETH");
  }

  describe("Close Vaults", () => {
    it("should close a vault when paying fee in DAI + ETH (blockchain tx)", async () => {
      await testCloseLoan({ useDai: true, relayed: false });
    });

    it("should close a vault when paying fee in DAI + ETH (relayed tx)", async () => {
      await testCloseLoan({ useDai: true, relayed: true });
    });

    it("should close a vault when paying fee in ETH (blockchain tx)", async () => {
      await testCloseLoan({ useDai: false, relayed: false });
    });

    it("should close a vault when paying fee in ETH (relayed tx)", async () => {
      await testCloseLoan({ useDai: false, relayed: true });
    });

    it("should not close a vault for the wrong loan owner", async () => {
      const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
      const loanId = await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      const proxy = await Proxy.new(walletImplementation.address);
      const wallet2 = await BaseWallet.at(proxy.address);

      await wallet2.init(owner2, [makerV2.address]);
      await assertRevert(
        makerV2.closeLoan(wallet2.address, loanId, { from: owner2 }),
        "MV2: unauthorized loanId",
      );
    });
  });

  describe("MakerRegistry", () => {
    it("should add a new collateral token", async () => {
      const numCollateralBefore = (await makerRegistry.getCollateralTokens()).length;
      await makerRegistry.addCollateral(batJoin.address);
      const numCollateralAfter = (await makerRegistry.getCollateralTokens()).length;
      assert.equal(numCollateralAfter, numCollateralBefore + 1, "A new collateral should have been added");
      await makerRegistry.removeCollateral(bat.address); // cleanup
    });

    it("should open a loan with a newly added collateral token", async () => {
      await makerRegistry.addCollateral(batJoin.address);
      const { daiAmount, collateralAmount } = await getTestAmounts(bat.address);
      await bat["mint(address,uint256)"](walletAddress, collateralAmount);
      await testOpenLoan({
        collateralAmount, daiAmount, collateral: bat, relayed: false,
      });
      await makerRegistry.removeCollateral(bat.address); // cleanup
    });

    it("should not add a collateral when Join is not in the Vat", async () => {
      const badJoin = await GemJoin.new(vat.address, formatBytes32String("BAD"), bat.address);
      await assertRevert(makerRegistry.addCollateral(badJoin.address), "MR: _joinAdapter not authorised in vat");
    });

    it("should not add a duplicate collateral", async () => {
      await makerRegistry.addCollateral(batJoin.address);
      await assertRevert(makerRegistry.addCollateral(batJoin.address), "MR: collateral already added");
      await makerRegistry.removeCollateral(bat.address); // cleanup
    });

    it("should remove a collateral", async () => {
      const numCollateralBefore = (await makerRegistry.getCollateralTokens()).length;
      await makerRegistry.addCollateral(batJoin.address);
      await makerRegistry.removeCollateral(bat.address);
      const numCollateralAfter = (await makerRegistry.getCollateralTokens()).length;
      assert.equal(numCollateralAfter, numCollateralBefore, "The added collateral should have been removed");
    });

    it("should not remove a non-existing collateral", async () => {
      await assertRevert(makerRegistry.removeCollateral(bat.address), "MR: collateral does not exist");
    });
  });

  describe("Acquiring a wallet's vault", () => {
    async function testAcquireVault({ relayed }) {
      // Create the vault with `owner` as owner
      const { ilk } = await makerRegistry.collaterals(weth.address);
      let txR = await (await cdpManager.open(ilk, owner, { from: owner })).wait();
      const vaultId = txR.events.find((e) => e.event === "NewCdp").args.cdp;
      // Transfer the vault to the wallet
      await cdpManager.give(vaultId, walletAddress, { from: owner });
      // Transfer the vault to the module
      const loanId = bigNumToBytes32(vaultId);
      const method = "acquireLoan";
      const params = [walletAddress, loanId];
      if (relayed) {
        txR = await manager.relay(makerV2, method, params, { contractAddress: walletAddress }, [owner]);
        assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
      } else {
        await makerV2[method](...params, { gasLimit: 1000000, from: owner });
      }
      // The loanId held by the MakerV2Manager will be different from the transferred vault id, in case the latter was merged into an existing vault
      const moduleLoanId = await makerV2.loanIds(walletAddress, ilk);
      // Add some collateral and debt
      const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
      await testChangeCollateral({
        loanId: moduleLoanId, collateralAmount, add: true, relayed, makerV2,
      });
      await testChangeDebt({
        loanId: moduleLoanId, daiAmount, add: true, relayed,
      });
    }

    it("should transfer a vault from a wallet to the module (blockchain tx)", async () => {
      await testAcquireVault({ relayed: false });
    });

    it("should transfer a vault from a wallet to the module (relayed tx)", async () => {
      await testAcquireVault({ relayed: true });
    });

    it("should not transfer a vault that is not owned by the wallet", async () => {
      // Create the vault with `owner` as owner
      const { ilk } = await makerRegistry.collaterals(weth.address);
      const txR = await (await cdpManager.open(ilk, owner, { from: owner })).wait();
      const vaultId = txR.events.find((e) => e.event === "NewCdp").args.cdp;
      const loanId = bigNumToBytes32(vaultId);
      // We are NOT transferring the vault from the owner to the wallet
      await assertRevert(
        makerV2.acquireLoan(walletAddress, loanId, { from: owner }), "MV2: wrong vault owner",
      );
    });

    it("should not transfer a vault that is not given to the module", async () => {
      // Deploy a fake wallet
      const fakeWallet = await FakeWallet.new(false, AddressZero, 0, "0x00");
      await fakeWallet.init(owner, [makerV2.address]);
      // Create the vault with `owner` as owner
      const { ilk } = await makerRegistry.collaterals(weth.address);
      const txR = await (await cdpManager.open(ilk, owner, { from: owner })).wait();
      const vaultId = txR.events.find((e) => e.event === "NewCdp").args.cdp;
      const loanId = bigNumToBytes32(vaultId);
      // Transfer the vault to the fake wallet
      await cdpManager.give(vaultId, fakeWallet.address, { from: owner });
      await assertRevert(
        makerV2.acquireLoan(fakeWallet.address, loanId, { from: owner }), "MV2: failed give",
      );
    });

    it("should transfer (merge) a vault when already holding a vault in the module (blockchain tx)", async () => {
      const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
      await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      await testAcquireVault({ relayed: false });
    });

    it("should transfer (merge) a vault when already holding a vault in the module (relayed tx)", async () => {
      const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
      await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
      await testAcquireVault({ relayed: true });
    });

    it("should not allow reentrancy in acquireLoan", async () => {
      // Deploy a fake wallet capable of reentrancy
      const acquireLoanCallData = makerV2.contract.methods.acquireLoan([AddressZero, bigNumToBytes32(ethers.BigNumber.from(0))]).encodeABI();
      const fakeWallet = await FakeWallet.new(true, makerV2.address, 0, acquireLoanCallData);
      await fakeWallet.init(owner, [makerV2.address]);
      // Create the vault with `owner` as owner
      const { ilk } = await makerRegistry.collaterals(weth.address);
      const txR = await (await cdpManager.open(ilk, owner, { from: owner })).wait();
      const vaultId = txR.events.find((e) => e.event === "NewCdp").args.cdp;
      const loanId = bigNumToBytes32(vaultId);
      // Transfer the vault to the fake wallet
      await cdpManager.give(vaultId, fakeWallet.address, { from: owner });
      await assertRevert(
        makerV2.acquireLoan(fakeWallet.address, loanId, { from: owner }), "MV2: reentrant call",
      );
    });
  });

  describe("Migrating an SCD CDP to an MCD vault", () => {
    let oldCdpId;

    beforeEach(async () => {
      // Opening SCD CDP
      const { daiAmount, collateralAmount } = await getTestAmounts(ETH_TOKEN);
      const params = [walletAddress, ETH_TOKEN, collateralAmount, sai.address, daiAmount];
      const txReceipt = await (await makerV1.openLoan(...params, { gasLimit: 2000000, from: owner })).wait();
      oldCdpId = (await parseLogs(txReceipt, makerV1, "LoanOpened"))[0]._loanId;
      assert.isDefined(oldCdpId, "The old CDP ID should be defined");
    });

    async function testMigrateCdp({ relayed }) {
      const method = "migrateCdp";
      const params = [walletAddress, oldCdpId];
      let txReceipt;
      if (relayed) {
        txReceipt = await manager.relay(makerV2, method, params, wallet, [owner]);
        const { success } = (await parseLogs(txReceipt, relayerModule, "TransactionExecuted"))[0];
        assert.isTrue(success, "Relayed tx should succeed");
      } else {
        txReceipt = await (await makerV2[method](...params, { gasLimit: 2000000, from: owner })).wait();
      }
      const loanId = (await parseLogs(txReceipt, makerV2, "CdpMigrated"))[0]._newVaultId;
      assert.isDefined(loanId, "The new vault ID should be defined");

      // Add some collateral and debt
      const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
      await testChangeCollateral({
        loanId, collateralAmount, add: true, relayed, makerV2,
      });
      await testChangeDebt({
        loanId, daiAmount, add: true, relayed,
      });
    }

    it("should migrate a CDP (blockchain tx)", async () => {
      await testMigrateCdp({ relayed: false });
    });

    it("should migrate a CDP (relayed tx)", async () => {
      await testMigrateCdp({ relayed: true });
    });

    it("should migrate a CDP when already holding a vault in the module (blockchain tx)", async () => {
      const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
      await testOpenLoan({ collateralAmount, daiAmount, relayed: false });
      await testMigrateCdp({ relayed: false });
    });

    it("should migrate a CDP when already holding a vault in the module (relayed tx)", async () => {
      const { collateralAmount, daiAmount } = await getTestAmounts(ETH_TOKEN);
      await testOpenLoan({ collateralAmount, daiAmount, relayed: true });
      await testMigrateCdp({ relayed: true });
    });
  });

  describe("Upgrade of MakerV2Manager", () => {
    let upgradedMakerV2;
    let daiAmount;
    let collateralAmount;

    beforeEach(async () => {
      // Generate test amounts
      const testAmounts = await getTestAmounts(ETH_TOKEN);
      daiAmount = testAmounts.daiAmount;
      collateralAmount = testAmounts.collateralAmount;

      // Deploy and register the upgraded MakerV2 module
      upgradedMakerV2 = await UpgradedMakerV2Manager.new(
        registry.address,
        guardianStorage.address,
        migration.address,
        pot.address,
        jug.address,
        makerRegistry.address,
        uniswapFactory.address,
        makerV2.address,
        { gasLimit: 10700000 },
      );
      await registry.registerModule(upgradedMakerV2.address, formatBytes32String("UpgradedMakerV2Manager"));

      // Adding BAT to the registry of supported collateral tokens
      if (!(await makerRegistry.collaterals(bat.address)).exists) {
        await makerRegistry.addCollateral(batJoin.address);
      }
    });

    async function testUpgradeModule({ relayed, withBatVault = false }) {
      // Open a WETH vault with the old MakerV2 module
      const loanId1 = await testOpenLoan({ collateralAmount, daiAmount, relayed });
      let loanId2;
      if (withBatVault) {
        // Open a BAT vault with the old MakerV2 module
        const batTestAmounts = await getTestAmounts(bat.address);
        await bat["mint(address,uint256)"](walletAddress, batTestAmounts.collateralAmount.add(parseEther("0.01")));
        loanId2 = await testOpenLoan({
          collateralAmount: batTestAmounts.collateralAmount,
          daiAmount: batTestAmounts.daiAmount,
          collateral: bat,
          relayed,
        });
      }

      // Add the upgraded module
      const method = "addModule";
      const params = [walletAddress, upgradedMakerV2.address];
      if (relayed) {
        const txR = await manager.relay(makerV2, method, params, wallet, [owner]);
        assert.isTrue(txR.events.find((e) => e.event === "TransactionExecuted").args.success, "Relayed tx should succeed");
      } else {
        await makerV2[method](...params, { gasLimit: 2000000, from: owner });
      }

      // Make sure that the vaults can be manipulated from the upgraded module
      await testChangeCollateral({
        loanId: loanId1,
        collateralAmount: parseEther("0.010"),
        add: true,
        relayed,
        makerV2Manager: upgradedMakerV2,
      });
      await upgradedMakerV2.closeLoan(walletAddress, loanId1, { gasLimit: 4500000, from: owner });

      if (withBatVault) {
        await testChangeCollateral({
          loanId: loanId2,
          collateralAmount: parseEther("0.010"),
          add: true,
          relayed,
          collateral: bat,
          makerV2Manager: upgradedMakerV2,
        });
        await upgradedMakerV2.closeLoan(walletAddress, loanId2, { gasLimit: 4500000, from: owner });
      }
    }

    it("should move a vault after a module upgrade (blockchain tx)", async () => {
      await testUpgradeModule({ relayed: false });
    });

    it("should move a vault after a module upgrade (relayed tx)", async () => {
      await testUpgradeModule({ relayed: true });
    });

    it("should move 2 vaults after a module upgrade (blockchain tx)", async () => {
      await testUpgradeModule({ withBatVault: true, relayed: false });
    });

    it("should move 2 vaults after a module upgrade (relayed tx)", async () => {
      await testUpgradeModule({ withBatVault: true, relayed: true });
    });

    it("should not allow non-module to give vault", async () => {
      await assertRevert(makerV2.giveVault(walletAddress, formatBytes32String(""), { from: owner }), "BM: must be a wallet module");
    });

    it("should not allow (fake) module to give unowned vault", async () => {
      // Deploy and register a (fake) bad module
      const badModule = await BadModule.new(registry.address, guardianStorage.address, false, 0);
      await registry.registerModule(badModule.address, formatBytes32String("BadModule"));
      // Add the bad module to the wallet
      await makerV2.addModule(walletAddress, badModule.address, { gasLimit: 2000000, from: owner });
      // Use the bad module to attempt a bad giveVault call
      const callData = makerV2.contract.methods.giveVault([walletAddress, bigNumToBytes32(ethers.BigNumber.from(666))]).encodeABI();
      await assertRevert(badModule.callContract(makerV2.address, 0, callData, { from: owner }), "MV2: unauthorized loanId");
    });
  });
});
