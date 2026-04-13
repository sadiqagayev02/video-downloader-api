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
const audioDir = '/tmp/audio-downloader';
const COOKIE_PATH = '/tmp/yt-cookies/youtube.txt';

app.use(cors());
app.use(express.json());

fs.mkdirSync(tmpDir, { recursive: true });
fs.mkdirSync(audioDir, { recursive: true });
fs.mkdirSync('/tmp/yt-cookies', { recursive: true });

// ─── Statik cookie setup (environment variable — fallback) ────────────────────
if (process.env.YOUTUBE_COOKIE_BASE64) {
  try {
    const content = Buffer.from(process.env.YOUTUBE_COOKIE_BASE64, 'base64').toString('utf8');
    fs.writeFileSync(COOKIE_PATH, content);
    console.log('✅ Statik cookie yaradıldı (env)');
  } catch (e) {
    console.log('⚠️ Statik cookie xətası:', e.message);
  }
}

// Statik cookie arg (environment variable-dan)
function getStaticCookieArg() {
  try { fs.accessSync(COOKIE_PATH); return `--cookies "${COOKIE_PATH}"`; }
  catch { return ''; }
}

// ─── Flutter-dən gələn cookie string-i müvəqqəti Netscape faylına çevir ───────
// Flutter "name=value; name2=value2" formatında göndərir
// yt-dlp Netscape formatı istəyir
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
      const name  = pair.substring(0, eqIdx).trim();
      const value = pair.substring(eqIdx + 1).trim();
      if (!name) return;
      // .youtube.com  TRUE  /  FALSE  <expiry>  <name>  <value>
      lines.push(
        `.youtube.com\tTRUE\t/\tFALSE\t${Math.floor(Date.now() / 1000) + 86400 * 14}\t${name}\t${value}`
      );
    });

    fs.writeFileSync(cookieFile, lines.join('\n'));
    console.log(`🍪 Flutter cookie faylı yaradıldı: ${lines.length - 3} cookie`);
    return cookieFile;
  } catch (e) {
    console.log('⚠️ Flutter cookie fayl xətası:', e.message);
    return null;
  }
}

function deleteTempFile(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch (_) {}
}

// ─── Innertube client ─────────────────────────────────────────────────────────
let ytClient = null;

