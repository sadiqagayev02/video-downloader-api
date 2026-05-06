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
const tmpDir   = '/tmp/video-downloader';
const audioDir = '/tmp/audio-downloader';
const COOKIE_PATH = '/tmp/yt-cookies/youtube.txt';

app.use(cors());
app.use(express.json());

fs.mkdirSync(tmpDir,   { recursive: true });
fs.mkdirSync(audioDir, { recursive: true });
fs.mkdirSync('/tmp/yt-cookies', { recursive: true });

// ─── Cookie setup ─────────────────────────────────────────────────────────────
if (process.env.YOUTUBE_COOKIE_BASE64) {
  try {
    const content = Buffer.from(process.env.YOUTUBE_COOKIE_BASE64, 'base64').toString('utf8');
    fs.writeFileSync(COOKIE_PATH, content);
    console.log('✅ Statik cookie yaradıldı (env)');
  } catch (e) {
    console.log('⚠️ Statik cookie xətası:', e.message);
  }
}

function getStaticCookieArg() {
  try { fs.accessSync(COOKIE_PATH); return `--cookies "${COOKIE_PATH}"`; }
  catch { return ''; }
}

function createTempCookieFile(cookieString, fileId) {
  if (!cookieString || typeof cookieString !== 'string' || !cookieString.trim()) return null;
  try {
    const cookieFile = path.join('/tmp/yt-cookies', `flutter_${fileId}.txt`);
    const lines = ['# Netscape HTTP Cookie File', ''];
    cookieString.split(';').forEach(pair => {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) return;
      const name  = pair.substring(0, eqIdx).trim();
      const value = pair.substring(eqIdx + 1).trim();
      if (!name) return;
      lines.push(`.youtube.com\tTRUE\t/\tFALSE\t${Math.floor(Date.now() / 1000) + 86400 * 14}\t${name}\t${value}`);
    });
    fs.writeFileSync(cookieFile, lines.join('\n'));
    console.log(`🍪 Flutter cookie: ${lines.length - 2} ədəd`);
    return cookieFile;
  } catch (e) {
    console.log('⚠️ Flutter cookie xətası:', e.message);
    return null;
  }
}

function deleteTempFile(filePath) {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch (_) {}
}

// ─── Youtubei.js client ───────────────────────────────────────────────────────
// generate_session_locally: true → "No valid URL to decipher" xətasını həll edir
let ytClientAnon = null;

async function getYouTubeClient(cookieString) {
  const { Innertube } = await import("youtubei.js");
  const baseOpts = {
    lang: "en",
    location: "US",
    retrieve_player: true,
    generate_session_locally: true,
  };
  if (cookieString && cookieString.trim()) {
    console.log("🍪 Innertube: cookie ilə client yaradılır");
    return await Innertube.create({ ...baseOpts, cookie: cookieString.trim() });
  }
  if (ytClientAnon) return ytClientAnon;
  ytClientAnon = await Innertube.create(baseOpts);
  console.log("✅ Innertube anonim client hazırdır");
  return ytClientAnon;
}

getYouTubeClient(null).catch(e => console.log("⚠️ Innertube init xətası:", e.message));


function extractVideoId(url) {
  try {
    const uri = new URL(url);
    if (uri.hostname === 'youtu.be') return uri.pathname.slice(1).split('?')[0];
    if (uri.pathname.includes('/shorts/')) return uri.pathname.split('/shorts/')[1].split('?')[0];
    return uri.searchParams.get('v');
  } catch { return null; }
}

// ─── Yardımçılar ──────────────────────────────────────────────────────────────
function formatDuration(secs) {
  if (!secs) return '00:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  return `${m}:${s.toString().padStart(2,'0')}`;
}

