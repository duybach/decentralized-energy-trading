const express = require("express");
const cors = require("cors");
const commander = require("commander");
const web3Utils = require("web3-utils");
const shell = require("shelljs");
const fs = require("fs");
const grpc = require("grpc");
const Utility = require("./utility");
const hhHandler = require("./household-handler");
const zkHandler = require("./zk-handler");
const web3Helper = require("../helpers/web3");
const contractHelper = require("../helpers/contract");
const request = require("request-promise");

const serverConfig = require("../ned-server-config");

// Specify cli options
commander
  .option("-h, --host <type>", "ip of ned server")
  .option("-p, --port <type>", "port of ned server")
  .option("-i, --interval <type>", "interval of the netting")
  .option(
    "-n, --network <type>",
    "network name specified in truffle-config.js"
  )
  .option("-s, --pathssl <type>", "path to tls.cert for LND node")
  .option(
      "-m, --pathmacaroon <type>",
      "path to admin.macaroon for LND node"
  )
  .option("-l, --portlndgrpc <type>", "port of lnd server for grpc")
  .option("-a --addresslnd <type>", "address of lnd server for communication");
commander.parse(process.argv);

const config = {
  nettingInterval: commander.interval || serverConfig.nettingInterval,
  host: commander.host || serverConfig.host,
  port: commander.port || serverConfig.port,
  network: commander.network || serverConfig.network,
  address: serverConfig.address,
  password: serverConfig.password,
  portlndgrpc: commander.portlndgrpc || serverConfig.portlndgrpc,
  addresslnd: commander.addresslnd || serverConfig.addresslnd,
  pathssl: commander.pathssl || serverConfig.pathssl,
  pathmacaroon: commander.pathmacaroon || serverConfig.pathmacaroon
};

let web3;
/** @type Utility */
let utility;
/** @type Utility */
let utilityAfterNetting;
let ownedSetContract;
let utilityContract;
let latestBlockNumber;
let lnrpc;
let lndCert;
let sslCreds;
let macaroonCreds;
let macaroon;
let metadata;
let creds;
let lnd_request;
let lightning;
let invoiceListener;
let options;
let nettingStatus = new Date().getTime();

async function init() {
  web3 = web3Helper.initWeb3(config.network);
  latestBlockNumber = await web3.eth.getBlockNumber();

  // Init lightning
  lightning = lndHandler();

  // Off-chain utility instance
  utility = new Utility();
  utilityContract = new web3.eth.Contract(
    contractHelper.getAbi("dUtility"),
    contractHelper.getDeployedAddress("dUtility", await web3.eth.net.getId())
  );
  ownedSetContract = new web3.eth.Contract(
    contractHelper.getAbi("ownedSet"),
    contractHelper.getDeployedAddress("ownedSet", await web3.eth.net.getId())
  );

  shell.cd("zokrates-code");

  utilityContract.events.NettingSuccess(
    {
      fromBlock: latestBlockNumber
    },
    async (error, event) => {
      if (error) {
        console.error(error.msg);
        throw error;
      }
      console.log("Netting Successful!");
      latestBlockNumber = event.blockNumber;
      utility = utilityAfterNetting;
    }
  );

  async function runZokrates() {
    shell.cd("zokrates-code");
    let utilityBeforeNetting = JSON.parse(JSON.stringify(utility)); // dirty hack for obtaining deep copy of utility
    Object.setPrototypeOf(utilityBeforeNetting, Utility.prototype);
    utilityAfterNetting = { ...utility };
    Object.setPrototypeOf(utilityAfterNetting, Utility.prototype);
    utilityAfterNetting.settle();
    console.log("Utility before Netting: ", utilityBeforeNetting)
    console.log("Utility after Netting: ", utilityAfterNetting)

    nettingStatus = new Date().getTime() / 1000;

    console.log(`Sleep for ${config.nettingInterval}ms ...`);
    setTimeout(() => {
      runZokrates();
    }, config.nettingInterval);

    /*
    let hhAddresses = zkHandler.generateProof(
      utilityBeforeNetting,
      utilityAfterNetting,
      "production_mode"
    );

    let rawdata = fs.readFileSync("../zokrates-code/proof.json");
    let data = JSON.parse(rawdata);
    if (hhAddresses.length > 0) {
      await web3.eth.personal.unlockAccount(
        config.address,
        config.password,
        null
      );
      utilityContract.methods
        .checkNetting(
          hhAddresses,
          data.proof.a,
          data.proof.b,
          data.proof.c,
          data.inputs
        )
        .send({ from: config.address, gas: 60000000 }, (error, txHash) => {
          if (error) {
            console.error(error.message);
            throw error;
          }
          console.log(`Sleep for ${config.nettingInterval}ms ...`);
          setTimeout(() => {
            runZokrates();
          }, config.nettingInterval);
        });
    } else {
      console.log("No households to hash.");
      console.log(`Sleep for ${config.nettingInterval}ms ...`);
      setTimeout(() => {
        runZokrates();
      }, config.nettingInterval);
    }
    */

    shell.cd("..");
  }

  setTimeout(() => {
    runZokrates();
  }, config.nettingInterval);

  shell.cd("..");
}

