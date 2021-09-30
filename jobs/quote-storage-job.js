/**
 * This job listens to bets being placed in the system, and then stores the price of every option after the price has been calculated.
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
const DEFAULT_CHANNEL = 'system';
let subClient;

const { BetContract } = require('@wallfair.io/smart_contract_mock');

async function onBetPlaced(message) {
  const { _id: betId, outcomes } = message.data.bet;
  const betContract = new BetContract(betId, outcomes.length);

  const initialPrices = await betContract.calcBuyAllOutcomes();
  const values = initialPrices.map(betContract.toUnitInterval);

  return betContract.insertPrices(values);
}

async function onNewBet(message) {
  const { _id: betId, outcomes } = message.data.bet;

  const timestamp = new Date();
  timestamp.setMinutes(timestamp.getMinutes() - 5);

  const betContract = new BetContract(betId, outcomes.length);
  const initialPrice = betContract.calcInitialPrice();

  return betContract.insertPrices(outcomes.map(() => initialPrice), timestamp.toISOString());
}

module.exports = {
  initQuoteJobs: (_subClient) => {
    subClient = _subClient;

    subClient.subscribe(DEFAULT_CHANNEL, (error, channel) => {
      console.log(error || 'QuoteStorageJob subscribed to channel:', channel);
    });

    subClient.on('message', async (_, message) => {
      const messageObj = JSON.parse(message);
      if (messageObj.event === 'Notification/EVENT_BET_PLACED') {
        await onBetPlaced(messageObj);
        return;
      }

      if (messageObj.event === 'Notification/EVENT_NEW_BET') {
        await onNewBet(messageObj);
      }
    });
  }
}
