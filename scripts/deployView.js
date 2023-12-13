async function main() {
    const StakingView = await ethers.getContractFactory("StakingView");
    const stakingView = await StakingView.deploy();

    console.log("StakingView deployed to: " + stakingView.address);
}
  
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
});