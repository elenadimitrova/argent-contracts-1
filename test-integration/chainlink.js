/* global accounts */

const TokenPriceRegistry = require("../build/TokenPriceRegistry");
const TestManager = require("../utils/test-manager");

describe("Chainlink integration ", function () {
  this.timeout(100000);

  const manager = new TestManager();

  const infrastructure = accounts[0].signer;

  let deployer;
  let tokenPriceRegistry;

  before(async () => {
    deployer = manager.newDeployer();
    tokenPriceRegistry = await deployer.deploy(TokenPriceRegistry);
    await tokenPriceRegistry.addManager(infrastructure.address);

    // Add available chainlink price feeds to TokenPriceRegistry
    // https://docs.chain.link/docs/reference-contracts#config
    // https://feeds.chain.link/
    // Add BAT/ETH chainlink price feed
    await tokenPriceRegistry.from(infrastructure).addAggregator(
      "0x0d8775f648430679a709e98d2b0cb6250d2887ef",
      "0x0F4D89586EADA00C73b96f11fd447720aFf504C0",
    );

    // Add BNT/ETH chainlink price feed
    await tokenPriceRegistry.from(infrastructure).addAggregator(
      "0x1f573d6fb3f13d689ff844b4ce37794d79a7ff1c",
      "0xa5e7f6e0D34E0026efaa8834af97859b536f944F",
    );

    // Add BUSD/ETH chainlink price feed
    await tokenPriceRegistry.from(infrastructure).addAggregator(
      "0x4fabb145d64652a948d72533023f6e7a623c7c53",
      "0xdcD3364A1D62e38153295B670d2FC4c1a39a3cC0",
    );

    // Add DAI/ETH chainlink price feed
    await tokenPriceRegistry.from(infrastructure).addAggregator(
      "0x6b175474e89094c44da98b954eedeac495271d0f",
      "0x24959556020AE5D39e5bAEC2bd6Bf12420C25aB5",
    );

    // Add KNC/ETH chainlink price feed"
    await tokenPriceRegistry.from(infrastructure).addAggregator(
      "0xdd974d5c2e2928dea5f71b9825b8b646686bd200",
      "0xF15d39E526167734275DaF6e8610CfDa4Ae466AF",
    );

    // Add LEND/ETH chainlink price feed
    await tokenPriceRegistry.from(infrastructure).addAggregator(
      "0x80fB784B7eD66730e8b1DBd9820aFD29931aab03",
      "0x593fe68bDa1e6d5028af0568A42E8C4662a111a1",
    );

    // Add LINK/ETH chainlink price feed
    await tokenPriceRegistry.from(infrastructure).addAggregator(
      "0x514910771af9ca656af840dff83e8264ecf986ca",
      "0xf27a1E18d1605F8C3FB74d770275F7c38350D508",
    );

    // Add LRC/ETH chainlink price feed
    await tokenPriceRegistry.from(infrastructure).addAggregator(
      "0xbbbbca6a901c926f240b89eacb641d8aec7aeafd",
      "0x845dEAe63DC415875A464855Be1882850D96fC20",
    );

    // Add MANA/ETH chainlink price feed
    await tokenPriceRegistry.from(infrastructure).addAggregator(
      "0x0f5d2fb29fb7d3cfee444a200298f468908cc942",
      "0x8afad537c2552aD4fA41205D3D6C4B486D511eD7",
    );

    // Add MKR/ETH chainlink price feed
    await tokenPriceRegistry.from(infrastructure).addAggregator(
      "0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2",
      "0x672145c02443113cD578FA9356f074BC039bcFC5",
    );

    // Add REN/ETH chainlink price feed
    await tokenPriceRegistry.from(infrastructure).addAggregator(
      "0x408e41876cccdc0f92210600ef50372656052a38",
      "0x73C7424DcA9282816Ea65Fb751C5588CEA754a58",
    );

    // Add SNX/ETH chainlink price feed
    await tokenPriceRegistry.from(infrastructure).addAggregator(
      "0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f",
      "0x4CAD7cF64FDD9945F75026a1d9a9f362e3E5A7c4",
    );

    // Add SUSD/ETH chainlink price feed
    await tokenPriceRegistry.from(infrastructure).addAggregator(
      "0x57ab1ec28d129707052df4df418d58a2d46d5f51",
      "0xb5Ebd2FbA9DBd5f97DEC89B561c182330aD850eF",
    );

    // Add TUSD/ETH chainlink price feed
    await tokenPriceRegistry.from(infrastructure).addAggregator(
      "0x0000000000085d4780B73119b644AE5ecd22b376",
      "0x9eDF9D455904144a22A18346419DfC54DC9B0a5e",
    );

    // Add USDC/ETH chainlink price feed
    await tokenPriceRegistry.from(infrastructure).addAggregator(
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      "0xB8784d2D77D3dbaa9cAC7d32D035A6d41e414e9c",
    );

    // Add USDT/ETH chainlink price feed
    await tokenPriceRegistry.from(infrastructure).addAggregator(
      "0xdac17f958d2ee523a2206206994597c13d831ec7",
      "0x14137fA0D2Cf232922840081166a6a05C957bA4c",
    );

    // Add ZRX/ETH chainlink price feed
    await tokenPriceRegistry.from(infrastructure).addAggregator(
      "0xe41d2489571d322189246dafa5ebde1f4699f498",
      "0x5F00c355F784955f38303DeCd1431F882909A69A",
    );
  });

  describe("Chainlink price feeds integration", () => {
    it("should be able to get price from chainlink oracle if available", async () => {
      const tokenPriceBAT = await tokenPriceRegistry.getTokenPrice("0x0d8775f648430679a709e98d2b0cb6250d2887ef");
      assert.notEqual(tokenPriceBAT.toString(), 0);
      console.log("BAT/ETH", tokenPriceBAT.toString());

      const tokenPriceBNT = await tokenPriceRegistry.getTokenPrice("0x1f573d6fb3f13d689ff844b4ce37794d79a7ff1c");
      assert.notEqual(tokenPriceBNT.toString(), 0);
      console.log("BNT/ETH", tokenPriceBNT.toString());

      const tokenPriceBUSD = await tokenPriceRegistry.getTokenPrice("0x4fabb145d64652a948d72533023f6e7a623c7c53");
      assert.notEqual(tokenPriceBUSD.toString(), 0);
      console.log("BUSD/ETH", tokenPriceBUSD.toString());

      const tokenPriceDAI = await tokenPriceRegistry.getTokenPrice("0x6b175474e89094c44da98b954eedeac495271d0f");
      assert.notEqual(tokenPriceDAI.toString(), 0);
      console.log("DAI/ETH", tokenPriceDAI.toString());

      const tokenPriceKNC = await tokenPriceRegistry.getTokenPrice("0xdd974d5c2e2928dea5f71b9825b8b646686bd200");
      assert.notEqual(tokenPriceKNC.toString(), 0);
      console.log("KNC/ETH", tokenPriceKNC.toString());

      const tokenPriceLEND = await tokenPriceRegistry.getTokenPrice("0x80fB784B7eD66730e8b1DBd9820aFD29931aab03");
      assert.notEqual(tokenPriceLEND.toString(), 0);
      console.log("LEND/ETH", tokenPriceLEND.toString());

      const tokenPriceLINK = await tokenPriceRegistry.getTokenPrice("0x514910771af9ca656af840dff83e8264ecf986ca");
      assert.notEqual(tokenPriceLINK.toString(), 0);
      console.log("LINK/ETH", tokenPriceLINK.toString());

      const tokenPriceLRC = await tokenPriceRegistry.getTokenPrice("0xbbbbca6a901c926f240b89eacb641d8aec7aeafd");
      assert.notEqual(tokenPriceLRC.toString(), 0);
      console.log("LRC/ETH", tokenPriceLRC.toString());

      const tokenPriceMANA = await tokenPriceRegistry.getTokenPrice("0x0f5d2fb29fb7d3cfee444a200298f468908cc942");
      assert.notEqual(tokenPriceMANA.toString(), 0);
      console.log("MANA/ETH", tokenPriceMANA.toString());

      const tokenPriceMKR = await tokenPriceRegistry.getTokenPrice("0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2");
      assert.notEqual(tokenPriceMKR.toString(), 0);
      console.log("MKR/ETH", tokenPriceMKR.toString());

      const tokenPriceREN = await tokenPriceRegistry.getTokenPrice("0x408e41876cccdc0f92210600ef50372656052a38");
      assert.notEqual(tokenPriceREN.toString(), 0);
      console.log("REN/ETH", tokenPriceREN.toString());

      const tokenPriceSNX = await tokenPriceRegistry.getTokenPrice("0xc011a73ee8576fb46f5e1c5751ca3b9fe0af2a6f");
      assert.notEqual(tokenPriceSNX.toString(), 0);
      console.log("SNX/ETH", tokenPriceSNX.toString());

      const tokenPriceSUSD = await tokenPriceRegistry.getTokenPrice("0x57ab1ec28d129707052df4df418d58a2d46d5f51");
      assert.notEqual(tokenPriceSUSD.toString(), 0);
      console.log("SUSD/ETH", tokenPriceSUSD.toString());

      const tokenPriceTUSD = await tokenPriceRegistry.getTokenPrice("0x0000000000085d4780B73119b644AE5ecd22b376");
      assert.notEqual(tokenPriceTUSD.toString(), 0);
      console.log("TUSD/ETH", tokenPriceTUSD.toString());

      const tokenPriceUSDC = await tokenPriceRegistry.getTokenPrice("0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48");
      assert.notEqual(tokenPriceUSDC.toString(), 0);
      console.log("USDC/ETH", tokenPriceUSDC.toString());

      const tokenPriceUSDT = await tokenPriceRegistry.getTokenPrice("0xdac17f958d2ee523a2206206994597c13d831ec7");
      assert.notEqual(tokenPriceUSDT.toString(), 0);
      console.log("USDT/ETH", tokenPriceUSDT.toString());

      const tokenPriceZRX = await tokenPriceRegistry.getTokenPrice("0xe41d2489571d322189246dafa5ebde1f4699f498");
      assert.notEqual(tokenPriceZRX.toString(), 0);
      console.log("ZRX/ETH", tokenPriceZRX.toString());
    });
  });
});
