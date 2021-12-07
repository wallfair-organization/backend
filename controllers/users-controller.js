const dotenv = require('dotenv');

dotenv.config();
const { validationResult } = require('express-validator');
const {
  Wallet, Transactions, Account, ExternalTransactionOriginator
} = require('@wallfair.io/trading-engine');
const {
  CasinoTradeContract,
  CASINO_TRADE_STATE
} = require('@wallfair.io/wallfair-casino');
const { User } = require('@wallfair.io/wallfair-commons').models;
const userService = require('../services/user-service');
const tradeService = require('../services/trade-service');
const statsService = require('../services/statistics-service');
const mailService = require('../services/mail-service');
const { ErrorHandler } = require('../util/error-handler');
const { fromScaledBigInt, toScaledBigInt } = require('../util/number-helper');

const _ = require('lodash');
const bigDecimal = require('js-big-decimal');

const WFAIR = new Wallet();
const WFAIR_TOKEN = 'WFAIR';
const casinoContract = new CasinoTradeContract();

const bindWalletAddress = async (req, res, next) => {
  console.log('Binding wallet address', req.body);

  // retrieve wallet address
  const { walletAddress } = req.body;

  // ensure address is present
  if (!walletAddress) {
    return next(new ErrorHandler(422, 'WalletAddress expected, but was missing'));
  }

  try {
    // check if there is already a user with this wallet
    const walletUser = await User.findOne({ walletAddress });

    // if this address was already bound to another user, return 409 error
    if (walletUser && walletUser.id !== req.user.id) {
      return next(new ErrorHandler(409, 'This wallet is already bound to another user'));
    }

    let user;
    if (!walletUser) {
      // retrieve user who made the request
      user = await userService.getUserById(req.user.id);
      user.walletAddress = walletAddress;
      user = await userService.saveUser(user);
    } else {
      // do nothing if wallet exists and is already bound to the same user who made the request
    }

    res.status(201).json({
      userId: user?.id,
      walletAddress,
    });
  } catch (err) {
    console.log(err);
    next(new ErrorHandler(422, err.message));
  }
};

//@todo this route is not used in frontend, I will move ref reward part in confirm-email route
const saveAdditionalInformation = async (req, res, next) => {
  // Validating User Inputs
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new ErrorHandler(422, errors[0]));
  }

  // Defining User Inputs
  const { email, name, username } = req.body;

  try {
    let user = await userService.getUserById(req.user.id);

    if (username) {
      const usernameUser = await User.findOne({ username });

      if (usernameUser !== null && !usernameUser._id.equals(user._id)) {
        return next(new ErrorHandler(409, 'Username is already used'));
      }

      user.username = username.replace(' ', '');
      user.name = name;
    }

    if (email) {
      const emailUser = await User.findOne({ email });

      if (emailUser !== null && !emailUser._id.equals(user._id)) {
        return next(new ErrorHandler(409, 'Email address is already used'));
      }

      user.email = email.replace(' ', '');

      // await rewardRefUserIfNotConfirmed(user);
    }

    user = await userService.saveUser(user);

    res.status(201).json({
      userId: user.id,
      phone: user.phone,
      name: user.username,
      email: user.email,
    });
  } catch (err) {
    next(new ErrorHandler(422, err.message));
  }
};

//@todo this route is not used in frontend as well
const saveAcceptConditions = async (req, res, next) => {
  // Validating User Inputs
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(new ErrorHandler(422, 'All conditions need to be accepted'));
  }

  try {
    let user = await userService.getUserById(req.user.id);
    const userConfirmedChanged = await rewardRefUserIfNotConfirmed(user);

    if (userConfirmedChanged) {
      user = await userService.saveUser(user);
    }

    res.status(201).json({
      confirmed: user.confirmed,
    });
  } catch (err) {
    next(new ErrorHandler(422, err.message));
  }
};

const rewardRefUserIfNotConfirmed = async (user) => {
  if (!user.confirmed) {
    // await userService.rewardUserAction(user.ref, WFAIR_REWARDS.referral);
    await userService.createUser(user);
    user.confirmed = true;
  }

  return user.confirmed;
};

// Receive all users in leaderboard
const getLeaderboard = async (req, res) => {
  const limit = +req.params.limit;
  const skip = +req.params.skip;

  const users = await User.find({ username: { $exists: true } })
    .sort({ amountWon: -1, date: -1 })
    .select({ username: 1, amountWon: 1 })
    .limit(limit)
    .skip(skip)
    .exec();

  const total = await User.countDocuments().exec();

  res.json({
    total,
    users,
    limit,
    skip,
  });
};

