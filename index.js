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

// ─── YouTube statik cookie ──────────────────────────────────────────────────
const COOKIE_PATH = path.join(cookieDir, 'youtube.txt');
if (process.env.YOUTUBE_COOKIE_BASE64) {
  try {
    const content = Buffer.from(process.env.YOUTUBE_COOKIE_BASE64, 'base64').toString('utf8');
    fs.writeFileSync(COOKIE_PATH, content);
    console.log('✅ YouTube cookie yaradıldı (env)');
  } catch (e) {
    console.log('⚠️ YouTube cookie xətası:', e.message);
  }
}

// ─── Instagram statik cookie (YENİ) ─────────────────────────────────────────
const INSTAGRAM_COOKIE_PATH = path.join(cookieDir, 'instagram.txt');
if (process.env.INSTAGRAM_COOKIE_BASE64) {
  try {
    const content = Buffer.from(process.env.INSTAGRAM_COOKIE_BASE64, 'base64').toString('utf8');
    fs.writeFileSync(INSTAGRAM_COOKIE_PATH, content);
    console.log('✅ Instagram cookie yaradıldı (env)');
    console.log(`   Fayl: ${INSTAGRAM_COOKIE_PATH}`);
    console.log(`   Ölçü: ${content.length} simvol`);
    console.log(`   Sətirlər: ${content.split('\n').length}`);
  } catch (e) {
    console.log('⚠️ Instagram cookie xətası:', e.message);
  }
} else {
  console.log('⚠️ INSTAGRAM_COOKIE_BASE64 env variable tapılmadı!');
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

// YENİ: Instagram cookie arg
global.getInstagramCookieArg = () => {
  try {
    fs.accessSync(INSTAGRAM_COOKIE_PATH);
    return `--cookies "${INSTAGRAM_COOKIE_PATH}"`;
  } catch {
    return '';
  }
};

// YENİ: Instagram cookie path (Python üçün)
global.getInstagramCookiePath = () => {
  try {
    fs.accessSync(INSTAGRAM_COOKIE_PATH);
    return INSTAGRAM_COOKIE_PATH;
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
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    instagram_cookie: fs.existsSync(INSTAGRAM_COOKIE_PATH) ? 'loaded' : 'missing',
  });
});

// Root
app.get('/', (req, res) => {
  res.json({
    message: 'Video Downloader API işləyir!',
    version: '2.1.0',
    features: ['YouTube', 'TikTok', 'Instagram', 'Web', 'MP3']
  });
});

app.listen(PORT, () => console.log(`🚀 Server ${PORT} portunda işləyir`));
