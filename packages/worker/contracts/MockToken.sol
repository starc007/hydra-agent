// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal mintable ERC20 used as a demo counterparty token in a v4 pool.
contract MockToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory n, string memory s, uint256 supply) {
        name = n;
        symbol = s;
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
        emit Transfer(address(0), msg.sender, supply);
    }

    function transfer(address to, uint256 v) external returns (bool) {
        balanceOf[msg.sender] -= v;
        balanceOf[to] += v;
        emit Transfer(msg.sender, to, v);
        return true;
    }

    function approve(address sp, uint256 v) external returns (bool) {
        allowance[msg.sender][sp] = v;
        emit Approval(msg.sender, sp, v);
        return true;
    }

    function transferFrom(address f, address t, uint256 v) external returns (bool) {
        allowance[f][msg.sender] -= v;
        balanceOf[f] -= v;
        balanceOf[t] += v;
        emit Transfer(f, t, v);
        return true;
    }
}
