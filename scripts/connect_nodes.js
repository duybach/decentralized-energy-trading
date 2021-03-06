const request = require("request-promise");
const shell = require("shelljs");

const options = { resolveWithFullResponse: true };

async function callRPC(methodSignature, port, params = []) {
  const { statusCode, body } = await request(`http://localhost:${port}`, {
    method: "POST",
    json: {
      jsonrpc: "2.0",
      method: methodSignature,
      params: params,
      id: 0
    },
    ...options
  });

  return { statusCode, body };
}

async function main() {
  const HHPU_RPC_PORT = process.env.HHPU_RPC_PORT || 8145;
  console.log("Adding new peer ...");
  const enode = (await callRPC("parity_enode", HHPU_RPC_PORT)).body.result;
  console.log(enode);
  const isPeerAdded = (await callRPC("parity_addReservedPeer", 8045, [enode]))
    .body.result;
  console.log(`Peer added: ${isPeerAdded}`);

  console.log("Getting accounts ...");
  const adminAccount = (await callRPC("personal_listAccounts", 8045)).body
    .result[0];
  const otherAccount = (await callRPC("personal_listAccounts", HHPU_RPC_PORT))
    .body.result[0];
  console.log(`Sending ether from ${adminAccount} to ${otherAccount} ...`);
  const params = [
    {
      from: adminAccount,
      to: otherAccount,
      value: "0xde0b6b3a7640000"
    },
    "node0"
  ];
  const transactionAddress = (await callRPC(
    "personal_sendTransaction",
    8045,
    params
  )).body;
  console.log(transactionAddress);
  console.log(`Running migration for ${otherAccount} ...`);
  shell.exec(`AUTHORITY_ADDRESS=${otherAccount} yarn migrate-contracts-docker`);
}

main();
