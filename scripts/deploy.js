async function main() {
    const stakingToken = "0xF1007A2cdff2A3EBc6FAad1F86F9ce1d30593927";
    const launchTime = 1650362100;
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