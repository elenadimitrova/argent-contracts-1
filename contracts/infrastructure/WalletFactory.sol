// Copyright (C) 2018  Argent Labs Ltd. <https://argent.xyz>

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.6.12;

import "../wallet/Proxy.sol";
import "../wallet/BaseWallet.sol";
import "./base/Owned.sol";
import "./base/Managed.sol";
import "./storage/IGuardianStorage.sol";
import "./ens/IENSManager.sol";
import "./IModuleRegistry.sol";
import "../modules/common/IVersionManager.sol";

/**
 * @title WalletFactory
 * @notice The WalletFactory contract creates and assigns wallets to accounts.
 * @author Julien Niset - <julien@argent.xyz>
 */
contract WalletFactory is Owned, Managed {

    // The address of the module dregistry
    address public moduleRegistry;
    // The address of the base wallet implementation
    address public walletImplementation;
    // The address of the ENS manager
    address public ensManager;
    // The address of the GuardianStorage
    address public guardianStorage;

    // *************** Events *************************** //

    event ModuleRegistryChanged(address addr);
    event ENSManagerChanged(address addr);
    event WalletCreated(address indexed wallet, address indexed owner, address indexed guardian);

    // *************** Constructor ********************** //

    /**
     * @notice Default constructor.
     */
    constructor(address _moduleRegistry, address _walletImplementation, address _ensManager, address _guardianStorage) public {
        require(_moduleRegistry != address(0), "WF: ModuleRegistry address not defined");
        require(_walletImplementation != address(0), "WF: WalletImplementation address not defined");
        require(_ensManager != address(0), "WF: ENSManager address not defined");
        require(_guardianStorage != address(0), "WF: GuardianStorage address not defined");
        moduleRegistry = _moduleRegistry;
        walletImplementation = _walletImplementation;
        ensManager = _ensManager;
        guardianStorage = _guardianStorage;
    }

    // *************** External Functions ********************* //
    /**
     * @notice Lets the manager create a wallet for an owner account.
     * The wallet is initialised with the version manager module, a version number, a first guardian, and an ENS.
     * The wallet is created using the CREATE opcode.
     * @param _owner The account address.
     * @param _versionManager The version manager module
     * @param _label Optional ENS label of the new wallet, e.g. franck.
     * @param _guardian The guardian address.
     * @param _version The version of the feature bundle.
     */
    function createWallet(
        address _owner,
        address _versionManager,
        string calldata _label,
        address _guardian,
        uint256 _version
    )
        external
        onlyManager
    {
        validateInputs(_owner, _versionManager, _guardian, _version);
        Proxy proxy = new Proxy(walletImplementation);
        address payable wallet = address(proxy);
        configureWallet(BaseWallet(wallet), _owner, _versionManager, _label, _guardian, _version);
    }
     
    /**
     * @notice Lets the manager create a wallet for an owner account at a specific address.
     * The wallet is initialised with the version manager module, the version number, a first guardian, and an ENS.
     * The wallet is created using the CREATE2 opcode.
     * @param _owner The account address.
     * @param _versionManager The version manager module
     * @param _label Optional ENS label of the new wallet, e.g. franck.
     * @param _guardian The guardian address.
     * @param _salt The salt.
     * @param _version The version of the feature bundle.
     */
    function createCounterfactualWallet(
        address _owner,
        address _versionManager,
        string calldata _label,
        address _guardian,
        bytes32 _salt,
        uint256 _version
    )
        external
        onlyManager
        returns (address _wallet)
    {
        validateInputs(_owner, _versionManager, _guardian, _version);
        bytes32 newsalt = newSalt(_salt, _owner, _versionManager, _guardian, _version);
        Proxy proxy = new Proxy{salt: newsalt}(walletImplementation);
        address payable wallet = address(proxy);
        configureWallet(BaseWallet(wallet), _owner, _versionManager, _label, _guardian, _version);
        return wallet;
    }

    /**
     * @notice Gets the address of a counterfactual wallet with a first default guardian.
     * @param _owner The account address.
     * @param _versionManager The version manager module
     * @param _guardian The guardian address.
     * @param _salt The salt.
     * @param _version The version of feature bundle.
     * @return _wallet The address that the wallet will have when created using CREATE2 and the same input parameters.
     */
    function getAddressForCounterfactualWallet(
        address _owner,
        address _versionManager,
        address _guardian,
        bytes32 _salt,
        uint256 _version
    )
        external
        view
        returns (address _wallet)
    {
        validateInputs(_owner, _versionManager, _guardian, _version);
        bytes32 newsalt = newSalt(_salt, _owner, _versionManager, _guardian, _version);
        bytes memory code = abi.encodePacked(type(Proxy).creationCode, uint256(walletImplementation));
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), newsalt, keccak256(code)));
        _wallet = address(uint160(uint256(hash)));
    }

    /**
     * @notice Lets the owner change the address of the module registry contract.
     * @param _moduleRegistry The address of the module registry contract.
     */
    function changeModuleRegistry(address _moduleRegistry) external onlyOwner {
        require(_moduleRegistry != address(0), "WF: address cannot be null");
        moduleRegistry = _moduleRegistry;
        emit ModuleRegistryChanged(_moduleRegistry);
    }

    /**
     * @notice Lets the owner change the address of the ENS manager contract.
     * @param _ensManager The address of the ENS manager contract.
     */
    function changeENSManager(address _ensManager) external onlyOwner {
        require(_ensManager != address(0), "WF: address cannot be null");
        ensManager = _ensManager;
        emit ENSManagerChanged(_ensManager);
    }

    /**
     * @notice Inits the module for a wallet by logging an event.
     * The method can only be called by the wallet itself.
     * @param _wallet The wallet.
     */
    function init(BaseWallet _wallet) external pure {
        //do nothing
    }

    // *************** Internal Functions ********************* //

    /**
     * @notice Helper method to configure a wallet for a set of input parameters.
     * @param _wallet The target wallet
     * @param _owner The account address.
     * @param _versionManager The version manager module
     * @param _label Optional ENS label of the new wallet, e.g. franck.
     * @param _guardian The guardian address.
     * @param _version The version of the feature bundle.
     */
    function configureWallet(
        BaseWallet _wallet,
        address _owner,
        address _versionManager,
        string memory _label,
        address _guardian,
        uint256 _version
    )
        internal
    {
        // initialise the wallet with the owner and the VersionManager module
        address[] memory modules = new address[](1);
        modules[0] = _versionManager;
        _wallet.init(_owner, modules);
        
        // add guardian
        IVersionManager(_versionManager).invokeStorage(
            address(_wallet),
            guardianStorage,
            abi.encodeWithSelector(IGuardianStorage(guardianStorage).addGuardian.selector, address(_wallet), _guardian)
        );

        // register ENS if needed
        registerWalletENS(address(_wallet), _versionManager, _label);

        // upgrade the wallet
        IVersionManager(_versionManager).upgradeWallet(address(_wallet), _version);

        // emit event
        emit WalletCreated(address(_wallet), _owner, _guardian);
    }

    /**
     * @notice Generates a new salt based on a provided salt, an owner, a list of modules and an optional guardian.
     * @param _salt The slat provided.
     * @param _owner The owner address.
     * @param _versionManager The version manager module
     * @param _guardian The guardian address.
     * @param _version The version of feature bundle
     */
    function newSalt(bytes32 _salt, address _owner, address _versionManager, address _guardian, uint256 _version) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_salt, _owner, _versionManager, _guardian, _version));
    }

    /**
     * @notice Throws if the owner, guardian, version or version manager is invalid.
     * @param _owner The owner address.
     * @param _versionManager The version manager module
     * @param _guardian The guardian address
     * @param _version The version of feature bundle
     */
    function validateInputs(address _owner, address _versionManager, address _guardian, uint256 _version) internal view {
        require(_owner != address(0), "WF: owner cannot be null");
        require(IModuleRegistry(moduleRegistry).isRegisteredModule(_versionManager), "WF: invalid _versionManager");
        require(_guardian != (address(0)), "WF: guardian cannot be null");
        require(_version > 0, "WF: invalid _version");
    }

    /**
     * @notice Register an ENS subname to a wallet.
     * @param _wallet The wallet address.
     * @param _versionManager The version manager.
     * @param _label ENS label of the new wallet (e.g. franck).
     */
    function registerWalletENS(address payable _wallet, address _versionManager, string memory _label) internal {
        if (bytes(_label).length > 0) {
            // claim reverse
            address ensResolver = IENSManager(ensManager).ensResolver();
            bytes memory methodData = abi.encodeWithSignature("claimWithResolver(address,address)", ensManager, ensResolver);
            address ensReverseRegistrar = IENSManager(ensManager).getENSReverseRegistrar();
            IVersionManager(_versionManager).checkAuthorisedFeatureAndInvokeWallet(_wallet, ensReverseRegistrar, 0, methodData);
            // register with ENS manager
            IENSManager(ensManager).register(_label, _wallet);
        }
    }
}
