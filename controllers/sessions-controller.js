const { ObjectId } = require('mongodb')
const logger = require('../util/logger');
const userApi = require('../services/user-api');
const { ErrorHandler } = require('../util/error-handler');
const auth0Service = require('../services/auth0-service');
const { validationResult } = require('express-validator');
const userService = require('../services/user-service');
const mailService = require('../services/mail-service');
const { generate } = require('../helper');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { publishEvent, notificationEvents } = require('../services/notification-service');
const { INFLUENCERS, WFAIR_REWARDS } = require("../util/constants");

module.exports = {
  async createUser(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return next(new ErrorHandler(422, errors));

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
      
      // create auth0 user
      const auth0User = await auth0Service.createUser(wFairUserId, {
        email,
        username: username || `wallfair-${counter}`,
        password,
        app_metadata: {},
        user_metadata: {
          // this reflects our own user mongoDB user Id
          appId: wFairUserId,
        },
      });
      logger.info("Created auth0User", auth0User)

      if (!auth0User) {
        return next(new ErrorHandler(500, "Couldn't create auth0 user"));
      }

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
      logger.info("Created WFair user", createdUser)
      if (!createdUser) {
        return next(new ErrorHandler(500, "Couldn't create WFAIR user"));
      }

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

      publishEvent(notificationEvents.EVENT_USER_SIGNED_UP, {
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
        broadcast: true
      });

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

  async verify(req, res, next) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return next(new ErrorHandler(422, errors));
    }

    try {
      const { userIdentifier, email } = req.body;
      let newUser = false;
      let user = await userApi.getByAuth0IdOrEmail(userIdentifier, email);

      if (!user) {
        newUser = true;
        const counter = ((await userApi.getUserEntriesAmount()) || 0) + 1;
        const emailCode = generate(6);
        user = await userApi.createUser({
          email,
          emailCode,
          username: `wallfair-${counter}`,
          preferences: {
            currency: 'WFAIR',
          },
          auth0Id: userIdentifier,
        });
        await userService.mintUser(user.id.toString());
        await mailService.sendConfirmMail(user);
        await auth0Service.updateUserMetadata(userIdentifier, { wfairUserId: user.id });
      }

      if (user && !user.auth0Id) {
        user.auth0Id = userIdentifier;
        await user.save();
        await auth0Service.updateUserMetadata(userIdentifier, { wfairUserId: user.id });
      }

      if (user.status === 'locked') {
        return next(new ErrorHandler(403, 'Your account is locked'));
      }

      publishEvent(notificationEvents.EVENT_USER_SIGNED_IN, {
        producer: 'user',
        producerId: user._id,
        data: {
          userIdentifier,
          userId: user._id,
          username: user.username,
          updatedAt: Date.now()
        },
        broadcast: true
      });

      res.status(200).json({
        userId: user._id.toString(),
        newUser,
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

      publishEvent(notificationEvents.EVENT_USER_CHANGED_PASSWORD, {
        producer: 'user',
        producerId: user._id,
        data: {
          email: user.email,
          passwordResetToken: req.body.passwordResetToken
        }
      });

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

      publishEvent(notificationEvents.EVENT_USER_FORGOT_PASSWORD, {
        producer: 'user',
        producerId: user._id,
        data: {
          email: user.email,
          passwordResetToken: user.passwordResetToken,
        }
      });

      return res.status(200).send();
    } catch (err) {
      logger.error(err);
      return res.status(500).send();
    }
  },
};
