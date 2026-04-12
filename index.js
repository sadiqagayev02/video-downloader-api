const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const tmpDir = '/tmp/video-downloader';
const COOKIE_PATH = '/tmp/yt-cookies/youtube.txt';

app.use(cors());
app.use(express.json());

fs.mkdirSync(tmpDir, { recursive: true });
fs.mkdirSync('/tmp/yt-cookies', { recursive: true });
console.log(`✅ TMP: ${tmpDir}`);

// ─── Cookie setup ─────────────────────────────────────────────────────────────
if (process.env.YOUTUBE_COOKIE_BASE64) {
  try {
    const content = Buffer.from(process.env.YOUTUBE_COOKIE_BASE64, 'base64').toString('utf8');
    fs.writeFileSync(COOKIE_PATH, content);
    console.log('✅ Cookie yaradıldı');
  } catch (e) {
    console.log('⚠️ Cookie xətası:', e.message);
  }
}

function getCookieArg() {
  try {
    fs.accessSync(COOKIE_PATH);
    return `--cookies "${COOKIE_PATH}"`;
  } catch {
    return '';
  }
}

// ─── Innertube client (yalnız YouTube metadata üçün) ─────────────────────────
let ytClient = null;

async function getYouTubeClient() {
  if (ytClient) return ytClient;
  const { Innertube } = await import('youtubei.js');
  // retrieve_player: false — stream URL-ləri almır, çox sürətlidir
  ytClient = await Innertube.create({ lang: 'en', location: 'US', retrieve_player: false });
  console.log('✅ Innertube client hazırdır');
  return ytClient;
}

getYouTubeClient().catch(e => console.log('⚠️ Innertube init xətası:', e.message));

// ─── Yardımçılar ──────────────────────────────────────────────────────────────
function extractVideoId(url) {
  try {
    const uri = new URL(url);
    if (uri.hostname === 'youtu.be') return uri.pathname.slice(1).split('?')[0];
    if (uri.pathname.includes('/shorts/')) return uri.pathname.split('/shorts/')[1].split('?')[0];
    return uri.searchParams.get('v');
  } catch { return null; }
}

function formatDuration(secs) {
  if (!secs) return '00:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  return `${m}:${s.toString().padStart(2,'0')}`;
}

// YouTube üçün sabit keyfiyyət siyahısı — URL saxlamır, dərhal qaytarır
// yt-dlp yükləmə zamanı mövcudluğu özü yoxlayacaq
const YOUTUBE_QUALITIES = [
  { label: '1080p Full HD', value: '1080', ext: 'mp4' },
  { label: '720p HD',       value: '720',  ext: 'mp4' },
  { label: '480p',          value: '480',  ext: 'mp4' },
  { label: '360p',          value: '360',  ext: 'mp4' },
  { label: 'MP3 (Audio)',   value: 'audio',ext: 'm4a' },
];

