const express = require("express");
const fs = require("fs");
const grpc = require("grpc");
const cors = require("cors");
const commander = require("commander");
const byteBuffer = require("bytebuffer");
const db = require("./apis/db");
const ned = require("./apis/ned");
const blockchain = require("./apis/blockchain");
const transferHandler = require("./transfer-handler");
const energyHandler = require("./energy-handler");
const request = require("request-promise");
const web3Helper = require("../helpers/web3");
const zokratesHelper = require("../helpers/zokrates");
const contractHelper = require("../helpers/contract");
const serverConfig = require("../household-server-config");

// Specify cli options
commander
  .option("-h, --host <type>", "ip of household server")
  .option("-p, --port <type>", "port of household server")
  .option("-d, --dbUrl <type>", "url of mongodb")
  .option("-N, --nedUrl <type>", "url of NED server")
  .option("-a, --address <type>", "address of the parity account")
  .option("-P, --password <type>", "password of the parity account")
  .option(
    "-n, --network <type>",
    "network name specified in truffle-config.js"
  )
  .option("-s, --pathSsl <type>", "path to tls.cert for LND node")
  .option(
      "-m, --pathMacaroon <type>",
      "path to admin.macaroon for LND node"
  )
  .option("-l, --portLnd <type>", "port of LND server");
commander.parse(process.argv);

// Configuration wrapper
const config = {
  host: commander.host || serverConfig.host,
  port: commander.port || serverConfig.port,
  dbUrl: commander.dbUrl || serverConfig.dbUrl,
  nedUrl: commander.nedUrl || serverConfig.nedUrl,
  network: commander.network || serverConfig.network,
  address: commander.address || serverConfig.address,
  password: commander.password || serverConfig.password,
  dbName: serverConfig.dbName,
  sensorDataCollection: serverConfig.sensorDataCollection,
  utilityDataCollection: serverConfig.utilityDataCollection,
  meterReadingCollection: serverConfig.meterReadingCollection,
  portLnd: commander.portLnd || serverConfig.portLnd,
  pathSsl: commander.pathSsl || serverConfig.pathSsl,
  pathMacaroon: commander.pathMacaroon || serverConfig.pathMacaroon
};

// Set up the DB
db.createDB(config.dbUrl, config.dbName, [
  config.sensorDataCollection,
  config.utilityDataCollection,
  config.meterReadingCollection
])

let web3;
let utilityContract;
let latestBlockNumber;
let nettingActive = false;
let nettingStatus = 0;
let lnrpc;
let lndCert;
let sslCreds;
let macaroonCreds;
let macaroon;
let metadata;
let creds;
let options;
let remaining_delta;
let close;
let channel_point;
let direction;
let lightning;
let ned_server_lightning_address
let ned_server_identity_pubkey;
let ned_server_lightning_port;
let ned_server_lightning_host;
let call;
let up_channel;
let down_channel;

async function init() {
  web3 = web3Helper.initWeb3(config.network);
  latestBlockNumber = await web3.eth.getBlockNumber();

  // Init lightning channel to NED server
  options = {
    uri: `${config.nedUrl}/lnd/address`,
    json: true
  };

  request(options).then(function (res) {
    ned_server_identity_pubkey = res["identity_pubkey"];
    ned_server_lightning_host = res["host"];
    ned_server_lightning_port = res["port"];

    lightning = lndHandler();
  }).then(function() {
    ned_server_lightning_address = new lnrpc.LightningAddress(ned_server_identity_pubkey, ned_server_lightning_host + ":" + ned_server_lightning_port);
    lndInitToNed(ned_server_lightning_address);
  }).catch(function (err) {
    console.log(err);
  });


  utilityContract = new web3.eth.Contract(
    contractHelper.getAbi("dUtility"),
    contractHelper.getDeployedAddress("dUtility", await web3.eth.net.getId())
  );
  utilityContract.events.NettingSuccess(
    {
      fromBlock: latestBlockNumber
    },
    (error, event) => {
      if (error) {
        console.error(error.message);
        throw error;
      }
      if (checkNetting()){
        console.log("Netting Successful!");
        latestBlockNumber = event.blockNumber;
        nettingActive = false;
        transferHandler.collectTransfers(config);
      } else {
        throw "Preimage doesn't Match stored hash. NETTING INVALID"
      }
    }
  );
}

