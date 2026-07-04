const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Routeları import et
const infoRouter = require('./routes/info');
const downloadRouter = require('./routes/download');
const audioRouter = require('./routes/audio');

app.use(cors());
app.use(express.json());

// Tmp qovluqları yarat
const tmpDir = '/tmp/video-downloader';
const audioDir = '/tmp/audio-downloader';
const cookieDir = '/tmp/yt-cookies';

fs.mkdirSync(tmpDir, { recursive: true });
fs.mkdirSync(audioDir, { recursive: true });
fs.mkdirSync(cookieDir, { recursive: true });

// Statik cookie (environment variable)
const COOKIE_PATH = path.join(cookieDir, 'youtube.txt');
if (process.env.YOUTUBE_COOKIE_BASE64) {
  try {
    const content = Buffer.from(process.env.YOUTUBE_COOKIE_BASE64, 'base64').toString('utf8');
    fs.writeFileSync(COOKIE_PATH, content);
    console.log('✅ Statik cookie yaradıldı (env)');
  } catch (e) {
    console.log('⚠️ Statik cookie xətası:', e.message);
  }
}

// Global yardımçı funksiyalar
global.getStaticCookieArg = () => {
  try {
    fs.accessSync(COOKIE_PATH);
    return `--cookies "${COOKIE_PATH}"`;
  } catch {
    return '';
  }
};

global.makeSafeTitle = (title) => {
  return (title || 'video')
    .replace(/[^\w\s\u0400-\u04FF\u0100-\u024F-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 80) || 'video';
};

global.formatDuration = (secs) => {
  if (!secs) return '00:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// Routeları qoş
app.use('/api/info', infoRouter);
app.use('/api/download', downloadRouter);
app.use('/api/audio', audioRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root
app.get('/', (req, res) => {
  res.json({ 
    message: 'Video Downloader API işləyir!',
    version: '2.0.0',
    features: ['YouTube', 'TikTok', 'Instagram', 'Web', 'MP3']
  });
});

app.listen(PORT, () => console.log(`🚀 Server ${PORT} portunda işləyir`));