// TikTok/Instagram üçün sabit keyfiyyət siyahısı
const TIKTOK_QUALITIES = [
  { label: 'HD Video', value: 'video', ext: 'mp4' },
];

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Info — SÜRƏTLI, yalnız metadata ─────────────────────────────────────────
// Stream URL-ləri burada saxlanmır — 403 problemi yoxdur
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL tələb olunur' });

  console.log(`📡 Info: ${url}`);

  const isYoutube   = url.includes('youtube.com') || url.includes('youtu.be');
  const isTikTok    = url.includes('tiktok.com');
  const isInstagram = url.includes('instagram.com');

  try {
    // ── YouTube: getBasicInfo (~200-400ms) ────────────────────────────────
    if (isYoutube) {
      const videoId = extractVideoId(url);
      if (!videoId) return res.status(400).json({ error: 'Video ID tapılmadı' });

      let title = 'YouTube Video', thumbnail = '', duration = '00:00', uploader = '';

      try {
        const client = await getYouTubeClient();
        // getBasicInfo — retrieve_player:false ilə stream data gəlmir, ~300ms
        const info = await client.getBasicInfo(videoId);
        title     = info.basic_info?.title || title;
        thumbnail = info.basic_info?.thumbnail?.[0]?.url || '';
        duration  = formatDuration(info.basic_info?.duration || 0);
        uploader  = info.basic_info?.author || '';
      } catch (e) {
        console.log('⚠️ Innertube xətası, fallback:', e.message);
        // Innertube uğursuz olsa — sabit siyahını boş metadata ilə qaytır
        // Yükləmə yenə işləyəcək çünki yt-dlp URL-dən alır
      }

      return res.json({
        success: true,
        data: { title, thumbnail, duration, platform: 'youtube', uploader, qualities: YOUTUBE_QUALITIES },
      });
    }

    // ── TikTok / Instagram: --print ilə sürətli metadata (~1-2s) ─────────
    // --dump-json 3-5s çəkir, --print çox sürətlidir
    // CDN URL-ləri saxlanmır — 403 problemi yoxdur
    if (isTikTok || isInstagram) {
      const platform = isTikTok ? 'tiktok' : 'instagram';
      let title = 'Video', thumbnail = '', duration = '00:00', uploader = '';

      try {
        const extraArgs = isTikTok
          ? '--extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"'
          : '';

        // --print dump-json-dan 3x sürətlidir — yalnız lazımi sahələri alır
        const printCmd = `yt-dlp --no-playlist --socket-timeout 15 ${extraArgs} `
          + `--print "%(title)s|||%(thumbnail)s|||%(duration)s|||%(uploader)s" "${url}"`;

        const { stdout } = await execPromise(printCmd, { timeout: 25000 });
        const parts = stdout.trim().split('|||');

        title     = parts[0]?.trim() || 'Video';
        thumbnail = parts[1]?.trim() || '';
        duration  = formatDuration(parseFloat(parts[2]) || 0);
        uploader  = parts[3]?.trim() || '';
      } catch (e) {
        console.log(`⚠️ ${platform} metadata xətası:`, e.message);
        // Xəta olsa boş metadata ilə qaytır — yükləmə yenə işləyir
      }

      return res.json({
        success: true,
        data: { title, thumbnail, duration, platform, uploader, qualities: TIKTOK_QUALITIES },
      });
    }

    // ── Digər platformalar ────────────────────────────────────────────────
    let title = 'Video', thumbnail = '', duration = '00:00', uploader = '';
    try {
      const { stdout } = await execPromise(
        `yt-dlp --no-playlist --socket-timeout 15 --print "%(title)s|||%(thumbnail)s|||%(duration)s|||%(uploader)s" "${url}"`,
        { timeout: 25000 }
      );
      const parts = stdout.trim().split('|||');
      title     = parts[0]?.trim() || 'Video';
      thumbnail = parts[1]?.trim() || '';
      duration  = formatDuration(parseFloat(parts[2]) || 0);
      uploader  = parts[3]?.trim() || '';
    } catch (e) {
      console.log('⚠️ Generic info xətası:', e.message);
    }

    return res.json({
      success: true,
      data: {
        title, thumbnail, duration, platform: 'other', uploader,
        qualities: [{ label: 'HD Video', value: 'video', ext: 'mp4' }],
      },
    });

  } catch (err) {
    console.error(`❌ /api/info xətası: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Download start ───────────────────────────────────────────────────────────
app.post('/api/download/start', async (req, res) => {
  const { url, quality } = req.body;
  if (!url || !quality) return res.status(400).json({ error: 'URL və keyfiyyət tələb olunur' });

  const fileId  = crypto.randomBytes(16).toString('hex');
  const cookie  = getCookieArg();
  const isYoutube   = url.includes('youtube.com') || url.includes('youtu.be');
  const isTikTok    = url.includes('tiktok.com');
  const isInstagram = url.includes('instagram.com');

  console.log(`📥 Download: ${url} | keyfiyyət: ${quality}`);

  try {
    const outputExt  = quality === 'audio' ? 'm4a' : 'mp4';
    const outputPath = path.join(tmpDir, `out_${fileId}.${outputExt}`);
    let title = 'video';

    if (isYoutube) {
      // ── YouTube ───────────────────────────────────────────────────────────
      // Innertube stream URL-ləri curl ilə işləmir (n parametri şifrəli)
      // yt-dlp həm URL-i decode edir həm yükləyir — ən etibarlı yol

      let fmtArg;
      if (quality === 'audio') {
        // MP3: ən yaxşı audio formatı
        fmtArg = 'bestaudio[ext=m4a]/bestaudio/best';
      } else {
        const h = parseInt(quality);
        if (!isNaN(h)) {
          // Əvvəlcə həmin hündürlükdə mp4+m4a axtarır
          // Tapılmasa — ən yaxın hündürlük
          fmtArg = `bestvideo[height=${h}][ext=mp4]+bestaudio[ext=m4a]/`
                 + `bestvideo[height=${h}]+bestaudio/`
                 + `best[height<=${h}][ext=mp4]/best[height<=${h}]/best`;
        } else {
          fmtArg = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best';
        }
      }

      // Title al (15s timeout, uğursuz olsa 'video' saxlanır)
      try {
        const { stdout } = await execPromise(
          `yt-dlp --get-title --no-playlist ${cookie} "${url}"`,
          { timeout: 15000 }
        );
        title = stdout.trim() || 'video';
      } catch (_) {}

      console.log(`📥 YouTube yt-dlp: -f "${fmtArg}"`);

      await execPromise(
        `yt-dlp -f "${fmtArg}" ${cookie} --merge-output-format ${outputExt} `
        + `--no-playlist --retries 3 -o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );

    } else if (isTikTok) {
      // ── TikTok: yt-dlp həm URL alır həm yükləyir ─────────────────────────
      // /api/info-da CDN URL saxlanmır, buna görə burada tazədən alınır
      // Bu 403-ü tam aradan qaldırır
      const extraArgs = '--extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"';

      try {
        const { stdout } = await execPromise(
          `yt-dlp --get-title --no-playlist ${extraArgs} "${url}"`,
          { timeout: 15000 }
        );
        title = stdout.trim() || 'video';
      } catch (_) {}

      console.log('📥 TikTok birbaşa yükləmə (yt-dlp)');

      await execPromise(
        `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" `
        + `${extraArgs} --merge-output-format mp4 `
        + `--no-playlist --retries 3 -o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );

    } else if (isInstagram) {
      // ── Instagram ─────────────────────────────────────────────────────────
      try {
        const { stdout } = await execPromise(
          `yt-dlp --get-title --no-playlist "${url}"`,
          { timeout: 15000 }
        );
        title = stdout.trim() || 'video';
      } catch (_) {}

      console.log('📥 Instagram birbaşa yükləmə (yt-dlp)');

      await execPromise(
        `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" `
        + `${cookie} --merge-output-format mp4 --no-playlist --retries 3 `
        + `-o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );

    } else {
      // ── Digər platformalar ────────────────────────────────────────────────
      await execPromise(
        `yt-dlp -f "best" ${cookie} --no-playlist -o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );
    }

    // Fayl yoxlaması
    const stats = fs.statSync(outputPath);
    if (stats.size === 0) throw new Error('Yüklənmiş fayl boşdur');

    const safeTitle = title
      .replace(/[^\w\s\u0400-\u04FF\u0100-\u024F-]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 80) || 'video';

    console.log(`✅ Tamamlandı: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);

    res.json({
      success: true,
      fileId,
      filename: `${safeTitle}.${outputExt}`,
      filesize: stats.size,
    });

  } catch (err) {
    console.error(`❌ Download xətası: ${err.message}`);
    // Tmp faylları təmizlə
    try {
      fs.readdirSync(tmpDir).forEach(f => {
        if (f.includes(fileId)) {
          try { fs.unlinkSync(path.join(tmpDir, f)); } catch (_) {}
        }
      });
    } catch (_) {}
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Download file ────────────────────────────────────────────────────────────
app.get('/api/download/file/:fileId', (req, res) => {
  const { fileId } = req.params;
  for (const ext of ['mp4', 'm4a', 'mp3', 'webm']) {
    const filePath = path.join(tmpDir, `out_${fileId}.${ext}`);
    if (fs.existsSync(filePath)) {
      return res.download(filePath, () => {
        try { fs.unlinkSync(filePath); } catch (_) {}
      });
    }
  }
  res.status(404).json({ error: 'Fayl tapılmadı' });
});

app.get('/', (req, res) => {
  res.json({ message: 'Video Downloader API işləyir!' });
});

app.listen(PORT, () => {
  console.log(`🚀 Server ${PORT} portunda işləyir`);
});
