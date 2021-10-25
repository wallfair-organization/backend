const userService = require('./user-service');
const statsService = require('./statistics-service');
const tradeService = require('./trade-service');
const eventService = require('./event-service');
const websocketService = require('./websocket-service');
const { Bet, Trade, Event } = require('@wallfair.io/wallfair-commons').models;
const { publishEvent, notificationEvents } = require('./notification-service');
const { BetContract } = require('@wallfair.io/smart_contract_mock');
const { toScaledBigInt, fromScaledBigInt } = require('../util/number-helper');
const { calculateAllBetsStatus, filterPublishedBets } = require('../services/event-service');

exports.listBets = async (q) => {
  return Bet.find(q).populate('event')
    .map(calculateAllBetsStatus)
    .map(filterPublishedBets);
}

exports.filterBets = async (
  type = 'all',
  category = 'all',
  count = 10,
  page = 1,
  sortby = 'name',
  searchQuery,
  status = 'active',
  published = true,
  resolved = false,
  canceled = false,
) => {
  const eventQuery = {};
  const betQuery = {};

  // only filter by type if it is not 'all'
  if (type !== 'all') {
    eventQuery.type = type;
  }

  if (category !== 'all') {
    eventQuery.category = category;
  }

  // filter by default: active, published, not resolved and not cancelled Bets
  betQuery.status = status;
  betQuery.published = published;
  betQuery.resolved = resolved;
  betQuery.canceled = canceled;

  // only filter by searchQuery if it is present
  if (searchQuery) {
    betQuery.marketQuestion = { $regex: searchQuery, $options: 'i' };
  }

  const eventIds = await Event.find(eventQuery).select('_id').lean();

  betQuery.event = { $in: eventIds };

  const result = await Bet.find(betQuery)
    .limit(count)
    .skip(count * (page - 1))
    .collation({ locale: 'en' })
    .sort(sortby)
    .populate({ path: 'event' })
    .lean();

  return result;
};


exports.editBet = async (betId, betData) => {
  const updatedEvent = await Bet.findByIdAndUpdate(betId, betData, { new: true });
  return updatedEvent;
};

exports.placeBet = async (userId, betId, amount, outcome, minOutcomeTokens) => {
  const LOG_TAG = '[CREATE-BET]';

  amount = toScaledBigInt(amount);

  let minOutcomeTokensToBuy = 1n;
  if (minOutcomeTokens > 1) {
    minOutcomeTokensToBuy = toScaledBigInt(minOutcomeTokens);
  }

  const bet = await eventService.getBet(betId);
  const event = await Event.findById({ _id: bet.event });

  console.debug(LOG_TAG, 'Placing Bet', betId, userId);

  if (!eventService.isBetTradable(bet)) {
    console.error(LOG_TAG, 'Bet is not tradeable');
    throw new Error('No further action can be performed on an event/bet that has ended!');
  }

  const user = await userService.getUserReducedDataById(userId);

  if (!user) {
    console.error(LOG_TAG, `User not found with id ${userId}`);
    throw new Error('User not found');
  }

  const response = {
    bet,
    trade: {},
  };

  const session = await Bet.startSession();
  try {
    const balance = await userService.getBalanceOf(userId);

    await session.withTransaction(async () => {
      const betContract = new BetContract(betId, bet.outcomes.length);

      console.debug(LOG_TAG, 'Interacting with the AMM');

      const outcomeResult = await betContract.buy(userId, amount, outcome, minOutcomeTokensToBuy);

      console.debug(LOG_TAG, 'Successfully bought Tokens');

      const trade = new Trade({
        userId: userId,
        betId: bet._id,
        outcomeIndex: outcome,
        investmentAmount: fromScaledBigInt(amount),
        outcomeTokens: fromScaledBigInt(outcomeResult.boughtOutcomeTokens),
      });

      response.trade = await trade.save({ session });

      console.debug(LOG_TAG, 'Trade saved successfully');
    });

    await eventService.placeBet(user, bet, fromScaledBigInt(amount), outcome);

    const eventPayload = {
      producer: 'user',
      producerId: userId,
      data: { bet, trade: response.trade,
        user: {
          ...user.toObject(),
          balance: Math.floor(balance*100)/100,
        }, event },
      broadcast: true
    }

    //check for user award max stake in a row, 5 in a row
    //ignore decimals during check
    if(Math.floor(eventPayload.data.user.balance) === Math.floor(eventPayload?.data.trade.investmentAmount)) {
      await userService.checkBetsMaxStakeInRow(userId, 5);
    }

    publishEvent(notificationEvents.EVENT_BET_PLACED, eventPayload);
    return response;
  } catch (err) {
    console.error(LOG_TAG, err);
    throw new Error('Unexpected error ocurred while placing bet');
  } finally {
    await session.endSession();
  }
};

exports.getTrade = async (id) => {
  return await Trade.findById(id).populate('userId').populate('betId');
};

exports.clearOpenBets = async (bet, session) => {
  const betContract = new BetContract(bet.id, bet.outcomes.length);
  for (const outcome of bet.outcomes) {
    const wallets = await betContract.getInvestorsOfOutcome(outcome.index);
    const win = outcome.index === +bet.finalOutcome;

    for (const wallet of wallets) {
      const userId = wallet.owner;

      if (userId.startsWith('BET')) {
        continue;
      }

      await tradeService.closeTrades(
        userId,
        bet,
        outcome.index,
        win ? 'rewarded' : 'closed',
        session
      );
    }
  }
};

