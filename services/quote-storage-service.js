/**
 * When bets being placed in the system, stores the price of every option after the price has been calculated.
 * This generates a time series to be consumed later to display price action history (how each option delevoped in price over time).
 *
 * TODO Move this logic to a microservice
 *
 * CREATE TABLE IF NOT EXISTS amm_price_action (
 *  betid varchar(255),
 *  trx_timestamp timestamp,
 *  outcomeIndex integer,
 *  quote decimal,
 *  PRIMARY KEY(betid, option, trx_timestamp)
 * );
 */
const format = require('pg-format');
const { BetContract, Erc20, pool } = require('@wallfair.io/smart_contract_mock');
const WFAIR = new Erc20('WFAIR');
let one = parseInt(WFAIR.ONE);

const INSERT_PRICE_ACTION = 'INSERT INTO amm_price_action (betid, trx_timestamp, outcomeindex, quote) values %L'

const onBetPlaced = async (bet) => {
  const { _id: betId, outcomes } = bet;
  const betContract = new BetContract(betId, outcomes.length);

  const timestamp = new Date().toISOString();
  const valuePromises = outcomes.map(
    outcome => betContract.calcBuy(WFAIR.ONE, outcome.index).then(p => [
      betId,
      timestamp,
      outcome.index,
      Math.min(1 / (parseInt(p) / one), 1),
    ])
  );

  const values = await Promise.all(valuePromises);
  await pool.query(format(INSERT_PRICE_ACTION, values));
}

const onNewBet = async (bet) => {
  const { _id: betId, outcomes } = bet;
  const initialQuote = 1 / outcomes.length;
  const timestamp = new Date();
  timestamp.setMinutes(timestamp.getMinutes() - 5);
  const values = outcomes.map(outcome => [
    betId,
    timestamp.toISOString(),
    outcome.index,
    initialQuote,
  ]);
  await pool.query(format(INSERT_PRICE_ACTION, values));
}

module.exports = {
  onNewBet,
  onBetPlaced
}