init();

/**
 * function for retrieving meterDelta from ned-server and checks if it's the correct preimage for meterDelta. Needed for households to validate netting
 */
async function checkNetting(){
  const randomHash = zokratesHelper.packAndHash(Math.floor(Math.random() * Math.floor(999999999)));
  const { data, signature } = await web3Helper.signData(web3, config.address, config.password, randomHash)

  const options = {
    uri: `${config.nedUrl}/meterdelta`,
    json: true,
    qs: {
      hash: data,
      signature: signature
    }
  }
  return await request(options)
    .then((res, err) => {
      const meterDeltaHash = blockchain.getAfterNettingHash(config.network, config.address, config.password)
      return zokratesHelper.packAndHash(res.meterDelta) != meterDeltaHash
    })
}

/**
 * Creating the express server waiting for incoming requests
 * When a request comes in, a corresponding event is emitted
 * At last a response is sent to the requester
 */
const app = express();

app.use(express.json());
app.use(cors());

function lndHandler() {
  lnrpc = grpc.load('rpc.proto').lnrpc;
  lndCert = fs.readFileSync(config.pathSsl);
  sslCreds = grpc.credentials.createSsl(lndCert);
  macaroonCreds = grpc.credentials.createFromMetadataGenerator(function(args, callback)
  {
    macaroon = fs.readFileSync(config.pathMacaroon).toString('hex');
    metadata = new grpc.Metadata();
    metadata.add('macaroon', macaroon);
    callback(null, metadata);
  });
  creds = grpc.credentials.combineChannelCredentials(sslCreds, macaroonCreds);

  return new lnrpc.Lightning('localhost:' + config.portLnd, creds);
}

function lndInitToNed(ned_server_lightning_address) {
  options = {
    addr: ned_server_lightning_address
  };

  lightning.connectPeer(options, function(err, res) {
    if (err) {
      if (err['code'] == 2) {
        console.log(err['details'])
      }
    } else {
      console.log(err);
    }
  });

  lndCreateChannel(true);
  // up_channel = "38e1013e7ea9fb7ac816ffa118a3bfd8142778ea56c6f5794c18df56d6ed4a47"
  lndCreateChannel(false);
  // down_channel = "bd11e931174ba2d67f59a30ac19e55b90654f8644f4301185ee4e753a9a01e9a"

  var call = lightning.subscribeInvoices({})
  call.on('data', function(response) {
    if (response['settled']) {
      options = {
        active_only: true
      }

      lightning.listChannels(options, function(err, res) {
        for (let i = 0; i < res['channels'].length; i++) {
          if ([up_channel, down_channel].indexOf(res['channels'][i]['channel_point'].split(":")[0] >= 0)) {
            if (res['channels'][i]['remote_balance'] - res['channels'][i]['remote_chan_reserve_sat'] <= 0) {
              channel_point = new lnrpc.ChannelPoint();
              channel_point.funding_txid_bytes = byteBuffer.fromHex(res['channels'][i]['channel_point'].split(":")[0]);
              channel_point.funding_txid_str = res['channels'][i]['channel_point'].split(":")[0];
              channel_point.output_index = parseInt(res['channels'][i]['channel_point'].split(":")[1]);

              if (res['channels'][i]['channel_point'].split(":")[0] == up_channel) {
                up_channel = null;
                lndCloseChannel(channel_point);
                // lndCreateChannel(true);
              } else if (res['channels'][i]['channel_point'].split(":")[0] == down_channel) {
                down_channel = null;
                lndCloseChannel(channel_point);
                // lndCreateChannel(false);
              }
            }
          }
        }
      });
    }
  });
}

