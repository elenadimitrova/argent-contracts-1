/* global artifacts */
const ethers = require("ethers");

const Proxy = artifacts.require("Proxy");
const BaseWallet = artifacts.require("BaseWallet");
const Registry = artifacts.require("ModuleRegistry");
const RelayerModule = artifacts.require("RelayerModule");
const GuardianStorage = artifacts.require("GuardianStorage");
const NftModule = artifacts.require("NftTransfer");

const ERC721 = artifacts.require("TestERC721");
const CK = artifacts.require("CryptoKittyTest");
const ERC20 = artifacts.require("TestERC20");
const ERC20Approver = artifacts.require("ERC20Approver");

const ZERO_BYTES32 = ethers.constants.HashZero;

const TestManager = require("../utils/test-manager");
const { parseRelayReceipt } = require("../utils/utilities.js");

contract("NftTransfer", (accounts) => {
  const manager = new TestManager();

  const owner1 = accounts[1];
  const owner2 = accounts[2];
  const eoaRecipient = accounts[3];
  const tokenId = 1;

  let deployer;
  let nftModule;
  let walletImplementation;
  let relayerModule;
  let wallet1;
  let wallet2;
  let erc721;
  let ck;
  let ckId;
  let erc20;
  let erc20Approver;

  before(async () => {
    deployer = manager.newDeployer();
    const registry = await Registry.new();
    walletImplementation = await BaseWallet.new();

    const guardianStorage = await GuardianStorage.new();
    relayerModule = await RelayerModule.new(
      registry.address,
      guardianStorage.address,
      ethers.constants.AddressZero,
      ethers.constants.AddressZero);
    manager.setRelayerModule(relayerModule);
    ck = await CK.new();
    nftModule = await NftModule.new(
      registry.address,
      guardianStorage.address,
      ck.address);
    erc20Approver = await ERC20Approver.new(registry.address);
  });

  beforeEach(async () => {
    const proxy1 = await Proxy.new(walletImplementation.address);
    wallet1 = await BaseWallet.at(proxy1.address);
    const proxy2 = await Proxy.new(walletImplementation.address);
    wallet2 = await BaseWallet.at(proxy2.address);

    await wallet1.init(owner1, [nftModule.address, erc20Approver.address, relayerModule.address]);
    await wallet2.init(owner2, [nftModule.address, relayerModule.address]);
    erc721 = await ERC721.new();
    await erc721.mint(wallet1.address, tokenId);
  });

  describe("NFT transfers", () => {
    async function testNftTransfer({
      safe = true, relayed, recipientAddress, nftContract = erc721, nftId = tokenId, shouldSucceed = true, expectedError,
    }) {
      const beforeWallet1 = await nftContract.balanceOf(wallet1.address);
      const beforeRecipient = await nftContract.balanceOf(recipientAddress);
      if (relayed) {
        const txReceipt = await manager.relay(nftModule, "transferNFT",
          [wallet1.address, nftContract.address, recipientAddress, nftId, safe, ZERO_BYTES32], wallet1, [owner1]);
        const { success, error } = parseRelayReceipt(txReceipt);
        assert.equal(success, shouldSucceed);
        if (!shouldSucceed) {
          assert.equal(error, expectedError);
        }
      } else {
        const txPromise = nftModule.from(owner1)
          .transferNFT(wallet1.address, nftContract.address, recipientAddress, nftId, safe, ZERO_BYTES32);
        if (shouldSucceed) {
          await txPromise;
        } else {
          assert.revert(txPromise);
        }
      }
      if (shouldSucceed) {
        const afterWallet1 = await nftContract.balanceOf(wallet1.address);
        const afterRecipient = await nftContract.balanceOf(recipientAddress);
        assert.equal(beforeWallet1.sub(afterWallet1).toNumber(), 1, `wallet1 should have one less NFT (safe: ${safe}, relayed: ${relayed})`);
        assert.equal(afterRecipient.sub(beforeRecipient).toNumber(), 1, `recipient should have one more NFT (safe: ${safe}, relayed: ${relayed})`);
      }
    }

    describe("transfer to EOA account", () => {
      it("should allow unsafe NFT transfer from wallet1 to an EOA account", async () => {
        await testNftTransfer({ safe: false, relayed: false, recipientAddress: eoaRecipient });
      });

      it("should allow safe NFT transfer from wallet1 to an EOA account", async () => {
        await testNftTransfer({ safe: true, relayed: false, recipientAddress: eoaRecipient });
      });

      it("should allow unsafe NFT transfer from wallet1 to an EOA account (relayed)", async () => {
        await testNftTransfer({ safe: false, relayed: true, recipientAddress: eoaRecipient });
      });

      it("should allow safe NFT transfer from wallet1 to an EOA account (relayed)", async () => {
        await testNftTransfer({ safe: true, relayed: true, recipientAddress: eoaRecipient });
      });
    });

    describe("transfer to other wallet", () => {
      it("should allow unsafe NFT transfer from wallet1 to wallet2", async () => {
        await testNftTransfer({ safe: false, relayed: false, recipientAddress: wallet2.address });
      });

      it("should allow safe NFT transfer from wallet1 to wallet2", async () => {
        await testNftTransfer({ safe: true, relayed: false, recipientAddress: wallet2.address });
      });

      it("should allow unsafe NFT transfer from wallet1 to wallet2 (relayed)", async () => {
        await testNftTransfer({ safe: false, relayed: true, recipientAddress: wallet2.address });
      });

      it("should allow safe NFT transfer from wallet1 to wallet2 (relayed)", async () => {
        await testNftTransfer({ safe: true, relayed: true, recipientAddress: wallet2.address });
      });
    });

    describe("CK transfer", () => {
      beforeEach(async () => {
        await ck.createDumbKitty(wallet1.address);
        ckId = (ckId === undefined) ? 0 : ckId + 1; // update the id of the CryptoKitty that was just created
      });

      it("should allow CK transfer from wallet1 to wallet2", async () => {
        await testNftTransfer({
          relayed: false, nftId: ckId, nftContract: ck, recipientAddress: wallet2.address,
        });
      });

      it("should allow CK transfer from wallet1 to wallet2 (relayed)", async () => {
        await testNftTransfer({
          relayed: true, nftId: ckId, nftContract: ck, recipientAddress: wallet2.address,
        });
      });

      it("should allow CK transfer from wallet1 to EOA account", async () => {
        await testNftTransfer({
          relayed: false, nftId: ckId, nftContract: ck, recipientAddress: eoaRecipient,
        });
      });

      it("should allow CK transfer from wallet1 to EOA account (relayed)", async () => {
        await testNftTransfer({
          relayed: true, nftId: ckId, nftContract: ck, recipientAddress: eoaRecipient,
        });
      });
    });

    describe("Protecting from transferFrom hijacking", () => {
      beforeEach(async () => {
        erc20 = await ERC20.new([wallet1.address], 1000, 18);
        await erc20Approver.from(owner1).approveERC20(
          wallet1.address,
          erc20.address,
          wallet1.address, // spender
          100,
        ); // amount
      });

      it("should NOT allow ERC20 transfer from wallet1 to wallet2", async () => {
        await testNftTransfer({
          shouldSucceed: false, safe: false, relayed: false, nftId: 100, nftContract: erc20, recipientAddress: wallet2.address,
        });
      });

      it("should NOT allow ERC20 transfer from wallet1 to wallet2 (relayed)", async () => {
        await testNftTransfer({
          shouldSucceed: false,
          expectedError: "NT: Non-compliant NFT contract",
          safe: false,
          relayed: true,
          nftId: 100,
          nftContract: erc20,
          recipientAddress: wallet2.address,
        });
      });
    });
  });
});
