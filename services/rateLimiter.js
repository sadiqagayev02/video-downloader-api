// services/rateLimiter.js
const rateLimit = require('express-rate-limit');

// Info endpoint üçün limit (daha sərt - sui-istifadənin qarşısını almaq üçün)
const infoLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 dəqiqə
  max: 30, // dəqiqədə 30 sorğu
  message: { 
    success: false,
    error: 'Həddən çox sorğu. Zəhmət olmasa 1 dəqiqə gözləyin.' 
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // IP + User-Agent ilə unikal açar
    return req.ip + (req.headers['user-agent'] || '').substring(0, 50);
  },
  skip: (req) => {
    // Health check sorğularını limitləmə
    return req.path === '/api/health';
  }
});

// Download start endpoint üçün limit
const downloadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 dəqiqə
  max: 10, // dəqiqədə 10 yükləmə sorğusu
  message: { 
    success: false,
    error: 'Həddən çox yükləmə sorğusu. Zəhmət olmasa 1 dəqiqə gözləyin.' 
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.ip + (req.headers['user-agent'] || '').substring(0, 50);
  }
});

// Fayl göndərmə endpointi üçün limit
const fileLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 dəqiqə
  max: 20, // dəqiqədə 20 fayl sorğusu
  message: { 
    success: false,
    error: 'Həddən çox fayl sorğusu. Zəhmət olmasa 1 dəqiqə gözləyin.' 
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Audio endpoint üçün limit
const audioLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { 
    success: false,
    error: 'Həddən çox audio sorğusu. Zəhmət olmasa 1 dəqiqə gözləyin.' 
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Global limit (bütün endpointlər üçün fallback)
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100, // dəqiqədə maksimum 100 sorğu
  message: { 
    success: false,
    error: 'Həddən çox sorğu. Zəhmət olmasa 1 dəqiqə gözləyin.' 
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Health check və static faylları limitləmə
    return req.path === '/api/health' || req.path === '/';
  }
});

module.exports = { 
  infoLimiter, 
  downloadLimiter, 
  fileLimiter,
  audioLimiter,
  globalLimiter
};