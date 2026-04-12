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
  try { fs.accessSync(COOKIE_PATH); return `--cookies "${COOKIE_PATH}"`; }
  catch { return ''; }
}

// ─── Innertube client ─────────────────────────────────────────────────────────
let ytClient = null;

async function getYouTubeClient() {
  if (ytClient) return ytClient;
  const { Innertube } = await import('youtubei.js');
  // retrieve_player: true — streaming_data ilə gəlir, real keyfiyyətlər üçün lazımdır
  ytClient = await Innertube.create({ lang: 'en', location: 'US', retrieve_player: true });
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

// Real mövcud keyfiyyətləri streaming_data-dan çıxar
function extractYouTubeQualities(info) {
  const adaptive = info.streaming_data?.adaptive_formats || [];
  const basic    = info.streaming_data?.formats || [];
  const allFormats = [...basic, ...adaptive];

  const seen = new Set();
  const qualities = [];

  // Bütün mövcud hündürlükləri topla
  const heights = new Set();
  for (const f of allFormats) {
    if (f.height && f.height > 0) heights.add(f.height);
  }

  // Böyükdən kiçiyə sırala
  const sortedHeights = [...heights].sort((a, b) => b - a);

  for (const h of sortedHeights) {
    const hasVideo = allFormats.some(f =>
      f.height === h && f.mime_type?.startsWith('video/')
    );
    if (!hasVideo || seen.has(h)) continue;
    seen.add(h);

    let label;
    if      (h >= 2160) label = '4K Ultra HD';
    else if (h >= 1440) label = '1440p QHD';
    else if (h >= 1080) label = '1080p Full HD';
    else if (h >= 720)  label = '720p HD';
    else                label = `${h}p`;

    qualities.push({ label, value: String(h), ext: 'mp4' });
  }

  // Audio (MP3) — həmişə sonda
  const hasAudio = adaptive.some(f => f.mime_type?.startsWith('audio/'));
  if (hasAudio) {
    qualities.push({ label: 'MP3 (Audio)', value: 'audio', ext: 'm4a' });
  }

  return qualities;
}

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Info ─────────────────────────────────────────────────────────────────────
app.post('/api/info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL tələb olunur' });

  console.log(`📡 Info: ${url}`);
  const isYoutube   = url.includes('youtube.com') || url.includes('youtu.be');
  const isTikTok    = url.includes('tiktok.com');
  const isInstagram = url.includes('instagram.com');

  try {
    // ── YouTube ──────────────────────────────────────────────────────────────
    if (isYoutube) {
      const videoId = extractVideoId(url);
      if (!videoId) return res.status(400).json({ error: 'Video ID tapılmadı' });

      const client = await getYouTubeClient();

      // getInfo() — streaming_data ilə gəlir, real keyfiyyətlər üçün lazımdır
      const info = await client.getInfo(videoId);

      const qualities = extractYouTubeQualities(info);

      // Streaming data gəlmədisə fallback
      const finalQualities = qualities.length > 0 ? qualities : [
        { label: '1080p Full HD', value: '1080', ext: 'mp4' },
        { label: '720p HD',       value: '720',  ext: 'mp4' },
        { label: '480p',          value: '480',  ext: 'mp4' },
        { label: '360p',          value: '360',  ext: 'mp4' },
        { label: 'MP3 (Audio)',   value: 'audio',ext: 'm4a' },
      ];

      return res.json({
        success: true,
        data: {
          title:     info.basic_info?.title || 'YouTube Video',
          thumbnail: info.basic_info?.thumbnail?.[0]?.url || '',
          duration:  formatDuration(info.basic_info?.duration || 0),
          platform:  'youtube',
          uploader:  info.basic_info?.author || '',
          qualities: finalQualities,
        },
      });
    }

    // ── TikTok / Instagram ────────────────────────────────────────────────────
    if (isTikTok || isInstagram) {
      const platform = isTikTok ? 'tiktok' : 'instagram';
      let title = 'Video', thumbnail = '', duration = '00:00', uploader = '';

      const extraArgs = isTikTok
        ? '--extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"'
        : '';

      // Mövcud TikTok cookie faylını yoxla
      const tiktokCookiePath = '/tmp/tiktok-cookies/tiktok.txt';
      let tiktokCookieArg = '';
      try { fs.accessSync(tiktokCookiePath); tiktokCookieArg = `--cookies "${tiktokCookiePath}"`; }
      catch {}

      try {
        const printCmd = `yt-dlp --no-playlist --socket-timeout 15 `
          + `${extraArgs} ${tiktokCookieArg} `
          + `--print "%(title)s|||%(thumbnail)s|||%(duration)s|||%(uploader)s" "${url}"`;

        const { stdout } = await execPromise(printCmd, { timeout: 25000 });
        const parts = stdout.trim().split('|||');
        title     = parts[0]?.trim() || 'Video';
        thumbnail = parts[1]?.trim() || '';
        duration  = formatDuration(parseFloat(parts[2]) || 0);
        uploader  = parts[3]?.trim() || '';
      } catch (e) {
        console.log(`⚠️ ${platform} metadata xətası:`, e.message);
      }

      return res.json({
        success: true,
        data: {
          title, thumbnail, duration, platform, uploader,
          qualities: [{ label: 'HD Video', value: 'video', ext: 'mp4' }],
        },
      });
    }

    // ── Digər platformalar ────────────────────────────────────────────────────
    let title = 'Video', thumbnail = '', duration = '00:00', uploader = '';
    try {
      const { stdout } = await execPromise(
        `yt-dlp --no-playlist --socket-timeout 15 `
        + `--print "%(title)s|||%(thumbnail)s|||%(duration)s|||%(uploader)s" "${url}"`,
        { timeout: 25000 }
      );
      const parts = stdout.trim().split('|||');
      title = parts[0]?.trim() || 'Video';
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
  const { url, quality, tiktokCookies } = req.body;
  if (!url || !quality) return res.status(400).json({ error: 'URL və keyfiyyət tələb olunur' });

  const fileId  = crypto.randomBytes(16).toString('hex');
  const cookie  = getCookieArg();
  const isYoutube   = url.includes('youtube.com') || url.includes('youtu.be');
  const isTikTok    = url.includes('tiktok.com');
  const isInstagram = url.includes('instagram.com');

  console.log(`📥 Download: ${url} | keyfiyyət: ${quality}`);

  // TikTok cookies Flutter-dən gəldisə müvəqqəti Netscape fayla yaz
  let tiktokCookiePath = null;
  let tiktokCookieArg = '';
  if (isTikTok && tiktokCookies && Array.isArray(tiktokCookies) && tiktokCookies.length > 0) {
    try {
      fs.mkdirSync('/tmp/tiktok-cookies', { recursive: true });
      tiktokCookiePath = `/tmp/tiktok-cookies/tk_${fileId}.txt`;
      const lines = ['# Netscape HTTP Cookie File'];
      for (const c of tiktokCookies) {
        const domain  = (c.domain || '.tiktok.com').startsWith('.') ? c.domain : `.${c.domain || 'tiktok.com'}`;
        const secure  = c.isSecure   ? 'TRUE' : 'FALSE';
        const httpOnly = c.isHttpOnly ? 'TRUE' : 'FALSE';
        const expires = c.expiresDate
          ? Math.floor(new Date(c.expiresDate).getTime() / 1000)
          : 9999999999;
        lines.push(`${domain}\tTRUE\t${c.path || '/'}\t${secure}\t${expires}\t${c.name}\t${c.value}`);
      }
      fs.writeFileSync(tiktokCookiePath, lines.join('\n'));
      tiktokCookieArg = `--cookies "${tiktokCookiePath}"`;
      console.log(`🍪 TikTok cookies: ${tiktokCookies.length} ədəd`);
    } catch (e) {
      console.log('⚠️ TikTok cookie yazma xətası:', e.message);
    }
  }

  try {
    const outputExt  = quality === 'audio' ? 'm4a' : 'mp4';
    const outputPath = path.join(tmpDir, `out_${fileId}.${outputExt}`);
    let title = 'video';

    if (isYoutube) {
      let fmtArg;
      if (quality === 'audio') {
        // AAC audio — .m4a formatı, bütün player-lər oxuyur
        fmtArg = 'bestaudio[ext=m4a]/bestaudio[acodec=aac]/bestaudio/best';
      } else {
        const h = parseInt(quality);
        if (!isNaN(h)) {
          fmtArg = `bestvideo[height=${h}][ext=mp4]+bestaudio[ext=m4a]/`
                 + `bestvideo[height=${h}]+bestaudio[ext=m4a]/`
                 + `bestvideo[height=${h}]+bestaudio/`
                 + `best[height<=${h}][ext=mp4]/best[height<=${h}]/best`;
        } else {
          fmtArg = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best';
        }
      }

      try {
        const { stdout } = await execPromise(
          `yt-dlp --get-title --no-playlist ${cookie} "${url}"`, { timeout: 15000 }
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
      const tkArgs = '--extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"';

      try {
        const { stdout } = await execPromise(
          `yt-dlp --get-title --no-playlist ${tkArgs} ${tiktokCookieArg} "${url}"`, { timeout: 15000 }
        );
        title = stdout.trim() || 'video';
      } catch (_) {}

      console.log('📥 TikTok yükləmə');
      await execPromise(
        `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" `
        + `${tkArgs} ${tiktokCookieArg} --merge-output-format mp4 `
        + `--no-playlist --retries 3 -o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );

    } else if (isInstagram) {
      try {
        const { stdout } = await execPromise(
          `yt-dlp --get-title --no-playlist ${cookie} "${url}"`, { timeout: 15000 }
        );
        title = stdout.trim() || 'video';
      } catch (_) {}

      console.log('📥 Instagram yükləmə');
      await execPromise(
        `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" `
        + `${cookie} --merge-output-format mp4 --no-playlist --retries 3 `
        + `-o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );

    } else {
      await execPromise(
        `yt-dlp -f "best" ${cookie} --no-playlist -o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );
    }

    const stats = fs.statSync(outputPath);
    if (stats.size === 0) throw new Error('Yüklənmiş fayl boşdur');

    const safeTitle = title
      .replace(/[^\w\s\u0400-\u04FF\u0100-\u024F-]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 80) || 'video';

    console.log(`✅ Tamamlandı: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
    res.json({ success: true, fileId, filename: `${safeTitle}.${outputExt}`, filesize: stats.size });

  } catch (err) {
    console.error(`❌ Download xətası: ${err.message}`);
    try {
      fs.readdirSync(tmpDir).forEach(f => {
        if (f.includes(fileId)) { try { fs.unlinkSync(path.join(tmpDir, f)); } catch (_) {} }
      });
    } catch (_) {}
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (tiktokCookiePath) { try { fs.unlinkSync(tiktokCookiePath); } catch (_) {} }
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

app.get('/', (req, res) => res.json({ message: 'Video Downloader API işləyir!' }));

app.listen(PORT, () => console.log(`🚀 Server ${PORT} portunda işləyir`));
