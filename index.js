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

// ─── TikTok yardımçıları ──────────────────────────────────────────────────────
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
  } catch {
    return url;
  }
}

// ─── YouTube keyfiyyətləri ────────────────────────────────────────────────────
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

  const hasAudio = adaptive.some(f => f.mime_type?.startsWith('audio/'));
  if (hasAudio) {
    qualities.push({ label: 'MP3 (Audio)', value: 'audio', ext: 'm4a' });
  }

  return qualities;
}

// ─── ffmpeg mövcudluğunu yoxla ────────────────────────────────────────────────
let _hasFfmpeg = null;
async function hasFfmpeg() {
  if (_hasFfmpeg !== null) return _hasFfmpeg;
  try {
    await execPromise('ffmpeg -version', { timeout: 5000 });
    _hasFfmpeg = true;
    console.log('✅ ffmpeg mövcuddur');
  } catch {
    _hasFfmpeg = false;
    console.log('⚠️ ffmpeg yoxdur — m4a formatı istifadə ediləcək');
  }
  return _hasFfmpeg;
}

hasFfmpeg();

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

    // ── TikTok ────────────────────────────────────────────────────────────────
    if (isTikTok) {
      const resolvedUrl = await resolveTikTokUrl(url);

      if (isTikTokPhotoUrl(resolvedUrl)) {
        console.log('⚠️ TikTok foto — dəstəklənmir');
        return res.status(422).json({
          success: false,
          error: 'Bu TikTok foto paylaşımıdır. Yalnız videolar yüklənə bilər.',
        });
      }

      let title = 'Video', thumbnail = '', duration = '00:00', uploader = '';
      const tkArgs = '--extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"';

      const tiktokCookiePath = '/tmp/tiktok-cookies/tiktok.txt';
      let tiktokCookieArg = '';
      try { fs.accessSync(tiktokCookiePath); tiktokCookieArg = `--cookies "${tiktokCookiePath}"`; }
      catch {}

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
      } catch (e) {
        console.log('⚠️ TikTok metadata xətası:', e.message);
      }

      return res.json({
        success: true,
        data: {
          title, thumbnail, duration, platform: 'tiktok', uploader,
          qualities: [{ label: 'HD Video', value: 'video', ext: 'mp4' }],
        },
      });
    }

    // ── Instagram ─────────────────────────────────────────────────────────────
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
      } catch (e) {
        console.log('⚠️ Instagram metadata xətası:', e.message);
      }

      return res.json({
        success: true,
        data: {
          title, thumbnail, duration, platform: 'instagram', uploader,
          qualities: [{ label: 'HD Video', value: 'video', ext: 'mp4' }],
        },
      });
    }

    // ── Digər ─────────────────────────────────────────────────────────────────
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

  const fileId      = crypto.randomBytes(16).toString('hex');
  const cookie      = getCookieArg();
  const isYoutube   = url.includes('youtube.com') || url.includes('youtu.be');
  const isTikTok    = url.includes('tiktok.com');
  const isInstagram = url.includes('instagram.com');
  const isAudio     = quality === 'audio' || quality === 'mp3';

  console.log(`📥 Download: ${url} | keyfiyyət: ${quality} | audio: ${isAudio}`);

  // ── TikTok foto yoxlaması ─────────────────────────────────────────────────
  if (isTikTok) {
    const resolvedForCheck = await resolveTikTokUrl(url);
    if (isTikTokPhotoUrl(resolvedForCheck)) {
      return res.status(422).json({
        success: false,
        error: 'Bu TikTok foto paylaşımıdır. Yalnız videolar yüklənə bilər.',
      });
    }
  }

  // ── TikTok cookie ─────────────────────────────────────────────────────────
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

  // ── Çıxış formatı ─────────────────────────────────────────────────────────
  // ffmpeg varsa → mp3, yoxsa → m4a (hər iki halda audio faylıdır)
  const ffmpegAvailable = await hasFfmpeg();
  const audioExt   = ffmpegAvailable ? 'mp3' : 'm4a';
  const outputExt  = isAudio ? audioExt : 'mp4';
  const outputPath = path.join(tmpDir, `out_${fileId}.${outputExt}`);
  let title = 'video';

  try {

    // ── YouTube ───────────────────────────────────────────────────────────────
    if (isYoutube) {

      try {
        const { stdout } = await execPromise(
          `yt-dlp --get-title --no-playlist ${cookie} "${url}"`,
          { timeout: 15000 }
        );
        title = stdout.trim() || 'video';
      } catch (_) {}

      if (isAudio) {
        // ── Audio yükləmə ─────────────────────────────────────────────────────
        // ffmpeg varsa: bestaudio → mp3-ə çevir
        // ffmpeg yoxdursa: birbaşa m4a (AAC) yüklə — çevirmə yoxdur
        if (ffmpegAvailable) {
          console.log('📥 YouTube audio → mp3 (ffmpeg ilə)');
          await execPromise(
            `yt-dlp -f "bestaudio/best" ${cookie} `
            + `--extract-audio --audio-format mp3 --audio-quality 0 `
            + `--no-playlist --retries 3 -o "${outputPath}" "${url}"`,
            { timeout: 300000 }
          );
        } else {
          // ffmpeg yoxdur — m4a (AAC) birbaşa yüklə
          // tag 140 = 128kbps AAC, tag 141 = 256kbps AAC — ən etibarlı
          console.log('📥 YouTube audio → m4a (ffmpeg yoxdur)');
          await execPromise(
            `yt-dlp -f "bestaudio[ext=m4a]/bestaudio[acodec=aac]/140/141/bestaudio" ${cookie} `
            + `--no-playlist --retries 3 -o "${outputPath}" "${url}"`,
            { timeout: 300000 }
          );
        }

      } else {
        // ── Video yükləmə ─────────────────────────────────────────────────────
        const h = parseInt(quality);
        let fmtArg;
        if (!isNaN(h)) {
          if (ffmpegAvailable) {
            // ffmpeg var → DASH (video+audio ayrı) birləşdir
            fmtArg = `bestvideo[height=${h}][ext=mp4]+bestaudio[ext=m4a]/`
                   + `bestvideo[height=${h}]+bestaudio/`
                   + `best[height<=${h}][ext=mp4]/best[height<=${h}]/best`;
          } else {
            // ffmpeg yox → yalnız muxed (video+audio birlikdə)
            fmtArg = `best[height<=${h}][ext=mp4]/best[height<=${h}]/best[ext=mp4]/best`;
          }
        } else {
          fmtArg = ffmpegAvailable
            ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best'
            : 'best[ext=mp4]/best';
        }

        console.log(`📥 YouTube video → mp4 | format: ${fmtArg}`);
        await execPromise(
          `yt-dlp -f "${fmtArg}" ${cookie} --merge-output-format mp4 `
          + `--no-playlist --retries 3 -o "${outputPath}" "${url}"`,
          { timeout: 300000 }
        );
      }

    // ── TikTok ────────────────────────────────────────────────────────────────
    } else if (isTikTok) {
      const tkArgs = '--extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"';
      const resolvedUrl = await resolveTikTokUrl(url);

      try {
        const { stdout } = await execPromise(
          `yt-dlp --get-title --no-playlist ${tkArgs} ${tiktokCookieArg} "${resolvedUrl}"`,
          { timeout: 15000 }
        );
        title = stdout.trim() || 'video';
      } catch (_) {}

      console.log('📥 TikTok video yükləmə');
      await execPromise(
        `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" `
        + `${tkArgs} ${tiktokCookieArg} --merge-output-format mp4 `
        + `--no-playlist --retries 3 -o "${outputPath}" "${resolvedUrl}"`,
        { timeout: 300000 }
      );

    // ── Instagram ─────────────────────────────────────────────────────────────
    } else if (isInstagram) {
      try {
        const { stdout } = await execPromise(
          `yt-dlp --get-title --no-playlist "${url}"`, { timeout: 15000 }
        );
        title = stdout.trim() || 'video';
      } catch (_) {}

      console.log('📥 Instagram yükləmə');
      await execPromise(
        `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" `
        + `--merge-output-format mp4 --no-playlist --retries 3 `
        + `-o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );

    // ── Digər ─────────────────────────────────────────────────────────────────
    } else {
      await execPromise(
        `yt-dlp -f "best" ${cookie} --no-playlist -o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );
    }

    // ── Fayl yoxlaması ────────────────────────────────────────────────────────
    // yt-dlp bəzən faylı fərqli extension ilə saxlayır
    // məsələn: .mp3 istədik, .mp3.m4a kimi saxladı
    // buna görə həqiqi faylı tapırıq
    let actualPath = outputPath;
    if (!fs.existsSync(outputPath)) {
      // Həmin fileId ilə başlayan faylı tap
      const files = fs.readdirSync(tmpDir).filter(f => f.startsWith(`out_${fileId}`));
      if (files.length > 0) {
        actualPath = path.join(tmpDir, files[0]);
        console.log(`📁 Fayl fərqli adla saxlandı: ${files[0]}`);
      } else {
        throw new Error('Yüklənmiş fayl tapılmadı');
      }
    }

    const stats = fs.statSync(actualPath);
    if (stats.size === 0) throw new Error('Yüklənmiş fayl boşdur');

    // Fayl adını actual path-dan al
    const actualExt = path.extname(actualPath).slice(1) || outputExt;

    const safeTitle = title
      .replace(/[^\w\s\u0400-\u04FF\u0100-\u024F-]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 80) || 'video';

    const filename = `${safeTitle}.${actualExt}`;

    console.log(`✅ Tamamlandı: ${(stats.size / 1024 / 1024).toFixed(1)} MB → ${filename}`);

    // Faylı düzgün adla yenidən adlandır
    const finalPath = path.join(tmpDir, `out_${fileId}_final.${actualExt}`);
    fs.renameSync(actualPath, finalPath);

    res.json({
      success: true,
      fileId: `${fileId}_final`,
      filename,
      filesize: stats.size,
    });

  } catch (err) {
    console.error(`❌ Download xətası: ${err.message}`);
    // Temp faylları təmizlə
    try {
      fs.readdirSync(tmpDir)
        .filter(f => f.includes(fileId))
        .forEach(f => { try { fs.unlinkSync(path.join(tmpDir, f)); } catch (_) {} });
    } catch (_) {}
    res.status(500).json({ success: false, error: err.message });
  } finally {
    if (tiktokCookiePath) { try { fs.unlinkSync(tiktokCookiePath); } catch (_) {} }
  }
});

// ─── Download file ────────────────────────────────────────────────────────────
app.get('/api/download/file/:fileId', (req, res) => {
  const { fileId } = req.params;
  for (const ext of ['mp4', 'm4a', 'mp3', 'webm', 'mkv']) {
    const filePath = path.join(tmpDir, `out_${fileId}.${ext}`);
    if (fs.existsSync(filePath)) {
      console.log(`📤 Göndərilir: ${path.basename(filePath)}`);
      return res.download(filePath, () => {
        try { fs.unlinkSync(filePath); } catch (_) {}
      });
    }
  }
  console.error(`❌ Fayl tapılmadı: out_${fileId}.*`);
  res.status(404).json({ error: 'Fayl tapılmadı' });
});

app.get('/', (req, res) => res.json({ message: 'Video Downloader API işləyir!' }));

app.listen(PORT, () => console.log(`🚀 Server ${PORT} portunda işləyir`));
