// M) routes/health.js
const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

router.get('/', async (req, res) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    checks: {}
  };

  try {
    // yt-dlp yoxla
    const ytDlpCheck = await execPromise('yt-dlp --version');
    health.checks.ytdlp = { status: 'ok', version: ytDlpCheck.stdout.trim() };
  } catch (err) {
    health.checks.ytdlp = { status: 'error', error: err.message };
    health.status = 'unhealthy';
  }

  try {
    // ffmpeg yoxla
    const ffmpegCheck = await execPromise('ffmpeg -version');
    const versionMatch = ffmpegCheck.stdout.match(/ffmpeg version ([^\s]+)/);
    health.checks.ffmpeg = { status: 'ok', version: versionMatch ? versionMatch[1] : 'unknown' };
  } catch (err) {
    health.checks.ffmpeg = { status: 'error', error: err.message };
    health.status = 'unhealthy';
  }

  try {
    // TMP qovluğunu yoxla
    const tmpDir = process.env.TMP_DIR || '/tmp/video-downloader';
    await fs.access(tmpDir);
    const files = await fs.readdir(tmpDir);
    health.checks.tmp = { status: 'ok', path: tmpDir, files: files.length };
  } catch (err) {
    health.checks.tmp = { status: 'error', error: err.message };
    health.status = 'degraded';
  }

  const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
  res.status(statusCode).json(health);
});

module.exports = router;