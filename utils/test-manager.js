const ethers = require("ethers");
const { signOffchain, ETH_TOKEN, getNonceForRelay } = require("./utilities.js");

class TestManager {
  setRelayerModule(relayerModule) {
    this.relayerModule = relayerModule;
  }

  async relay(_module, _method, _params, _wallet, _signers,
    _relayer = this.accounts[9].signer,
    _estimate = false,
    _gasLimit = 2000000,
    _nonce,
    _gasPrice = 0,
    _refundToken = ETH_TOKEN,
    _refundAddress = ethers.constants.AddressZero,
    _gasLimitRelay = (_gasLimit * 1.1)) {
    const nonce = _nonce || await getNonceForRelay();
    const methodData = _module.contract.interface.functions[_method].encode(_params);
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
    const tx = await this.relayerModule.from(_relayer).execute(
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
    const txReceipt = await _module.verboseWaitForTransaction(tx);
    return txReceipt;
  }
}

module.exports = TestManager;
