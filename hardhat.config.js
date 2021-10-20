require('dotenv').config();
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-web3");
require("hardhat-gas-reporter");
require("hardhat-abi-exporter");

module.exports = {
    solidity: {
        version: "0.8.4",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            }
        }
    },
    networks: {
        kovan: {
            url: `https://kovan.infura.io/v3/${process.env.INFURA_KEY}`,
            accounts: [`0x${process.env.PRIVATE_KEY}`],
            gasPrice: 1e9
        },
        mainnet: {
            url: `https://mainnet.infura.io/v3/${process.env.INFURA_KEY}`,
            accounts: [`0x${process.env.PRIVATE_KEY}`],
        },
    },
    abiExporter: {
        path: './abi',
        clear: true,
        flat: true,
    }
};
