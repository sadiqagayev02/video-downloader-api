// routes/audio.js
const express = require('express');
const router = express.Router();
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { exec, spawn } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const audioDir = process.env.AUDIO_DIR || '/tmp/audio-downloader';

fs.mkdir(audioDir, { recursive: true }).catch(() => {});

function createTempCookieFile(cookieString, fileId) {
  if (!cookieString || typeof cookieString !== 'string' || !cookieString.trim()) {
    return null;
  }
  try {
    const cookieDir = '/tmp/yt-cookies';
    const cookieFile = path.join(cookieDir, `flutter_${fileId}.txt`);
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
    require('fs').writeFileSync(cookieFile, lines.join('\n'));
    console.log(`🍪 Audio cookie faylı yaradıldı: ${lines.length - 3} cookie`);
    return cookieFile;
  } catch (e) {
    console.log('⚠️ Audio cookie fayl xətası:', e.message);
    return null;
  }
}

function getStaticCookieArg() {
  const cookiePath = '/tmp/yt-cookies/youtube.txt';
  try {
    require('fs').accessSync(cookiePath);
    return `--cookies "${cookiePath}"`;
  } catch {
    return '';
  }
}

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

function findFile(dir, fileId) {
  try {
    const files = require('fs').readdirSync(dir).filter(f => f.startsWith(`out_${fileId}`));
    if (files.length > 0) return path.join(dir, files[0]);
  } catch (_) {}
  return null;
}

function cleanupDir(dir, fileId) {
  try {
    require('fs').readdirSync(dir)
      .filter(f => f.includes(fileId))
      .forEach(f => {
        try { require('fs').unlinkSync(path.join(dir, f)); } catch (_) {}
      });
  } catch (_) {}
}

// ─── YouTube Audio → FFmpeg → MP3 stream ─────────────────────────────────
//
// Flutter telefonda youtube_explode_dart ilə audio stream URL alır.
// URL buraya gəlir, FFmpeg birbaşa stream URL-dən oxuyur,
// MP3-ə çevirib cihaza stream edir.
// Python servis lazım deyil — Node.js öz FFmpeg-i işlədir.
//
router.post('/convert', async (req, res) => {
  const { stream_url, title } = req.body;

  if (!stream_url) {
    return res.status(400).json({ error: 'stream_url tələb olunur' });
  }

  const safeTitle = makeSafeTitle(title || 'audio');
  console.log(`🎵 FFmpeg convert başladı: ${safeTitle}`);

  const ffmpegProcess = spawn('ffmpeg', [
    '-reconnect',           '1',
    '-reconnect_streamed',  '1',
    '-reconnect_delay_max', '5',
    '-i',                   stream_url,
    '-vn',
    '-acodec',              'libmp3lame',
    '-ab',                  '192k',
    '-f',                   'mp3',
    'pipe:1',
  ]);

  let headersSent = false;

  // İlk data gəldikdə header göndər, sonra pipe et
  ffmpegProcess.stdout.once('data', (chunk) => {
    if (!headersSent) {
      headersSent = true;
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);
      res.write(chunk);
      ffmpegProcess.stdout.pipe(res);
      console.log(`📤 MP3 stream başladı: ${safeTitle}`);
    }
  });

  ffmpegProcess.on('error', (err) => {
    console.error(`❌ FFmpeg xətası: ${err.message}`);
    if (!res.headersSent) {
      res.status(500).json({ error: `FFmpeg xətası: ${err.message}` });
    }
  });

  ffmpegProcess.stderr.on('data', (data) => {
    const line = data.toString();
    if (line.includes('error') || line.includes('Error')) {
      console.log(`⚠️ FFmpeg: ${line.substring(0, 120)}`);
    }
  });

  ffmpegProcess.on('close', (code) => {
    console.log(`✅ FFmpeg tamamlandı (code ${code}): ${safeTitle}`);
    if (!res.headersSent) {
      res.status(500).json({ error: 'FFmpeg heç bir data qaytarmadı' });
    }
  });

  req.on('close', () => {
    ffmpegProcess.kill('SIGTERM');
    console.log(`🛑 FFmpeg dayandırıldı: ${safeTitle}`);
  });
});

