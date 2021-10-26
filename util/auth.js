const passport = require('passport');
const JWTstrategy = require('passport-jwt').Strategy;
const ExtractJWT = require('passport-jwt').ExtractJwt;
const { passportJwtSecret } = require('jwks-rsa');
// Import User Service
const userService = require('../services/user-service');
const userApi = require('../services/user-api');

passport.use(
  'jwt',
  new JWTstrategy(
    {
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
      }),
      jwtFromRequest: ExtractJWT.fromAuthHeaderAsBearerToken(),
    },
    async (token, done) => {
      try {
        const user = await userApi.getByAuth0IdOrEmail(token.sub);
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
