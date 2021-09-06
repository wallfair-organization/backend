const { BetContract, Erc20 } = require('@wallfair.io/smart_contract_mock');

// Import User, Bet and Event models
const { User, Bet, Event } = require('@wallfair.io/wallfair-commons').models;

const WFAIR = new Erc20('WFAIR');

// Import services

const generator = require('generate-password');

const flatten = require('flat');

const AdminBro = require('admin-bro');
const AdminBroExpress = require('@admin-bro/express');
const AdminBroMongoose = require('@admin-bro/mongoose');
const { Router } = require('express');

AdminBro.registerAdapter(AdminBroMongoose);

let mongoose = null;

exports.setMongoose = (newMongoose) => (mongoose = newMongoose);

let adminBro = null;

exports.initialize = function () {
  adminBro = new AdminBro({
    env: {
      CLIENT_URL: process.env.CLIENT_URL,
    },
    locale: {
      translations: {
        properties: {
          slug: 'SEO-optimized name',
        },
      },
    },
    databases: [mongoose],
    resources: [
      {
        resource: User,
        options: {
          listProperties: [
            '_id',
            'email',
            'name',
            'phone',
            'profilePictureUrl',
          ],
          actions: {
            mint: {
              actionType: 'record',
              icon: 'Cash',
              isVisible: true,
              handler: async (request, response, context) => {
                const { record } = context;
                record.params.balance = await userService
                  .getBalanceOf(record.params._id)
                  .toString();
                return {
                  record: record.toJSON(),
                };
              },
              component: AdminBro.bundle('./components/user-mint'),
            },
            'do-mint': {
              // create a totally new action
              actionType: 'record',
              isVisible: false,
              handler: async (request, response, context) => {
                const addBalance = request.fields.add;
                await userService.mintUser(
                  context.record.params._id,
                  addBalance,
                );
                return {
                  record: context.record.toJSON(context.currentAdmin),
                };
              },
            },
          },
        },
      },
      {
        resource: Bet,
        options: {
          properties: {
            slug: {
              components: {
                new: AdminBro.bundle('./components/slug-input'),
                edit: AdminBro.bundle('./components/slug-input'),
              },
              props: {
                referenceField: 'marketQuestion',
                basePath: '/trade/<event-name>/',
              },
            },
          },
          actions: {
            new: {
              after: async (request) => {
                const bet = flatten.unflatten(request.record.params, {
                  safe: true,
                });

                const session = await Event.startSession();
                await session.withTransaction(async () => {
                  bet.id = bet._id;
                  await eventService.provideLiquidityToBet(bet);
                  const event = await Event.findById(bet.event).session(
                    session,
                  );
                  event.bets.push(bet.id);
                  await event.save({ session });
                });
                return request;
              },
            },
            cancel: {
              // create a totally new action
              actionType: 'record',
              icon: 'Cancel',
              isVisible: true,
              handler: async (request, response, context) => ({
                record: context.record.toJSON(),
              }),
              component: AdminBro.bundle('./components/bet-cancel'),
            },
            'do-cancel': {
              // create a totally new action
              actionType: 'record',
              isVisible: false,
              handler: async (request, response, context) => {
                const session = await Bet.startSession();

                let dbBet;
                let userIds = [];

                await session.withTransaction(async () => {
                  dbBet = await eventService.getBet(
                    request.params.recordId,
                    session,
                  );
                  dbBet.canceled = true;
                  dbBet.reasonOfCancellation = request.fields.reason;

                  userIds = await betService.refundUserHistory(dbBet, session);
                  await eventService.saveBet(dbBet, session);

                  const betContract = new BetContract(dbBet.id);
                  await betContract.refund();
                });

                if (dbBet) {
                  const event = await eventService.getEvent(dbBet.event);

                  for (const userId of userIds) {
                    websocketService.emitEventCancelNotification(userId, dbBet.event, event.name, dbBet.reasonOfCancellation);
                  }
                }

                return {
                  record: context.record.toJSON(),
                };
              },
              component: AdminBro.bundle('./components/bet-cancel'),
            },
            resolve: {
              // create a totally new action
              actionType: 'record',
              icon: 'Receipt',
              isVisible: true,
              handler: async (request, response, context) => {
                const id = context.record.params._id;
                const { record } = context;
                record.params = await Bet.findById(id);
                return {
                  record: record.toJSON(),
                };
              },
              component: AdminBro.bundle('./components/resolve'),
            },
            'do-resolve': {
              // create a totally new action
              actionType: 'record',
              isVisible: false,
              handler: async (request, response, context) => {
                const id = context.record.params._id;
                const bet = await eventService.getBet(id);
                const event = await Event.findById(bet.event);
                const indexOutcome = request.fields.index;
                const { evidenceActual } = request.fields;
                const { evidenceDescription } = request.fields;

                if (bet.status !== 'active' && bet.status !== 'closed') {
                  context.record.params.message = 'Event can only be resolved if it is active or closed';
                  return {
                    record: context.record.toJSON(context.currentAdmin),
                  };
                }

                let resolveResults = [];
                let ammInteraction = [];

                const session = await Bet.startSession();
                try {
                  await session.withTransaction(async () => {
                    bet.finalOutcome = indexOutcome;
                    bet.resolved = true;
                    bet.evidenceDescription = evidenceDescription;
                    bet.evidenceActual = evidenceActual;

                    await betService.clearOpenBets(bet, session);
                    await bet.save({ session });
                    const betContract = new BetContract(id);
                    resolveResults = await betContract.resolveAndPayout(
                      'Wallfair Admin User',
                      indexOutcome,
                    );
                    ammInteraction = await betContract.getUserAmmInteractions();
                  });
                } catch (err) {
                  console.debug(err);
                } finally {
                  await session.endSession();

                  // find out how much each individual user invested
                  const investedValues = {}; // userId -> value
                  for (const interaction of ammInteraction) {
                    const amount = Number(interaction.amount) / Number(WFAIR.ONE);
                    if (interaction.direction === 'BUY') { // when user bought, add this amount to value invested
                      investedValues[interaction.buyer] = investedValues[interaction.buyer] ? investedValues[interaction.buyer] + amount : amount;
                    } else if (interaction.direction === 'SELL') { // when user sells, decrease amount invested
                      investedValues[interaction.buyer] = investedValues[interaction.buyer] - amount;
                    }
                  }

                  for (const resolvedResult of resolveResults) {
                    const userId = resolvedResult.owner;
                    const { balance } = resolvedResult;

                    const winToken = Math.round(Number(balance) / Number(WFAIR.ONE));

                    if (userId.includes('_')) {
                      continue;
                    }

                    // update the balance of tokens won of a user, to be used for leaderboards
                    // must be done inside transaction
                    await userService.increaseAmountWon(userId, winToken);

                    // send notification to this user
                    if (user) {
                      websocketService.emitBetResolveNotification(
                        userId,
                        id,
                        bet.marketQuestion,
                        bet.outcomes[indexOutcome].name,
                        Math.round(investedValues[userId]),
                        event.previewImageUrl,
                        winToken,
                      );
                    }
                  }
                }
                return {
                  record: context.record.toJSON(context.currentAdmin),
                };
              },
            },
          },
        },
      },
      {
        resource: Event,
        options: {
          listProperties: ['_id', 'name', 'type', 'category'],
          editProperties: ['name', 'slug', 'type', 'category', 'previewImageUrl', 'streamUrl', 'tags'],
          showProperties: ['name', 'slug', 'type', 'category', 'tags', 'previewImageUrl', 'streamUrl', 'metadata'],
          properties: {
            slug: {
              components: {
                new: AdminBro.bundle('./components/slug-input'),
                edit: AdminBro.bundle('./components/slug-input'),
              },
              props: {
                referenceField: 'name',
                basePath: '/trade/',
              },
            },
          },
          actions: {
            'import-event-from-twitch': {
              actionType: 'resource',
              label: 'Create Event from Twitch URL',
              icon: 'Add',
              isVisible: true,
              component: AdminBro.bundle('./components/twitch-url'),
            },
            'do-import-event-from-twitch-url': {
              actionType: 'resource',
              isVisible: false,
              handler: async (request, response, context) => {
                let { twitch_url } = request.payload;
                if (twitch_url.lastIndexOf('/') == -1) {
                  twitch_url = `https://www.twitch.tv/${twitch_url}`;
                }
                const event = await twitchService.getEventFromTwitchUrl(twitch_url);

                return {
                  eventId: event._id.toString(),
                };
              },
            },
            'sync-with-twitch': {
              actionType: 'record',
              label: 'Reload information from twitch',
              icon: 'Reset',
              component: false,
              isVisible: (currentAdmin) => currentAdmin.record.params.type === 'streamed',
              isAccessible: (currentAdmin) => currentAdmin.record.params.type === 'streamed',
              handler: async (request, response, context) => {
                const twitchUrl = context.record.params.streamUrl;
                console.log('URL', twitchUrl);

                const event = await twitchService.getEventFromTwitchUrl(twitchUrl);

                context.record.params = event;

                return {
                  record: context.record.toJSON(),
                };
              },
            },
            'new-bet-from-template': {
              actionType: 'record',
              icon: 'Plus',
              isVisible: true,
              handler: async (request, response, context) => {
                const { record } = context;
                return {
                  record: record.toJSON(),
                };
              },
              component: AdminBro.bundle('./components/new-bet'),
            },
            'do-new-bet-from-template': {
              actionType: 'record',
              isVisible: false,
              handler: async (request, response, context) => {
                const { record } = context;
                const event = flatten.unflatten(record.params, {
                  safe: true,
                });
                let dbEvent = await eventService.getEvent(record.params._id);
                const bet = event.betTemplate;

                const slug = generateSlug(bet.marketQuestion);

                let createBet = new Bet({
                  marketQuestion: bet.marketQuestion,
                  description: bet.description,
                  hot: bet.hot,
                  outcomes: bet.outcomes,
                  duration: bet.duration,
                  event: record.params._id,
                  creator: bet.creator,
                  published: false,
                  slug,
                });

                const session = await Bet.startSession();
                try {
                  await session.withTransaction(async () => {
                    createBet = await eventService.saveBet(createBet, session);

                    createBet.endDate = new Date(
                      createBet.date.getTime() + bet.betDuration * 1000 * 60,
                    );

                    createBet = await eventService.saveBet(createBet, session);

                    dbEvent.bets.push(createBet);
                    dbEvent = await eventService.saveEvent(dbEvent, session);
                  });
                } finally {
                  await session.endSession();
                }
                record.params = dbEvent;
                record.params._doc.createdBet = createBet.id;
                return {
                  record: record.toJSON(),
                };
              },
              component: AdminBro.bundle('./components/new-bet'),
            },
          },
        },
      },
    ],
    rootPath: '/admin',
    branding: {
      companyName: 'WALLFAIR',
    },
  });
};
const passport = require('passport');
const twitchService = require('./twitch-service');
const websocketService = require('./websocket-service');
const betService = require('./bet-service');
const eventService = require('./event-service');
const generateSlug = require('../util/generateSlug');
const userService = require('./user-service');

exports.getRootPath = function () {
  return adminBro.options.rootPath;
};

exports.getLoginPath = function () {
  return adminBro.options.loginPath;
};
let router = null;
exports.buildRouter = function () {
  router = AdminBroExpress.buildAuthenticatedRouter(adminBro, {
    authenticate: async (username, password, request, response) => username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD,
    cookiePassword: 'ueudeiuhihd',
  },
  null,
  {
    resave: false,
    saveUninitialized: true,
  });/**/

  // router = Router()
  // router.use(passport.authenticate('jwt_admin', { session: false }))
  router = AdminBroExpress.buildRouter(adminBro, router);
};

exports.getRouter = function () {
  return router;
};
