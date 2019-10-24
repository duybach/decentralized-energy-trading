const fs = require('fs')

function generateHelperFuncs(wE, nE) {
  
  /*
  let numHouseholds = numHHs;
  let withEnergy;
  let noEnergy;
  if((numHouseholds % 2) == 1){
    withEnergy = (numHouseholds/2) - 0.5;
    noEnergy = (numHouseholds/2) + 0.5;
   numHouseholds++;
  }
  else{
    withEnergy = numHouseholds/2;
    noEnergy = withEnergy;
  }
  */

  console.log("# of HHs with Energy: ", wE);
  console.log("# of HHs without Energy: ", nE);

    return `//The comments and explanations are provided for an example with n = 4 households!

import "hashes/sha256/512bitPacked.code" as sha256packed

// Aggregates the Energy of Energy producing HHS.
// @param {field[n]} Energy producing HHs
// @returns {field} energy of provided households
def energyOfWE(field[${wE}] hh) -> (field):
  field energy = 0
  for field i in 0..${wE - 1} do
    energy = energy + hh[i]
  endfor
  return energy

// Aggregates the Energy of Energy consuming HHS.
// @param {field[m]} Energy producing HHs
// @returns {field} energy of provided households
def energyOfNE(field[${nE}] hh) -> (field):
  field energy = 0
  for field i in 0..${nE - 1} do
    energy = energy + hh[i]
  endfor
  return energy

// Returns total energy balance of the system. Remember, this balance can be available or needed energy.
// @param {field[n]} hhWithEnergy
// @param {field[m]} hhNoEnergy
// @returns {field} totalEnergy
def calculateTotalEnergy(field[${wE}] hhWithEnergy, field[${nE}] hhNoEnergy) -> (field):
  availableEnergy = energyOfWE(hhWithEnergy)
  neededEnergy = energyOfNE(hhNoEnergy)
  field totalEnergy = if (availableEnergy > neededEnergy) then (availableEnergy - neededEnergy) else (neededEnergy - availableEnergy) fi
  return totalEnergy

// Returns sum of deltas between hh and hhNet with Energy
// @param {field[n]} hh
// @param {field[n]} hhNet
// @returns {field} delta
def deltaNetWE(field[${wE}] hh, field[${wE}] hhNet) -> (field):
  field delta = 0
  for field i in 0..${wE - 1} do
    delta = delta + (hh[i] - hhNet[i])
  endfor
  return delta

// Returns sum of deltas between hh and hhNet without Energy
// @param {field[m]} hh
// @param {field[m]} hhNet
// @returns {field} delta
def deltaNetNE(field[${nE}] hh, field[${nE}] hhNet) -> (field):
  field delta = 0
  for field i in 0..${nE - 1} do
    delta = delta + (hh[i] - hhNet[i])
  endfor
  return delta

// Returns errorCounter. Implements weak fairness invariant for HHs with Energy
// @param {field[n]} hh
// @param {field[n]} hhNet
// @returns {field} errorCounter
def validateFairnessWE(field[${wE}] hh, field[${wE}] hhNet) -> (field):
  field errorCounter = 0
  for field i in 0..${wE - 1} do
    errorCounter = errorCounter + if hhNet[i] > hh[i] then 1 else 0 fi
  endfor
  return errorCounter

// Returns errorCounter. Implements weak fairness invariant for HHs without Energy
// @param {field[m]} hh
// @param {field[m]} hhNet
// @returns {field} errorCounter
def validateFairnessNE(field[${nE}] hh, field[${nE}] hhNet) -> (field):
  field errorCounter = 0
  for field i in 0..${nE - 1} do
    errorCounter = errorCounter + if hhNet[i] > hh[i] then 1 else 0 fi
  endfor
  return errorCounter

// Validates the zero-net property (one set of household will be 0 (up to an epislon error) after netting)
// for the case of sumWithEnergy <= sumNoEnergy
// Is valid, only if returns 0.
// @param (field[n]) household party having energy
// @param epsilon the error tolerance value
def validateZeroNetWE(field[${wE}] hh, field epsilon) -> (field):
  field errorCounter = 0
  for field i in 0..${wE - 1} do
    errorCounter = errorCounter + if hh[i] > epsilon then 1 else 0 fi
  endfor
  return errorCounter

// Validates the zero-net property (one set of household will be 0 (up to an epislon error) after netting)
// for the case of sumWithEnergy >= sumNoEnergy
// Is valid, only if returns 0.
// @param (field[m]) household party needing
// @param epsilon the error tolerance value
def validateZeroNetNE(field[${nE}] hh, field epsilon) -> (field):
  field errorCounter = 0
  for field i in 0..${nE - 1} do
    errorCounter = errorCounter + if hh[i] > epsilon then 1 else 0 fi
  endfor
  return errorCounter

// Simply return hh[0] + hh[1] for any array of households with energy.
// @param (field[n]) hh
// @returns (field) energy of provided households
def sumWE(field[${wE}] hh) -> (field):
  field s = 0
  for field i in 0..${wE - 1} do
    s = s + hh[i]
  endfor
  return s

// Simply return hh[0] + hh[1] for any array of households without energy.
// @param (field[m]) hh
// @returns (field) energy of provided households
def sumNE(field[${nE}] hh) -> (field):
  field s = 0
  for field i in 0..${nE - 1} do
    s = s + hh[i]
  endfor
  return s
`;
  }
  
  function generateCode(wE, nE) {
    
    /*let numHouseholds = numHHs;
    let withEnergy;
    let noEnergy;
    if((numHouseholds % 2) == 1){
     // withEnergy = (numHouseholds/2) - 0.5;
     // noEnergy = (numHouseholds/2) + 0.5;
     numHouseholds++;
    }
    else{
      withEnergy = numHouseholds/2;
      noEnergy = withEnergy;
    }
    */

    let energySumStringWE = "  field energySumWE = hhWithEnergy[0] + hhWithEnergyNet[0]";
    let energySumStringNE = "  field energySumNE = hhNoEnergy[0] + hhNoEnergyNet[0]";
    let packedString = "";
    let returnSignatureString = Array((wE + nE) + 1)
      .fill("field[2]", 0, (wE + nE) + 1)
      .join(",");
    let returnString = " return ";

    let uBound;;
    let lBound;

    if(wE >= nE){
      uBound = wE;
      lBound = nE;
    }
    else{
      uBound = nE;
      lBound = wE;
    }


    for(let i = 1; i < wE; i++){
      energySumStringWE += ` + hhWithEnergy[${i}] + hhWithEnergyNet[${i}]`;
    }
    
    for(let i = 1; i < nE; i++){
      energySumStringNE += ` + hhNoEnergy[${i}] + hhNoEnergyNet[${i}]`;
    }

    for (let i = 0; i < wE; i++) {
      if (i % 5 === 0) {/*
        const j = i / 5 + 1;
        if(uBound == wE){
          energySumString += `+ hhWithEnergy[${i}] + hhWithEnergyNet[${i}]`;
        }else{
          energySumString += `hhNoEnergy[${i}] + hhNoEnergyNet[${i}]`;
        }
        for (let k = 0; k < lBound; k++) {
          if(lBound == nE){
            energySumString += ` + hhNoEnergy[${k}] + hhNoEnergyNet[${k}]`;
          }else{
            energySumString += ` + hhWithEnergy[${k}] + hhWithEnergyNet[${k}]`;
          }
        }*/
      }
      packedString += `  hh${i +
        1}WithEnergyHash = sha256packed([hhWithEnergyPacked[${i +
        3 * i}], hhWithEnergyPacked[${i + 1 + 3 * i}], hhWithEnergyPacked[${i +
        2 +
        3 * i}], hhWithEnergyPacked[${i + 3 + 3 * i}]])\n`;
    }

    for(let i = 0; i < nE; i++){
      packedString += `  hh${i +
        1}NoEnergyHash = sha256packed([hhNoEnergyPacked[${i +
        3 * i}], hhNoEnergyPacked[${i + 1 + 3 * i}], hhNoEnergyPacked[${i +
        2 +
        3 * i}], hhNoEnergyPacked[${i + 3 + 3 * i}]])\n`;
    }

    for(let i = 0; i < wE; i++){
      returnString += ` hh${i + 1}WithEnergyHash,`;
    }

    for(let i = 0; i < nE; i++){
      returnString += ` hh${i + 1}NoEnergyHash,`;
    }

    energySumStringNE += "\n";
  
    const helperFuncs = generateHelperFuncs(wE, nE);
  
    return `
  ${helperFuncs}

// Returns sha256packed hash if settlement result is consistent and proportional fair up to epsilon = 15
// Assume n = 4 households, where |householdListWithEnergy| = 2 and |householdListNoEnergy| = 2
// Before settlement, households with produce-consume = 0 are not part of the settlement
// @param (private field[2]) hhWithEnergy before settlement
// Index represents household and hhWithEnergy[index] := produce-consume > 0 
// @param (private field[2]) hhNoEnergy before settlement
// Index represents household and hhNoEnergy[index] := produce-consume < 0 
// @param (private field[2]) hhWithEnergyNet after settlement
// Index represents household and hhWithEnergyNet[index] := produce-consume > 0 
// @param (private field[2]) hhNoEnergyNet after settlement
// Index represents household and hhNoEnergyNet[index] := produce-consume < 0
// @param (private field[8]) hhWithEnergyPacked Packed inputs energy + nonce + address of hh with energy surplus
// Index 0 to 3 are packed inputs of hh1 with energy surplus
// Index 4 to 7 are packed inputs of hh2 with energy surplus
// @param (private field[8]) hhNoEnergyPacked Packed inputs energy + nonce + address of hh with energy deficit
// Index 0 to 3 are packed inputs of hh1 with energy deficit
// Index 4 to 7 are packed inputs of hh2 with energy deficit
// @returns (field[2], field[2], field[2], field[2], field[2]) sha256packed hashes of hhWithEnergyPacked and hhNoEnergyPacked and sha256packed hash that depends on inputs
def main(private field[${wE}] hhWithEnergy, private field[${nE}] hhNoEnergy, private field[${wE}] hhWithEnergyNet, private field[${nE}] hhNoEnergyNet, private field[${wE * 4}] hhWithEnergyPacked, private field[${nE * 4}] hhNoEnergyPacked) -> (${returnSignatureString}):
  totalEnergy = calculateTotalEnergy(hhWithEnergy, hhNoEnergy)
  totalEnergyNet = calculateTotalEnergy(hhWithEnergyNet, hhNoEnergyNet)
  totalEnergy == totalEnergyNet
  deltaNetWithEnergy = deltaNetWE(hhWithEnergy, hhWithEnergyNet)
  deltaNetNoEnergy = deltaNetNE(hhNoEnergy, hhNoEnergyNet)
  deltaNetWithEnergy == deltaNetNoEnergy
  0 == validateFairnessWE(hhWithEnergy, hhWithEnergyNet)
  0 == validateFairnessNE(hhNoEnergy, hhNoEnergyNet)
  field sumWithEnergy = sumWE(hhWithEnergyNet)
  field sumNoEnergy = sumNE(hhNoEnergyNet)
  field[${wE}] zeroNetPartyWE = hhWithEnergyNet
  field[${nE}] zeroNetPartyNE = hhNoEnergyNet
  0 == if sumWithEnergy <= sumNoEnergy then validateZeroNetWE(zeroNetPartyWE, 15) else validateZeroNetNE(zeroNetPartyNE, 15) fi// Can make epsilon more accurate in the future
${energySumStringWE}
${energySumStringNE}
  field energySum = energySumWE + energySumNE
  h = sha256packed([0, 0, 0, energySum])
${packedString} ${returnString} h
`;
  }

  function generateNedServerConfig(wE, nE){
    return `
    module.exports = {
      // IP on which the ned server should run
      host: "127.0.0.1",
      // Port on which the ned server should listen
      port: 3005,
      // Ethereum address of NED node
      address: "0x00bd138abd70e2f00903268f3db08f2d25677c9e",
      // Password to unlock NED node
      password: "node0",
      // Name of JSON RPC interface specified in truffle-config.js
      network: "authority",
      // Time Interval of the ned server triggering the netting in the ZoKrates execution environment
      nettingInterval: 10000,
      // Working directory of the file and the child process
      workingDir: "./ned-server",
      // File name to execute
      fileName: "helloworld.sh",
      // Execution environment for the file
      executionEnv: "bash",
      //No. of HHs with Energy Production
      hhProduce: ${wE},
      //No. of HHs with No Energy Production -> Only Consumption
      hhConsume: ${nE}
    };`
  }


  let args = process.argv.slice(2);

  let code;
  let code2;
  let wE;
  let nE;

  if(args.length === 2 && args[0] >= 1 && args[1] >= 1){
      
    wE = Number(args[0]);
    nE = Number(args[1]);

    code = generateCode(wE, nE);
    
    console.log("Generating zoKrates-Code for n = %s HHs with Energy & m = %s HHs without Energy and saving it to a file...", wE, nE);
    fs.writeFile('settlement-check.zok', code, 'utf8',(err) => {   
      if (err) throw err;
    })

    console.log("Generating the corresponding code for the Configuration of the NED-Server...")
    code2 = generateNedServerConfig(wE, nE);

    console.log("Saving the generated code to the ned-server-config.js File...")
    fs.writeFile('../ned-server-config.js', code2, 'utf8',(err)=> {
      if (err) throw err;
    })

  console.log("Done!");

  }else{
      console.log("ERROR! The number of inputs provided is less than two OR inputs are not numbers OR not numbers >= 1! \nThe zoKrates-Code-Generation stopped! \nPlease provide for the numbers of HHs two integer values >= 1!");
    }