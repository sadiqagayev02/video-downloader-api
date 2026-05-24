// services/mergeService.js
const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);
const fs = require('fs').promises;

class MergeService {
  constructor() {
    this.ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';
  }

  async checkFfmpeg() {
    try {
      await execFilePromise(this.ffmpegPath, ['-version'], { timeout: 10000 });
      return true;
    } catch (err) {
      console.error('FFmpeg tapılmadı:', err.message);
      return false;
    }
  }

  async mergeVideoAudio(videoPath, audioPath, outputPath) {
    const ffmpegExists = await this.checkFfmpeg();
    if (!ffmpegExists) {
      throw new Error('FFmpeg qurulmayıb. Render-də ffmpeg quraşdırın.');
    }

    return new Promise((resolve, reject) => {
      const args = [
        '-i', videoPath,
        '-i', audioPath,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart',
        '-y',
        outputPath
      ];

      console.log(`🎬 FFmpeg merge başladı: ${outputPath}`);
      console.log(`   Video: ${videoPath}`);
      console.log(`   Audio: ${audioPath}`);
      
      const process = execFile(this.ffmpegPath, args, { 
        timeout: 300000,
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      }, (error, stdout, stderr) => {
        if (error) {
          console.error('❌ FFmpeg xətası:', stderr);
          reject(new Error(`FFmpeg merge uğursuz: ${stderr || error.message}`));
        } else {
          console.log(`✅ Merge tamamlandı: ${outputPath}`);
          resolve(outputPath);
        }
      });

      // Progress üçün stderr dinlə (isteğe bağlı)
      if (process.stderr) {
        process.stderr.on('data', (data) => {
          const msg = data.toString();
          if (msg.includes('time=')) {
            // FFmpeg progress mesajı
            const timeMatch = msg.match(/time=(\d{2}:\d{2}:\d{2})/);
            if (timeMatch) {
              console.log(`   Progress: ${timeMatch[1]}`);
            }
          }
        });
      }
    });
  }

  async cleanupFiles(...paths) {
    for (const filePath of paths) {
      try {
        await fs.access(filePath);
        await fs.unlink(filePath);
        console.log(`🗑️ Silindi: ${filePath}`);
      } catch (err) {
        // Fayl yoxdursa problem deyil
        if (err.code !== 'ENOENT') {
          console.log(`⚠️ Silinə bilmədi: ${filePath} - ${err.message}`);
        }
      }
    }
  }

  // Toplu təmizləmə
  async cleanupTempFiles(directory, pattern) {
    try {
      const files = await fs.readdir(directory);
      for (const file of files) {
        if (file.includes(pattern)) {
          const filePath = require('path').join(directory, file);
          try {
            await fs.unlink(filePath);
            console.log(`🗑️ Təmizləndi: ${file}`);
          } catch (err) {
            console.log(`⚠️ Silinə bilmədi: ${file}`);
          }
        }
      }
    } catch (err) {
      console.log(`⚠️ Qovluq oxuna bilmədi: ${directory}`);
    }
  }
}

module.exports = new MergeService();