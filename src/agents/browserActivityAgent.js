const { exec } = require('child_process');
const os = require('os');

/**
 * Browser Activity Agent
 * Reads active window title to detect website/app category
 * Categorizes as: Productive / Communication / Social / Entertainment / System
 */
class BrowserActivityAgent {
  constructor(db) {
    this.db = db;
    this.interval = null;
    this.POLL_MS = 10000; // every 10s
    this.platform = os.platform();
    this.listeners = [];
  }

  start() {
    console.log('[BrowserActivity] Agent started');
    this.interval = setInterval(() => this.poll(), this.POLL_MS);
  }

  stop() { if (this.interval) clearInterval(this.interval); }
  addListener(fn) { this.listeners.push(fn); }
  notify(data) { this.listeners.forEach(fn => fn(data)); }

  poll() {
    this.getActiveTitle((title) => {
      if (!title) return;
      const category = this.categorize(title);
      const site = this.extractSite(title);
      const date = new Date().toISOString().split('T')[0];
      this.db.saveBrowserActivity({ site, title, category, date, seconds: Math.floor(this.POLL_MS / 1000) });
      this.notify({ site, title, category, date });
    });
  }

  getActiveTitle(callback) {
    if (this.platform === 'win32') {
      exec(
        `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "` +
        `$p = Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Sort-Object CPU -Desc | Select -First 1;` +
        `if($p){Write-Output $p.MainWindowTitle}"`,
        { timeout: 3000, windowsHide: true },
        (err, out) => callback(err ? null : out.trim())
      );
    } else if (this.platform === 'darwin') {
      exec(`osascript -e 'tell application "System Events" to get name of first window of (first application process whose frontmost is true)' 2>/dev/null`,
        { timeout: 3000 }, (err, out) => callback(err ? null : out.trim()));
    } else {
      exec('xdotool getactivewindow getwindowname 2>/dev/null',
        { timeout: 3000 }, (err, out) => callback(err ? null : out.trim()));
    }
  }

  extractSite(title) {
    // Extract domain from browser titles like "Google - Chrome" or "YouTube - Firefox"
    const browserSuffixes = [' - Google Chrome', ' - Microsoft Edge', ' - Firefox', ' - Safari', ' | Mozilla Firefox'];
    for (const s of browserSuffixes) {
      if (title.includes(s)) {
        const pagePart = title.replace(s, '').trim();
        // Try to find domain pattern
        const domainMatch = pagePart.match(/([a-zA-Z0-9-]+\.[a-zA-Z]{2,})/);
        if (domainMatch) return domainMatch[1];
        return pagePart.slice(0, 40);
      }
    }
    return title.slice(0, 40);
  }

  categorize(title) {
    const t = title.toLowerCase();
    if (/youtube|netflix|twitch|spotify|hulu|disney|prime video|tiktok/.test(t)) return 'Entertainment';
    if (/facebook|instagram|twitter|reddit|linkedin|snapchat/.test(t)) return 'Social';
    if (/gmail|outlook|slack|teams|discord|whatsapp|zoom|meet/.test(t)) return 'Communication';
    if (/github|stackoverflow|vs code|visual studio|figma|jira|notion|docs|drive|excel|word|powerpoint/.test(t)) return 'Productive';
    if (/news|bbc|cnn|times|guardian|medium|substack/.test(t)) return 'Reading';
    if (/settings|control panel|task manager|explorer|finder/.test(t)) return 'System';
    return 'Other';
  }
}

module.exports = BrowserActivityAgent;