// Import and configure dotenv to enable use of environmental variable
const dotenv = require('dotenv');

dotenv.config();

// Import express
const express = require('express');
const http = require('http');

// Import mongoose to connect to Database
const mongoose = require('mongoose');

// Import Models from Wallfair Commons
const wallfair = require('@wallfair.io/wallfair-commons');
const { handleError } = require('./util/error-handler');

let mongoURL = process.env.DB_CONNECTION;

/**
 * CORS options
 * @type import('cors').CorsOptions
 */
const corsOptions = {
  origin: '*',
  credentials: true,
  allowedMethods: [
    'GET',
    'PUT',
    'POST',
    'PATCH',
    'DELETE',
  ],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'X-Access-Token',
    'Authorization',
  ],
  exposedHeaders: ['Content-Length'],
  preflightContinue: false,
}

// Connection to Database
async function connectMongoDB() {
  const connection = await mongoose.connect(mongoURL, {
    useUnifiedTopology: true,
    useNewUrlParser: true,
    useFindAndModify: false,
    useCreateIndex: true,
    readPreference: 'primary',
    retryWrites: true,
  });
  console.log('Connection to Mongo-DB successful');

  wallfair.initModels(connection);
  console.log('Mongoose models initialized');

  return connection;
}

async function main() {
  const mongoDBConnection = await connectMongoDB();

  // Import Admin service
  const adminService = require('./services/admin-service');
  adminService.setMongoose(mongoDBConnection);
  adminService.initialize();

  const { initBetsJobs } = require('./jobs/bets-jobs');
  initBetsJobs();

  const { initTwitchSubscribeJob } = require('./jobs/twitch-subscribe-job');
  initTwitchSubscribeJob();

  const { initYoutubeCheckJob } = require('./jobs/youtube-live-check-job');
  initYoutubeCheckJob();

  // Import cors
  const cors = require('cors');

  // Import middleware for jwt verification
  const passport = require('passport');
  require('./util/auth');

  // Initialise server using express
  const server = express();
  const httpServer = http.createServer(server);
  server.use(cors(corsOptions));

  const amqp = require('./services/amqp-service');
  amqp.init();

  const awsS3Service = require('./services/aws-s3-service');
  awsS3Service.init();

  // Giving server ability to parse json
  server.use(passport.initialize());
  server.use(passport.session());
  adminService.buildRouter();

  server.use(adminService.getRootPath(), adminService.getRouter());
  server.use(adminService.getLoginPath(), adminService.getRouter());
  server.use(express.json({ limit: '5mb' }));
  server.use(express.urlencoded({ limit: '5mb', extended: true }));

  // Home Route
  server.get('/', (req, res) => {
    res.status(200).send({
      message: 'Blockchain meets Prediction Markets made Simple. - Wallfair.',
    });
  });

  // Import Routes
  const userRoute = require('./routes/users/users-routes');
  const secureEventRoutes = require('./routes/users/secure-events-routes');
  const secureRewardsRoutes = require('./routes/users/secure-rewards-routes');
  const eventRoutes = require('./routes/users/events-routes');
  const secureUserRoute = require('./routes/users/secure-users-routes');
  const secureBetTemplateRoute = require('./routes/users/secure-bet-template-routes');
  const twitchWebhook = require('./routes/webhooks/twitch-webhook');
  const chatRoutes = require('./routes/users/chat-routes');
  const notificationEventsRoutes = require('./routes/users/notification-events-routes');
  const authRoutes = require('./routes/auth/auth-routes');

  const auth0ShowcaseRoutes = require('./routes/auth0-showcase-routes');
  server.use(auth0ShowcaseRoutes);

  // Using Routes
  server.use('/api/event', eventRoutes);
  server.use('/api/event', passport.authenticate('jwt', { session: false }), secureEventRoutes);
  server.use('/api/user', userRoute);
  server.use('/api/user', passport.authenticate('jwt', { session: false }), secureUserRoute);
  server.use('/api/rewards', passport.authenticate('jwt', { session: false }), secureRewardsRoutes);
  server.use(
    '/api/bet-template',
    passport.authenticate('jwt', { session: false }),
    secureBetTemplateRoute
  );
  server.use('/webhooks/twitch/', twitchWebhook);
  server.use('/api/chat', chatRoutes);
  server.use('/api/notification-events', notificationEventsRoutes);
  server.use('/api/auth', authRoutes);

  // Error handler middleware
  // eslint-disable-next-line no-unused-vars
  server.use((err, req, res, next) => {
    handleError(err, res);
  });

  // Let server run and listen
  const appServer = httpServer.listen(process.env.PORT || 8000, () => {
    const { port } = appServer.address();

    console.log(`API runs on port: ${port}`);
  });
}

main();
