const express = require('express');
const cors = require('cors');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// HEALTH CHECK ROUTE
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// INFO ROUTE
app.post('/api/info', async (req, res) => {
    const { url } = req.body;
    
    if (!url) {
        return res.status(400).json({ error: 'URL tələb olunur' });
    }

    // Test cavabı
    res.json({
        success: true,
        data: {
            title: 'Test Video',
            thumbnail: 'https://example.com/thumb.jpg',
            duration: '1:23',
            platform: 'youtube',
            uploader: 'Test User',
            qualities: [
                { label: '720p', value: '720p', ext: 'mp4', needsMerge: false, filesize: 5000000 },
                { label: '360p', value: '360p', ext: 'mp4', needsMerge: false, filesize: 2500000 },
                { label: 'Yalnız səs', value: 'audio', ext: 'm4a', needsMerge: false, filesize: 1000000 }
            ]
        }
    });
});

// DOWNLOAD START ROUTE
app.post('/api/download/start', async (req, res) => {
    const { url, quality } = req.body;
    
    if (!url || !quality) {
        return res.status(400).json({ error: 'URL və keyfiyyət tələb olunur' });
    }

    res.json({
        success: true,
        fileId: 'test-file-id-123',
        filename: 'video.mp4',
        filesize: 5000000
    });
});

// DOWNLOAD FILE ROUTE
app.get('/api/download/file/:fileId', (req, res) => {
    const { fileId } = req.params;
    
    // Test üçün sadəcə mesaj qaytar
    res.json({ 
        message: 'Bu test endpointidir. Real fayl yükləmək üçün Flutter tətbiqindən istifadə edin.',
        fileId: fileId 
    });
});

// ANA SƏHİFƏ (test üçün)
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
});
