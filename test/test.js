const { expect } = require("chai");
const { time } = require("@openzeppelin/test-helpers");

describe("Staking smart contract", function() {
    let deployer, user1, user2, user3, contract, stakingToken, launchTime, currentDay;

    const PRECISION_LOSS = "1000000000000000";

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
        expect(globalsAfter.shareRate).to.closeTo(parseUnits(expectedShareRate, 5), "1000");
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
    
        launchTime = (await time.latest()).toString();
        currentDay = 0;

        const ERC20Mock = await ethers.getContractFactory("ERC20Mock");
        stakingToken = await ERC20Mock.deploy("MOCK1", "MOCK1", deployer.address, parseUnits("12000000000"), 18);
        const StakingSC = await ethers.getContractFactory("Staking");
        contract = await StakingSC.deploy(stakingToken.address, launchTime, deployer.address);

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

    before(async function() {
        await init();
    });

    describe("Simple test with 2 users staking the same (small) amount for the same time", function() {
        it("Deployer funds", async function() {
            await fundRewards(10, 10, 0);
        });
    
        it("User 1 and 2 stake 100 tokens for 10 days", async function() {
            await stakeStart(user1, 100, 10, 100.494);
            await stakeStart(user2, 100, 10, 100.494);
        });
    
        it("Checks multiple days for reward and penalty of users, who then unstake after 20 days", async function() {
            await checkStakeEnd(user1, 0, 100, 0);
            await checkStakeEnd(user2, 0, 100, 0);

            increaseDays(1);
            await checkStakeEnd(user1, 0, 0, 100);
            await checkStakeEnd(user2, 0, 0, 100);

            increaseDays(4);
            await checkStakeEnd(user1, 0, 0, 120);
            await checkStakeEnd(user2, 0, 0, 120);

            increaseDays(5);
            await checkStakeEnd(user1, 0, 0, 145);
            await checkStakeEnd(user2, 0, 0, 145);

            increaseDays(1);
            await checkStakeEnd(user1, 0, 150, 0);
            await checkStakeEnd(user2, 0, 150, 0);

            increaseDays(10);
            await checkStakeEnd(user1, 0, 150, 0);
            await checkStakeEnd(user2, 0, 150, 0);
            await stakeEnd(user1, 0, 1.5);
            await stakeEnd(user2, 0, 1.5);
        });
    });

    describe("Test with 2 users staking for different times, small amounts", function() {
        it("User 1 stakes 100 tokens for 2 years, user 2 for 1 year", async function() {
            await stakeStart(user1, 100, 730, 93.37);
            await stakeStart(user2, 100, 365, 80);
        });

        it("Deployer funds multiple times", async function() {
            await fundRewards(5, 365, 0);
            await fundRewards(5, 365, 0);
            await fundRewards(5, 365, 365);
            await fundRewards(5, 365, 365);
        });

        it("Checks early fees", async function() {
            await checkStakeEnd(user1, 0, 100, 0);
            await checkStakeEnd(user2, 0, 100, 0);

            increaseDays(1);
            await checkStakeEnd(user1, 0, 0, 100);
            await checkStakeEnd(user2, 0, 0, 100);

            increaseDays(4);
            await checkStakeEnd(user1, 0, 0, 121.543);
            await checkStakeEnd(user2, 0, 0, 118.457);

            increaseDays(86);
            await checkStakeEnd(user1, 0, 0, 584.703);
            await checkStakeEnd(user2, 0, 0, 515.296);
        });

        it("user 2 has staked for half of the period he committed to, his stake return is now minimally the stake amount he put in", async function() {
            increaseDays(93);
            await checkStakeEnd(user2, 0, 100, 844.437);
        });

        it("user 2 stake ends, 0 penalty and unstakes", async function() {
            increaseDays(182);
            await checkStakeEnd(user2, 0, 1784.259, 0);
            await stakeEnd(user2, 0, 26.764);
        });

        it("user 1 has staked for half of the period he committed to", async function() {
            await checkStakeEnd(user1, 0, 100, 1965.74);
        });

        it("user 1 now has all the reward in the pool for himself", async function() {
            increaseDays(365);
            await checkStakeEnd(user1, 0, 5715.74, 0);
            increaseDays(1);
            await checkStakeEnd(user1, 0, 5715.74, 0);
            increaseDays(1);
            await checkStakeEnd(user1, 0, 5715.74, 0);
        });

        it("user 1 late fee", async function() {
            const totalReturn = 5715.74;
            increaseDays(12);
            await checkStakeEnd(user1, 0, totalReturn, 0);

            // late fee start
            increaseDays(350);
            await checkStakeEnd(user1, 0, totalReturn / 2, totalReturn / 2);

            await contract.dailyDataUpdate(currentDay);

            increaseDays(349);
            await checkStakeEnd(user1, 0, totalReturn / 700, totalReturn / 700 * 699);

            increaseDays(1);
            await checkStakeEnd(user1, 0, 0, totalReturn);
        });

        it("User 3 stakes for 10 days and ends stake for user, getting half of his total return", async function() {
            increaseDays(10);

            await stakeStart(user3, 100, 10, 3.755);
            increaseDays(1);
            await stakeGoodAccounting(user1, 0, user3);
            increaseDays(1);
            await checkStakeEnd(user3, 0, 0, 2957.87);

            await expect(contract.stakeGoodAccounting(user1.address, 0, 3)).to.be.revertedWith("STAKING: Stake already unlocked");
            await expect(contract.stakeGoodAccounting(user3.address, 0, 5)).to.be.revertedWith("STAKING: Stake not fully served");

            increaseDays(10);
            await checkStakeEnd(user3, 0, 2957.87, 0);
            await stakeEnd(user3, 0, 791.643);
        });

        it("User 1 stakes for 200 days, unstakes after 120 days", async function() {
            await fundRewards(10, 200, 0);

            await stakeStart(user1, 100, 200, 0.14013);
            increaseDays(120);

            await checkStakeEnd(user1, 1, 289.999, 999.999);
            await stakeEnd(user1, 1, 2295.765);
        });

        it("User 1 unstakes the first stake with late fee", async function() {
            await stakeEnd(user1, 0, 2295.765);
        });

        it("User 1 stakes again", async function() {
            await stakeStart(user1, 100, 10, 0.04377);
        });
    });

    describe("Test share bonuses", function() {
        it("Check max bonus for bigger amount (6.666%)", async function() {
            const bonusShares = await contract.stakeStartBonusShares(parseUnits("100000000"), 1);
            expect(bonusShares).to.closeTo(parseUnits("6666666.666"), PRECISION_LOSS);
        });

        it("Check max bonus for bigger amount (10% capped)", async function() {
            const bonusShares = await contract.stakeStartBonusShares(parseUnits("300000000"), 1);
            expect(bonusShares).to.equal(parseUnits("30000000"));
        });

        it("Check max bonus for longer time", async function() {
            let bonusShares = await contract.stakeStartBonusShares(parseUnits("1"), 365 * 5);
            expect(bonusShares).to.closeTo(parseUnits("1.0022"), PRECISION_LOSS);

            bonusShares = await contract.stakeStartBonusShares(parseUnits("1"), 365 * 10);
            expect(bonusShares).to.closeTo(parseUnits("2"), PRECISION_LOSS);

            bonusShares = await contract.stakeStartBonusShares(parseUnits("1"), 365 * 15);
            expect(bonusShares).to.closeTo(parseUnits("2"), PRECISION_LOSS);
        });
    });

    describe("Test input require statements in external functions", function () {
        it("Stake start inputs", async function() {
            contract = contract.connect(user1);
            await expect(contract.stakeStart(100, 0)).to.be.revertedWith("STAKING: newStakedDays lower than minimum");
            await expect(contract.stakeStart(0, 100)).to.be.revertedWith("STAKING: newStakedAmount must be at least minimum shareRate");
            await expect(contract.stakeStart(100, 55555)).to.be.revertedWith("STAKING: newStakedDays higher than maximum");
        });

        it("Stake end inputs", async function() {
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
});