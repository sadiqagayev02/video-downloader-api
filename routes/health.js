// routes/health.js
const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const os = require('os');

router.get('/', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + ' MB',
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB',
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
    },
    system: {
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMem: Math.round(os.totalmem() / 1024 / 1024 / 1024) + ' GB',
      freeMem: Math.round(os.freemem() / 1024 / 1024 / 1024) + ' GB',
    },
    checks: {}
  };

  // yt-dlp yoxla
  try {
    const ytDlpCheck = await execPromise('yt-dlp --version', { timeout: 5000 });
    health.checks.ytdlp = { 
      status: 'ok', 
      version: ytDlpCheck.stdout.trim() 
    };
  } catch (err) {
    health.checks.ytdlp = { 
      status: 'error', 
      error: err.message.substring(0, 100) 
    };
    health.status = 'unhealthy';
  }

  // ffmpeg yoxla
  try {
    const ffmpegCheck = await execPromise('ffmpeg -version', { timeout: 5000 });
    const versionMatch = ffmpegCheck.stdout.match(/ffmpeg version ([^\s]+)/);
    health.checks.ffmpeg = { 
      status: 'ok', 
      version: versionMatch ? versionMatch[1] : 'unknown' 
    };
  } catch (err) {
    health.checks.ffmpeg = { 
      status: 'error', 
      error: err.message.substring(0, 100) 
    };
    health.status = 'unhealthy';
  }

  // curl yoxla
  try {
    await execPromise('curl --version', { timeout: 3000 });
    health.checks.curl = { status: 'ok' };
  } catch (err) {
    health.checks.curl = { status: 'error' };
  }

  // TMP qovluqlarını yoxla
  const tmpDir = process.env.TMP_DIR || '/tmp/video-downloader';
  const audioDir = process.env.AUDIO_DIR || '/tmp/audio-downloader';
  const cookieDir = '/tmp/yt-cookies';
  const tiktokDir = '/tmp/tiktok-cookies';

  const dirs = [
    { name: 'tmp', path: tmpDir },
    { name: 'audio', path: audioDir },
    { name: 'cookies', path: cookieDir },
    { name: 'tiktok', path: tiktokDir },
  ];

  for (const dir of dirs) {
    try {
      await fs.access(dir.path);
      const files = await fs.readdir(dir.path);
      
      // Ümumi ölçüsü hesabla
      let totalSize = 0;
      for (const file of files) {
        try {
          const stats = await fs.stat(`${dir.path}/${file}`);
          totalSize += stats.size;
        } catch {}
      }
      
      health.checks[dir.name] = { 
        status: 'ok', 
        path: dir.path, 
        files: files.length,
        size: Math.round(totalSize / 1024 / 1024) + ' MB'
      };
    } catch (err) {
      // Qovluq yoxdursa yarat
      try {
        await fs.mkdir(dir.path, { recursive: true });
        health.checks[dir.name] = { 
          status: 'created', 
          path: dir.path, 
          files: 0 
        };
      } catch (mkdirErr) {
        health.checks[dir.name] = { 
          status: 'error', 
          error: mkdirErr.message 
        };
        if (health.status === 'healthy') health.status = 'degraded';
      }
    }
  }

  // Node versiyası
  health.checks.node = {
    version: process.version,
    env: process.env.NODE_ENV || 'development'
  };

  const statusCode = health.status === 'healthy' ? 200 : 
                     health.status === 'degraded' ? 200 : 503;
  
  res.status(statusCode).json(health);
});

// Sadə ping (Render cold-start üçün)
router.get('/ping', (req, res) => {
  res.json({ status: 'pong', timestamp: Date.now() });
});

module.exports = router;