// routes/audio.js — TAM YENİ VERSİYA (ikili sistem)
const express = require('express');
const router = express.Router();
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const audioDir = process.env.AUDIO_DIR || '/tmp/audio-downloader';
fs.mkdirSync(audioDir, { recursive: true });
fs.mkdirSync('/tmp/yt-cookies', { recursive: true });

// ─── Köməkçi funksiyalar ──────────────────────────────────────────────────
function formatSize(bytes) {
  if (bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

function makeSafeTitle(title) {
  return (title || 'audio')
    .replace(/[^\w\s\u0400-\u04FF\u0100-\u024F-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 80) || 'audio';
}

function detectPlatform(url) {
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('tiktok.com')) return 'tiktok';
  return 'other';
}

function createTempCookieFile(cookieString, fileId) {
  if (!cookieString || typeof cookieString !== 'string' || !cookieString.trim()) {
    return null;
  }
  try {
    const cookieFile = path.join('/tmp/yt-cookies', `flutter_${fileId}.txt`);
    const lines = [
      '# Netscape HTTP Cookie File',
      '# Generated from Flutter app cookies',
      '',
    ];
    cookieString.split(';').forEach(pair => {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) return;
      const name = pair.substring(0, eqIdx).trim();
      const value = pair.substring(eqIdx + 1).trim();
      if (!name) return;
      lines.push(
        `.youtube.com\tTRUE\t/\tFALSE\t${Math.floor(Date.now() / 1000) + 86400 * 14}\t${name}\t${value}`
      );
    });
    fs.writeFileSync(cookieFile, lines.join('\n'));
    console.log(`🍪 Cookie faylı yaradıldı: ${lines.length - 3} cookie`);
    return cookieFile;
  } catch (e) {
    console.log('⚠️ Cookie fayl xətası:', e.message);
    return null;
  }
}

function getStaticCookieArg() {
  const cookiePath = '/tmp/yt-cookies/youtube.txt';
  try {
    fs.accessSync(cookiePath);
    return cookiePath;
  } catch {
    return null;
  }
}

// ─── YT-DLP-i spawn ilə işlət (progress üçün) ────────────────────────────
function runYtDlp(args, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn('yt-dlp', args);
    let stderr = '';
    let stdout = '';

    proc.stdout.on('data', (d) => {
      const text = d.toString();
      stdout += text;
      if (onProgress) {
        const match = text.match(/(\d+\.?\d*)%/);
        if (match) onProgress(parseFloat(match[1]));
      }
    });

    proc.stderr.on('data', (d) => {
      const text = d.toString();
      stderr += text;
      if (onProgress) {
        const match = text.match(/(\d+\.?\d*)%/);
        if (match) onProgress(parseFloat(match[1]));
      }
    });

    proc.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`yt-dlp kod ${code}: ${stderr.slice(-500)}`));
    });

    proc.on('error', (err) => reject(new Error(`yt-dlp tapılmadı: ${err.message}`)));
  });
}

