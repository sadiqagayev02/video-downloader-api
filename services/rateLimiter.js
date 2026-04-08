// J) services/rateLimiter.js
const rateLimit = require('express-rate-limit');

const infoLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 dəqiqə
  max: 20,
  message: { error: 'Həddən çox sorğu, 1 dəqiqə gözləyin' },
  standardHeaders: true,
  legacyHeaders: false
});

const downloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Həddən çox yükləmə sorğusu, 1 dəqiqə gözləyin' },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = { infoLimiter, downloadLimiter };