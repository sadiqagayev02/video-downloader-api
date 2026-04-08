const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const tmpDir = '/tmp/video-downloader';

app.use(cors());
app.use(express.json());

// TMP qovluğunu yarat
async function ensureTmpDir() {
    try {
        await fs.mkdir(tmpDir, { recursive: true });
        console.log(`✅ TMP qovluğu: ${tmpDir}`);
    } catch (err) {
        console.log(`⚠️ TMP qovluğu xətası: ${err.message}`);
    }
}
ensureTmpDir();

// HEALTH CHECK
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// INFO - REAL məlumat alma
app.post('/api/info', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL tələb olunur' });
    }

    console.log(`📡 Məlumat alınır: ${url}`);

    try {
        // Platformaya görə fərqli parametrlər
        let cmd = `yt-dlp --dump-json --no-playlist --socket-timeout 30 "${url}"`;
        
        if (url.includes('tiktok.com')) {
            cmd = `yt-dlp --dump-json --no-playlist --extractor-args "tiktok:api_hostname=api22-normal-c-useast2a.tiktokv.com" "${url}"`;
        } else if (url.includes('instagram.com')) {
            cmd = `yt-dlp --dump-json --no-playlist "${url}"`;
        } else if (url.includes('facebook.com') || url.includes('fb.watch')) {
            cmd = `yt-dlp --dump-json --no-playlist "${url}"`;
        }

        const { stdout } = await execPromise(cmd, { timeout: 60000 });
        const data = JSON.parse(stdout);

        // Keyfiyyətləri çıxar
        const qualities = [];
        
        if (data.formats && data.formats.length > 0) {
            // Video formatları
            const videos = data.formats.filter(f => f.vcodec !== 'none' && f.height);
            const uniqueHeights = [...new Set(videos.map(v => v.height).filter(h => h))].sort((a,b) => b - a);
            
            for (const height of uniqueHeights.slice(0, 4)) {
                const video = videos.find(v => v.height === height);
                if (video) {
                    qualities.push({
                        label: height >= 1080 ? '1080p HD' : `${height}p`,
                        value: `${height}p`,
                        formatId: video.format_id,
                        url: video.url,
                        filesize: video.filesize,
                        ext: 'mp4',
                        needsMerge: false
                    });
                }
            }
            
            // Audio
            const audio = data.formats.find(f => f.acodec !== 'none' && f.vcodec === 'none');
            if (audio) {
                qualities.push({
                    label: 'Yalnız səs',
                    value: 'audio',
                    formatId: audio.format_id,
                    url: audio.url,
                    filesize: audio.filesize,
                    ext: 'm4a',
                    needsMerge: false
                });
            }
        }

        const result = {
            success: true,
            data: {
                title: data.title,
                thumbnail: data.thumbnail,
                duration: data.duration ? `${Math.floor(data.duration / 60)}:${(data.duration % 60).toString().padStart(2, '0')}` : '00:00',
                platform: url.includes('tiktok.com') ? 'tiktok' : (url.includes('instagram.com') ? 'instagram' : (url.includes('facebook.com') ? 'facebook' : 'youtube')),
                uploader: data.uploader || data.channel || 'Unknown',
                qualities: qualities
            }
        };
        
        console.log(`✅ Məlumat tapıldı: ${data.title}`);
        res.json(result);
        
    } catch (err) {
        console.error(`❌ Info xətası: ${err.message}`);
        res.status(500).json({ 
            success: false, 
            error: err.message.includes('Sign in') ? 'YouTube bu videonu blokladı' : err.message 
        });
    }
});

// DOWNLOAD START - REAL yükləmə
app.post('/api/download/start', async (req, res) => {
    const { url, quality } = req.body;
    
    if (!url || !quality) {
        return res.status(400).json({ error: 'URL və keyfiyyət tələb olunur' });
    }

    const fileId = crypto.randomBytes(16).toString('hex');
    console.log(`📥 Download: ${url}, keyfiyyət: ${quality}, ID: ${fileId}`);

    try {
        // Əvvəl info al
        const infoCmd = `yt-dlp --dump-json --no-playlist "${url}"`;
        const { stdout } = await execPromise(infoCmd, { timeout: 30000 });
        const data = JSON.parse(stdout);
        
        // Format ID-ni tap
        let formatId = quality;
        if (quality !== 'audio') {
            const video = data.formats.find(f => f.height === parseInt(quality) && f.vcodec !== 'none');
            if (video) formatId = video.format_id;
        } else {
            const audio = data.formats.find(f => f.acodec !== 'none' && f.vcodec === 'none');
            if (audio) formatId = audio.format_id;
        }
        
        const outputExt = quality === 'audio' ? 'm4a' : 'mp4';
        const outputPath = path.join(tmpDir, `out_${fileId}.${outputExt}`);
        
        // Videonu yüklə
        const downloadCmd = `yt-dlp -f ${formatId} -o "${outputPath}" "${url}"`;
        await execPromise(downloadCmd, { timeout: 300000 });
        
        const stats = await fs.stat(outputPath);
        
        console.log(`✅ Download tamam: ${outputPath} (${stats.size} bytes)`);
        
        res.json({
            success: true,
            fileId: fileId,
            filename: `${data.title.replace(/[^a-zA-Z0-9]/g, '_')}.${outputExt}`,
            filesize: stats.size
        });
        
    } catch (err) {
        console.error(`❌ Download xətası: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// DOWNLOAD FILE - Faylı yüklə
app.get('/api/download/file/:fileId', async (req, res) => {
    const { fileId } = req.params;
    const possibleExts = ['mp4', 'm4a'];
    let filePath = null;
    
    for (const ext of possibleExts) {
        const testPath = path.join(tmpDir, `out_${fileId}.${ext}`);
        try {
            await fs.access(testPath);
            filePath = testPath;
            break;
        } catch (err) {}
    }
    
    if (!filePath) {
        return res.status(404).json({ error: 'Fayl tapılmadı' });
    }
    
    res.download(filePath, async (err) => {
        if (err) console.error('Fayl göndərilərkən xəta:', err);
        try {
            await fs.unlink(filePath);
            console.log(`🗑️ Fayl silindi: ${filePath}`);
        } catch (cleanErr) {}
    });
});

// ANA SƏHİFƏ
app.get('/', (req, res) => {
    res.json({ 
        message: 'Video Downloader API işləyir!',
        endpoints: {
            health: 'GET /api/health',
            info: 'POST /api/info',
            downloadStart: 'POST /api/download/start',
            downloadFile: 'GET /api/download/file/:fileId'
        }
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Server ${PORT} portunda işləyir`);
    console.log(`📁 TMP: ${tmpDir}`);
});
