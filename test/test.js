const { expect } = require("chai");
const { time } = require("@openzeppelin/test-helpers");

describe("Staking smart contract", function() {
    let deployer, user1, user2, user3, contract, stakingToken, launchTime, currentDay;

    const PRECISION_LOSS = "1000000000";
    let shareRate = 1;

    // SC CONSTANTS BUST BE THE SAME FOR PROPER WORKING OF THIS UNIT TEST!
    const BPB_MAX_PERCENT = 0.1;
    const BPB = 1500000000;
    const LPB_MAX_PERCENT = 2;
    const LPB = 1820;

    const parseUnits = (value, decimals = 18) => {
        return ethers.utils.parseUnits(value.toString(), decimals);
    }

    const calcExpectedShares = (amount, days) => {
        let amountBonus = amount / BPB;
        if (amountBonus > BPB_MAX_PERCENT) amountBonus = BPB_MAX_PERCENT;
        let daysBonus = (days - 1) / LPB;
        if (daysBonus > LPB_MAX_PERCENT) daysBonus = LPB_MAX_PERCENT;
        const bonus = 1 + ((amountBonus + daysBonus) / shareRate);
        const expectedShares = amount * bonus;
        return expectedShares;
    }

    const calcShareRate = (amountBefore, amountAfter, days) => {
        let sharesBefore = calcExpectedShares(amountBefore, days);
        let sharesAfter = calcExpectedShares(amountAfter, days);
        return parseUnits(sharesAfter / sharesBefore, 5);
    }

    const stakeStart = async(user, amount, days) => {
        contract = contract.connect(user);

        let expectedShares = calcExpectedShares(amount, days);
        expectedShares = parseUnits(expectedShares);
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
        expect(stakeInfo.stakeShares).to.closeTo(expectedShares, PRECISION_LOSS);

        expect(contractBalanceAfter).to.equal(contractBalanceBefore.add(amount));
        expect(globalsAfter.lockedStakeTotal).to.equal(globalsBefore.lockedStakeTotal.add(stakeInfo.stakedAmount));
        expect(globalsAfter.nextStakeSharesTotal.add(globalsAfter.stakeSharesTotal)).to.equal(
            globalsBefore.nextStakeSharesTotal.add(globalsBefore.stakeSharesTotal).add(stakeInfo.stakeShares));
        expect(globalsAfter.stakePenaltyTotal).to.be.at.most(globalsBefore.stakePenaltyTotal);
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

    const stakeEnd = async(user, stakeIndex) => {
        contract = contract.connect(user);
        const stakeInfo = await contract.stakeLists(user.address, stakeIndex);
        const unstakeData = await contract.callStatic.stakeEnd(stakeIndex, stakeInfo.stakeId);
        
        const contractBalanceBefore = await stakingToken.balanceOf(contract.address);
        const originAddrBalanceBefore = await stakingToken.balanceOf(deployer.address);
        const globalsBefore = await contract.globals();
        await contract.stakeEnd(stakeIndex, stakeInfo.stakeId);
        const contractBalanceAfter = await stakingToken.balanceOf(contract.address);
        const originAddrBalanceAfter = await stakingToken.balanceOf(deployer.address);
        const globalsAfter = await contract.globals();

        expect(contractBalanceAfter).to.equal(contractBalanceBefore.sub(unstakeData.stakeReturn).add(unstakeData.cappedPenalty.div(2)));
        expect(originAddrBalanceAfter).to.equal(originAddrBalanceBefore.add(unstakeData.cappedPenalty.div(2)));
        expect(globalsAfter.lockedStakeTotal).to.equal(globalsBefore.lockedStakeTotal.sub(stakeInfo.stakedAmount));
        expect(globalsAfter.nextStakeSharesTotal.add(globalsAfter.stakeSharesTotal)).to.equal(
            globalsBefore.nextStakeSharesTotal.add(globalsBefore.stakeSharesTotal).sub(stakeInfo.stakeShares));
        expect(globalsAfter.stakePenaltyTotal).to.equal(globalsBefore.stakePenaltyTotal.add(unstakeData.cappedPenalty.div(2)));

        const minShareRate = calcShareRate(stakeInfo.stakedAmount, unstakeData.stakeReturn, stakeInfo.stakedDays);
        expect(globalsAfter.shareRate).to.be.at.least(minShareRate);
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



    describe("full flow test 1", function() {
        before(async function() {
            await init();
        });

        it("Deployer funds", async function() {
            await fundRewards(10, 10, 0);
        });
    
        it("User 1 and 2 stake 100 tokens for 10 days", async function() {
            await stakeStart(user1, 100, 10);
            await stakeStart(user2, 100, 10);
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
            await stakeEnd(user1, 0);
            await stakeEnd(user2, 0);
        });
    });
});