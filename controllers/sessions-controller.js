const { ObjectId } = require('mongodb')
const logger = require('../util/logger');
const userApi = require('../services/user-api');
const { ErrorHandler } = require('../util/error-handler');
const authService = require('../services/auth-service');
const { validationResult } = require('express-validator');
const userService = require('../services/user-service');
const mailService = require('../services/mail-service');
const { generate } = require('../helper');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { INFLUENCERS, WFAIR_REWARDS } = require("../util/constants");
const { notificationEvents } = require('@wallfair.io/wallfair-commons/constants/eventTypes');
const amqp = require('../services/amqp-service');


module.exports = {
  async createUser(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ErrorHandler(422, errors));
    }

    try {
      const { password, email, username, ref, recaptchaToken } = req.body;
      const { skip } = req.query;

      if (!process.env.RECAPTCHA_SKIP_TOKEN || process.env.RECAPTCHA_SKIP_TOKEN !== skip) {
        const recaptchaRes = await axios.post(`https://www.google.com/recaptcha/api/siteverify?secret=${process.env.GOOGLE_RECAPTCHA_CLIENT_SECRET}&response=${recaptchaToken}`);

        if (!recaptchaRes.data.success || recaptchaRes.data.score < 0.5 || recaptchaRes.data.action !== 'join') {
          console.log("ERROR", "Recaptcha verification failed", recaptchaRes ? recaptchaRes.data : "NULL")
          return next(new ErrorHandler(422, 'Recaptcha verification failed, please try again later.'));
        }
      }

      const existing = await userApi.getUserByIdEmailPhoneOrUsername(email);

      if (existing) {
        return next(new ErrorHandler(400, 'User with provided email/phone/username already exists'));
      }

      // init data
      const wFairUserId = new ObjectId().toHexString();
      const counter = ((await userApi.getUserEntriesAmount()) || 0) + 1;
      const passwordHash = await bcrypt.hash(password, 8);

      const emailCode = generate(6);

      const createdUser = await userApi.createUser({
        _id: wFairUserId,
        email,
        emailCode,
        username: username || `wallfair-${counter}`,
        password: passwordHash,
        preferences: {
          currency: 'WFAIR',
        },
        ref
      });

      // TODO: When there's time, delete Auth0 user if WFAIR creation fails

      await userService.mintUser(createdUser.id.toString());

      let initialReward = 5000;
      if (ref) {
        if (INFLUENCERS.indexOf(ref) > -1) {
          console.debug('[REWARD BY INFLUENCER] ', ref);

          await userService.createUserAwardEvent({
            userId: createdUser.id.toString(),
            awardData: {
              type: 'CREATED_ACCOUNT_BY_INFLUENCER',
              award: WFAIR_REWARDS.registeredByInfluencer,
              ref
            }
          }).catch((err) => {
            console.error('createUserAwardEvent', err)
          })

          initialReward += WFAIR_REWARDS.registeredByInfluencer;
        } else {
          console.debug('[REWARD BY USER] ', ref);

          await userService.createUserAwardEvent({
            userId: ref,
            awardData: {
              type: 'CREATED_ACCOUNT_BY_THIS_REF',
              award: WFAIR_REWARDS.referral,
              ref
            }
          }).catch((err) => {
            console.error('createUserAwardEvent', err)
          })
        }
      }

      amqp.send('universal_events', 'event.user_signed_up', JSON.stringify({
        event: notificationEvents.EVENT_USER_SIGNED_UP,
        producer: 'user',
        producerId: createdUser._id,
        data: {
          email: createdUser.email,
          userId: createdUser._id,
          username: createdUser.username,
          ref,
          initialReward,
          updatedAt: Date.now()
        },
        date: Date.now(),
        broadcast: true
      }));

      await mailService.sendConfirmMail(createdUser);

      return res.status(201).json({
        userId: createdUser.id,
        email: createdUser.email,
        initialReward
      });
    } catch (err) {
      logger.error(err);
      return next(new ErrorHandler(500, 'Something went wrong.'));
    }
  },

  async login(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ErrorHandler(422, errors));
    }

    try {
      const { userIdentifier, password } = req.body;
      const user = await userApi.getUserByIdEmailPhoneOrUsername(userIdentifier);

      if (!user) {
        console.log("ERROR ", "User not found upon login!", req.body);
        return next(new ErrorHandler(401, 'Invalid login'));
      }

      const valid = user && (await bcrypt.compare(password, user.password));
      if (user.status === 'locked') {
        return next(new ErrorHandler(403, 'Your account is locked'));
      }

      if (!valid) {
        return next(new ErrorHandler(401, 'Invalid login'));
      }

      amqp.send('universal_events', 'event.user_signed_in', JSON.stringify({
        event: notificationEvents.EVENT_USER_SIGNED_IN,
        producer: 'user',
        producerId: user._id,
        data: {
          userIdentifier,
          userId: user._id,
          username: user.username,
          updatedAt: Date.now()
        }
      }))

      res.status(200).json({
        userId: user.id,
        session: await authService.generateJwt(user),
      });
    } catch (err) {
      logger.error(err);
      return next(new ErrorHandler(401, "Couldn't verify user"));
    }
  },

  async verifyEmail(req, res, next) {
    try {
      const user = await userApi.verifyEmail(req.body.email);
      if (!user) return next(new ErrorHandler(404, "Couldn't find user"));
      return res.status(200).send();
    } catch (err) {
      logger.error(err);
      return res.status(500).send();
    }
  },

  /** Handler to acutally reset your password */
  async resetPassword(req, res, next) {
    try {
      // get user
      const user = await userApi.getUserByIdEmailPhoneOrUsername(req.body.email);
      if (!user) return next(new ErrorHandler(404, "Couldn't find user"));

      // check if token matches
      if (user.passwordResetToken !== req.body.passwordResetToken) {
        return next(new ErrorHandler(401, "Token not valid"));
      }

      // check if email matches
      if (user.email !== req.body.email) {
        return next(new ErrorHandler(401, "Emails do not match"));
      }

      // check if given passwords match
      if (req.body.password !== req.body.passwordConfirmation) {
        return next(new ErrorHandler(401, "Passwords do not match"));
      }

      user.password = await bcrypt.hash(req.body.password, 8);
      user.passwordResetToken = undefined;
      await user.save();

      amqp.send('universal_events', 'event.user_changed_password', JSON.stringify({
        event: notificationEvents.EVENT_USER_CHANGED_PASSWORD,
        producer: 'user',
        producerId: user._id,
        data: {
          email: user.email,
          passwordResetToken: user.passwordResetToken
        }
      }))

      return res.status(200).send();
    } catch (err) {
      logger.error(err);
      return res.status(500).send();
    }
  },


  /** Hanlder to init the "I've forgot my passwort" process */
  async forgotPassword(req, res, next) {
    try {
      const user = await userApi.getUserByIdEmailPhoneOrUsername(req.body.email);
      if (!user) {
        console.log("ERROR", "Forgot password: User not found ", req.body)
        return next(new ErrorHandler(404, "Couldn't find user"));
      }

      const passwordResetToken = generate(10);
      const resetPwUrl = `${process.env.CLIENT_URL}/reset-password?email=${user.email}&passwordResetToken=${passwordResetToken}`

      user.passwordResetToken = passwordResetToken;
      await user.save();
      await mailService.sendPasswordResetMail(user.email, resetPwUrl);

      amqp.send('universal_events', 'event.user_forgot_password', JSON.stringify({
        event: notificationEvents.EVENT_USER_FORGOT_PASSWORD,
        producer: 'user',
        producerId: user._id,
        data: {
          email: user.email,
          passwordResetToken: user.passwordResetToken,
        }
      }))

      return res.status(200).send();
    } catch (err) {
      logger.error(err);
      return res.status(500).send();
    }
  },
};
