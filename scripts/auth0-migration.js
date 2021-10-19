const dotenv = require('dotenv');
dotenv.config();
const bcrypt = require('bcrypt');
const logger = require('../util/logger')
const mongoose = require('mongoose');
const wallfair = require('@wallfair.io/wallfair-commons');
const { createUser } = require('../services/auth0-service');
const { updateUser } = require('../services/user-service');
const { User } = require('@wallfair.io/wallfair-commons').models;


async function connectMongoDB() {
  const connection = await mongoose.connect(process.env.DB_CONNECTION, {
    useUnifiedTopology: true,
    useNewUrlParser: true,
    useFindAndModify: false,
    useCreateIndex: true,
    readPreference: 'primary',
    retryWrites: true,
  });
  logger.info('Connection to Mongo-DB successful');

  wallfair.initModels(connection);
  logger.info('Mongoose models initialized');

  return connection;
}

const doMigration = async () => {
  // get all users
  const users = await User.find({}).exec();
  if (!users || !users.length) throw new Error('No users found!')

  // acutal migration
  await Promise.all(
    users.map(async user => {
      const auth0User = await createUser(user.id, {
        email: user.email,
        password: user.password,
      });

      return updateUser(user.id, {
        auth0Id: auth0User.user_id
      })
    })
  )
}

(async () => {
  try {
    // waterfall to make sure everythings there
    await [
      connectMongoDB,
      doMigration,
    ].reduce((p, f) => p.then(f), Promise.resolve());

  } catch (err) {
    logger.error(err)
  }
})()
