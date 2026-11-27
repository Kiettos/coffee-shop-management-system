const router = require('express').Router();
const { wrap } = require('../middleware/errorHandler');
const { requireAuth } = require('../middleware/auth');
const c = require('../controllers/loginController');

router.post('/login', wrap(c.login));
router.get('/me', requireAuth, wrap(c.me));
router.post('/change-password', requireAuth, wrap(c.changePassword));

module.exports = router;
