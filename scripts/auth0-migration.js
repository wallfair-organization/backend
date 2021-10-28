const dotenv = require('dotenv');
dotenv.config();
const logger = require('../util/logger')
const mongoose = require('mongoose');
const wallfair = require('@wallfair.io/wallfair-commons');
const { importUsers } = require('../services/auth0-service');

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
  const args = process.argv.slice(2);
  if (!args.length || !args[0].startsWith('con_')) {
    throw new Error('Missing connection id argument');
  }

  await connectMongoDB();

  const connectionId = args[0];
  const users = await wallfair.models.User.find(
    { password: { $exists: true } },
    {
      email: "$email",
      name: "$name",
      nickname: "$username",
      email_verified: { $literal: true },
      custom_password_hash: {
        algorithm: "bcrypt",
        hash: {
          value: "$password"
        }
      },
      user_metadata: {
        wfairUserId: { $toString: "$_id" }
      }
    }
  ).select({ _id: 0 });

  if (!users || !users.length) throw new Error('No users found!')

  const response = await importUsers(users, connectionId);
  console.log("Import done", response);
}

(async () => {
  try {
    await doMigration();
  } catch (e) {
    console.error('Migration script failed: ', e.message);
  } finally {
    process.exit();
  }
})();