const { expect } = require("chai");
const { time } = require("@openzeppelin/test-helpers");

// NEEDS TO BE MODIFIED FOR THE NEW CONSTANTS

describe("Staking smart contract", function() {
    let deployer, user1, user2, user3, contract, stakingToken, launchTime, currentDay;

    const PRECISION_LOSS = "1000000000000000000";

    const parseUnits = (value, decimals = 18) => {
        return ethers.utils.parseUnits(value.toString(), decimals);
    }

    const stakeStart = async(user, amount, days, expectedShares) => {
        contract = contract.connect(user);

        amount = parseUnits(amount);

        const contractBalanceBefore = await stakingToken.balanceOf(contract.address);
        const globalsBefore = await contract.globals();
        await contract.stakeStart(amount, days);
        const contractBalanceAfter = await stakingToken.balanceOf(contract.address);
        const globalsAfter = await contract.globals();

        const stakeCount = await contract.stakeCount(user.address);
        const stakeInfo = await contract.stakeLists(user.address, stakeCount - 1);
        expect(stakeInfo.lockedDay).to.equal(currentDay + 1);
        expect(stakeInfo.stakedDays).to.equal(days);
        expect(stakeInfo.stakedAmount).to.equal(amount);
        expect(stakeInfo.stakeShares).to.closeTo(parseUnits(expectedShares), PRECISION_LOSS);

        expect(contractBalanceAfter).to.equal(contractBalanceBefore.add(amount));
        expect(globalsAfter.lockedStakeTotal).to.equal(globalsBefore.lockedStakeTotal.add(stakeInfo.stakedAmount));
        expect(globalsAfter.nextStakeSharesTotal.add(globalsAfter.stakeSharesTotal)).to.equal(
            globalsBefore.nextStakeSharesTotal.add(globalsBefore.stakeSharesTotal).add(stakeInfo.stakeShares));
        expect(globalsAfter.stakePenaltyTotal).to.be.at.most(globalsBefore.stakePenaltyTotal);
        expect(globalsAfter.dailyDataCount).to.equal(currentDay);
    }

    const checkStakeEnd = async(user, stakeIndex, expectedStakeReturn, expectedCappedPenalty) => {
        contract = contract.connect(user);
        expectedStakeReturn = parseUnits(expectedStakeReturn);
        expectedCappedPenalty = parseUnits(expectedCappedPenalty);

        const stakeId = (await contract.stakeLists(user.address, stakeIndex)).stakeId;

        const unstakeData = await contract.callStatic.stakeEnd(stakeIndex, stakeId);
        expect(unstakeData.stakeReturn).to.closeTo(expectedStakeReturn, PRECISION_LOSS);
        expect(unstakeData.cappedPenalty).to.closeTo(expectedCappedPenalty, PRECISION_LOSS);
    }

    const stakeGoodAccounting = async(user, stakeIndex, caller) => {
        contract = contract.connect(user);
        const stakeInfo = await contract.stakeLists(user.address, stakeIndex);
        const unstakeData = await contract.callStatic.stakeEnd(stakeIndex, stakeInfo.stakeId);

        contract = contract.connect(caller);
        const userBalanceBefore = await stakingToken.balanceOf(user.address);
        const contractBalanceBefore = await stakingToken.balanceOf(contract.address);
        const originAddrBalanceBefore = await stakingToken.balanceOf(deployer.address);
        const globalsBefore = await contract.globals();
        await contract.stakeGoodAccounting(user.address, stakeIndex, stakeInfo.stakeId);
        const userBalanceAfter = await stakingToken.balanceOf(user.address);
        const contractBalanceAfter = await stakingToken.balanceOf(contract.address);
        const originAddrBalanceAfter = await stakingToken.balanceOf(deployer.address);
        const globalsAfter = await contract.globals();
        
        expect(userBalanceAfter).to.equal(userBalanceBefore);
        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(unstakeData.cappedPenalty.div(2)));
        expect(originAddrBalanceAfter).to.equal(originAddrBalanceBefore.add(unstakeData.cappedPenalty.div(2).mul(3).div(5)));
        
        expect(globalsAfter.lockedStakeTotal).to.equal(globalsBefore.lockedStakeTotal);
        expect(globalsAfter.stakeSharesTotal.add(globalsAfter.nextStakeSharesTotal)).to.equal(
            globalsBefore.stakeSharesTotal.add(globalsBefore.nextStakeSharesTotal).sub(stakeInfo.stakeShares));
        expect(globalsAfter.shareRate).to.equal(globalsBefore.shareRate);
        expect(globalsAfter.dailyDataCount).to.equal(currentDay);

        const stakeInfoAfter = await contract.stakeLists(user.address, stakeIndex);
        expect(stakeInfoAfter.stakedAmount).to.equal(stakeInfo.stakedAmount);
        expect(stakeInfoAfter.stakeShares).to.equal(stakeInfo.stakeShares);
        expect(stakeInfoAfter.unlockedDay).to.equal(currentDay);
    }

    const stakeEnd = async(user, stakeIndex, expectedShareRate) => {
        contract = contract.connect(user);
        const stakeInfo = await contract.stakeLists(user.address, stakeIndex);
        const unstakeData = await contract.callStatic.stakeEnd(stakeIndex, stakeInfo.stakeId);
        
        const userBalanceBefore = await stakingToken.balanceOf(user.address);
        const contractBalanceBefore = await stakingToken.balanceOf(contract.address);
        const originAddrBalanceBefore = await stakingToken.balanceOf(deployer.address);
        const globalsBefore = await contract.globals();
        await contract.stakeEnd(stakeIndex, stakeInfo.stakeId);
        const userBalanceAfter = await stakingToken.balanceOf(user.address);
        const contractBalanceAfter = await stakingToken.balanceOf(contract.address);
        const originAddrBalanceAfter = await stakingToken.balanceOf(deployer.address);
        const globalsAfter = await contract.globals();

        expect(userBalanceAfter).to.equal(userBalanceBefore.add(unstakeData.stakeReturn));
        if (stakeInfo.unlockedDay == 0) {
            expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(unstakeData.stakeReturn).sub(unstakeData.cappedPenalty.div(2)));
            expect(originAddrBalanceAfter).to.equal(originAddrBalanceBefore.add(unstakeData.cappedPenalty.div(2).mul(3).div(5)));
            expect(globalsAfter.nextStakeSharesTotal.add(globalsAfter.stakeSharesTotal)).to.equal(
                globalsBefore.nextStakeSharesTotal.add(globalsBefore.stakeSharesTotal).sub(stakeInfo.stakeShares));
        } else {
            expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(unstakeData.stakeReturn));
            expect(originAddrBalanceAfter).to.equal(originAddrBalanceBefore);
        }
        expect(globalsAfter.lockedStakeTotal).to.equal(globalsBefore.lockedStakeTotal.sub(stakeInfo.stakedAmount));
        expect(globalsAfter.shareRate).to.closeTo(parseUnits(expectedShareRate, 5), "100000");
        expect(globalsAfter.dailyDataCount).to.equal(currentDay);
    }

    const fundRewards = async(amountPerDay, daysCount, shiftInDays) => {
        contract = contract.connect(deployer);
        amountPerDay = parseUnits(amountPerDay);
        
        const from = currentDay + 1 + shiftInDays;
        const dailyDataBefore = await contract.dailyDataRange(from, from + daysCount);

        await contract.fundRewards(amountPerDay, daysCount, shiftInDays);

        const dailyData = await contract.dailyDataRange(from, from + daysCount);
        for (const i in dailyData.listDayPayoutTotal) {
            expect(dailyData.listDayPayoutTotal[i]).to.equal(dailyDataBefore.listDayPayoutTotal[i].add(amountPerDay));
        }
    }

    const increaseDays = async(days) => {
        await time.increase(time.duration.days(days));
        currentDay += days;
    }

    const init = async() => {
        [deployer, user1, user2, user3] = await ethers.getSigners();
    
        launchTime = (Number(await time.latest()) + 10).toString();
        currentDay = 0;

        const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
        stakingToken = await ERC20Mock.deploy("MOCK1", "MOCK1", deployer.address, parseUnits("12000000000"), 18);
        const StakingSC = await ethers.getContractFactory("Staking");
        contract = await StakingSC.deploy(stakingToken.address, launchTime, deployer.address);
        await time.increase(10);

        const amount = parseUnits("3000000000");
        stakingToken.transfer(user1.address, amount);
        stakingToken.transfer(user2.address, amount);
        stakingToken.transfer(user3.address, amount);
        
        stakingToken.approve(contract.address, amount);
        stakingToken = stakingToken.connect(user1);
        stakingToken.approve(contract.address, amount);
        stakingToken = stakingToken.connect(user2);
        stakingToken.approve(contract.address, amount);
        stakingToken = stakingToken.connect(user3);
        stakingToken.approve(contract.address, amount);
    }

    describe("Simple test with 2 users staking the same (small) amount for the same time", function() {
        before(async function() {
            await init();
        });

        it("Deployer funds", async function() {
            await fundRewards(10, 30, 0);
        });
    
        it("User 1 and 2 stake 100 tokens for 20 days", async function() {
            await stakeStart(user1, 100, 30, 148);
            await stakeStart(user2, 100, 30, 148);
        });

        it("Check hard lock", async function() {
            contract = contract.connect(user1);
            await expect(contract.stakeEnd(0, 1)).to.be.revertedWith("STAKING: hard lock period");
            increaseDays(15);
            await expect(contract.stakeEnd(0, 1)).to.be.revertedWith("STAKING: hard lock period");
        });
    
        it("Checks multiple days for reward and penalty of users, who then unstake after their lock periods end", async function() {
            increaseDays(1);
            await checkStakeEnd(user1, 0, 25, 150);
            await checkStakeEnd(user2, 0, 25, 150);

            increaseDays(5);
            await checkStakeEnd(user1, 0, 50, 150);
            await checkStakeEnd(user2, 0, 50, 150);

            increaseDays(5);
            await checkStakeEnd(user1, 0, 75, 150);
            await checkStakeEnd(user2, 0, 75, 150);

            increaseDays(5);
            await checkStakeEnd(user1, 0, 250, 0);
            await checkStakeEnd(user2, 0, 250, 0);
            await stakeEnd(user1, 0, 2.5);
            await stakeEnd(user2, 0, 2.5);
        });
    });

    describe("Test with 2 users staking for different times, small amounts", function() {
        before(async function() {
            await init();
        });

        it("User 1 stakes 100 tokens for 2 years, user 2 for 1 year", async function() {
            await stakeStart(user1, 100, 730, 1315);
            await stakeStart(user2, 100, 365, 706);
        });

        it("Deployer funds multiple times", async function() {
            await fundRewards(5, 365, 0);
            await fundRewards(5, 365, 0);
            await fundRewards(5, 365, 365);
            await fundRewards(5, 365, 365);
        });

        it("Checks early fees", async function() {
            increaseDays(16);
            await checkStakeEnd(user1, 0, 0, 197);
            await checkStakeEnd(user2, 0, 0, 152);

            increaseDays(15);
            await checkStakeEnd(user1, 0, 0, 295);
            await checkStakeEnd(user2, 0, 0, 204);

            increaseDays(60);
            await checkStakeEnd(user1, 0, 0, 685);
            await checkStakeEnd(user2, 0, 0, 415);
        });

        it("user 2 has staked for half of the period he committed to, his stake return is now minimally the stake amount he put in", async function() {
            increaseDays(93);
            await checkStakeEnd(user2, 0, 100, 640);
        });

        it("user 2 stake ends, 0 penalty and unstakes", async function() {
            increaseDays(182);
            await checkStakeEnd(user2, 0, 1376, 0);
            await stakeEnd(user2, 0, 13);
        });

        it("user 1 has staked for half of the period he committed to", async function() {
            await checkStakeEnd(user1, 0, 100, 2374);
        });

        it("user 1 now has all the reward in the pool for himself", async function() {
            increaseDays(365);
            await checkStakeEnd(user1, 0, 6124, 0);
            increaseDays(1);
            await checkStakeEnd(user1, 0, 6124, 0);
            increaseDays(1);
            await checkStakeEnd(user1, 0, 6124, 0);
        });

        it("user 1 late fee", async function() {
            const totalReturn = 6124;
            increaseDays(28);
            await checkStakeEnd(user1, 0, totalReturn, 0);

            // late fee start
            increaseDays(50);
            await checkStakeEnd(user1, 0, totalReturn / 2, totalReturn / 2);

            await contract.dailyDataUpdate(currentDay);

            increaseDays(49);
            await checkStakeEnd(user1, 0, totalReturn / 100, totalReturn / 100 * 99);

            increaseDays(1);
            await checkStakeEnd(user1, 0, 0, totalReturn);
        });

        it("User 3 stakes ends stake for user 1, getting half of his total return", async function() {
            increaseDays(10);

            await stakeStart(user3, 100, 30, 11);
            increaseDays(1);
            await stakeGoodAccounting(user1, 0, user3);
            increaseDays(15);
            await checkStakeEnd(user3, 0, 0, 3162);

            await expect(contract.stakeGoodAccounting(user1.address, 0, 1)).to.be.revertedWith("STAKING: Stake already unlocked");
            await expect(contract.stakeGoodAccounting(user3.address, 0, 3)).to.be.revertedWith("STAKING: Stake not fully served");

            increaseDays(15);
            await checkStakeEnd(user3, 0, 3162, 0);
            await stakeEnd(user3, 0, 435);
        });

        it("User 1 stakes for 100000 amount for 200 days, unstakes after 120 days", async function() {
            await fundRewards(10, 200, 0);

            await stakeStart(user1, 100000, 200, 998);
            increaseDays(120);

            await checkStakeEnd(user1, 1, 100189, 1000);
            await stakeEnd(user1, 1, 435);
        });

        it("User 1 unstakes the first stake with late fee", async function() {
            await stakeEnd(user1, 0, 435);
        
            expect(await stakingToken.balanceOf(contract.address)).to.closeTo(parseUnits(1310), PRECISION_LOSS);
        });
    });

    describe("Test share bonuses", function() {
        before(async function() {
            await init();
        });

        it("Check bonus for 50000 amount", async function() {
            const bonusShares = await contract.stakeStartBonusShares(parseUnits("50000"), 1);
            expect(bonusShares).to.closeTo(parseUnits("0"), PRECISION_LOSS);
        });

        it("Check bonus for 100000 amount (2.5%)", async function() {
            const bonusShares = await contract.stakeStartBonusShares(parseUnits("100000"), 1);
            expect(bonusShares).to.closeTo(parseUnits("2500"), PRECISION_LOSS);
        });

        it("Check max bonus for 1050000 amount (50%)", async function() {
            const bonusShares = await contract.stakeStartBonusShares(parseUnits("1050000"), 1);
            expect(bonusShares).to.equal(parseUnits("525000"));
        });

        it("Check max bonus for 2000000 amount (capped 50%)", async function() {
            const bonusShares = await contract.stakeStartBonusShares(parseUnits("2000000"), 1);
            expect(bonusShares).to.equal(parseUnits("1000000"));
        });

        it("Check bonuses for staking longer", async function() {
            let bonusShares = await contract.stakeStartBonusShares(parseUnits("1"), 365);
            expect(bonusShares).to.closeTo(parseUnits("6"), PRECISION_LOSS);

            bonusShares = await contract.stakeStartBonusShares(parseUnits("1"), 365 * 2);
            expect(bonusShares).to.closeTo(parseUnits("12"), PRECISION_LOSS);

            bonusShares = await contract.stakeStartBonusShares(parseUnits("1"), 365 * 3);
            expect(bonusShares).to.closeTo(parseUnits("18"), PRECISION_LOSS);

            bonusShares = await contract.stakeStartBonusShares(parseUnits("1"), 365 * 4);
            expect(bonusShares).to.closeTo(parseUnits("18"), PRECISION_LOSS);
        });
    });

    describe("Test input require statements in external functions", function () {
        before(async function() {
            await init();
            await stakeStart(user1, 100, 30, 148);
        });

        it("Stake start inputs", async function() {
            contract = contract.connect(user1);
            await expect(contract.stakeStart(100, 29)).to.be.revertedWith("STAKING: newStakedDays lower than minimum");
            await expect(contract.stakeStart(100, 0)).to.be.revertedWith("STAKING: newStakedDays lower than minimum");
            await expect(contract.stakeStart(0, 100)).to.be.revertedWith("STAKING: newStakedAmount must be at least minimum shareRate");
            await expect(contract.stakeStart(100, 55555)).to.be.revertedWith("STAKING: newStakedDays higher than maximum");
        });

        it("Stake end inputs", async function() {
            await expect(contract.stakeEnd(0, 1)).to.be.revertedWith("STAKING: hard lock period");
            increaseDays(16);
            await expect(contract.stakeEnd(0, 10)).to.be.revertedWith("STAKING: stakeIdParam not in stake");
            await expect(contract.stakeEnd(10, 10)).to.be.revertedWith("STAKING: stakeIndex invalid");
        });

        it("Stake good accounting inputs", async function() {
            await expect(contract.stakeGoodAccounting(user1.address, 0, 10)).to.be.revertedWith("STAKING: stakeIdParam not in stake");
            await expect(contract.stakeGoodAccounting(user1.address, 10, 10)).to.be.revertedWith("STAKING: stakeIndex invalid");
            await expect(contract.stakeGoodAccounting(deployer.address, 0, 10)).to.be.revertedWith("STAKING: Empty stake list");
        });

        it("Fund rewards inputs", async function() {
            await expect(contract.fundRewards(5, 366, 0)).to.be.revertedWith("STAKING: too many days");
        });

        it("Daily data update inputs", async function () {
            await expect(contract.dailyDataUpdate(currentDay + 1)).to.be.revertedWith("STAKING: beforeDay cannot be in the future");
        });
    });

    describe("Test distributing allocated (for late unstakers) unclaimable reward", function() {
        before(async function() {
            await init();
            await fundRewards(10, 35, 0);

            await stakeStart(user1, 100, 30, 148);
            increaseDays(5);
            await stakeStart(user2, 100, 30, 148);
            increaseDays(26);
            await checkStakeEnd(user1, 0, 275, 0);
        });

        it("User 1 unstakes 3 days late, his allocated unclaimable reward is added as reward for the next day", async function () {
            increaseDays(3);
            await stakeEnd(user1, 0, 2.5);
        });

        it("User 2 gets the unclaimable reward by user 1", async function() {
            increaseDays(2);
            await checkStakeEnd(user2, 0, 275, 0);
            await stakeEnd(user2, 0, 2.5);
        });
    });

    describe("Test function getStakeStatus", function() {
        before(async function() {
            await init();
            await stakeStart(user1, 100, 30, 148);
            increaseDays(20);
            await contract.dailyDataUpdate(currentDay);
        });

        it("getStakeStatus returns the same as the endStake function", async function() {
            const stakeEndResult = await contract.callStatic.stakeEnd(0, 1);
            const getStakeStatusResult = await contract.getStakeStatus(user1.address, 0, 1);

            expect(stakeEndResult.stakeReturn).to.equal(getStakeStatusResult.stakeReturn);
            expect(stakeEndResult.payout).to.equal(getStakeStatusResult.payout);
            expect(stakeEndResult.penalty).to.equal(getStakeStatusResult.penalty);
            expect(stakeEndResult.cappedPenalty).to.equal(getStakeStatusResult.cappedPenalty);
        });
    });
});