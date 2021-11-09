async function main() {
    const stakingToken = "0x141fe79c2a797fd5ad703fc3752bdbc66afb52aa";
    const launchTime = 1636411860;
    const originAddr = "0xcF28556EE95Be8c52AD2f3480149128cCA51daC1";

    const Staking = await ethers.getContractFactory("Staking");
    const staking = await Staking.deploy(stakingToken, launchTime, originAddr);

    console.log("Staking deployed to: " + staking.address);
}
  
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
});