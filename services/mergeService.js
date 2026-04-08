// E) services/mergeService.js
const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);
const fs = require('fs').promises;

class MergeService {
  constructor() {
    this.ffmpegPath = 'ffmpeg';
  }

  async checkFfmpeg() {
    try {
      await execFilePromise(this.ffmpegPath, ['-version']);
      return true;
    } catch (err) {
      throw new Error('ffmpeg qurulmayıb: ' + err.message);
    }
  }

  async mergeVideoAudio(videoPath, audioPath, outputPath) {
    await this.checkFfmpeg();

    return new Promise((resolve, reject) => {
      const args = [
        '-i', videoPath,
        '-i', audioPath,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-y',
        outputPath
      ];

      console.log(`🎬 FFmpeg merge başladı: ${outputPath}`);
      
      const process = execFile(this.ffmpegPath, args, { timeout: 300000 }, (error, stdout, stderr) => {
        if (error) {
          console.error('❌ FFmpeg xətası:', stderr);
          reject(new Error(`FFmpeg merge uğursuz: ${stderr}`));
        } else {
          console.log(`✅ Merge tamamlandı: ${outputPath}`);
          resolve(outputPath);
        }
      });
    });
  }

  async cleanupFiles(...paths) {
    for (const path of paths) {
      try {
        await fs.unlink(path);
        console.log(`🗑️ Silindi: ${path}`);
      } catch (err) {
        console.log(`⚠️ Silinə bilmədi: ${path}`);
      }
    }
  }
}

module.exports = new MergeService();