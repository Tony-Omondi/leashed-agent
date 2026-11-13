require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.24",
  networks: {
    // The built-in local practice chain. `npm run chain` serves it at
    // http://127.0.0.1:8545 with funded test accounts (fake ETH only).
    localhost: {
      url: "http://127.0.0.1:8545",
    },
  },
};
