const Migrations = artifacts.require("Migrations");

const web3Helper = require("../helpers/web3");
const { address, password } = require("../household-server-config");

module.exports = async (deployer, network) => {
  if (network !== "authority" && network !== "authority_docker") {
    if (network === "benchmark") {
      const web3 = web3Helper.initWeb3("benchmark");
      await web3Helper.unlockAccount(web3, network, address, password)
      await deployer.deploy(Migrations);
      await web3Helper.unlockAccount(web3, network, address, password)
    } else {
      await deployer.deploy(Migrations);
    }
  }
};
