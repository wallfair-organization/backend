const router = require('express').Router();

router.get('/health-check', (_, res) => res
  .status(200)
  .json({ timestamp: Date.now() }));

module.exports = router;
