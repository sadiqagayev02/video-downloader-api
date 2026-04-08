// A) index.js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const rateLimiter = require('./services/rateLimiter');
const infoRoutes = require('./routes/info');
const downloadRoutes = require('./routes/download');
const healthRoutes = require('./routes/health');
const cleanupService = require('./services/cleanupService');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));

// TMP qovluğunu yarat
const tmpDir = process.env.TMP_DIR || '/tmp/video-downloader';
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
  console.log(`✅ TMP qovluğu yaradıldı: ${tmpDir}`);
}

// Rate limiting tətbiq et
app.use('/api/info', rateLimiter.infoLimiter);
app.use('/api/download', rateLimiter.downloadLimiter);

// Routes
app.use('/api/info', infoRoutes);
app.use('/api/download', downloadRoutes);
app.use('/api/health', healthRoutes);

// Xəta handleri
app.use((err, req, res, next) => {
  console.error('❌ Global xəta:', err.message);
  res.status(500).json({ 
    success: false, 
    error: 'Server daxili xətası',
    message: err.message 
  });
});

// Təmizlik servisini başlat
cleanupService.startCleanup();

app.listen(PORT, () => {
  console.log(`🚀 Server ${PORT} portunda işləyir`);
  console.log(`📁 TMP direktoriyası: ${tmpDir}`);
});