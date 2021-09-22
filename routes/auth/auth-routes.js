const router = require('express').Router();
const { check } = require('express-validator');
const passport = require('passport');
const sessionsController = require('../../controllers/sessions-controller');

// router.post(
//   '/login',
//   [check('userIdentifier').notEmpty(), check('password').notEmpty().isLength({ min: 8, max: 255 })],
//   sessionsController.login
// );

router.post(
  '/sign-up',
  [
    check('email').notEmpty(),
    check('passwordConfirm').notEmpty(),
    check('password')
      .notEmpty()
      .isLength({ min: 8, max: 255 })
      .custom((value, { req }) => {
        if (value !== req.body.passwordConfirm) {
          throw new Error("Passwords don't match");
        } else {
          return value;
        }
      }),
  ],
  sessionsController.createUser
);

router.post('/verify-email', [check('email').notEmpty().isEmail()], sessionsController.verifyEmail);

router.post(
  '/reset-password',
  [check('email').notEmpty().isEmail()],
  sessionsController.resetPassword
);

/** ##############
 * New Routes
 */
// start the login process using passport-oauth2 strategy
router.get(
  '/login',
  passport.authenticate('oauth2')
);

// callback when the authorization server (idp) provided an authorization code
router.get(
  '/callback',
  passport.authenticate('oauth2', { failureRedirect: '/auth_code/error' }),
  function (req, res) {
    res.redirect(process.env.CLIENT_URL);
  }
);

router.get("/logout", (req, res) => {
  req.session = null;
  req.logout();
  res.redirect(process.env.CLIENT_URL);
})

module.exports = router;