// ─── FFmpeg ilə stream → MP3 ──────────────────────────────────────────────
function runFfmpegConvert(streamUrl, outputPath, onProgress) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-reconnect',           '1',
      '-reconnect_streamed',  '1',
      '-reconnect_delay_max', '5',
      '-reconnect_at_eof',    '1',
      '-rw_timeout',          '15000000',
      '-i',                   streamUrl,
      '-vn',
      '-acodec',              'libmp3lame',
      '-ab',                  '192k',
      '-y',
      '-progress',            'pipe:1',    // ← progress stdout-a
      outputPath,
    ]);

    let stderr = '';
    let duration = 0;

    ffmpeg.stderr.on('data', (d) => {
      const text = d.toString();
      stderr += text;
      // Duration tap
      const durMatch = text.match(/Duration: (\d+):(\d+):(\d+)/);
      if (durMatch) {
        duration = parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseInt(durMatch[3]);
      }
    });

    ffmpeg.stdout.on('data', (d) => {
      const text = d.toString();
      // out_time_ms=12345678
      const timeMatch = text.match(/out_time_ms=(\d+)/);
      if (timeMatch && duration > 0 && onProgress) {
        const secs = parseInt(timeMatch[1]) / 1000000;
        const pct = Math.min(100, (secs / duration) * 100);
        onProgress(pct);
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg kod ${code}: ${stderr.slice(-500)}`));
    });

    ffmpeg.on('error', reject);
  });
}

// ─── ƏSAS ROUTE: /convert ────────────────────────────────────────────────
// Flutter göndərir:
//   - YouTube: { url, stream_url, title }  → FFmpeg ilə convert
//   - Instagram/TikTok: { url, cookieString, title } → yt-dlp ilə download
//
router.post('/convert', async (req, res) => {
  const { url, stream_url, title, cookieString } = req.body;

  if (!url && !stream_url) {
    return res.status(400).json({ error: 'url və ya stream_url tələb olunur' });
  }

  const actualUrl = url || '';
  const platform  = detectPlatform(actualUrl);
  const safeTitle = makeSafeTitle(title || 'audio');
  const fileId    = crypto.randomBytes(8).toString('hex');

  console.log(`🎵 [${platform}] Convert başladı: ${safeTitle}`);

  try {
    // ── YOUTUBE: stream_url varsa FFmpeg ilə ──
    if (platform === 'youtube' && stream_url) {
      const outputPath = path.join(audioDir, `conv_${fileId}.mp3`);

      await runFfmpegConvert(stream_url, outputPath, (pct) => {
        console.log(`   📊 FFmpeg: ${pct.toFixed(1)}%`);
      });

      const stats = fs.statSync(outputPath);
      if (stats.size === 0) throw new Error('MP3 fayl boşdur');

      console.log(`✅ [YouTube] MP3 hazır: ${formatSize(stats.size)}`);

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);
      res.setHeader('Content-Length', stats.size);

      return res.download(outputPath, `${safeTitle}.mp3`, (err) => {
        if (err) console.error(`❌ Göndərmə: ${err.message}`);
        try { fs.unlinkSync(outputPath); } catch (_) {}
      });
    }

    // ── INSTAGRAM / TIKTOK / DIGƏR: yt-dlp ilə ──
    if (!actualUrl) {
      return res.status(400).json({ error: 'Bu platforma üçün url tələb olunur' });
    }

    const tempCookieFile = createTempCookieFile(cookieString, fileId);
    const staticCookie   = getStaticCookieArg();
    const cookiePath     = tempCookieFile || staticCookie;

    console.log(`🍪 Cookie: ${tempCookieFile ? 'Flutter' : (staticCookie ? 'env' : 'yoxdur')}`);

    // Başlıq al
    let actualTitle = title || 'audio';
    try {
      const titleArgs = ['--get-title', '--no-playlist'];
      if (cookiePath) titleArgs.push('--cookies', cookiePath);
      titleArgs.push(actualUrl);
      const out = await runYtDlp(titleArgs);
      if (out.trim()) actualTitle = out.trim();
    } catch (_) {}

    const safeActualTitle = makeSafeTitle(actualTitle);
    const outputTemplate = path.join(audioDir, `out_${fileId}.%(ext)s`);

    // Platform-spesifik args
    const dlArgs = [
      '-f', 'bestaudio[ext=m4a]/bestaudio[acodec=aac]/bestaudio/best',
      '--no-playlist',
      '--retries', '3',
      '--fragment-retries', '3',
      '--socket-timeout', '30',
      '-o', outputTemplate,
    ];

    if (cookiePath) dlArgs.push('--cookies', cookiePath);

    // TikTok xüsusi
    if (platform === 'tiktok') {
      dlArgs.push('--extractor-args', 'tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com');
    }

    // Instagram xüsusi
    if (platform === 'instagram') {
      dlArgs.push('--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    }

    dlArgs.push(actualUrl);

    console.log(`⬇️ [${platform}] yt-dlp yükləyir...`);
    await runYtDlp(dlArgs, (pct) => {
      console.log(`   📊 yt-dlp: ${pct.toFixed(1)}%`);
    });

    // Faylı tap
    const files = fs.readdirSync(audioDir).filter(f => f.startsWith(`out_${fileId}`));
    if (files.length === 0) throw new Error('Audio fayl tapılmadı');

    const actualPath = path.join(audioDir, files[0]);
    const stats = fs.statSync(actualPath);
    if (stats.size === 0) throw new Error('Audio fayl boşdur');

    const ext = path.extname(actualPath).slice(1) || 'm4a';
    const filename = `${safeActualTitle}.${ext}`;

    console.log(`✅ [${platform}] Hazır: ${formatSize(stats.size)} → ${filename}`);

    res.setHeader('Content-Type', ext === 'mp3' ? 'audio/mpeg' : 'audio/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', stats.size);

    return res.download(actualPath, filename, (err) => {
      if (err) console.error(`❌ Göndərmə: ${err.message}`);
      try { fs.unlinkSync(actualPath); } catch (_) {}
      if (tempCookieFile) {
        try { fs.unlinkSync(tempCookieFile); } catch (_) {}
      }
    });

  } catch (err) {
    console.error(`❌ Convert xətası: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

// ─── Köhnə /start route (uyğunluq üçün saxlanılır) ───────────────────────
router.post('/start', async (req, res) => {
  const { url, cookieString } = req.body;

  if (!url) return res.status(400).json({ error: 'URL tələb olunur' });

  const fileId = crypto.randomBytes(16).toString('hex');
  const platform = detectPlatform(url);

  console.log(`🎵 [${platform}] /start: ${url}`);

  const tempCookieFile = createTempCookieFile(cookieString, fileId);
  const cookiePath = tempCookieFile || getStaticCookieArg();

  try {
    const outputTemplate = path.join(audioDir, `out_${fileId}.%(ext)s`);

    const args = [
      '-f', 'bestaudio[ext=m4a]/bestaudio[acodec=aac]/bestaudio/best',
      '--no-playlist',
      '--retries', '3',
      '--socket-timeout', '30',
      '-o', outputTemplate,
    ];

    if (cookiePath) args.push('--cookies', cookiePath);
    if (platform === 'tiktok') {
      args.push('--extractor-args', 'tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com');
    }
    args.push(url);

    await runYtDlp(args);

    const files = fs.readdirSync(audioDir).filter(f => f.startsWith(`out_${fileId}`));
    if (files.length === 0) throw new Error('Fayl tapılmadı');

    const actualPath = path.join(audioDir, files[0]);
    const stats = fs.statSync(actualPath);
    const ext = path.extname(actualPath).slice(1) || 'm4a';
    const finalPath = path.join(audioDir, `out_${fileId}_final.${ext}`);
    fs.renameSync(actualPath, finalPath);

    const safeTitle = makeSafeTitle(req.body.title || 'audio');
    const filename = `${safeTitle}.${ext}`;

    res.json({
      success: true,
      fileId: `${fileId}_final`,
      filename,
      filesize: stats.size,
      sizeFormatted: formatSize(stats.size),
    });
  } catch (err) {
    console.error(`❌ /start xətası: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (tempCookieFile) {
      try { fs.unlinkSync(tempCookieFile); } catch (_) {}
    }
  }
});

// ─── /file/:fileId (köhnə uyğunluq) ──────────────────────────────────────
router.get('/file/:fileId', async (req, res) => {
  const { fileId } = req.params;
  const exts = ['m4a', 'mp3', 'aac', 'opus', 'webm'];

  for (const ext of exts) {
    const testPath = path.join(audioDir, `out_${fileId}.${ext}`);
    try {
      await fsp.access(testPath);
      return res.download(testPath, path.basename(testPath), (err) => {
        if (err) console.error('❌', err.message);
        setTimeout(() => { try { fs.unlinkSync(testPath); } catch (_) {} }, 60000);
      });
    } catch (_) {}
  }

  res.status(404).json({ error: 'Fayl tapılmadı' });
});

// ─── /info ────────────────────────────────────────────────────────────────
router.post('/info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL tələb olunur' });

  try {
    const data = await runYtDlp(['--dump-json', '--no-playlist', '--socket-timeout', '30', url]);
    const json = JSON.parse(data);
    const formats = json.formats || [];
    const audioFormats = formats.filter(f => f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'));

    res.json({
      success: true,
      data: {
        title: json.title || 'Audio',
        thumbnail: json.thumbnail || '',
        duration: formatDuration(json.duration || 0),
        platform: detectPlatform(url),
        uploader: json.uploader || json.channel || '',
        qualities: audioFormats.length > 0 ? [{
          label: 'MP3 (Audio)',
          value: 'audio',
          formatId: audioFormats[0].format_id,
          filesize: audioFormats[0].filesize || null,
          ext: 'm4a',
          needsMerge: false,
        }] : [],
      },
    });
  } catch (err) {
    console.error('❌ Info xətası:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

function formatDuration(seconds) {
  if (!seconds) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

module.exports = router;