async function getYouTubeClient() {
  if (ytClient) return ytClient;
  const { Innertube } = await import('youtubei.js');
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

function isTikTokPhotoUrl(url) {
  return url.includes('/photo/');
}

async function resolveTikTokUrl(url) {
  if (!url.includes('vt.tiktok.com') && !url.includes('vm.tiktok.com')) return url;
  try {
    const { stdout } = await execPromise(
      `curl -sI -L --max-redirs 5 "${url}" | grep -i "^location:" | tail -1 | awk '{print $2}' | tr -d '\\r'`,
      { timeout: 10000 }
    );
    const resolved = stdout.trim();
    console.log(`🔗 TikTok resolved: ${resolved || url}`);
    return resolved || url;
  } catch { return url; }
}

function extractYouTubeQualities(info) {
  const adaptive = info.streaming_data?.adaptive_formats || [];
  const basic    = info.streaming_data?.formats || [];
  const allFormats = [...basic, ...adaptive];
  const seen = new Set();
  const qualities = [];

  const heights = new Set();
  for (const f of allFormats) {
    if (f.height && f.height > 0) heights.add(f.height);
  }

  for (const h of [...heights].sort((a, b) => b - a)) {
    const hasVideo = allFormats.some(f => f.height === h && f.mime_type?.startsWith('video/'));
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

  const hasAudio = adaptive.some(f => f.mime_type?.startsWith('audio/'));
  if (hasAudio) {
    qualities.push({ label: 'MP3 (Audio)', value: 'audio', ext: 'm4a' });
  }

  return qualities;
}

function findFile(dir, fileId) {
  try {
    const files = fs.readdirSync(dir).filter(f => f.startsWith(`out_${fileId}`));
    if (files.length > 0) return path.join(dir, files[0]);
  } catch (_) {}
  return null;
}

function cleanupDir(dir, fileId) {
  try {
    fs.readdirSync(dir)
      .filter(f => f.includes(fileId))
      .forEach(f => { try { fs.unlinkSync(path.join(dir, f)); } catch (_) {} });
  } catch (_) {}
}

function makeSafeTitle(title) {
  return (title || 'video')
    .replace(/[^\w\s\u0400-\u04FF\u0100-\u024F-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 80) || 'video';
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
    if (isYoutube) {
      const videoId = extractVideoId(url);
      if (!videoId) return res.status(400).json({ error: 'Video ID tapılmadı' });

      const client = await getYouTubeClient();
      const info = await client.getInfo(videoId);
      const qualities = extractYouTubeQualities(info);

      const finalQualities = qualities.length > 0 ? qualities : [
        { label: '1080p Full HD', value: '1080', ext: 'mp4' },
        { label: '720p HD',       value: '720',  ext: 'mp4' },
        { label: '480p',          value: '480',  ext: 'mp4' },
        { label: '360p',          value: '360',  ext: 'mp4' },
        { label: 'MP3 (Audio)',   value: 'audio', ext: 'm4a' },
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

    if (isTikTok) {
      const resolvedUrl = await resolveTikTokUrl(url);
      if (isTikTokPhotoUrl(resolvedUrl)) {
        return res.status(422).json({
          success: false,
          error: 'Bu TikTok foto paylaşımıdır. Yalnız videolar yüklənə bilər.',
        });
      }

      let title = 'Video', thumbnail = '', duration = '00:00', uploader = '';
      const tkArgs = '--extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"';
      const tiktokCookiePath = '/tmp/tiktok-cookies/tiktok.txt';
      let tiktokCookieArg = '';
      try { fs.accessSync(tiktokCookiePath); tiktokCookieArg = `--cookies "${tiktokCookiePath}"`; } catch {}

      try {
        const { stdout } = await execPromise(
          `yt-dlp --no-playlist --socket-timeout 15 ${tkArgs} ${tiktokCookieArg} `
          + `--print "%(title)s|||%(thumbnail)s|||%(duration)s|||%(uploader)s" "${resolvedUrl}"`,
          { timeout: 25000 }
        );
        const parts = stdout.trim().split('|||');
        title     = parts[0]?.trim() || 'Video';
        thumbnail = parts[1]?.trim() || '';
        duration  = formatDuration(parseFloat(parts[2]) || 0);
        uploader  = parts[3]?.trim() || '';
      } catch (e) { console.log('⚠️ TikTok metadata xətası:', e.message); }

      return res.json({
        success: true,
        data: { title, thumbnail, duration, platform: 'tiktok', uploader,
          qualities: [{ label: 'HD Video', value: 'video', ext: 'mp4' }] },
      });
    }

    if (isInstagram) {
      let title = 'Video', thumbnail = '', duration = '00:00', uploader = '';
      try {
        const { stdout } = await execPromise(
          `yt-dlp --no-playlist --socket-timeout 15 `
          + `--print "%(title)s|||%(thumbnail)s|||%(duration)s|||%(uploader)s" "${url}"`,
          { timeout: 25000 }
        );
        const parts = stdout.trim().split('|||');
        title     = parts[0]?.trim() || 'Video';
        thumbnail = parts[1]?.trim() || '';
        duration  = formatDuration(parseFloat(parts[2]) || 0);
        uploader  = parts[3]?.trim() || '';
      } catch (e) { console.log('⚠️ Instagram metadata xətası:', e.message); }

      return res.json({
        success: true,
        data: { title, thumbnail, duration, platform: 'instagram', uploader,
          qualities: [{ label: 'HD Video', value: 'video', ext: 'mp4' }] },
      });
    }

    let title = 'Video', thumbnail = '', duration = '00:00', uploader = '';
    try {
      const { stdout } = await execPromise(
        `yt-dlp --no-playlist --socket-timeout 15 `
        + `--print "%(title)s|||%(thumbnail)s|||%(duration)s|||%(uploader)s" "${url}"`,
        { timeout: 25000 }
      );
      const parts = stdout.trim().split('|||');
      title     = parts[0]?.trim() || 'Video';
      thumbnail = parts[1]?.trim() || '';
      duration  = formatDuration(parseFloat(parts[2]) || 0);
      uploader  = parts[3]?.trim() || '';
    } catch (e) { console.log('⚠️ Generic info xətası:', e.message); }

    return res.json({
      success: true,
      data: { title, thumbnail, duration, platform: 'other', uploader,
        qualities: [{ label: 'HD Video', value: 'video', ext: 'mp4' }] },
    });

  } catch (err) {
    console.error(`❌ /api/info xətası: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// VIDEO DOWNLOAD
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/download/start', async (req, res) => {
  const { url, quality, tiktokCookies } = req.body;
  if (!url || !quality) return res.status(400).json({ error: 'URL və keyfiyyət tələb olunur' });

  const fileId      = crypto.randomBytes(16).toString('hex');
  const cookie      = getStaticCookieArg();
  const isYoutube   = url.includes('youtube.com') || url.includes('youtu.be');
  const isTikTok    = url.includes('tiktok.com');
  const isInstagram = url.includes('instagram.com');

  console.log(`📥 Video download: ${url} | keyfiyyət: ${quality}`);

  if (isTikTok) {
    const resolvedForCheck = await resolveTikTokUrl(url);
    if (isTikTokPhotoUrl(resolvedForCheck)) {
      return res.status(422).json({ success: false, error: 'Bu TikTok foto paylaşımıdır.' });
    }
  }

  let tiktokCookiePath = null;
  let tiktokCookieArg = '';
  if (isTikTok && tiktokCookies && Array.isArray(tiktokCookies) && tiktokCookies.length > 0) {
    try {
      fs.mkdirSync('/tmp/tiktok-cookies', { recursive: true });
      tiktokCookiePath = `/tmp/tiktok-cookies/tk_${fileId}.txt`;
      const lines = ['# Netscape HTTP Cookie File'];
      for (const c of tiktokCookies) {
        const domain  = (c.domain || '.tiktok.com').startsWith('.') ? c.domain : `.${c.domain || 'tiktok.com'}`;
        const secure  = c.isSecure ? 'TRUE' : 'FALSE';
        const expires = c.expiresDate ? Math.floor(new Date(c.expiresDate).getTime() / 1000) : 9999999999;
        lines.push(`${domain}\tTRUE\t${c.path || '/'}\t${secure}\t${expires}\t${c.name}\t${c.value}`);
      }
      fs.writeFileSync(tiktokCookiePath, lines.join('\n'));
      tiktokCookieArg = `--cookies "${tiktokCookiePath}"`;
    } catch (e) { console.log('⚠️ TikTok cookie yazma xətası:', e.message); }
  }

  const outputPath = path.join(tmpDir, `out_${fileId}.mp4`);
  let title = 'video';

  try {
    if (isYoutube) {
      try {
        const { stdout } = await execPromise(`yt-dlp --get-title --no-playlist ${cookie} "${url}"`, { timeout: 15000 });
        title = stdout.trim() || 'video';
      } catch (_) {}

      const h = parseInt(quality);
      const fmtArg = !isNaN(h)
        ? `bestvideo[height=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height=${h}]+bestaudio/best[height<=${h}][ext=mp4]/best[height<=${h}]/best`
        : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best';

      console.log(`📥 YouTube video | format: ${fmtArg}`);
      await execPromise(
        `yt-dlp -f "${fmtArg}" ${cookie} --merge-output-format mp4 --no-playlist --retries 3 -o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );

    } else if (isTikTok) {
      const tkArgs = '--extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"';
      const resolvedUrl = await resolveTikTokUrl(url);
      try {
        const { stdout } = await execPromise(`yt-dlp --get-title --no-playlist ${tkArgs} ${tiktokCookieArg} "${resolvedUrl}"`, { timeout: 15000 });
        title = stdout.trim() || 'video';
      } catch (_) {}

      console.log('📥 TikTok video');
      await execPromise(
        `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" ${tkArgs} ${tiktokCookieArg} --merge-output-format mp4 --no-playlist --retries 3 -o "${outputPath}" "${resolvedUrl}"`,
        { timeout: 300000 }
      );

    } else if (isInstagram) {
      try {
        const { stdout } = await execPromise(`yt-dlp --get-title --no-playlist "${url}"`, { timeout: 15000 });
        title = stdout.trim() || 'video';
      } catch (_) {}

      console.log('📥 Instagram video');
      await execPromise(
        `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 --no-playlist --retries 3 -o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );

    } else {
      await execPromise(`yt-dlp -f "best" ${cookie} --no-playlist -o "${outputPath}" "${url}"`, { timeout: 300000 });
    }

    let actualPath = fs.existsSync(outputPath) ? outputPath : findFile(tmpDir, fileId);
    if (!actualPath) throw new Error('Yüklənmiş fayl tapılmadı');

    const stats = fs.statSync(actualPath);
    if (stats.size === 0) throw new Error('Yüklənmiş fayl boşdur');

    const actualExt = path.extname(actualPath).slice(1) || 'mp4';
    const finalPath = path.join(tmpDir, `out_${fileId}_final.${actualExt}`);
    fs.renameSync(actualPath, finalPath);

    const filename = `${makeSafeTitle(title)}.${actualExt}`;
    console.log(`✅ Video tamamlandı: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
    res.json({ success: true, fileId: `${fileId}_final`, filename, filesize: stats.size });

  } catch (err) {
    console.error(`❌ Video download xətası: ${err.message}`);
    cleanupDir(tmpDir, fileId);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (tiktokCookiePath) { try { fs.unlinkSync(tiktokCookiePath); } catch (_) {} }
  }
});

app.get('/api/download/file/:fileId', (req, res) => {
  const { fileId } = req.params;
  for (const ext of ['mp4', 'm4a', 'mp3', 'webm', 'mkv']) {
    const filePath = path.join(tmpDir, `out_${fileId}.${ext}`);
    if (fs.existsSync(filePath)) {
      console.log(`📤 Video göndərilir: ${path.basename(filePath)}`);
      return res.download(filePath, () => { try { fs.unlinkSync(filePath); } catch (_) {} });
    }
  }
  res.status(404).json({ error: 'Fayl tapılmadı' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIO DOWNLOAD  —  /api/audio/*
//
// DƏYİŞİKLİK:
// Flutter-dən cookieString gəlir → müvəqqəti Netscape faylı yaradılır
// → yt-dlp həmin cookie ilə işləyir → bot xətası yox
// cookieString yoxdursa → statik environment cookie fallback
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/audio/start', async (req, res) => {
  const { url, cookieString } = req.body; // ← cookieString Flutter-dən gəlir
  if (!url) return res.status(400).json({ error: 'URL tələb olunur' });

  const fileId    = crypto.randomBytes(16).toString('hex');
  const isYoutube = url.includes('youtube.com') || url.includes('youtu.be');

  console.log(`🎵 Audio download: ${url}`);

  const outputPath = path.join(audioDir, `out_${fileId}.m4a`);
  let title = 'audio';

  // Flutter-dən gələn cookie-ni müvəqqəti fayla yaz
  // Yoxdursa statik environment cookie istifadə et
  const tempCookieFile = createTempCookieFile(cookieString, fileId);
  const cookieArg = tempCookieFile
    ? `--cookies "${tempCookieFile}"`
    : getStaticCookieArg();

  console.log(`🍪 Cookie: ${tempCookieFile ? 'Flutter (dinamik)' : (cookieArg ? 'env (statik)' : 'yoxdur')}`);

  try {
    if (isYoutube) {
      try {
        const { stdout } = await execPromise(
          `yt-dlp --get-title --no-playlist ${cookieArg} "${url}"`,
          { timeout: 15000 }
        );
        title = stdout.trim() || 'audio';
      } catch (_) {}

      console.log('🎵 YouTube audio → m4a');
      await execPromise(
        `yt-dlp -f "140/141/139/bestaudio[ext=m4a]/bestaudio[acodec=aac]/bestaudio" `
        + `${cookieArg} --no-playlist --retries 3 -o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );

    } else {
      try {
        const { stdout } = await execPromise(
          `yt-dlp --get-title --no-playlist "${url}"`,
          { timeout: 15000 }
        );
        title = stdout.trim() || 'audio';
      } catch (_) {}

      console.log('🎵 Audio → m4a');
      await execPromise(
        `yt-dlp -f "bestaudio[ext=m4a]/bestaudio[acodec=aac]/bestaudio/best" `
        + `--no-playlist --retries 3 -o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );
    }

    let actualPath = fs.existsSync(outputPath) ? outputPath : findFile(audioDir, fileId);
    if (!actualPath) throw new Error('Audio fayl tapılmadı');

    const stats = fs.statSync(actualPath);
    if (stats.size === 0) throw new Error('Audio fayl boşdur');

    const actualExt  = path.extname(actualPath).slice(1) || 'm4a';
    const finalPath  = path.join(audioDir, `out_${fileId}_final.${actualExt}`);
    fs.renameSync(actualPath, finalPath);

    const filename = `${makeSafeTitle(title)}.${actualExt}`;
    console.log(`✅ Audio tamamlandı: ${(stats.size / 1024 / 1024).toFixed(1)} MB → ${filename}`);

    res.json({ success: true, fileId: `${fileId}_final`, filename, filesize: stats.size });

  } catch (err) {
    console.error(`❌ Audio download xətası: ${err.message}`);
    cleanupDir(audioDir, fileId);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    deleteTempFile(tempCookieFile); // Müvəqqəti cookie faylını sil
  }
});

app.get('/api/audio/file/:fileId', (req, res) => {
  const { fileId } = req.params;
  for (const ext of ['m4a', 'mp3', 'aac', 'opus', 'webm']) {
    const filePath = path.join(audioDir, `out_${fileId}.${ext}`);
    if (fs.existsSync(filePath)) {
      console.log(`📤 Audio göndərilir: ${path.basename(filePath)}`);
      return res.download(filePath, () => { try { fs.unlinkSync(filePath); } catch (_) {} });
    }
  }
  res.status(404).json({ error: 'Audio fayl tapılmadı' });
});

// ─── Root ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ message: 'Video Downloader API işləyir!' }));

app.listen(PORT, () => console.log(`🚀 Server ${PORT} portunda işləyir`));