exports.refundUserHistory = async (bet, session) => {
  const userIds = [];
  const betContract = new BetContract(bet.id, bet.outcomes.length);

  for (const outcome of bet.outcomes) {
    const wallets = await betContract.getInvestorsOfOutcome(outcome.index);

    for (const wallet of wallets) {
      const userId = wallet.owner;

      if (userId.startsWith('BET')) {
        continue;
      }

      if (!userIds.includes(userId)) {
        userIds.push(userId);
      }

      await tradeService.closeTrades(userId, bet, outcome.index, 'closed', session);
    }
  }

  publishEvent(notificationEvents.EVENT_BET_CANCELED, {
    producer: 'system',
    producerId: 'notification-service',
    data: {
      bet,
      userIds,
    },
    broadcast: true
  });

  return userIds;
};

exports.automaticPayout = async (winningUsers, bet) => {
  // Payout finalOutcome
  for (const userId of winningUsers) {
    await userService.payoutUser(userId, bet);
  }
};

exports.resolve = async ({
  betId,
  outcomeIndex,
  evidenceActual,
  evidenceDescription,
  reporter,
}) => {
  const LOG_TAG = '[RESOLVE-BET]';

  const bet = await eventService.getBet(betId);
  const event = await Event.findById(bet.event);

  if (bet.status !== 'active' && bet.status !== 'closed') {
    throw new Error('Event can only be resolved if it is active or closed');
  }
  console.debug(LOG_TAG, 'Resolving Bet', { betId, reporter, outcomeIndex });

  let resolveResults = [];
  let ammInteraction = [];

  const session = await Bet.startSession();
  try {
    await session.withTransaction(async () => {
      bet.finalOutcome = outcomeIndex;
      bet.resolved = true;
      bet.endDate = new Date().toISOString();
      bet.evidenceDescription = evidenceDescription;
      bet.evidenceActual = evidenceActual;

      await this.clearOpenBets(bet, session);
      await bet.save({ session });
      const betContract = new BetContract(betId);
      resolveResults = await betContract.resolveAndPayout(reporter, outcomeIndex);
      ammInteraction = await betContract.getUserAmmInteractions();
    });

    publishEvent(notificationEvents.EVENT_BET_RESOLVED, {
      producer: 'system',
      producerId: 'notification-service',
      data: { bet, event },
      broadcast: true
    });
  } catch (err) {
    console.debug(err);
  } finally {
    await session.endSession();
  }

  // find out how much each individual user invested
  const investedValues = {}; // userId -> value
  for (const interaction of ammInteraction) {
    const amount = fromScaledBigInt(interaction.amount);

    if (interaction.direction === 'BUY') {
      // when user bought, add this amount to value invested
      investedValues[interaction.buyer] = investedValues[interaction.buyer]
        ? amount.plus(investedValues[interaction.buyer])
        : amount;
    } else if (interaction.direction === 'SELL') {
      // when user sells, decrease amount invested
      investedValues[interaction.buyer] = investedValues[interaction.buyer].minus(amount);
    }
  }

  console.log(LOG_TAG, 'Finding investments', investedValues);

  for (const resolvedResult of resolveResults) {
    const userId = resolvedResult.owner;
    const { balance } = resolvedResult;
    const winToken = fromScaledBigInt(balance);

    if (userId.includes('_')) {
      continue;
    }

    console.log(LOG_TAG, 'Awarding winnings', { userId, winToken });

    // update the balance of tokens won of a user, to be used for leaderboards
    // must be done inside transaction
    await userService.increaseAmountWon(userId, winToken);
    publishEvent(notificationEvents.EVENT_USER_REWARD, {
      producer: 'system',
      producerId: 'notification-service',
      data: { bet, event, userId, winToken: winToken.toString() },
      broadcast: true
    });

    // send notification to this user
    websocketService.emitBetResolveNotification(
      // eslint-disable-line no-unsafe-finally
      userId,
      betId,
      bet.marketQuestion,
      bet.outcomes[outcomeIndex].name,
      +investedValues[userId],
      event.previewImageUrl,
      winToken
    );
  }
  return bet;
};

exports.cancel = async (bet, cancellationReason) => {
  const session = await Bet.startSession();

  let dbBet;
  let userIds = [];

  await session.withTransaction(async () => {
    dbBet = await eventService.getBet(bet._id, session);

    const betContract = new BetContract(dbBet.id);
    await betContract.refund();

    dbBet.canceled = true;
    dbBet.reasonOfCancellation = cancellationReason;
    dbBet.endDate = new Date().toISOString();
    await eventService.saveBet(dbBet, session);

    userIds = await this.refundUserHistory(dbBet, session);
  });

  if (dbBet) {
    const event = await eventService.getEvent(dbBet.event);

    for (const userId of userIds) {
      publishEvent(notificationEvents.EVENT_CANCEL, {
        producer: 'system',
        producerId: 'notification-service',
        data: {
          userId,
          eventId: dbBet.event,
          eventName: event.name,
          reasonOfCancellation: dbBet.reasonOfCancellation,
          previewImageUrl: event.previewImageUrl,
        },
        broadcast: true
      });
      websocketService.emitEventCancelNotification(
        userId,
        dbBet.event,
        event.name,
        dbBet.reasonOfCancellation
      );
    }
  }

  return dbBet;
};