// Receive specific user information
const getUserInfo = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);

    if (!user) {
      return next(new ErrorHandler(404, 'User not found'));
    }

    const balance = BigInt(await WFAIR.getBalance(userId));
    const formattedBalance = fromScaledBigInt(balance);
    const { rank, toNextRank } = await userService.getRankByUserId(userId);

    res.status(200).json({
      userId: user._id,
      name: user.name,
      username: user.username,
      email: user.email,
      profilePicture: user.profilePicture,
      balance: formattedBalance,
      totalWin: userService.getTotalWin(balance).toString(),
      admin: user.admin,
      emailConfirmed: user.emailConfirmed,
      rank,
      toNextRank,
      amountWon: user.amountWon,
      tokensRequestedAt: user.tokensRequestedAt,
      preferences: user.preferences,
      aboutMe: user.aboutMe,
      status: user.status,
      notificationSettings: user && _.omit(user.toObject().notificationSettings, '_id'),
      alpacaBuilderProps: user.alpacaBuilderProps
    });
  } catch (err) {
    console.error(err);
    next(new ErrorHandler(422, 'Account information loading failed'));
  }
};

// get public basic user info
const getBasicUserInfo = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);

    if (!user) {
      return next(new ErrorHandler(404, 'User not found'));
    }

    const { rank } = await userService.getRankByUserId(userId);

    res.status(200).json({
      name: user.name,
      username: user.username,
      profilePicture: user.profilePicture,
      aboutMe: user.aboutMe,
      rank,
      amountWon: user.amountWon,
      status: user.status,
    });
  } catch (err) {
    console.error(err);
    next(new ErrorHandler(422, 'Account information loading failed'));
  }
};

// check if username already exist
const checkUsername = async (req, res, next) => {
  try {
    const { username } = req.body;
    const user = await User.findOne({
      username,
    });
    let isUnique = false;

    if (!user) {
      isUnique = true;
    }

    res.status(200).json({
      username,
      isUnique,
    });
  } catch (err) {
    console.error(err);
    next(new ErrorHandler(400, 'Check username failed'));
  }
};

// Receive specific user information
const getRefList = async (req, res, next) => {
  try {
    const refList = await userService.getRefByUserId(req.user.id);

    res.status(200).json({
      userId: req.user.id,
      refList,
    });
  } catch (err) {
    next(new ErrorHandler(422, 'Account information loading failed'));
  }
};

const getOpenBetsList = async (request, response, next) => {
  const { user } = request;

  try {
    if (user) {
      const trades = await tradeService.getTradesByUserIdAndStatuses(user.id, ['active']);

      const openBets = [];

      for (const trade of trades) {
        const outcomeIndex = trade._id.outcomeIndex;
        const betId = trade._id.betId;
        // const outcomes = trade._id.bet.outcomes || [];
        let outcomeBuy = 0;
        let outcomeSell = 0;

        // if (outcomes.length) {
        //   const betContract = new BetContract(betId, outcomes.length);
        //   outcomeBuy = await betContract.calcBuy(
        //     toScaledBigInt(trade.totalInvestmentAmount),
        //     outcomeIndex
        //   );
        //   outcomeSell = await betContract.calcSellFromAmount(
        //     toScaledBigInt(trade.totalOutcomeTokens),
        //     outcomeIndex
        //   );
        // }

        openBets.push({
          betId,
          outcome: outcomeIndex,
          investmentAmount: trade.totalInvestmentAmount,
          outcomeAmount: trade.totalOutcomeTokens,
          lastDate: trade.date,
          currentBuyAmount: fromScaledBigInt(outcomeBuy),
          sellAmount: fromScaledBigInt(outcomeSell),
          status: trade._id.status,
        });
      }

      response.status(200).json({
        openBets,
      });
    } else {
      return next(new ErrorHandler(404, 'User not found'));
    }
  } catch (err) {
    console.error(err);
    next(new ErrorHandler(500, err.message));
  }
};

