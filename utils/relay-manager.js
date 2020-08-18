const ethers = require("ethers");
const { signOffchain, ETH_TOKEN, getNonceForRelay, getAccount } = require("./utilities.js");

class RelayManager {
  setRelayerModule(relayerModule) {
    this.relayerModule = relayerModule;
  }

  async relay(_module, _method, _params, _wallet, _signers,
    _relayerAccount,
    _estimate = false,
    _gasLimit = 2000000,
    _nonce,
    _gasPrice = 0,
    _refundToken = ETH_TOKEN,
    _refundAddress = ethers.constants.AddressZero,
    _gasLimitRelay = (_gasLimit * 1.1)) {
    const relayerAccount = _relayerAccount || await getAccount(9);
    const nonce = _nonce || await getNonceForRelay();
    const methodData = _module.contract.methods[_method](_params).encodeABI();
    const signatures = await signOffchain(
      _signers,
      this.relayerModule.address,
      _module.address,
      0,
      methodData,
      nonce,
      _gasPrice,
      _gasLimit,
      _refundToken,
      _refundAddress,
    );
    if (_estimate === true) {
      const gasUsed = await this.relayerModule.estimate.execute(
        _wallet.address,
        _module.address,
        methodData,
        nonce,
        signatures,
        _gasPrice,
        _gasLimit,
        _refundToken,
        _refundAddress,
        { gasLimit: _gasLimitRelay, gasPrice: _gasPrice },
      );
      return gasUsed;
    }
    const tx = await this.relayerModule.execute(
      _wallet.address,
      _module.address,
      methodData,
      nonce,
      signatures,
      _gasPrice,
      _gasLimit,
      _refundToken,
      _refundAddress,
      { gasLimit: _gasLimitRelay, gasPrice: _gasPrice, from: relayerAccount },
    );
    return tx.receipt;
  }
}

module.exports = RelayManager;