init();

const app = express();

app.use(express.json());
app.use(cors());

function lndHandler() {
  lnrpc = grpc.load('rpc.proto').lnrpc;
  lndCert = fs.readFileSync(config.pathssl);
  sslCreds = grpc.credentials.createSsl(lndCert);
  macaroonCreds = grpc.credentials.createFromMetadataGenerator(function(args, callback)
  {
    macaroon = fs.readFileSync(config.pathmacaroon).toString('hex');
    metadata = new grpc.Metadata();
    metadata.add('macaroon', macaroon);
    callback(null, metadata);
  });
  creds = grpc.credentials.combineChannelCredentials(sslCreds, macaroonCreds);
  return new lnrpc.Lightning('localhost:' + config.portlndgrpc, creds);

  /*
  lnd_request = {};

  let lnd_response;

  lightning.getInfo(lnd_request, function(err, response) {
      console.log(response)
  });
  */
}

/**
 * GET LND address of server
 */
app.get("/lnd/address", (req, res) => {
  try {
    res.status(200);

    lnd_request = {};

    lightning.getInfo(lnd_request, function(err, response) {
      res.json({
          identity_pubkey: response["identity_pubkey"],
          host: config.addresslnd,
          port: "9735"
      });
    });
  } catch (err) {
    console.error("GET /lnd/address", err.message);
    res.status(400);
    res.send(err);
  }
});

/**
 * GET netting status of server
 */
app.get("/lnd/netting-active", (req, res) => {
  try {
    res.status(200);
    res.json({
      netting_status: nettingStatus
    })
  } catch (err) {
    console.error("GET /lnd/netting-active", err.message);
    res.status(400);
    res.send(err);
  }
});

/**
 * PUT /lnd/energy/:householdAddress
 */
app.put("/lnd/energy/:householdAddress", (req, res) => {
  try {
    const householdAddress = req.params.householdAddress;
    const { direction, invoice } = req.body;
    console.log(`Incoming invoice from ${req.params.householdAddress} with direction via ${direction}`);

    options = {
      pay_req: invoice
    }

    lightning.decodePayReq(options, function(err, res) {
      const timestamp = res['timestamp']*1000;
      console.log(timestamp);

      let meterDelta = res['num_msat'];

      options = {
        payment_request: invoice,
        outgoing_chan_id: direction
      }

      lightning.sendPaymentSync(options, function(err, res) {
        if (err || res['payment_error']) {
          console.log('Can\'t pay invoice yet');
        } else {
          console.log('Payed invoice');

          if (utility.addHousehold(householdAddress)) {
            console.log(`New household ${householdAddress} added`);
          }

          options = {
            active_only: true
          }

          lightning.listChannels(options, function(req, res) {
            for (var i = 0; i < res['channels'].length; i++) {
              if (res['channels'][i]['chan_id'] == direction) {
                if (res['channels'][i]['capacity'] % 2 > 0) {
                  meterDelta = meterDelta * -1;
                }

                console.log(
                  `Incoming LND meter delta ${meterDelta} at ${timestamp} for ${householdAddress}`
                );
                utility.updateMeterDelta(householdAddress, meterDelta, timestamp);

                break;
              }
            }
          });
        }
      })
    })

    res.status(200);
    res.send();
  } catch (err) {
    console.error("PUT /lnd/energy/:householdAddress", err.message);
    res.status(400);
    res.send(err);
  }
});