const getHistory = async (req, res, next) => {
  const { user } = req;

  try {
    if (user) {
      const interactions = await casinoContract.getAMMInteractions(user.id);
      const casinoTrades = await casinoContract.getCasinoTradesByUserIdAndStates(user.id, [
        CASINO_TRADE_STATE.LOCKED,
        CASINO_TRADE_STATE.WIN,
        CASINO_TRADE_STATE.LOSS,
      ]);
      const transactions = [];

      for (const interaction of interactions) {
        const investmentAmount = fromScaledBigInt(BigInt(interaction.investmentamount));
        const feeAmount = fromScaledBigInt(BigInt(interaction.feeamount));
        const outcomeTokensBought = fromScaledBigInt(BigInt(interaction.outcometokensbought));

        transactions.push({
          ...interaction,
          investmentAmount,
          feeAmount,
          outcomeTokensBought,
          type: 'BET',
        });
      }

      for (const casinoTrade of casinoTrades) {
        const isWin = casinoTrade.state === CASINO_TRADE_STATE.WIN;
        const investmentAmount = fromScaledBigInt(casinoTrade.stakedamount);
        const outcomeTokensBought = isWin
          ? fromScaledBigInt(
            bigDecimal.multiply(
              BigInt(casinoTrade.stakedamount),
              parseFloat(casinoTrade.crashfactor)
            )
          )
          : 0;
        const direction = isWin ? 'PAYOUT' : 'BUY';

        transactions.push({
          direction,
          investmentAmount,
          outcomeTokensBought,
          trx_timestamp: casinoTrade.created_at,
          type: 'GAME',
        });
      }

      res.status(200).json(transactions);
    } else {
      return next(new ErrorHandler(404, 'User not found'));
    }
  } catch (err) {
    console.error(err);
    next(new ErrorHandler(500, err.message));
  }
};

const getTradeHistory = async (req, res, next) => {
  const user = req.user;

  if (!user) {
    return next(new ErrorHandler(404, 'User not found'));
  }

  try {
    const interactions = await casinoContract.getAMMInteractions(user.id);
    const finalizedTrades = await tradeService.getTradesByUserIdAndStatuses(user.id, [
      'closed',
      'rewarded',
      'sold',
    ]);

    const trades = finalizedTrades.map((trade) => {
      let soldAmount;
      const bet = trade._id;

      if (bet.status === 'sold') {
        const sellInteractions = interactions.filter(
          (i) =>
            i.bet === bet.betId.toString() &&
            i.direction === 'SELL' &&
            i.outcome === bet.outcomeIndex
        );
        const totalSellAmount = _.sum(
          sellInteractions.map(_.property('investmentamount')).map(BigInt).filter(Boolean)
        );
        soldAmount = fromScaledBigInt(totalSellAmount);
      }

      return {
        ...bet,
        investmentAmount: trade.totalInvestmentAmount,
        outcomeAmount: trade.totalOutcomeTokens,
        lastDate: trade.date,
        soldAmount,
      };
    });

    res.status(200).json({
      trades,
    });
  } catch (e) {
    console.error(e);
    next(new ErrorHandler(500, 'Failed to fetch trade history'));
  }
};

const confirmEmail = async (req, res, next) => {
  // Validating User Inputs
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(res.status(400).send(errors));
  }

  // Defining User Inputs
  const { code, userId } = req.query;

  const user = await userService.getUserById(userId);

  if (user.emailConfirmed && user.confirmed) {
    return res.status(200).send({ status: 'The email has been already confirmed' });
  }

  if (user.emailCode === code) {
    user.emailConfirmed = true;
    user.confirmed = true;
    await user.save();

    // await userService
    //   .createUserAwardEvent({
    //     userId,
    //     awardData: {
    //       type: AWARD_TYPES.EMAIL_CONFIRMED,
    //       award: WFAIR_REWARDS.confirmEmail,
    //     },
    //   })
    //   .catch((err) => {
    //     console.error('createUserAwardEvent', err);
    //   });

    res.status(200).send({ status: 'OK' });
  } else {
    next(new ErrorHandler(422, 'The email code is invalid'));
  }
};

const resendConfirmEmail = async (req, res, next) => {
  try {
    // Validating User Inputs
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(res.status(400).send(errors));
    }

    // Defining User Inputs
    const { userId } = req.query;

    const user = await userService.getUserById(userId);

    if (user.emailConfirmed && user.confirmed) {
      return res.status(200).send({ status: 'The email has been already confirmed' });
    }

    await mailService.sendConfirmMail(user);
    res.status(200).send({ status: 'OK' });
  } catch (err) {
    next(new ErrorHandler(422, err.message));
  }
};

const updateUser = async (req, res, next) => {
  if (req.user.admin === false && req.params.userId !== req.user.id) {
    return next(new ErrorHandler(403, 'Action not allowed'));
  }

  //allow notificationSettings to save without additional params
  if (req.body.username || req.body.email) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const error = errors.errors[0].nestedErrors[0];
      return next(new ErrorHandler(400, `${error?.param}: ${error?.value} - ${error?.msg}`));
    }
  }

  try {
    const user = await userService.updateUser(req.params.userId, req.body);
    res.status(200).send({
      name: user.name,
      username: user.username,
      email: user.email,
      aboutMe: user.aboutMe,
      profilePicture: user.profilePicture,
      alpacaBuilderProps: user.alpacaBuilderProps
    });
  } catch (err) {
    next(new ErrorHandler(422, err.message));
  }
};

