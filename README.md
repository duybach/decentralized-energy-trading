---
noteId: "1e61fc70226911ea85c0fd637b375b0e"
tags: []

---

# Privacy-Preserving Netting in Local Energy Grids

## Requirements

- [Docker](https://docs.docker.com/install/) >= v19.03.2
- [NodeJS 10](https://nodejs.org/en/download/) = v10.x.x >= v10.15.3
- [Yarn](https://yarnpkg.com/lang/en/docs/install) >= v1.16
- [ZoKrates](https://github.com/Zokrates/ZoKrates) >= 0.5.0

## Get started

**1.)** Deploying LND Node for household-server and netting-server:

```bash
# Assumes lnd docker directory (/lnd/docker)
export NETWORK="simnet" && docker volume create simnet_lnd_ned_server && docker-compose run -p 10009:10009 -p 9735:9735 -d --name ned_server --volume simnet_lnd_ned_server:/root/.lnd lnd

export NETWORK="simnet" && docker volume create simnet_lnd_client && docker-compose run -p 10010:10009 -d --name client --volume simnet_lnd_client:/root/.lnd lnd

docker exec -i -t client bash

# Generate a new backward compatible nested p2sh address for Alice:
client$ lncli --network=simnet newaddress np2wkh

# Recreate "btcd" node and set Alice's address as mining address:
MINING_ADDRESS=<client_address> docker-compose up -d btcd

# Generate 400 blocks (we need at least "100 >=" blocks because of coinbase
# block maturity and "300 ~=" in order to activate segwit):
docker exec -it btcd /start-btcctl.sh generate 400

# Check that segwit is active:
docker exec -it btcd /start-btcctl.sh getblockchaininfo | grep -A 1 segwit

# Check Client balance:
client$ lncli --network=simnet walletbalance
```

**2.)** Export certificates for LND access:

```bash
# Assumes household-server directory (/household-server)
docker cp client:/root/.lnd/tls.cert tls.cert && docker cp client:/root/.lnd/data/chain/bitcoin/simnet/admin.macaroon admin.macaroon && chmod -R 775 admin.macaroon

# Assumes netting-server directory (/netting-entity)
docker cp ned_server:/root/.lnd/tls.cert tls.cert && docker cp ned_server:/root/.lnd/data/chain/bitcoin/simnet/admin.macaroon admin.macaroon && chmod -R 775 admin.macaroon
```

**3.)** Install dependencies

```bash
yarn install
yarn --cwd household-ui/ install
```

**4.)** Setup ZoKrates contract

```bash
yarn setup-zokrates

# Edit contracts/Verifier.sol to contracts/verifier.sol
# Remove (2x) "pragma solidity ^0.6.1;"" from verifier.sol file

yarn update-contract-bytecodes
```

**5.)** Start the ethereum parity chain:

```bash
cd parity-authority
docker-compose up -d --build
```

**ethstats** is available at: http://localhost:3001

**6.)** Configure the contracts using truffle migrations:

```bash
# Rename build/Verifier.json to build/verifier.json
# Wait a bit before running this command
yarn migrate-contracts-authority
```

**7.)** Start the Netting Entity:

```bash
docker inspect ned_server | grep "IPAddress"

yarn run-netting-entity -i 60000 -l 10009 -s netting-entity/tls.cert -m netting-entity/admin.macaroon -p 8123 -a <IPAddress>
```

**8.)** Create two databases for both household servers:

```bash
# Assumes project root directory
docker-compose -f mongo/docker-compose.yml up -d
```

**9.)** Start two household servers:

```bash
# Household 1
yarn run-server -p 3002 -N http://localhost:8123 \
  -a 0x00aa39d30f0d20ff03a22ccfc30b7efbfca597c2 \
  -P node1 -n authority_1 \
  -d mongodb://127.0.0.1:27011 \
  -l 10010 -s household-server/tls.cert -m household-server/admin.macaroon
```

```bash
# Household 2
yarn run-server -p 3003 -N http://localhost:8123 \
  -a 0x002e28950558fbede1a9675cb113f0bd20912019 \
  -P node2 -n authority_2 \
  -d mongodb://127.0.0.1:27012 \
  -l 10010 -s household-server/tls.cert -m household-server/admin.macaroon
```

**Note:** Depending on your network settings an extra flag `-h 127.0.0.1` could be needed for both households.

**10.)** Start a mocked sensor for each household and Bitcoin Miner:

```bash
# Household 1 with positive energy balance
yarn run-sensor -p 3002 -e +
```

```bash
# Household 2 with negative energy balance
yarn run-sensor -p 3003 -e -
```

```bash
# Start Bitcoin Miner
sh ./miner.sh
```

**11.)** Start two household-ui applications:

```bash
# Household 1
yarn --cwd household-ui/ start
```

```bash
# Household 2
REACT_APP_HSS_PORT=3003 \
 PORT=3010 \
 yarn --cwd household-ui/ start
```

## Tests

- `yarn test-contracts` to test contracts
- `yarn test-parity-docker` to test docker parity authority setup
- `yarn test-helpers` to test helper functions
- `yarn test-utility-js` to test off-chain utility functionality

## Benchmarks

- `yarn utility-benchmark` to benchmark the `settle` method of the `Utility` contract

## Development

- `yarn update-contract-bytecodes` to update the contracts code in the `chain.json` file
- `yarn setup-zokrates` to generate a new `Verifier` contract
- `yarn format-all` fix linting issues

## Smart contract and ZoKrates program generation:
- `yarn generate-prooving-files [# Prod] [# Cons]` generates required files for given number of producers and consumers
