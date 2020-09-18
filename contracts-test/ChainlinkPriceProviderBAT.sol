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

import "@chainlink/contracts/src/v0.6/interfaces/AggregatorV3Interface.sol";

/**
 * @title Abbreviated implementation of AggregatorV3Interface for testing purposes
 */
contract ChainlinkPriceProviderBAT is AggregatorV3Interface {
 
 function decimals() external override view returns (uint8) {
   return 18;
 }

  function description() external override view returns (string memory) {
    return "BAT / ETH";
  }

  function version() external override view returns (uint256) {
    return 2;
  }

  // getRoundData and latestRoundData should both raise "No data present"
  // if they do not have data to report, instead of returning unset values
  // which could be misinterpreted as actual reported values.
  function getRoundData(uint80 _roundId)
    external
    override
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    )
    {
      // Return the same as the latest round data
      return (
        36893488147419104445,  // roundId
        654600000000000,       // price
        1600418316,            // startedAt
        1600418316,            // updatedAt
        36893488147419104445); // answeredInRound
    }

  function latestRoundData()
    external
    override 
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    ) {
      return (
        36893488147419104445,  // roundId
        654600000000000,       // price
        1600418316,            // startedAt
        1600418316,            // updatedAt
        36893488147419104445); // answeredInRound
    }
}