// Import the express Router to create routes
const router = require('express').Router();

// Imports from express validator to validate user input
const { check, oneOf } = require('express-validator');

// Import User Controller
const userController = require('../../controllers/users-controller');

router.post(
  '/saveAdditionalInformation',
  oneOf([
    [
      check('name').notEmpty(),
      check('username').notEmpty(),
      check('username').isLength({ min: 3, max: 25 }),
      check('name').isLength({ min: 3 }),
    ],
    check('email').isEmail(),
  ]),
  userController.saveAdditionalInformation
);

router.post(
  '/acceptConditions',
  [check('conditions').isArray({ min: 3, max: 3 })],
  userController.saveAcceptConditions
);

router.get('/refList', userController.getRefList);

router.get('/history', userController.getHistory);

router.patch(
  '/:userId',
  oneOf([[check('username').isLength({ min: 3, max: 25 })]]),
  userController.updateUser
);

router.patch(
  '/:userId/preferences',
  [check('preferences').notEmpty()],
  userController.updateUserPreferences
);

router.get('/:userId', userController.getUserInfo);

router.post('/:userId/status', userController.updateStatus);

router.get('/wallet/transactions', userController.getUserTransactions);

router.post('/buy-with-crypto', userController.buyWithCrypto);
router.post('/buy-with-fiat', userController.buyWithFiat);
router.post('/consent', userController.updateUserConsent);

router.post(
  '/cryptopay/channel',
  [
    check('currency')
      .isIn(['BTC', 'ETH', 'LTC', 'USDT', 'USDC', 'DAI', 'XRP'])
  ],
  userController.cryptoPayChannel
);

router.post(
  '/moonpay/url',
  [
    check('amount').isNumeric(),
    check('currency').isIn(['EUR', 'USD']),
  ],
  userController.generateMoonpayUrl
)

router.post(
  '/:userId/ban',
  [check('duration').isNumeric(), check('description').isString()],
  userController.banUser
);

router.get('/promo-codes/all', userController.getUserPromoCodes);

router.post(
  '/promo-codes',
  [check('promoCode').notEmpty()],
  userController.claimPromoCode
);

router.patch('/promo-codes/:name', userController.cancelPromoCode);

router.post('/tokens', userController.claimTokens);

router.post('/upload-image', userController.uploadImage);

router.post(
  '/deposits',
  [
    check('networkCode').notEmpty(),
    check('hash').notEmpty(),
  ],
  userController.deposit
);

module.exports = router;