/**
 * PUT /energy/:householdAddress
 */
app.put("/energy/:householdAddress", async (req, res) => {
  try {
    const householdAddress = web3Utils.toChecksumAddress(
      req.params.householdAddress
    );
    const { signature, hash, timestamp, meterDelta } = req.body;

    if (typeof meterDelta !== "number") {
      throw new Error("Invalid payload: meterDelta is not a number");
    }

    const validHouseholdAddress = await hhHandler.isValidatorAddress(
      ownedSetContract,
      householdAddress
    );
    if (!validHouseholdAddress) {
      throw new Error("Given address is not a validator");
    }

    const recoveredAddress = await web3Helper.verifySignature(
      web3,
      hash,
      signature
    );
    if (recoveredAddress != householdAddress) {
      throw new Error("Invalid signature");
    }

    if (utility.addHousehold(householdAddress)) {
      console.log(`New household ${householdAddress} added`);
    }
    console.log(
      `Incoming meter delta ${meterDelta} at ${timestamp} for ${householdAddress}`
    );
    utility.updateMeterDelta(householdAddress, meterDelta, timestamp);

    res.status(200);
    res.send();
  } catch (err) {
    console.error("PUT /energy/:householdAddress", err.message);
    res.status(400);
    res.send(err);
  }
});

/**
 * GET endpoint returning the current energy balance of renewableEnergy from Utility.js
 */
app.get("/network", (req, res) => {
  try {
    res.status(200);
    res.json({
      renewableEnergy: utility.renewableEnergy,
      nonRenewableEnergy: utility.nonRenewableEnergy
    });
  } catch (err) {
    console.error("GET /network", err.message);
    res.status(400);
    res.send(err);
  }
});

/**
 * GET endpoint returning the current meterDelta of a household that provides a valid signature for the account
 */
app.get("/meterdelta", async (req, res) => {
  try {
    const { signature, hash } = req.query;
    const recoveredAddress = await web3Helper.verifySignature(web3, hash, signature)
    const validHouseholdAddress = await hhHandler.isValidatorAddress(
      ownedSetContract,
      recoveredAddress
    );
    if (!validHouseholdAddress) {
      throw new Error("Given address is not a validator");
    }

    res.status(200);
    res.json({meterDelta: utility.households[recoveredAddress].meterDelta });
  } catch (err) {
    console.error("GET /meterdelta", err.message);
    res.status(400);
    res.send(err);
  }
});

/**
 * GET endpoint returning the transfers of a specific Household and a given day from Utility.js
 * Access this like: http://127.0.0.1:3005/transfers/123456789?from=1122465557 (= Date.now())
 */
app.get("/transfers/:householdAddress", (req, res) => {
  try {
    const { from = 0 } = req.query;
    const householdAddress = web3Utils.toChecksumAddress(
      req.params.householdAddress
    );
    const transfers = utility.getTransfers(householdAddress, from);
    res.status(200);
    res.json(transfers || []);
  } catch (err) {
    console.error("GET /transfers/:householdAddress", err.message);
    res.status(400);
    res.send(err);
  }
});

/**
 * GET request not supported
 */
app.get("/", function(req, res, next) {
  res.status(400);
  res.end(req.method + " is not supported.\n");
});

/**
 * POST request not supported
 */
app.post("/", function(req, res, next) {
  res.status(400);
  res.end(req.method + " is not supported.\n");
});

/**
 * DELETE request not supported
 */
app.delete("/", function(req, res, next) {
  res.status(400);
  res.end(req.method + " is not supported.\n");
});

/**
 * Let the server listen to incoming requests on the given IP:Port
 */
app.listen(config.port, () => {
  console.log(`Netting Entity running at http://${config.host}:${config.port}/`);
});
