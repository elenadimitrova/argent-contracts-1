/* global artifacts */

const { parseEther, formatBytes32String } = require("ethers").utils;
const etherlime = require("etherlime-lib");
const ethers = require("ethers");

const UniswapFactory = require("../lib/uniswap/UniswapFactory");
const UniswapExchange = require("../lib/uniswap/UniswapExchange");

const ScdMcdMigration = artifacts.require("ScdMcdMigration");
const DSValue = artifacts.require("DSValue");
const DSToken = artifacts.require("DSToken");
const Dai = artifacts.require("Dai");
const Vox = artifacts.require("SaiVox");
const Tub = artifacts.require("SaiTub");
const WETH = artifacts.require("WETH9");
const Vat = artifacts.require("Vat");
const Pot = artifacts.require("Pot");
const Jug = artifacts.require("Jug");
const CdpManager = artifacts.require("DssCdpManager");
const GemJoin = artifacts.require("GemJoin");
const DaiJoin = artifacts.require("DaiJoin");

const RAY = ethers.BigNumber.from("1000000000000000000000000000"); // 10**27
const WAD = ethers.BigNumber.from("1000000000000000000"); // 10**18
const RAD = RAY.mul(WAD);
const USD_PER_DAI = RAY; // 1 DAI = 1 USD
const USD_PER_ETH = WAD.mul(100); // 1 ETH = 100 USD
const USD_PER_MKR = WAD.mul(400); // 1 MKR = 400 USD
const ETH_PER_MKR = WAD.mul(USD_PER_MKR).div(USD_PER_ETH); // 1 MKR = 4 ETH
const ETH_PER_DAI = WAD.mul(USD_PER_DAI).div(RAY).mul(WAD).div(USD_PER_ETH); // 1 DAI = 0.01 ETH
const MAT = RAY.mul(3).div(2); // collateralizsation ratio = 150%

