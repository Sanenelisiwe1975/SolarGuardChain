// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SolarGuard Registry
/// @notice Shared ownership and theft registry for solar panels, keyed by the
///         manufacturer serial laminated under the glass. No personal data is
///         stored: owners are represented by a salted hash kept off-chain.
/// @dev Registrars are accredited parties (installers, solar providers,
///      insurers). Each registrar signs its own transactions, so no single
///      company controls the record.
contract SolarRegistry {
    enum Status { Unregistered, Clean, Stolen }

    struct Panel {
        bytes32 ownerHash;
        address registrar;
        uint64 registeredAt;
        uint64 updatedAt;
        uint32 transfers;
        Status status;
    }

    address public admin;
    mapping(address => bool) public isRegistrar;
    mapping(bytes32 => Panel) private panels;
    uint256 public panelCount;

    event RegistrarSet(address indexed registrar, bool allowed);
    event PanelRegistered(bytes32 indexed serialKey, string serial, bytes32 ownerHash, address indexed registrar);
    event OwnershipTransferred(bytes32 indexed serialKey, string serial, bytes32 fromOwner, bytes32 toOwner, address indexed registrar);
    event PanelReportedStolen(bytes32 indexed serialKey, string serial, string caseRef, address indexed reporter);
    event PanelRecovered(bytes32 indexed serialKey, string serial, address indexed reporter);

    error NotAdmin();
    error NotRegistrar();
    error AlreadyRegistered();
    error NotRegistered();
    error PanelIsStolen();
    error PanelNotStolen();
    error EmptySerial();
    error EmptyOwner();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    modifier onlyRegistrar() {
        if (!isRegistrar[msg.sender]) revert NotRegistrar();
        _;
    }

    constructor() {
        admin = msg.sender;
        isRegistrar[msg.sender] = true;
        emit RegistrarSet(msg.sender, true);
    }

    function setRegistrar(address registrar, bool allowed) external onlyAdmin {
        isRegistrar[registrar] = allowed;
        emit RegistrarSet(registrar, allowed);
    }

    function serialKey(string calldata serial) public pure returns (bytes32) {
        return keccak256(bytes(serial));
    }

    function registerPanel(string calldata serial, bytes32 ownerHash) external onlyRegistrar {
        if (bytes(serial).length == 0) revert EmptySerial();
        if (ownerHash == bytes32(0)) revert EmptyOwner();
        bytes32 key = keccak256(bytes(serial));
        Panel storage p = panels[key];
        if (p.status != Status.Unregistered) revert AlreadyRegistered();

        p.ownerHash = ownerHash;
        p.registrar = msg.sender;
        p.registeredAt = uint64(block.timestamp);
        p.updatedAt = uint64(block.timestamp);
        p.status = Status.Clean;
        panelCount++;

        emit PanelRegistered(key, serial, ownerHash, msg.sender);
    }

    function transferOwnership(string calldata serial, bytes32 newOwnerHash) external onlyRegistrar {
        if (newOwnerHash == bytes32(0)) revert EmptyOwner();
        bytes32 key = keccak256(bytes(serial));
        Panel storage p = panels[key];
        if (p.status == Status.Unregistered) revert NotRegistered();
        if (p.status == Status.Stolen) revert PanelIsStolen();

        bytes32 previous = p.ownerHash;
        p.ownerHash = newOwnerHash;
        p.transfers += 1;
        p.updatedAt = uint64(block.timestamp);

        emit OwnershipTransferred(key, serial, previous, newOwnerHash, msg.sender);
    }

    function reportStolen(string calldata serial, string calldata caseRef) external onlyRegistrar {
        bytes32 key = keccak256(bytes(serial));
        Panel storage p = panels[key];
        if (p.status == Status.Unregistered) revert NotRegistered();
        if (p.status == Status.Stolen) revert PanelIsStolen();

        p.status = Status.Stolen;
        p.updatedAt = uint64(block.timestamp);

        emit PanelReportedStolen(key, serial, caseRef, msg.sender);
    }

    function markRecovered(string calldata serial) external onlyRegistrar {
        bytes32 key = keccak256(bytes(serial));
        Panel storage p = panels[key];
        if (p.status != Status.Stolen) revert PanelNotStolen();

        p.status = Status.Clean;
        p.updatedAt = uint64(block.timestamp);

        emit PanelRecovered(key, serial, msg.sender);
    }

    function getPanel(string calldata serial) external view returns (Panel memory) {
        return panels[keccak256(bytes(serial))];
    }
}