// ─── Audio yükləməni başlat ───────────────────────────────────────────────
router.post('/start', async (req, res) => {
  const { url, cookieString } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL tələb olunur' });
  }

  const fileId = crypto.randomBytes(16).toString('hex');
  const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');
  const isTikTok = url.includes('tiktok.com');
  const isInstagram = url.includes('instagram.com');

  console.log(`🎵 Audio download: ${url}`);

  const outputPath = path.join(audioDir, `out_${fileId}.m4a`);
  let title = 'audio';

  const tempCookieFile = createTempCookieFile(cookieString, fileId);
  const cookieArg = tempCookieFile
    ? `--cookies "${tempCookieFile}"`
    : getStaticCookieArg();

  console.log(`🍪 Cookie: ${tempCookieFile ? 'Flutter (dinamik)' : (cookieArg ? 'env (statik)' : 'yoxdur')}`);

  try {
    try {
      const titleCmd = `yt-dlp --get-title --no-playlist ${cookieArg} "${url}"`;
      const { stdout } = await execPromise(titleCmd, { timeout: 15000 });
      title = stdout.trim() || 'audio';
    } catch (_) {}

    let downloadCmd;

    if (isYoutube) {
      downloadCmd = `yt-dlp -f "140/141/139/bestaudio[ext=m4a]/bestaudio[acodec=aac]/bestaudio" ${cookieArg} --no-playlist --retries 3 -o "${outputPath}" "${url}"`;
      console.log('🎵 YouTube audio → m4a');
    } else if (isTikTok) {
      const tkArgs = '--extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"';
      downloadCmd = `yt-dlp -f "bestaudio[ext=m4a]/bestaudio[acodec=aac]/bestaudio" ${tkArgs} --no-playlist --retries 3 -o "${outputPath}" "${url}"`;
      console.log('🎵 TikTok audio → m4a');
    } else if (isInstagram) {
      downloadCmd = `yt-dlp -f "bestaudio[ext=m4a]/bestaudio[acodec=aac]/bestaudio" --no-playlist --retries 3 -o "${outputPath}" "${url}"`;
      console.log('🎵 Instagram audio → m4a');
    } else {
      downloadCmd = `yt-dlp -f "bestaudio[ext=m4a]/bestaudio[acodec=aac]/bestaudio/best" --no-playlist --retries 3 -o "${outputPath}" "${url}"`;
      console.log('🎵 Generic audio → m4a');
    }

    await execPromise(downloadCmd, { timeout: 300000, maxBuffer: 5 * 1024 * 1024 });

    let actualPath = require('fs').existsSync(outputPath) ? outputPath : findFile(audioDir, fileId);
    if (!actualPath) throw new Error('Audio fayl tapılmadı');

    const stats = require('fs').statSync(actualPath);
    if (stats.size === 0) throw new Error('Audio fayl boşdur');

    const actualExt = path.extname(actualPath).slice(1) || 'm4a';
    const finalPath = path.join(audioDir, `out_${fileId}_final.${actualExt}`);
    require('fs').renameSync(actualPath, finalPath);

    const filename = `${makeSafeTitle(title)}.${actualExt}`;
    const sizeStr = formatSize(stats.size);

    console.log(`✅ Audio tamamlandı: ${sizeStr} → ${filename}`);

    res.json({
      success:       true,
      fileId:        `${fileId}_final`,
      filename,
      filesize:      stats.size,
      sizeFormatted: sizeStr,
    });

  } catch (err) {
    console.error(`❌ Audio download xətası: ${err.message}`);
    cleanupDir(audioDir, fileId);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (tempCookieFile) {
      try { require('fs').unlinkSync(tempCookieFile); } catch (_) {}
    }
  }
});

// ─── Audio faylı göndər ───────────────────────────────────────────────────
router.get('/file/:fileId', async (req, res) => {
  const { fileId } = req.params;
  const exts = ['m4a', 'mp3', 'aac', 'opus', 'webm'];

  let filePath = null;

  for (const ext of exts) {
    const testPath = path.join(audioDir, `out_${fileId}.${ext}`);
    try {
      await fs.access(testPath);
      filePath = testPath;
      break;
    } catch (_) {}
  }

  if (!filePath) {
    return res.status(404).json({ error: 'Audio fayl tapılmadı' });
  }

  console.log(`📤 Audio göndərilir: ${path.basename(filePath)}`);

  res.download(filePath, path.basename(filePath), (err) => {
    if (err) console.error('❌ Audio göndərmə xətası:', err);
    setTimeout(() => {
      try {
        require('fs').unlinkSync(filePath);
        console.log(`🗑️ Audio silindi: ${path.basename(filePath)}`);
      } catch (_) {}
    }, 60000);
  });
});

// ─── Audio məlumatı al ────────────────────────────────────────────────────
router.post('/info', async (req, res) => {
  const { url } = req.body;

  if (!url) return res.status(400).json({ error: 'URL tələb olunur' });

  try {
    const cmd = `yt-dlp --dump-json --no-playlist --socket-timeout 30 "${url}"`;
    const { stdout } = await execPromise(cmd, { timeout: 35000, maxBuffer: 10 * 1024 * 1024 });
    const data = JSON.parse(stdout);

    const formats = data.formats || [];
    const audioFormats = formats.filter(f =>
      f.acodec !== 'none' && (f.vcodec === 'none' || !f.vcodec)
    );

    const qualities = [];
    if (audioFormats.length > 0) {
      qualities.push({
        label:      'MP3 (Audio)',
        value:      'audio',
        formatId:   audioFormats[0].format_id,
        filesize:   audioFormats[0].filesize || null,
        ext:        'm4a',
        needsMerge: false,
        _source:    'audio_direct',
      });
    }

    res.json({
      success: true,
      data: {
        title:    data.title || 'Audio',
        thumbnail: data.thumbnail || '',
        duration: formatDuration(data.duration || 0),
        platform: url.includes('youtube.com') ? 'youtube' :
                  (url.includes('tiktok.com') ? 'tiktok' :
                   (url.includes('instagram.com') ? 'instagram' : 'other')),
        uploader: data.uploader || data.channel || '',
        qualities,
      },
    });
  } catch (err) {
    console.error('❌ Audio info xətası:', err.message);
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
