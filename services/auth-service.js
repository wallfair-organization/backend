const jwt = require('jsonwebtoken');
const { getDiscordUserData } = require('../util/discord.oauth');
const { getFacebookUserData } = require('../util/facebook.oauth');
const { getGoogleUserData } = require('../util/google.oauth');
const { getTwitchUserData } = require('../util/twitch.oauth');
const { User } = require('@wallfair.io/wallfair-commons').models;
const amqp = require('./amqp-service');

// Import User Service
const userService = require('./user-service');
const { publishEvent, notificationEvents } = require('./notification-service');

// Import twilio client
const twilio = require('twilio')(process.env.TWILIO_ACC_SID, process.env.TWILIO_AUTH_TOKEN);

exports.generateJwt = async (user) => jwt.sign({ userId: user.id, phone: user.phone, isAdmin: Boolean(user.admin) }, process.env.JWT_KEY, { expiresIn: '48h' });

exports.getUserDataForProvider = async (provider, context) => {
  const dataGetter = {
    google: getGoogleUserData,
    facebook: getFacebookUserData,
    twitch: getTwitchUserData,
    discord: getDiscordUserData,
  }[provider];

  if (!dataGetter) {
    throw new Error(`Provider '${JSON.stringify(provider)}' not supported.`);
  }

  return {
    ...await dataGetter(context),
    accountSource: provider,
  };


}
exports.doLogin = async (phone, ref) => {
  // Check if user with phone already exists
  const existingUser = await userService.getUserByPhone(phone);

  const verification = await twilio.verify
    .services(process.env.TWILIO_SID)
    .verifications.create({ to: phone, channel: 'sms' });

  if (!existingUser) {
    let createdUser = new User({
      phone,
      ref,
    });

    try {
      const session = await User.startSession();
      try {
        await session.withTransaction(async () => {
          await userService.saveUser(createdUser, session);
          createdUser = await userService.getUserByPhone(phone, session);
          console.debug(`createdUser ${createdUser.id}`);
          await userService.mintUser(createdUser.id.toString());
        });

        // TODO: Move to new function after impl for user/password is ready
        publishEvent(notificationEvents.EVENT_USER_SIGNED_UP, {
          producer: 'user',
          producerId: createdUser._id,
          data: { phone, ref },
        });
      } finally {
        await session.endSession();
      }
    } catch (err) {
      console.debug(err);
      throw new Error('Signing up/in failed, please try again later.', 500);
    }
  }

  return { status: verification.status, existing: existingUser && existingUser.confirmed };
};

exports.verifyLogin = async (phone, smsToken) => {
  const user = await userService.getUserByPhone(phone);

  if (!user) {
    throw new Error('User not found, please try again', 422);
  }

  let verification;

  try {
    verification = await twilio.verify
      .services(process.env.TWILIO_SID)
      .verificationChecks.create({ to: phone, code: smsToken });
  } catch (err) {
    throw new Error('Invalid verification code', 401);
  }

  if (!verification || verification.status !== 'approved') {
    throw new Error('Invalid verification code', 401);
  }

  amqp.send(
    'universal_events',
    'event.user_signed_in',
    JSON.stringify({
      event: notificationEvents.EVENT_USER_SIGNED_IN,
      producer: 'user',
      producerId: user._id,
      data: { phone },

      date: Date.now(),
      broadcast: true,
    })
  );
  return user;
};
