const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const path = require('path');

class InstagramServiceV3 {
  constructor() {
    this.pythonScript = path.join(__dirname, 'instagram_python.py');
  }

  async getInfo(url) {
    console.log('📸 Instagram Python servis:', url);
    
    try {
      // URL-i təhlükəsiz şəkildə Python-a ötür
      const safeUrl = url.replace(/"/g, '\\"');
      
      // Python skriptini çağır
      const cmd = `python3 "${this.pythonScript}" "${safeUrl}"`;
      console.log('📸 Python çağırılır...');
      
      const { stdout, stderr } = await execPromise(cmd, {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024
      });
      
      if (stderr) {
        console.log('⚠️ Python stderr:', stderr.substring(0, 200));
      }
      
      const result = JSON.parse(stdout);
      
      if (result.error) {
        throw new Error(result.error);
      }
      
      if (result.success && result.data) {
        console.log('✅ Python uğurlu!');
        return result.data;
      }
      
      throw new Error('Python boş nəticə');
    } catch (err) {
      console.error('❌ Python xətası:', err.message);
      throw err;
    }
  }
}

module.exports = new InstagramServiceV3();
