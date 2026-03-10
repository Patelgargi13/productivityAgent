const fs = require('fs');
const path = require('path');
const os = require('os');
const chokidar = require('chokidar');

/**
 * File Organizer Agent
 * Monitors the Downloads folder and auto-categorizes files
 * into Documents, Images, Videos, Audio, Code, Archives, Others
 */
class FileOrganizerAgent {
  constructor(db) {
    this.db = db;
    this.watcher = null;
    this.listeners = [];

    this.downloadsPath = path.join(os.homedir(), 'Downloads');
    this.organizedBasePath = path.join(os.homedir(), 'Organized');

    // File extension → category mapping
    this.categoryMap = {
      // Documents
      pdf: 'Documents', doc: 'Documents', docx: 'Documents',
      xls: 'Documents', xlsx: 'Documents', ppt: 'Documents', pptx: 'Documents',
      txt: 'Documents', md: 'Documents', csv: 'Documents', rtf: 'Documents',
      odt: 'Documents', ods: 'Documents', odp: 'Documents',

      // Images
      jpg: 'Images', jpeg: 'Images', png: 'Images', gif: 'Images',
      bmp: 'Images', svg: 'Images', webp: 'Images', ico: 'Images',
      tiff: 'Images', tif: 'Images', raw: 'Images', heic: 'Images',

      // Videos
      mp4: 'Videos', mkv: 'Videos', avi: 'Videos', mov: 'Videos',
      wmv: 'Videos', flv: 'Videos', webm: 'Videos', m4v: 'Videos',
      mpg: 'Videos', mpeg: 'Videos', '3gp': 'Videos',

      // Audio
      mp3: 'Audio', wav: 'Audio', flac: 'Audio', aac: 'Audio',
      ogg: 'Audio', wma: 'Audio', m4a: 'Audio', opus: 'Audio',

      // Code
      js: 'Code', ts: 'Code', py: 'Code', java: 'Code', cpp: 'Code',
      c: 'Code', h: 'Code', html: 'Code', css: 'Code', php: 'Code',
      rb: 'Code', go: 'Code', rs: 'Code', swift: 'Code', kt: 'Code',
      sh: 'Code', bash: 'Code', json: 'Code', xml: 'Code', yaml: 'Code',
      yml: 'Code', sql: 'Code', r: 'Code', ipynb: 'Code',

      // Archives
      zip: 'Archives', rar: 'Archives', '7z': 'Archives', tar: 'Archives',
      gz: 'Archives', bz2: 'Archives', xz: 'Archives', dmg: 'Archives',
      iso: 'Archives', pkg: 'Archives', deb: 'Archives', rpm: 'Archives',

      // Executables
      exe: 'Executables', msi: 'Executables', app: 'Executables',
      apk: 'Executables', bat: 'Executables',
    };

    // Debounce map to avoid processing partial downloads
    this.pendingFiles = new Map();
  }

  start() {
    if (!fs.existsSync(this.downloadsPath)) {
      console.warn('[FileOrganizer] Downloads folder not found:', this.downloadsPath);
      return;
    }

    // Ensure organized folders exist
    this.ensureOutputFolders();

    this.watcher = chokidar.watch(this.downloadsPath, {
      ignored: /(^|[/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,     // don't process existing files on startup
      awaitWriteFinish: {
        stabilityThreshold: 3000, // wait 3s after last write
        pollInterval: 500
      }
    });

    this.watcher.on('add', (filePath) => {
      setTimeout(() => this.organizeFile(filePath), 2000);
    });

    this.watcher.on('error', err => console.error('[FileOrganizer] Watcher error:', err));
    console.log('[FileOrganizer] Watching:', this.downloadsPath);
  }

  stop() {
    if (this.watcher) this.watcher.close();
    console.log('[FileOrganizer] Agent stopped');
  }

  addListener(fn) {
    this.listeners.push(fn);
  }

  ensureOutputFolders() {
    const categories = ['Documents', 'Images', 'Videos', 'Audio', 'Code', 'Archives', 'Executables', 'Others'];
    categories.forEach(cat => {
      const dir = path.join(this.organizedBasePath, cat);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  }

  organizeFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) return;

      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) return;

      const fileName = path.basename(filePath);
      const ext = path.extname(fileName).slice(1).toLowerCase();
      const category = this.categoryMap[ext] || 'Others';
      const destDir = path.join(this.organizedBasePath, category);

      // Handle filename conflicts
      let destPath = path.join(destDir, fileName);
      if (fs.existsSync(destPath)) {
        const base = path.basename(fileName, path.extname(fileName));
        const timestamp = Date.now();
        destPath = path.join(destDir, `${base}_${timestamp}${path.extname(fileName)}`);
      }

      fs.renameSync(filePath, destPath);

      const logEntry = {
        original_path: filePath,
        new_path: destPath,
        file_name: fileName,
        file_type: ext || 'unknown',
        category,
        size_bytes: stat.size
      };

      this.db.logFileMove(logEntry);
      this.listeners.forEach(fn => fn(logEntry));

      console.log(`[FileOrganizer] Moved "${fileName}" → ${category}`);
    } catch (err) {
      console.error('[FileOrganizer] Error organizing file:', filePath, err.message);
    }
  }

  // Manual scan of downloads folder
  scanNow() {
    if (!fs.existsSync(this.downloadsPath)) return { scanned: 0, organized: 0 };
    this.ensureOutputFolders();

    const files = fs.readdirSync(this.downloadsPath).filter(f => {
      const fullPath = path.join(this.downloadsPath, f);
      return fs.statSync(fullPath).isFile();
    });

    let organized = 0;
    files.forEach(f => {
      this.organizeFile(path.join(this.downloadsPath, f));
      organized++;
    });

    return { scanned: files.length, organized };
  }
}

module.exports = FileOrganizerAgent;
