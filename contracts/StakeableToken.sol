//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./GlobalsAndUtility.sol";

contract StakeableToken is GlobalsAndUtility {
    using SafeERC20 for IERC20;

    constructor()
        public
    {
        /* Initialize global shareRate to 1 */
        globals.shareRate = uint40(1 * SHARE_RATE_SCALE);
    }

    /**
     * @dev PUBLIC FACING: Open a stake.
     * @param newStakedHearts Number of Hearts to stake
     * @param newStakedDays Number of days to stake
     */
    function stakeStart(uint256 newStakedHearts, uint256 newStakedDays)
        external
    {
        GlobalsCache memory g;
        GlobalsCache memory gSnapshot;
        _globalsLoad(g, gSnapshot);

        /* Enforce the minimum stake time */
        require(newStakedDays >= MIN_STAKE_DAYS, "HEX: newStakedDays lower than minimum");

        /* Check if log data needs to be updated */
        _dailyDataUpdateAuto(g);

        _stakeStart(g, newStakedHearts, newStakedDays);

        /* Remove staked Hearts from balance of staker */
        stakingToken.safeTransferFrom(msg.sender, address(this), newStakedHearts);

        _globalsSync(g, gSnapshot);
    }

    /**
     * @dev PUBLIC FACING: Unlocks a completed stake, distributing the proceeds of any penalty
     * immediately. The staker must still call stakeEnd() to retrieve their stake return (if any).
     * @param stakerAddr Address of staker
     * @param stakeIndex Index of stake within stake list
     * @param stakeIdParam The stake's id
     */
    function stakeGoodAccounting(address stakerAddr, uint256 stakeIndex, uint40 stakeIdParam)
        external
    {
        GlobalsCache memory g;
        GlobalsCache memory gSnapshot;
        _globalsLoad(g, gSnapshot);

        /* require() is more informative than the default assert() */
        require(stakeLists[stakerAddr].length != 0, "HEX: Empty stake list");
        require(stakeIndex < stakeLists[stakerAddr].length, "HEX: stakeIndex invalid");

        StakeStore storage stRef = stakeLists[stakerAddr][stakeIndex];

        /* Get stake copy */
        StakeCache memory st;
        _stakeLoad(stRef, stakeIdParam, st);

        /* Stake must have served full term */
        require(g._currentDay >= st._lockedDay + st._stakedDays, "HEX: Stake not fully served");

        /* Stake must still be locked */
        require(st._unlockedDay == 0, "HEX: Stake already unlocked");

        /* Check if log data needs to be updated */
        _dailyDataUpdateAuto(g);

        /* Unlock the completed stake */
        _stakeUnlock(g, st);

        /* stakeReturn value is unused here */
        (, uint256 payout, uint256 penalty, uint256 cappedPenalty) = _stakePerformance(
            g,
            st,
            st._stakedDays
        );

        _emitStakeGoodAccounting(
            stakerAddr,
            stakeIdParam,
            st._stakedHearts,
            st._stakeShares,
            payout,
            penalty
        );

        if (cappedPenalty != 0) {
            _splitPenaltyProceeds(g, cappedPenalty);
        }

        /* st._unlockedDay has changed */
        _stakeUpdate(stRef, st);

        _globalsSync(g, gSnapshot);
    }

    /**
     * @dev PUBLIC FACING: Closes a stake. The order of the stake list can change so
     * a stake id is used to reject stale indexes.
     * @param stakeIndex Index of stake within stake list
     * @param stakeIdParam The stake's id
     */
    function stakeEnd(uint256 stakeIndex, uint40 stakeIdParam)
        external
    {
        GlobalsCache memory g;
        GlobalsCache memory gSnapshot;
        _globalsLoad(g, gSnapshot);

        StakeStore[] storage stakeListRef = stakeLists[msg.sender];

        /* require() is more informative than the default assert() */
        require(stakeListRef.length != 0, "HEX: Empty stake list");
        require(stakeIndex < stakeListRef.length, "HEX: stakeIndex invalid");

        /* Get stake copy */
        StakeCache memory st;
        _stakeLoad(stakeListRef[stakeIndex], stakeIdParam, st);

        /* Check if log data needs to be updated */
        _dailyDataUpdateAuto(g);

        uint256 servedDays = 0;

        bool prevUnlocked = (st._unlockedDay != 0);
        uint256 stakeReturn;
        uint256 payout = 0;
        uint256 penalty = 0;
        uint256 cappedPenalty = 0;

        if (g._currentDay >= st._lockedDay) {
            if (prevUnlocked) {
                /* Previously unlocked in stakeGoodAccounting(), so must have served full term */
                servedDays = st._stakedDays;
            } else {
                _stakeUnlock(g, st);

                servedDays = g._currentDay - st._lockedDay;
                if (servedDays > st._stakedDays) {
                    servedDays = st._stakedDays;
                }
            }

            (stakeReturn, payout, penalty, cappedPenalty) = _stakePerformance(g, st, servedDays);
        } else {
            /* Stake hasn't been added to the total yet, so no penalties or rewards apply */
            g._nextStakeSharesTotal -= st._stakeShares;

            stakeReturn = st._stakedHearts;
        }

        _emitStakeEnd(
            stakeIdParam,
            st._stakedHearts,
            st._stakeShares,
            payout,
            penalty,
            servedDays,
            prevUnlocked
        );

        if (cappedPenalty != 0 && !prevUnlocked) {
            /* Split penalty proceeds only if not previously unlocked by stakeGoodAccounting() */
            _splitPenaltyProceeds(g, cappedPenalty);
        }

        /* Pay the stake return, if any, to the staker */
        if (stakeReturn != 0) {
            stakingToken.safeTransfer(msg.sender, stakeReturn);

            /* Update the share rate if necessary */
            _shareRateUpdate(g, st, stakeReturn);
        }
        g._lockedHeartsTotal -= st._stakedHearts;

        _stakeRemove(stakeListRef, stakeIndex);

        _globalsSync(g, gSnapshot);
    }

    /**
     * @dev PUBLIC FACING: Return the current stake count for a staker address
     * @param stakerAddr Address of staker
     */
    function stakeCount(address stakerAddr)
        external
        view
        returns (uint256)
    {
        return stakeLists[stakerAddr].length;
    }

    /**
     * @dev Open a stake.
     * @param g Cache of stored globals
     * @param newStakedHearts Number of Hearts to stake
     * @param newStakedDays Number of days to stake
     */
    function _stakeStart(
        GlobalsCache memory g,
        uint256 newStakedHearts,
        uint256 newStakedDays
    )
        internal
    {
        /* Enforce the maximum stake time */
        require(newStakedDays <= MAX_STAKE_DAYS, "HEX: newStakedDays higher than maximum");

        uint256 bonusHearts = _stakeStartBonusHearts(newStakedHearts, newStakedDays);
        uint256 newStakeShares = (newStakedHearts + bonusHearts) * SHARE_RATE_SCALE / g._shareRate;

        /* Ensure newStakedHearts is enough for at least one stake share */
        require(newStakeShares != 0, "HEX: newStakedHearts must be at least minimum shareRate");

        /*
            The stakeStart timestamp will always be part-way through the current
            day, so it needs to be rounded-up to the next day to ensure all
            stakes align with the same fixed calendar days. The current day is
            already rounded-down, so rounded-up is current day + 1.
        */
        uint256 newLockedDay = g._currentDay + 1;

        /* Create Stake */
        uint40 newStakeId = ++g._latestStakeId;
        _stakeAdd(
            stakeLists[msg.sender],
            newStakeId,
            newStakedHearts,
            newStakeShares,
            newLockedDay,
            newStakedDays
        );

        _emitStakeStart(newStakeId, newStakedHearts, newStakeShares, newStakedDays);

        /* Stake is added to total in the next round, not the current round */
        g._nextStakeSharesTotal += newStakeShares;

        /* Track total staked Hearts for inflation calculations */
        g._lockedHeartsTotal += newStakedHearts;
    }

    /**
     * @dev Calculates total stake payout including rewards for a multi-day range
     * @param g Cache of stored globals
     * @param stakeSharesParam Param from stake to calculate bonuses for
     * @param beginDay First day to calculate bonuses for
     * @param endDay Last day (non-inclusive) of range to calculate bonuses for
     * @return payout Payout in Hearts
     */
    function _calcPayoutRewards(
        GlobalsCache memory g,
        uint256 stakeSharesParam,
        uint256 beginDay,
        uint256 endDay
    )
        private
        view
        returns (uint256 payout)
    {
        for (uint256 day = beginDay; day < endDay; day++) {
            payout += dailyData[day].dayPayoutTotal * stakeSharesParam
                / dailyData[day].dayStakeSharesTotal;
        }

        return payout;
    }

    /**
     * @dev Calculate bonus Hearts for a new stake, if any
     * @param newStakedHearts Number of Hearts to stake
     * @param newStakedDays Number of days to stake
     */
    function _stakeStartBonusHearts(uint256 newStakedHearts, uint256 newStakedDays)
        private
        pure
        returns (uint256 bonusHearts)
    {
        /*
            LONGER PAYS BETTER:

            If longer than 1 day stake is committed to, each extra day
            gives bonus shares of approximately 0.0548%, which is approximately 20%
            extra per year of increased stake length committed to, but capped to a
            maximum of 200% extra.

            extraDays       =  stakedDays - 1

            longerBonus%    = (extraDays / 364) * 20%
                            = (extraDays / 364) / 5
                            =  extraDays / 1820
                            =  extraDays / LPB

            extraDays       =  longerBonus% * 1820
            extraDaysMax    =  longerBonusMax% * 1820
                            =  200% * 1820
                            =  3640
                            =  LPB_MAX_DAYS

            BIGGER PAYS BETTER:

            Bonus percentage scaled 0% to 10% for the first 150M HEX of stake.

            biggerBonus%    = (cappedHearts /  BPB_MAX_HEARTS) * 10%
                            = (cappedHearts /  BPB_MAX_HEARTS) / 10
                            =  cappedHearts / (BPB_MAX_HEARTS * 10)
                            =  cappedHearts /  BPB

            COMBINED:

            combinedBonus%  =            longerBonus%  +  biggerBonus%

                                      cappedExtraDays     cappedHearts
                            =         ---------------  +  ------------
                                            LPB               BPB

                                cappedExtraDays * BPB     cappedHearts * LPB
                            =   ---------------------  +  ------------------
                                      LPB * BPB               LPB * BPB

                                cappedExtraDays * BPB  +  cappedHearts * LPB
                            =   --------------------------------------------
                                                  LPB  *  BPB

            bonusHearts     = hearts * combinedBonus%
                            = hearts * (cappedExtraDays * BPB  +  cappedHearts * LPB) / (LPB * BPB)
        */
        uint256 cappedExtraDays = 0;

        /* Must be more than 1 day for Longer-Pays-Better */
        if (newStakedDays > 1) {
            cappedExtraDays = newStakedDays <= LPB_MAX_DAYS ? newStakedDays - 1 : LPB_MAX_DAYS;
        }

        uint256 cappedStakedHearts = newStakedHearts <= BPB_MAX_HEARTS
            ? newStakedHearts
            : BPB_MAX_HEARTS;

        bonusHearts = cappedExtraDays * BPB + cappedStakedHearts * LPB;
        bonusHearts = newStakedHearts * bonusHearts / (LPB * BPB);

        return bonusHearts;
    }

    function _stakeUnlock(GlobalsCache memory g, StakeCache memory st)
        private
        pure
    {
        g._stakeSharesTotal -= st._stakeShares;
        st._unlockedDay = g._currentDay;
    }

    function _stakePerformance(GlobalsCache memory g, StakeCache memory st, uint256 servedDays)
        private
        view
        returns (uint256 stakeReturn, uint256 payout, uint256 penalty, uint256 cappedPenalty)
    {
        if (servedDays < st._stakedDays) {
            (payout, penalty) = _calcPayoutAndEarlyPenalty(
                g,
                st._lockedDay,
                st._stakedDays,
                servedDays,
                st._stakeShares
            );
            stakeReturn = st._stakedHearts + payout;
        } else {
            // servedDays must == stakedDays here
            payout = _calcPayoutRewards(
                g,
                st._stakeShares,
                st._lockedDay,
                st._lockedDay + servedDays
            );
            stakeReturn = st._stakedHearts + payout;

            penalty = _calcLatePenalty(st._lockedDay, st._stakedDays, st._unlockedDay, stakeReturn);
        }
        if (penalty != 0) {
            if (penalty > stakeReturn) {
                /* Cannot have a negative stake return */
                cappedPenalty = stakeReturn;
                stakeReturn = 0;
            } else {
                /* Remove penalty from the stake return */
                cappedPenalty = penalty;
                stakeReturn -= cappedPenalty;
            }
        }
        return (stakeReturn, payout, penalty, cappedPenalty);
    }

    function _calcPayoutAndEarlyPenalty(
        GlobalsCache memory g,
        uint256 lockedDayParam,
        uint256 stakedDaysParam,
        uint256 servedDays,
        uint256 stakeSharesParam
    )
        private
        view
        returns (uint256 payout, uint256 penalty)
    {
        uint256 servedEndDay = lockedDayParam + servedDays;

        /* 50% of stakedDays (rounded up) with a minimum applied */
        uint256 penaltyDays = (stakedDaysParam + 1) / 2;
        if (penaltyDays < EARLY_PENALTY_MIN_DAYS) {
            penaltyDays = EARLY_PENALTY_MIN_DAYS;
        }

        if (servedDays == 0) {
            /* Fill penalty days with the estimated average payout */
            uint256 expected = _estimatePayoutRewardsDay(g, stakeSharesParam, lockedDayParam);
            penalty = expected * penaltyDays;
            return (payout, penalty); // Actual payout was 0
        }

        if (penaltyDays < servedDays) {
            /*
                Simplified explanation of intervals where end-day is non-inclusive:

                penalty:    [lockedDay  ...  penaltyEndDay)
                delta:                      [penaltyEndDay  ...  servedEndDay)
                payout:     [lockedDay  .......................  servedEndDay)
            */
            uint256 penaltyEndDay = lockedDayParam + penaltyDays;
            penalty = _calcPayoutRewards(g, stakeSharesParam, lockedDayParam, penaltyEndDay);

            uint256 delta = _calcPayoutRewards(g, stakeSharesParam, penaltyEndDay, servedEndDay);
            payout = penalty + delta;
            return (payout, penalty);
        }

        /* penaltyDays >= servedDays  */
        payout = _calcPayoutRewards(g, stakeSharesParam, lockedDayParam, servedEndDay);

        if (penaltyDays == servedDays) {
            penalty = payout;
        } else {
            /*
                (penaltyDays > servedDays) means not enough days served, so fill the
                penalty days with the average payout from only the days that were served.
            */
            penalty = payout * penaltyDays / servedDays;
        }
        return (payout, penalty);
    }

    function _calcLatePenalty(
        uint256 lockedDayParam,
        uint256 stakedDaysParam,
        uint256 unlockedDayParam,
        uint256 rawStakeReturn
    )
        private
        pure
        returns (uint256)
    {
        /* Allow grace time before penalties accrue */
        uint256 maxUnlockedDay = lockedDayParam + stakedDaysParam + LATE_PENALTY_GRACE_DAYS;
        if (unlockedDayParam <= maxUnlockedDay) {
            return 0;
        }

        /* Calculate penalty as a percentage of stake return based on time */
        return rawStakeReturn * (unlockedDayParam - maxUnlockedDay) / LATE_PENALTY_SCALE_DAYS;
    }

    function _splitPenaltyProceeds(GlobalsCache memory g, uint256 penalty)
        private
    {
        /* Split a penalty 50:50 between Origin and stakePenaltyTotal */
        uint256 splitPenalty = penalty / 2;

        if (splitPenalty != 0) {
            stakingToken.safeTransfer(ORIGIN_ADDR, splitPenalty);
        }

        /* Use the other half of the penalty to account for an odd-numbered penalty */
        splitPenalty = penalty - splitPenalty;
        g._stakePenaltyTotal += splitPenalty;
    }

    function _shareRateUpdate(GlobalsCache memory g, StakeCache memory st, uint256 stakeReturn)
        private
    {
        if (stakeReturn > st._stakedHearts) {
            /*
                Calculate the new shareRate that would yield the same number of shares if
                the user re-staked this stakeReturn, factoring in any bonuses they would
                receive in stakeStart().
            */
            uint256 bonusHearts = _stakeStartBonusHearts(stakeReturn, st._stakedDays);
            uint256 newShareRate = (stakeReturn + bonusHearts) * SHARE_RATE_SCALE / st._stakeShares;

            if (newShareRate > SHARE_RATE_MAX) {
                /*
                    Realistically this can't happen, but there are contrived theoretical
                    scenarios that can lead to extreme values of newShareRate, so it is
                    capped to prevent them anyway.
                */
                newShareRate = SHARE_RATE_MAX;
            }

            if (newShareRate > g._shareRate) {
                g._shareRate = newShareRate;

                _emitShareRateChange(newShareRate, st._stakeId);
            }
        }
    }

    function _emitStakeStart(
        uint40 stakeId,
        uint256 stakedHearts,
        uint256 stakeShares,
        uint256 stakedDays
    )
        private
    {
        emit StakeStart(
            msg.sender,
            stakeId,
            uint40(block.timestamp),
            uint72(stakedHearts),
            uint72(stakeShares),
            uint16(stakedDays)
        );
    }

    function _emitStakeGoodAccounting(
        address stakerAddr,
        uint40 stakeId,
        uint256 stakedHearts,
        uint256 stakeShares,
        uint256 payout,
        uint256 penalty
    )
        private
    {
        emit StakeGoodAccounting(
            stakerAddr,
            stakeId,
            msg.sender,
            uint40(block.timestamp),
            uint72(stakedHearts),
            uint72(stakeShares),
            uint72(payout),
            uint72(penalty)
        );
    }

    function _emitStakeEnd(
        uint40 stakeId,
        uint256 stakedHearts,
        uint256 stakeShares,
        uint256 payout,
        uint256 penalty,
        uint256 servedDays,
        bool prevUnlocked
    )
        private
    {
        emit StakeEnd(
            msg.sender,
            stakeId,
            uint40(block.timestamp),
            uint72(stakedHearts),
            uint72(stakeShares),
            uint72(payout),
            uint72(penalty),
            uint16(servedDays),
            prevUnlocked
        );
    }

    function _emitShareRateChange(uint256 shareRate, uint40 stakeId)
        private
    {
        emit ShareRateChange(
            stakeId,
            uint40(block.timestamp),
            uint40(shareRate)
        );
    }
}