const updateUserPreferences = async (req, res, next) => {
  if (req.user.admin === false && req.params.userId !== req.user.id) {
    return next(new ErrorHandler(403, 'Action not allowed'));
  }

  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const error = errors.errors[0];
    return next(new ErrorHandler(400, `${error?.param}: ${error?.value} - ${error?.msg}`));
  }

  try {
    await userService.updateUserPreferences(req.params.userId, req.body.preferences);
    res.status(200).send();
  } catch (err) {
    next(new ErrorHandler(422, err.message));
  }
};

const getUserStats = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const user = await userService.getUserById(userId);
    const stats = await statsService.getUserStats(userId).catch((err) => {
      console.error('[getUserStats] err', err);
    });

    res.status(200).json({
      userId: userId,
      username: _.get(user, 'username'),
      stats,
    });
  } catch (err) {
    console.error(err);
    next(new ErrorHandler(422, 'Get user stats failed'));
  }
};

const getUserCount = async (req, res) => {
  const total = await User.countDocuments().exec();
  res.json({
    total,
  });
};

const updateStatus = async (req, res, next) => {
  if (!req.user.admin) {
    return next(new ErrorHandler(403, 'Action not allowed'));
  }

  try {
    await userService.updateStatus(req.params.userId, req.body.status);
    res.status(204).send();
  } catch (err) {
    console.error(err);
    next(new ErrorHandler(500, 'User could not be locked'));
  }
};

const requestTokens = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await userService.getUserById(userId);
    if (!user) return next(new ErrorHandler(403, 'Action not allowed'));
    const balance = BigInt(await WFAIR.getBalance(userId));
    if (balance >= toScaledBigInt(5000) || balance < 0) {
      return next(new ErrorHandler(403, 'Action not allowed'));
    }
    if (
      user.tokensRequestedAt
      && (new Date().getTime() - new Date(user.tokensRequestedAt).getTime()) < 3600000 // 1 hour
    ) {
      return next(new ErrorHandler(
        403,
        'Action not allowed. You can request new tokens after 1 hour since last request'
      ));
    }

    user.tokensRequestedAt = new Date().toISOString()
    user.amountWon = 0;
    const beneficiary = { owner: userId, namespace: 'usr', symbol: WFAIR_TOKEN };
    await WFAIR.mint(beneficiary, toScaledBigInt(5000) - balance);
    await user.save();
    res.status(200).send();
  } catch (err) {
    console.error(err);
    next(new ErrorHandler(422, err.message));
  }
};

const getUserTransactions = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const user = await userService.getUserById(userId);
    if (!user) return next(new ErrorHandler(403, 'Action not allowed'));

    const account = new Account();
    const accounts = await account.getUserAccounts(userId);

    const transactionsAgent = new Transactions();
    const transactions = await transactionsAgent.getExternalTransactionLogs({
      where: [
        ...accounts.map(({ owner_account }) => ({ sender: owner_account })),
        {
          internal_user_id: userId,
          originator: ExternalTransactionOriginator.ONRAMP,
        }
      ]
    });

    res.status(200).json(transactions);
  } catch (err) {
    console.error(err);
    next(new ErrorHandler(422, err.message));
  }
}

exports.bindWalletAddress = bindWalletAddress;
exports.saveAdditionalInformation = saveAdditionalInformation;
exports.saveAcceptConditions = saveAcceptConditions;
exports.getUserInfo = getUserInfo;
exports.getBasicUserInfo = getBasicUserInfo;
exports.getRefList = getRefList;
exports.getOpenBetsList = getOpenBetsList;
exports.getHistory = getHistory;
exports.getTradeHistory = getTradeHistory;
exports.confirmEmail = confirmEmail;
exports.resendConfirmEmail = resendConfirmEmail;
exports.updateUser = updateUser;
exports.updateUserPreferences = updateUserPreferences;
exports.getLeaderboard = getLeaderboard;
exports.checkUsername = checkUsername;
exports.getUserStats = getUserStats;
exports.getUserCount = getUserCount;
exports.updateStatus = updateStatus;
exports.requestTokens = requestTokens;
exports.getUserTransactions = getUserTransactions;