module.exports = {
  RAY,
  WAD,
  ETH_PER_MKR,
  ETH_PER_DAI,

  deployUniswap: async (deployer, manager, infrastructure, tokens = [], ethPerToken = [], ethLiquidity = parseEther("10")) => {
    const uniswapFactory = await deployer.deploy(UniswapFactory);
    const uniswapTemplateExchange = await deployer.deploy(UniswapExchange);
    await uniswapFactory.initializeFactory(uniswapTemplateExchange.address);
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      await uniswapFactory.from(infrastructure).createExchange(token.address);
      const tokenExchange = await etherlime.ContractAt(UniswapExchange, await uniswapFactory.getExchange(token.address));
      const tokenLiquidity = ethLiquidity.mul(WAD).div(ethPerToken[i]);
      await token["mint(address,uint256)"](infrastructure.address, tokenLiquidity);
      await token.from(infrastructure).approve(tokenExchange.address, tokenLiquidity);
      const timestamp = await manager.getTimestamp(await manager.getCurrentBlock());
      await tokenExchange.from(infrastructure).addLiquidity(1, tokenLiquidity, timestamp + 300, { value: ethLiquidity, gasLimit: 150000 });
    }
    return { uniswapFactory };
  },

  deployMaker: async (deployer, infrastructure) => {
    //
    // Deploy and setup SCD
    //
    const sai = await deployer.deploy(DSToken, {}, formatBytes32String("SAI"));
    const dai = await deployer.deploy(Dai, {}, 42);
    const gov = await deployer.deploy(DSToken, {}, formatBytes32String("MKR"));
    const weth = await deployer.deploy(WETH);
    const vox = await deployer.deploy(Vox, {}, USD_PER_DAI);
    const sin = await deployer.deploy(DSToken, {}, formatBytes32String("SIN"));
    const skr = await deployer.deploy(DSToken, {}, formatBytes32String("PETH"));
    const pip = await deployer.deploy(DSValue);
    const pep = await deployer.deploy(DSValue);
    const tub = await deployer.deploy(Tub, {},
      sai.address,
      sin.address,
      skr.address,
      weth.address,
      gov.address,
      pip.address,
      pep.address,
      vox.address,
      infrastructure.address);
    // Let the Tub mint PETH and DAI
    await skr.setOwner(tub.address);
    await sai.setOwner(tub.address);
    // Setup USD/ETH oracle with a convertion rate of 100 USD/ETH
    await pip.poke(`0x${USD_PER_ETH.toHexString().slice(2).padStart(64, "0")}`);
    // Setup USD/MKR oracle with a convertion rate of 400 USD/MKR
    await pep.poke(`0x${USD_PER_MKR.toHexString().slice(2).padStart(64, "0")}`);
    // Set the total DAI debt ceiling to 50,000 DAI
    await tub.mold(formatBytes32String("cap"), parseEther("50000"));
    // Set the collateralization ratio to 150%
    await tub.mold(formatBytes32String("mat"), MAT);
    // Set the governance fee to 7.5% APR
    await tub.mold(formatBytes32String("fee"), "1000000002293273137447730714");

    //
    // Deploy and setup MCD
    //

    // Vat setup
    const vat = await deployer.deploy(Vat);
    // Setting the debt ceiling
    await vat["file(bytes32,uint256)"](formatBytes32String("Line"), "138000000000000000000000000000000000000000000000000000");

    const cdpManager = await deployer.deploy(CdpManager, {}, vat.address);

    // Pot setup
    const pot = await deployer.deploy(Pot, {}, vat.address);
    await vat.rely(pot.address);

    // Jug setup
    const jug = await deployer.deploy(Jug, {}, vat.address);
    await vat.rely(jug.address);

    // SAI collateral setup
    const saiIlk = formatBytes32String("SAI");
    await jug.init(saiIlk);
    await vat.init(saiIlk);
    await vat.file(saiIlk, formatBytes32String("spot"), "100000000000000000000000000000000000000000000000000");
    await vat.file(saiIlk, formatBytes32String("line"), "100000000000000000000000000000000000000000000000000000");
    await vat.file(saiIlk, formatBytes32String("dust"), "0");
    const saiJoin = await deployer.deploy(GemJoin, {}, vat.address, saiIlk, sai.address);
    await vat.rely(saiJoin.address);

    // WETH collateral setup
    const wethIlk = formatBytes32String("ETH-A");
    await jug.init(wethIlk);
    await vat.init(wethIlk);
    await vat.file(wethIlk, formatBytes32String("spot"), "88050000000000000000000000000");
    await vat.file(wethIlk, formatBytes32String("line"), "50000000000000000000000000000000000000000000000000000");
    await vat.file(wethIlk, formatBytes32String("dust"), "20000000000000000000000000000000000000000000000");
    const wethJoin = await deployer.deploy(GemJoin, {}, vat.address, wethIlk, weth.address);
    await vat.rely(wethJoin.address);

    // BAT collateral setup
    const bat = await deployer.deploy(DSToken, {}, formatBytes32String("BAT"));
    const batIlk = formatBytes32String("BAT-A");
    await jug.init(batIlk);
    await vat.init(batIlk);
    await vat.file(batIlk, formatBytes32String("spot"), "88050000000000000000000000000");
    await vat.file(batIlk, formatBytes32String("line"), "50000000000000000000000000000000000000000000000000000");
    await vat.file(batIlk, formatBytes32String("dust"), "20000000000000000000000000000000000000000000000");
    const batJoin = await deployer.deploy(GemJoin, {}, vat.address, batIlk, bat.address);
    await vat.rely(batJoin.address);

    // DAI debt setup
    const daiJoin = await deployer.deploy(DaiJoin, {}, vat.address, dai.address);
    // Allow daiJoin to mint DAI
    await dai.rely(daiJoin.address);
    // Give daiJoin some internal DAI in the vat
    await vat.suck(daiJoin.address, daiJoin.address, RAD.mul(1000000));

    // Deploy and setup SCD to MCD Migration
    const migration = await deployer.deploy(
      ScdMcdMigration,
      {},
      tub.address,
      cdpManager.address,
      saiJoin.address,
      wethJoin.address,
      daiJoin.address,
    );
    // Setting up the common migration vault used by ScdMcdMigration
    const initialSaiAmountInMigrationVault = parseEther("1000");
    await sai["mint(address,uint256)"](infrastructure.address, initialSaiAmountInMigrationVault);
    await sai.from(infrastructure).approve(migration.address, initialSaiAmountInMigrationVault);
    await migration.from(infrastructure).swapSaiToDai(initialSaiAmountInMigrationVault);

    return {
      sai,
      dai,
      gov,
      bat,
      weth,
      vat,
      batJoin,
      wethJoin,
      tub,
      pip,
      pot,
      jug,
      cdpManager,
      migration,
    };
  },
};
