/* global artifacts */

const BaseWallet = artifacts.require("BaseWallet");
const ModuleRegistry = artifacts.require("ModuleRegistry");
const CompoundRegistry = artifacts.require("CompoundRegistry");
const MultiSig = artifacts.require("MultiSigWallet");
const ENS = artifacts.require("ENSRegistryWithFallback");
const ENSManager = artifacts.require("ArgentENSManager");
const ENSResolver = artifacts.require("ArgentENSResolver");
const WalletFactory = require("../build-legacy/v1.6.0/WalletFactory");
const TokenPriceProvider = require("../build-legacy/v1.6.0/TokenPriceProvider");

const MakerRegistry = artifacts.require("MakerRegistry");
const ScdMcdMigration = artifacts.require("ScdMcdMigration");

const utils = require("../utils/utilities.js");

const DeployManager = require("../utils/deploy-manager.js");
const MultisigExecutor = require("../utils/multisigexecutor.js");

const deploy = async (network) => {
  // //////////////////////////////////
  // Setup
  // //////////////////////////////////

  const manager = new DeployManager(network);
  await manager.setup();

  const { configurator } = manager;
  const { deployer } = manager;
  const { abiUploader } = manager;
  const { gasPrice } = deployer.defaultOverrides;

  const newConfig = configurator.config;
  const prevConfig = configurator.copyConfig();
  console.log("Previous Config:", prevConfig);

  const deploymentWallet = deployer.signer;
  const deploymentAccount = await deploymentWallet.getAddress();
  const walletRootEns = prevConfig.ENS.domain;

  // //////////////////////////////////
  // Deploy contracts
  // //////////////////////////////////

  // Deploy the Base Wallet Library
  const BaseWalletWrapper = await BaseWallet.new();
  // Deploy the MultiSig
  const MultiSigWrapper = await MultiSig.new(newConfig.multisig.threshold, newConfig.multisig.owners);
  // Deploy TokenPriceProvider
  const TokenPriceProviderWrapper = await TokenPriceProvider.new(
    newConfig.Kyber ? newConfig.Kyber.contract : "0x0000000000000000000000000000000000000000",
  );
  // Deploy Module Registry
  const ModuleRegistryWrapper = await ModuleRegistry.new();
  // Deploy Compound Registry
  const CompoundRegistryWrapper = await CompoundRegistry.new();
  // Deploy the ENS Resolver
  const ENSResolverWrapper = await ENSResolver.new();
  // Deploy the ENS Manager
  const ENSManagerWrapper = await ENSManager.new(
    walletRootEns, utils.namehash(walletRootEns), newConfig.ENS.ensRegistry, ENSResolverWrapper.address);
  // Deploy the Wallet Factory
  const WalletFactoryWrapper = await WalletFactory.new(
    ModuleRegistryWrapper.address, BaseWalletWrapper.address, ENSManagerWrapper.address);

  // Deploy and configure Maker Registry
  const ScdMcdMigrationWrapper = await ScdMcdMigration.at(newConfig.defi.maker.migration);
  const vatAddress = await ScdMcdMigrationWrapper.vat();
  const MakerRegistryWrapper = await MakerRegistry.new(vatAddress);
  const wethJoinAddress = await ScdMcdMigrationWrapper.wethJoin();
  const addCollateralTransaction = await MakerRegistryWrapper.contract.addCollateral(wethJoinAddress, { gasPrice });
  await MakerRegistryWrapper.verboseWaitForTransaction(addCollateralTransaction, `Adding join adapter ${wethJoinAddress} to the MakerRegistry`);
  const changeMakerRegistryOwnerTx = await MakerRegistryWrapper.contract.changeOwner(newConfig.contracts.MultiSigWallet, { gasPrice });
  await MakerRegistryWrapper.verboseWaitForTransaction(changeMakerRegistryOwnerTx, "Set the MultiSig as the owner of the MakerRegistry");

  // /////////////////////////////////////////////////
  // Making ENSManager owner of the root wallet ENS
  // /////////////////////////////////////////////////

  const ENSRegistryWrapper = await ENS.at(newConfig.ENS.ensRegistry);

  // Get the address of the previous owner of the root wallet ENS (e.g. argent.xyz)
  const previousWalletEnsOwner = await ENSRegistryWrapper.contract.owner(utils.namehash(walletRootEns));

  if (previousWalletEnsOwner.toLowerCase() === deploymentAccount.toLowerCase()) {
    // newly registered name -> change its owner from deploymentAccount to ENSManager address
    const setOwnerTransaction = await ENSRegistryWrapper.contract.setOwner(utils.namehash(walletRootEns), ENSManagerWrapper.address,
      { gasPrice });
    await ENSRegistryWrapper.verboseWaitForTransaction(setOwnerTransaction, "Replace deployment account by ENSManager as new owner of walletENS");
  } else if (previousWalletEnsOwner.toLowerCase() === prevConfig.contracts.ENSManager.toLowerCase()) {
    // change the owner from the previous ENSManager.address to the new one
    console.log("change the owner from the previous ENSManager to the new one");
    const previousMultiSigWrapper = await MultiSig.at(prevConfig.contracts.MultiSigWallet);
    const previousENSManagerWrapper = await ENSManager.at(prevConfig.contracts.ENSManager);

    const multisigExecutor = new MultisigExecutor(previousMultiSigWrapper, deploymentWallet, prevConfig.multisig.autosign, { gasPrice });
    console.log(`Owner of ${walletRootEns} changed from old ENSManager to new ENSManager...`);
    await multisigExecutor.executeCall(previousENSManagerWrapper, "changeRootnodeOwner", [ENSManagerWrapper.address]);
  } else {
    throw new Error(`Ownership of ${walletRootEns} not changed`);
  }

  // /////////////////////////////////////////////////
  // Add token to the Compound Registry
  // /////////////////////////////////////////////////

  for (const underlying in newConfig.defi.compound.markets) {
    const cToken = newConfig.defi.compound.markets[underlying];
    const addUnderlyingTransaction = await CompoundRegistryWrapper.contract.addCToken(underlying, cToken, { gasPrice });
    await CompoundRegistryWrapper.verboseWaitForTransaction(addUnderlyingTransaction,
      `Adding unerlying ${underlying} with cToken ${cToken} to the registry`);
  }

  // /////////////////////////////////////////////////
  // Update config and Upload ABIs
  // /////////////////////////////////////////////////

  configurator.updateInfrastructureAddresses({
    MultiSigWallet: MultiSigWrapper.address,
    WalletFactory: WalletFactoryWrapper.address,
    ENSResolver: ENSResolverWrapper.address,
    ENSManager: ENSManagerWrapper.address,
    TokenPriceProvider: TokenPriceProviderWrapper.address,
    ModuleRegistry: ModuleRegistryWrapper.address,
    CompoundRegistry: CompoundRegistryWrapper.address,
    BaseWallet: BaseWalletWrapper.address,
  });
  await configurator.save();

  await Promise.all([
    abiUploader.upload(MultiSigWrapper, "contracts"),
    abiUploader.upload(WalletFactoryWrapper, "contracts"),
    abiUploader.upload(ENSResolverWrapper, "contracts"),
    abiUploader.upload(ENSManagerWrapper, "contracts"),
    abiUploader.upload(TokenPriceProviderWrapper, "contracts"),
    abiUploader.upload(ModuleRegistryWrapper, "contracts"),
    abiUploader.upload(CompoundRegistryWrapper, "contracts"),
    abiUploader.upload(BaseWalletWrapper, "contracts"),
  ]);
};

module.exports = {
  deploy,
};
