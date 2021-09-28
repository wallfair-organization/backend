const { Erc20 } = require('@wallfair.io/smart_contract_mock');
const WFAIR = new Erc20('WFAIR');
const BigNumber = require('bignumber.js');

const toBigInt = (input) => {
  return BigInt(new BigNumber(input).times(WFAIR.ONE).decimalPlaces(0));
};

const toBigDecimal = (input) => {
  return new BigNumber(input).dividedBy(WFAIR.ONE).toFixed(4);
};

module.exports = {
  toBigInt,
  toBigDecimal
};
