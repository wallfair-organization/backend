const passport = require('passport');
const OAuth2Strategy = require('passport-oauth2')
const userService = require('../services/user-service');
const JWTstrategy = require('passport-jwt').Strategy;
const ExtractJWT = require('passport-jwt').ExtractJwt;
const request = require('request');
// Import User Service
const {
  OAUTH_AUTHORIZATION_URL,
  OAUTH_TOKEN_URL,
  OAUTH_CLIENT_ID,
  OAUTH_CLIENT_SECRET,
  OAUTH_CALLBACK_URL,
  CLIENT_URL
} = process.env;

OAuth2Strategy.prototype.userProfile = function (accessToken, done) {
  var options = {
    url: CLIENT_URL + '/auth/user-info',
    headers: {
      'User-Agent': 'request',
      'Authorization': 'Bearer ' + accessToken,
    }
  };

  request(options, callback);

  function callback(error, response, body) {
    if (error || response.statusCode !== 200) {
      return done(error);
    }
    var info = JSON.parse(body);
    return done(null, info.user);
  }
};



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
if (!OAUTH_AUTHORIZATION_URL) throw new Error('Env Var OAUTH_AUTHORIZATION_URL is missing')
if (!OAUTH_TOKEN_URL) throw new Error('Env Var OAUTH_TOKEN_URL is missing')
if (!OAUTH_CLIENT_ID) throw new Error('Env Var OAUTH_CLIENT_ID is missing')
if (!OAUTH_CLIENT_SECRET) throw new Error('Env Var OAUTH_CLIENT_SECRET is missing')
if (!OAUTH_CALLBACK_URL) throw new Error('Env Var OAUTH_CALLBACK_URL is missing')

passport.use(
  "oauth2",
  new OAuth2Strategy({
    clientID: OAUTH_CLIENT_ID,
    clientSecret: OAUTH_CLIENT_SECRET,
    authorizationURL: OAUTH_AUTHORIZATION_URL,
    tokenURL: OAUTH_TOKEN_URL,
    callbackURL: OAUTH_CALLBACK_URL,
  },
    async (req, accessToken, refreshToken, params, profile, done) => {
      const user = await userService.getUserById(params.id)
      if (!user) done(new Error("Couldn't find user"), false)
      done(user, true)
    }
  )
);

// Allow passport to serialize and deserialize users into sessions
passport.serializeUser((user, cb) => cb(null, user))
passport.deserializeUser((obj, cb) => cb(null, obj))

