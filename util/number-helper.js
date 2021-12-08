const _ = require("lodash");

const { ONE, BN } = require('@wallfair.io/trading-engine');

const toScaledBigInt = (input) => {
  return BigInt(input) * ONE;
};

const fromScaledBigInt = (input) => {
  return new BN(input).dividedBy(ONE).toFixed(4);
};

const calculateGain = (investmentAmount, outcomeAmount, precision = 2) => {
  const investment = _.toNumber(investmentAmount);
  const outcome = _.toNumber(outcomeAmount);
  const gain = ((outcome - investment) / investment) * 100;

  const negative = gain < 0;
  const value = isNaN(gain) ? '-' : negative ? `${gain.toFixed(precision)}%` : `+${gain.toFixed(precision)}%`;

  return {
    number: gain,
    value,
    negative,
  };
};

module.exports = {
  toScaledBigInt,
  fromScaledBigInt,
  calculateGain
};
