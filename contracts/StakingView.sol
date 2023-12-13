//SPDX-License-Identifier: MIT
pragma solidity 0.8.4;

import "./Staking.sol";
import "./GlobalsAndUtility.sol";

contract StakingView {
    function getAllStakesOfAddress(address stakingAddress, address staker) external view returns (GlobalsAndUtility.StakeStore[] memory)  {
        uint stakeCount = Staking(stakingAddress).stakeCount(staker);

        GlobalsAndUtility.StakeStore[] memory stakes = new GlobalsAndUtility.StakeStore[](stakeCount); 

        for (uint i; i < stakeCount; i++) {
            (
                uint128 stakedAmount,
                uint128 stakeShares,
                uint40 stakeId,
                uint16 lockedDay,
                uint16 stakedDays,
                uint16 unlockedDay
            ) = Staking(stakingAddress).stakeLists(staker, i);


            stakes[i] = GlobalsAndUtility.StakeStore(
                stakedAmount,
                stakeShares,
                stakeId,
                lockedDay,
                stakedDays,
                unlockedDay
            );
        }

        return stakes;
    }
}