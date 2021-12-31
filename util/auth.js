const passport = require('passport');
const JWTstrategy = require('passport-jwt').Strategy;
const ExtractJWT = require('passport-jwt').ExtractJwt;
// Import User Service
const userService = require('../services/user-service');
const { isUserBanned } = require('../util/user');
const { BannedError } = require('../util/error-handler');

exports.setPassportStrategies = () => {
  passport.use(
    'jwt',
    new JWTstrategy(
      {
        secretOrKey: process.env.JWT_KEY,
        jwtFromRequest: ExtractJWT.fromAuthHeaderAsBearerToken(),
      },
      async (token, done) => {
        try {
          const user = await userService.getUserById(token.userId);
          if (isUserBanned(user)) {
            throw new BannedError(user);
          }
          return done(null, user);
        } catch (error) {
          done(error);
        }
      }
    )
  );
  passport.use(
    'jwt_admin',
    new JWTstrategy(
      {
        secretOrKey: process.env.JWT_KEY,
        jwtFromRequest: ExtractJWT.fromAuthHeaderAsBearerToken(),
      },
      async (token, done) => {
        try {
          let user = await userService.getUserById(token.userId);
          if (!user.admin) {
            user = undefined;
          }
          return done(null, user);
        } catch (error) {
          done(error);
        }
      }
    )
  );
};

/**
 * Adds req.isAdmin that indicates if the logged in user
 * add user id to req._userId for api_logs
 * is an admin
 */
exports.evaluateIsAdmin = (req, res, next) => {
  return passport.authenticate('jwt', { session: false }, function (err, user) {
    if (err) {
      console.log(err);
    }
    req.isAdmin = !err && user && user.admin;
    req._userId = user?._id?.toString();
    next();
  })(req, res, next);
};

/**
 * Returns if the current logged in user is allowed to perform an action on a userId
 * provided in the request querystring or body
 * @param  {} req an http request
 * @param  {} userPropName optional name of property to look for
 */
exports.isUserAdminOrSelf = (req, userPropName = 'userId') => {
  if (req.isAdmin) return true;
  const actionableUserId =
    req.param[userPropName] || req.query[userPropName] || req.query['user-id'];
  return req.user?.id?.toString() === actionableUserId?.toString();
};