function lndSendMeterDelta(meterDelta, direction) {
  if (meterDelta == 0) {
    return;
  }

  options = {
    value_msat: Math.abs(meterDelta),
    private: true,
    memo: direction ? 'up' : 'down'
  };

  lightning.addInvoice(options, function(err, res) {
    options = {
      pending_only: true
    }

    lightning.listInvoices(options, function (err, res) {
      console.log(`Invoice queue: ${res['invoices'].length}`)

      options = {
        active_only: true
      }

      lightning.listChannels(options, function(err, res_lc) {
        for (let i = 0; i < res['invoices'].length; i++) {
          const { address, password } = config;

          var target = null;
          var target_key = res['invoices'][i]['memo'] == 'up' ? up_channel : down_channel;

          for (let i = 0; i < res_lc['channels'].length; i++) {
            if (res_lc['channels'][i]['channel_point'].split(":")[0] == target_key) {
              target = res_lc['channels'][i]['chan_id'];
              break;
            }
          }

          if (!target) {
            console.log('Postponing invoice. ' + res['invoices'][i]['memo'] + ' ' + !target + ' Channel not ready.');
            continue;
          }

          if (res['invoices'][i]['memo'] == 'up') {
            var mic_check = target;
          } else {
            var mic_check = target;
          }

          console.log('Sending invoice ' + res['invoices'][i]['memo'] + ' with chan_id: ' + mic_check);

          options = {
            method: 'PUT',
            uri: `${config.nedUrl}/lnd/energy/${address}`,
            body: {
              direction: res['invoices'][i]['memo'] == 'up' ? target : target,
              invoice: res['invoices'][i]['payment_request']
            },
            json: true
          };

          request(options)
            .then(function (res) {

            })
            .catch(function (err) {
              console.log(err);
            });
        }
      });
    });
  });
}

function lndCreateChannel(direction) {
  if (direction) {
    if (up_channel) {
      return;
    }
  } else {
    if (down_channel) {
      return;
    }
  }

  console.log("Trying to create channel");

  options = {
    node_pubkey: byteBuffer.fromHex(ned_server_identity_pubkey),
    node_pubkey_string: ned_server_identity_pubkey,
    local_funding_amount: direction ? 10000000*1.1 : 10000000*1.1 + 1,
    push_sat: 10000000,
    sat_per_byte: 0
  };

  lightning.openChannelSync(options, function(err, res) {
    if (err) {
      console.log(err['details']);
    } else {
      if (direction) {
        if (!up_channel) {
          up_channel = res['funding_txid_bytes'].reverse().toString('hex');

          console.log("Up channel created with chan_id: " + up_channel);
        }
      } else {
        if (!down_channel) {
          down_channel = res['funding_txid_bytes'].reverse().toString('hex');

          console.log("Down channel created with chan_id: " + down_channel);
        }
      }
    }
  });
}

function lndCloseChannel(channel_point) {
  console.log('Closing channel')

  options = {
    channel_point: channel_point,
    force: true
  };

  lightning.closeChannel(options);
}

/**
 * GET /sensor-stats?from=<fromDate>&to=<toDate>
 */
app.get("/sensor-stats", async (req, res) => {
  try {
    const { from, to } = req.query;
    const fromQuery = from ? { timestamp: { $gte: parseInt(from) } } : {};
    const toQuery = to ? { timestamp: { $lte: parseInt(to) } } : {};
    const data = await db.readAll(
      config.dbUrl,
      config.dbName,
      config.sensorDataCollection,
      {
        ...fromQuery,
        ...toQuery
      }
    );
    res.setHeader("Content-Type", "application/json");
    res.status(200);
    res.json(data);
  } catch (error) {
    console.error("GET /sensor-stats", error.message);
    res.status(500);
    res.end(error);
  }
});

/**
 * GET /transfers?from=<fromDate>&to=<toDate>
 */
app.get("/transfers", async (req, res) => {
  try {
    const { from, to } = req.query;
    const fromQuery = from ? { timestamp: { $gte: parseInt(from) } } : {};
    const toQuery = to ? { timestamp: { $lte: parseInt(to) } } : {};
    const data = await db.readAll(
      config.dbUrl,
      config.dbName,
      config.utilityDataCollection,
      {
        ...fromQuery,
        ...toQuery
      }
    );
    res.setHeader("Content-Type", "application/json");
    res.status(200);
    res.json(data);
  } catch (error) {
    console.error("GET /transfers", error.message);
    res.status(500);
    res.end(error);
  }
});

/**
 * GET /household-stats
 */