function isTikTokPhotoUrl(url) { return url.includes('/photo/'); }

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
  const { url, cookieString } = req.body;
  if (!url) return res.status(400).json({ error: 'URL tələb olunur' });

  console.log(`📡 Info: ${url}`);
  const isYoutube   = url.includes('youtube.com') || url.includes('youtu.be');
  const isTikTok    = url.includes('tiktok.com');
  const isInstagram = url.includes('instagram.com');

  try {
    // ── YouTube ───────────────────────────────────────────────────────────────
    if (isYoutube) {
      const fileId = crypto.randomBytes(8).toString('hex');
      const tempCookieFile = createTempCookieFile(cookieString, `info_${fileId}`);
      const ytCookieArg    = tempCookieFile ? `--cookies "${tempCookieFile}"` : getStaticCookieArg();

      console.log(`🎬 YouTube info | cookie: ${tempCookieFile ? 'flutter' : (ytCookieArg ? 'statik' : 'yoxdur')}`);

      let title = 'YouTube Video', thumbnail = '', duration = '00:00', uploader = '';
      const strategies = [
        '--extractor-args "youtube:player_client=tv_embedded"',
        '--extractor-args "youtube:player_client=ios" --user-agent "com.google.ios.youtube/19.29.1 (iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X;)"',
        '--extractor-args "youtube:player_client=android_vr"',
        '--extractor-args "youtube:player_client=web_creator"',
        '',
      ];

      let formats = [];
      let rawData = null;

      for (const strategy of strategies) {
        try {
          console.log(`📡 YouTube strategiya: ${strategy || 'default'}`);
          const { stdout } = await execPromise(
            `yt-dlp ${strategy} ${ytCookieArg} --dump-json --no-playlist --socket-timeout 30 "${url}"`,
            { timeout: 45000, maxBuffer: 20 * 1024 * 1024 }
          );
          rawData = JSON.parse(stdout);
          if (rawData?.formats) { formats = rawData.formats; break; }
        } catch (e) {
          console.log(`⚠️ Strategiya uğursuz: ${e.message.substring(0, 100)}`);
        }
      }

      if (rawData) {
        title     = rawData.title     || 'YouTube Video';
        thumbnail = rawData.thumbnail || '';
        duration  = formatDuration(rawData.duration || 0);
        uploader  = rawData.uploader  || rawData.channel || '';
      }

      const qualities = [];
      const audioBest = formats
        .filter(f => f.acodec && f.acodec !== 'none' && (!f.vcodec || f.vcodec === 'none'))
        .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

      for (const res of [1080, 720, 480, 360]) {
        const combined = formats
          .filter(f => f.height === res && f.vcodec && f.vcodec !== 'none' && f.acodec && f.acodec !== 'none')
          .sort((a, b) => (b.filesize || 0) - (a.filesize || 0))[0];
        if (combined) {
          qualities.push({
            label: res === 1080 ? '1080p Full HD' : res === 720 ? '720p HD' : `${res}p`,
            value: `${res}p`, formatId: combined.format_id,
            filesize: combined.filesize || null, ext: 'mp4', needsMerge: false,
          });
        } else if (audioBest) {
          const vOnly = formats
            .filter(f => f.height === res && f.vcodec && f.vcodec !== 'none' && (!f.acodec || f.acodec === 'none'))
            .sort((a, b) => (b.filesize || 0) - (a.filesize || 0))[0];
          if (vOnly) {
            qualities.push({
              label: res === 1080 ? '1080p Full HD' : res === 720 ? '720p HD' : `${res}p`,
              value: `${res}p`, videoFormatId: vOnly.format_id, audioFormatId: audioBest.format_id,
              filesize: (vOnly.filesize || 0) + (audioBest.filesize || 0), ext: 'mp4', needsMerge: true,
            });
          }
        }
      }

      if (audioBest) {
        qualities.push({
          label: 'MP3 (Audio)', value: 'audio',
          formatId: audioBest.format_id, filesize: audioBest.filesize || null,
          ext: 'm4a', needsMerge: false,
        });
      }

      if (qualities.length === 0) {
        qualities.push(
          { label: '720p HD',     value: '720p',  ext: 'mp4', needsMerge: false },
          { label: '480p',        value: '480p',  ext: 'mp4', needsMerge: false },
          { label: 'MP3 (Audio)', value: 'audio', ext: 'm4a', needsMerge: false },
        );
      }

      deleteTempFile(tempCookieFile);
      return res.json({
        success: true,
        data: { title, thumbnail, duration, platform: 'youtube', uploader, qualities },
      });
    }

    // ── TikTok ────────────────────────────────────────────────────────────────
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
        title = parts[0]?.trim() || 'Video'; thumbnail = parts[1]?.trim() || '';
        duration = formatDuration(parseFloat(parts[2]) || 0); uploader = parts[3]?.trim() || '';
      } catch (e) { console.log('⚠️ TikTok metadata xətası:', e.message); }
      return res.json({
        success: true,
        data: { title, thumbnail, duration, platform: 'tiktok', uploader,
          qualities: [{ label: 'HD Video', value: 'video', ext: 'mp4' }, { label: 'MP3 (Audio)', value: 'audio', ext: 'm4a' }] },
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
        title = parts[0]?.trim() || 'Video'; thumbnail = parts[1]?.trim() || '';
        duration = formatDuration(parseFloat(parts[2]) || 0); uploader = parts[3]?.trim() || '';
      } catch (e) { console.log('⚠️ Instagram metadata xətası:', e.message); }
      return res.json({
        success: true,
        data: { title, thumbnail, duration, platform: 'instagram', uploader,
          qualities: [{ label: 'HD Video', value: 'video', ext: 'mp4' }, { label: 'MP3 (Audio)', value: 'audio', ext: 'm4a' }] },
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
      title = parts[0]?.trim() || 'Video'; thumbnail = parts[1]?.trim() || '';
      duration = formatDuration(parseFloat(parts[2]) || 0); uploader = parts[3]?.trim() || '';
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
// VIDEO DOWNLOAD — /api/download/*
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/download/start', async (req, res) => {
  const { url, quality, cookieString, tiktokCookies } = req.body;
  if (!url || !quality) return res.status(400).json({ error: 'URL və keyfiyyət tələb olunur' });

  const fileId      = crypto.randomBytes(16).toString('hex');
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
  let tiktokCookieArg  = '';
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
    } catch (e) { console.log('⚠️ TikTok cookie xətası:', e.message); }
  }

  const tempYtCookieFile = isYoutube ? createTempCookieFile(cookieString, fileId) : null;
  const ytCookieArg      = tempYtCookieFile ? `--cookies "${tempYtCookieFile}"` : getStaticCookieArg();

  if (isYoutube) {
    console.log(`🍪 YT Cookie: ${tempYtCookieFile ? 'Flutter (dinamik)' : (ytCookieArg ? 'env (statik)' : 'yoxdur')}`);
  }

  const outputPath = path.join(tmpDir, `out_${fileId}.mp4`);
  let title = 'video';

  try {
    if (isYoutube) {
      try {
        const { stdout } = await execPromise(
          `yt-dlp --get-title --no-playlist ${ytCookieArg} "${url}"`, { timeout: 15000 }
        );
        title = stdout.trim() || 'video';
      } catch (_) {}

      const h = parseInt(quality);
      const fmtArg = !isNaN(h)
        ? `bestvideo[height=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`
        : 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best';

      console.log(`📥 YouTube video | format: ${fmtArg}`);
      await execPromise(
        `yt-dlp -f "${fmtArg}" ${ytCookieArg} --merge-output-format mp4 --no-playlist --retries 3 -o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );

    } else if (isTikTok) {
      const tkArgs      = '--extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"';
      const resolvedUrl = await resolveTikTokUrl(url);
      try {
        const { stdout } = await execPromise(
          `yt-dlp --get-title --no-playlist ${tkArgs} ${tiktokCookieArg} "${resolvedUrl}"`, { timeout: 15000 }
        );
        title = stdout.trim() || 'video';
      } catch (_) {}
      console.log('📥 TikTok video');
      await execPromise(
        `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" ${tkArgs} ${tiktokCookieArg} --merge-output-format mp4 --no-playlist --retries 3 -o "${outputPath}" "${resolvedUrl}"`,
        { timeout: 300000 }
      );

    } else if (isInstagram) {
      try {
        const { stdout } = await execPromise(
          `yt-dlp --get-title --no-playlist "${url}"`, { timeout: 15000 }
        );
        title = stdout.trim() || 'video';
      } catch (_) {}
      console.log('📥 Instagram video');
      await execPromise(
        `yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" --merge-output-format mp4 --no-playlist --retries 3 -o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );

    } else {
      await execPromise(
        `yt-dlp -f "best" --no-playlist -o "${outputPath}" "${url}"`, { timeout: 300000 }
      );
    }

    let actualPath = fs.existsSync(outputPath) ? outputPath : findFile(tmpDir, fileId);
    if (!actualPath) throw new Error('Yüklənmiş fayl tapılmadı');
    const stats = fs.statSync(actualPath);
    if (stats.size === 0) throw new Error('Yüklənmiş fayl boşdur');

    const actualExt = path.extname(actualPath).slice(1) || 'mp4';
    const finalPath = path.join(tmpDir, `out_${fileId}_final.${actualExt}`);
    fs.renameSync(actualPath, finalPath);

    const filename = `${makeSafeTitle(title)}.${actualExt}`;
    console.log(`✅ Video: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
    res.json({ success: true, fileId: `${fileId}_final`, filename, filesize: stats.size, title });

  } catch (err) {
    console.error(`❌ Video xətası: ${err.message}`);
    cleanupDir(tmpDir, fileId);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    deleteTempFile(tempYtCookieFile);
    if (tiktokCookiePath) { try { fs.unlinkSync(tiktokCookiePath); } catch (_) {} }
  }
});

app.get('/api/download/file/:fileId', (req, res) => {
  const { fileId } = req.params;
  for (const ext of ['mp4', 'm4a', 'mp3', 'webm', 'mkv']) {
    const filePath = path.join(tmpDir, `out_${fileId}.${ext}`);
    if (fs.existsSync(filePath)) {
      console.log(`📤 Video: ${path.basename(filePath)}`);
      return res.download(filePath, () => { try { fs.unlinkSync(filePath); } catch (_) {} });
    }
  }
  res.status(404).json({ error: 'Fayl tapılmadı' });
});

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIO DOWNLOAD — /api/audio/*
// ═══════════════════════════════════════════════════════════════════════════════

app.post('/api/audio/start', async (req, res) => {
  const { url, cookieString } = req.body;
  if (!url) return res.status(400).json({ error: 'URL tələb olunur' });

  const fileId      = crypto.randomBytes(16).toString('hex');
  const isYoutube   = url.includes('youtube.com') || url.includes('youtu.be');
  const isTikTok    = url.includes('tiktok.com');
  const isInstagram = url.includes('instagram.com');

  console.log(`🎵 Audio: ${url}`);

  if (isTikTok) {
    const resolvedForCheck = await resolveTikTokUrl(url);
    if (isTikTokPhotoUrl(resolvedForCheck)) {
      return res.status(422).json({ success: false, error: 'Bu TikTok foto paylaşımıdır.' });
    }
  }

  const outputPath = path.join(audioDir, `out_${fileId}.m4a`);
  let title = 'audio';

  // Cookie yalnız title əldə etmə üçün saxlanılır (youtubei.js cookie istifadə etmir)
  const tempCookieFile = isYoutube ? createTempCookieFile(cookieString, fileId) : null;
  const ytCookieArg    = tempCookieFile ? `--cookies "${tempCookieFile}"` : getStaticCookieArg();

  try {
    if (isYoutube) {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // FIX: yt-dlp "Signature solving failed" verir çünki Render-də JS runtime yoxdur
      // Həll: youtubei.js — saf Node.js internal API, runtime tələb etmir
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const videoId = extractVideoId(url);
      if (!videoId) throw new Error('YouTube video ID tapılmadı');

      console.log(`🎵 YouTube audio → youtubei.js | videoId: ${videoId} | cookie: ${cookieString ? 'var' : 'yox'}`);

      const yt   = await getYouTubeClient(cookieString);
      const info = await yt.getBasicInfo(videoId);
      title = info.basic_info?.title || 'audio';
      console.log(`📄 Başlıq: ${title}`);

      const stream = await yt.download(videoId, {
        type: 'audio',
        quality: 'best',
        format: 'any',
        client: 'ANDROID',
      });

      const writeStream = fs.createWriteStream(outputPath);
      for await (const chunk of stream) {
        writeStream.write(chunk);
      }
      await new Promise((resolve, reject) => {
        writeStream.end();
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      console.log('✅ youtubei.js stream tamamlandı');

    } else if (isTikTok) {
      const tkArgs      = '--extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com"';
      const resolvedUrl = await resolveTikTokUrl(url);
      try {
        const { stdout } = await execPromise(
          `yt-dlp --get-title --no-playlist ${tkArgs} "${resolvedUrl}"`, { timeout: 15000 }
        );
        title = stdout.trim() || 'audio';
      } catch (_) {}
      console.log('🎵 TikTok audio → m4a');
      await execPromise(
        `yt-dlp -f "bestaudio[ext=m4a]/bestaudio[acodec=aac]/bestaudio/best" `
        + `${tkArgs} --no-playlist --retries 3 -o "${outputPath}" "${resolvedUrl}"`,
        { timeout: 300000 }
      );

    } else if (isInstagram) {
      try {
        const { stdout } = await execPromise(
          `yt-dlp --get-title --no-playlist "${url}"`, { timeout: 15000 }
        );
        title = stdout.trim() || 'audio';
      } catch (_) {}
      console.log('🎵 Instagram audio → m4a');
      await execPromise(
        `yt-dlp -f "bestaudio[ext=m4a]/bestaudio[acodec=aac]/bestaudio/best" `
        + `--no-playlist --retries 3 -o "${outputPath}" "${url}"`,
        { timeout: 300000 }
      );

    } else {
      try {
        const { stdout } = await execPromise(
          `yt-dlp --get-title --no-playlist "${url}"`, { timeout: 15000 }
        );
        title = stdout.trim() || 'audio';
      } catch (_) {}
      console.log('🎵 Generic audio → m4a');
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

    const actualExt = path.extname(actualPath).slice(1) || 'm4a';
    const finalPath = path.join(audioDir, `out_${fileId}_final.${actualExt}`);
    fs.renameSync(actualPath, finalPath);

    const filename = `${makeSafeTitle(title)}.${actualExt}`;
    console.log(`✅ Audio: ${(stats.size / 1024 / 1024).toFixed(1)} MB → ${filename}`);
    res.json({ success: true, fileId: `${fileId}_final`, filename, filesize: stats.size, title });

  } catch (err) {
    console.error(`❌ Audio xətası: ${err.message}`);
    cleanupDir(audioDir, fileId);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    deleteTempFile(tempCookieFile);
  }
});

app.get('/api/audio/file/:fileId', (req, res) => {
  const { fileId } = req.params;
  for (const ext of ['m4a', 'mp3', 'aac', 'opus', 'webm']) {
    const filePath = path.join(audioDir, `out_${fileId}.${ext}`);
    if (fs.existsSync(filePath)) {
      console.log(`📤 Audio: ${path.basename(filePath)}`);
      return res.download(filePath, () => { try { fs.unlinkSync(filePath); } catch (_) {} });
    }
  }
  res.status(404).json({ error: 'Audio fayl tapılmadı' });
});

// ─── Root ─────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ message: 'Video Downloader API işləyir!' }));

app.listen(PORT, () => console.log(`🚀 Server ${PORT} portunda işləyir`));