app.get("/household-stats", async (req, res, next) => {
  try {
    const data = await db.getMeterReading(config.dbUrl, config.dbName, config.meterReadingCollection);
    data.address = config.address;
    res.setHeader("Content-Type", "application/json");
    res.status(200);
    res.json(data);
  } catch (error) {
    console.error("GET /household-stats", error.message);
    res.status(500);
    res.end(error);
  }
});

/**
 * GET /network-stats
 */
app.get("/network-stats", async (req, res, next) => {
  try {
    const data = await ned.getNetwork(config.nedUrl, config.address);
    res.setHeader("Content-Type", "application/json");
    res.status(200);
    res.json(data);
  } catch (error) {
    console.error("GET /network-stats", error.message);
    res.status(500);
    res.end(error);
  }
});

/**
 * PUT /sensor-stats
 */
app.put("/sensor-stats", async (req, res) => {
  const { meterDelta, produce, consume } = req.body;
  try {
    if (
      typeof meterDelta !== "number"
    ) {
      throw new Error("Invalid payload");
    }

    // Init lightning channel to NED server
    options = {
      uri: `${config.nedUrl}/lnd/netting-active`,
      json: true
    };

    request(options).then(function (res) {
      if (res["netting_status"] != nettingStatus) {
        console.log("Netting Successful!");
        nettingStatus = res["netting_status"];
        nettingActive = false;
        transferHandler.collectTransfers(config);
      }
    }).then(function() {
      if (!nettingActive) {
        nettingActive = true;

        options = {
          active_only: true
        };

        lightning.listChannels(options, function (err, res) {
          let channel_index = null;
          if (meterDelta >= 0) {
            direction = true;
          } else {
            direction = false;
          }

          for (var i = 0; i < res['channels'].length; i++) {
              if ((res['channels'][i]['channel_point'].split(":")[0] == up_channel && meterDelta >= 0) || (res['channels'][i]['channel_point'].split(":")[0] == down_channel && meterDelta < 0)) {
                channel_index = i;
                break;
              }
          }

          if (channel_index != null && (res['channels'].length > 0 && (res['channels'][channel_index]['remote_balance']*1000 - res['channels'][channel_index]['remote_chan_reserve_sat']*1000) < Math.abs(meterDelta))) {
            console.log("Need to reopen " + res['channels'][channel_index]['remote_balance']*1000 + " < " + Math.abs(meterDelta));

            remaining_delta = Math.abs(meterDelta) - res['channels'][channel_index]['remote_balance']*1000 + res['channels'][channel_index]['remote_chan_reserve_sat']*1000;

            lndSendMeterDelta(res['channels'][channel_index]['remote_balance']*1000 - res['channels'][channel_index]['remote_chan_reserve_sat']*1000, direction);

            // Transfer remaining
            lndSendMeterDelta(remaining_delta, direction);
          } else {
            if (channel_index == null) {
              lndCreateChannel(direction);
            }

            lndSendMeterDelta(meterDelta, direction);
          }
        });
      }

      /*
      await energyHandler.putMeterReading(
        config,
        web3,
        utilityContract,
        meterDelta
      );
      */
    });

    await db.writeToDB(
      config.dbUrl,
      config.dbName,
      config.sensorDataCollection,
      {
        produce,
        consume
      }
    )
    .then(res => {
      db.updateMeterReading(config.dbUrl, config.dbName, config.meterReadingCollection, res)
    })

    res.status(200);
    res.send();
  } catch (err) {
    console.error("GET /sensor-stats", err.message);
    res.status(500);
    res.send(err);
  }
});

/**
 * POST request not supported
 */
app.post("/", function(req, res, next) {
  res.statusCode = 400;
  res.end(
    req.method +
      " is not supported. Try GET for UI Requests or PUT for Sensor data!\n"
  );
});

/**
 * DELETE request not supported
 */
app.delete("/", function(req, res, next) {
  res.statusCode = 400;
  res.end(
    req.method +
      " is not supported. Try GET for UI Requests or PUT for Sensor data\n"
  );
});

/**
 * Let the server listen to incoming requests on the given IP:Port
 */
app.listen(config.port, () => {
  console.log(
    `Household Server running at http://${config.host}:${config.port}/`
  );
  console.log(`I am authority node ${config.address}.`);
});
