const { exec } = require('child_process');
const os = require('os');

class ScreenTimeAgent {
  constructor(db) {
    this.db = db;
    this.interval = null;
    this.pollInterval = 5000;
    this.listeners = [];
    this.platform = os.platform();
    this._lastGood = null;
    this._cache = null;
    this._cacheTime = 0;
  }

  start() {
    console.log('[ScreenTime] Agent started on', this.platform);
    this.interval = setInterval(() => this.poll(), this.pollInterval);
    this.poll();
  }

  stop() { if (this.interval) clearInterval(this.interval); }
  addListener(fn) { this.listeners.push(fn); }
  notify(data) { this.listeners.forEach(fn => fn(data)); }

  poll() {
    this.getActiveWindow((err, info) => {
      if (err || !info) {
        if (this._lastGood) info = this._lastGood;
        else return;
      }
      let { appName, windowTitle } = info;
      appName = this.cleanAppName(appName, windowTitle);
      if (!appName || appName.toLowerCase() === 'unknown') return;

      this._lastGood = { appName, windowTitle };
      const date = new Date().toISOString().split('T')[0];
      this.db.upsertScreenTime(appName, windowTitle, date, Math.floor(this.pollInterval / 1000));
      this.currentApp = appName;
      this.notify({ appName, windowTitle, date });
    });
  }

  // Map raw process names → friendly display names
  cleanAppName(processName, windowTitle) {
    if (!processName) return this.guessFromTitle(windowTitle);
    
    const name = processName.trim().replace(/\.exe$/i, '').toLowerCase();

    const friendlyNames = {
      // Browsers
      'chrome': 'Google Chrome',
      'msedge': 'Microsoft Edge',
      'firefox': 'Firefox',
      'opera': 'Opera',
      'brave': 'Brave Browser',
      'iexplore': 'Internet Explorer',

      // Editors / Dev
      'code': 'VS Code',
      'devenv': 'Visual Studio',
      'idea64': 'IntelliJ IDEA',
      'pycharm64': 'PyCharm',
      'webstorm64': 'WebStorm',
      'rider64': 'JetBrains Rider',
      'clion64': 'CLion',
      'datagrip64': 'DataGrip',
      'notepad++': 'Notepad++',
      'notepad': 'Notepad',
      'sublime_text': 'Sublime Text',
      'atom': 'Atom',

      // Communication
      'slack': 'Slack',
      'teams': 'Microsoft Teams',
      'zoom': 'Zoom',
      'discord': 'Discord',
      'telegram': 'Telegram',
      'whatsapp': 'WhatsApp',
      'skype': 'Skype',
      'outlook': 'Outlook',
      'thunderbird': 'Thunderbird',

      // Office
      'winword': 'Microsoft Word',
      'excel': 'Microsoft Excel',
      'powerpnt': 'PowerPoint',
      'onenote': 'OneNote',
      'mspub': 'Publisher',
      'acrobat': 'Adobe Acrobat',
      'acrord32': 'Adobe Reader',
      'soffice': 'LibreOffice',

      // System
      'explorer': 'File Explorer',
      'taskmgr': 'Task Manager',
      'cmd': 'Command Prompt',
      'powershell': 'PowerShell',
      'windowsterminal': 'Windows Terminal',
      'mmc': 'Management Console',
      'regedit': 'Registry Editor',
      'control': 'Control Panel',
      'mspaint': 'Paint',
      'snippingtool': 'Snipping Tool',
      'calc': 'Calculator',
      'wordpad': 'WordPad',

      // Media
      'vlc': 'VLC',
      'spotify': 'Spotify',
      'wmplayer': 'Windows Media Player',
      'mpv': 'MPV Player',
      'audacity': 'Audacity',

      // Design
      'photoshop': 'Photoshop',
      'illustrator': 'Illustrator',
      'figma': 'Figma',
      'xd': 'Adobe XD',
      'gimp': 'GIMP',
      'inkscape': 'Inkscape',

      // Other dev tools
      'postman': 'Postman',
      'insomnia': 'Insomnia',
      'docker': 'Docker Desktop',
      'filezilla': 'FileZilla',
      'putty': 'PuTTY',
      'winscp': 'WinSCP',
      'git': 'Git',
      'sourcetree': 'Sourcetree',
      'githubdesktop': 'GitHub Desktop',

      // This app itself
      'electron': 'FlowAgent',
      'ai-productivity-agent': 'FlowAgent',
    };

    if (friendlyNames[name]) return friendlyNames[name];

    // If still unknown, try to extract from window title
    if (name === 'unknown' || name === '' || name === 'applicationframehost') {
      return this.guessFromTitle(windowTitle);
    }

    // Capitalize and return as-is
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  guessFromTitle(title) {
    if (!title || title.trim() === '') return null;
    // Extract app name from window title patterns like "Document - App Name"
    const parts = title.split(/[-–|]/);
    const last = parts[parts.length - 1].trim();
    const first = parts[0].trim();
    // If last part looks like an app name (short, no spaces or few words)
    if (last.length > 0 && last.length < 30 && last !== title) return last;
    if (first.length > 0 && first.length < 40) return first;
    return title.slice(0, 30);
  }

  getActiveWindow(callback) {
    if (this.platform === 'win32') this.getWindowsActiveWindow(callback);
    else if (this.platform === 'darwin') this.getMacActiveWindow(callback);
    else this.getLinuxActiveWindow(callback);
  }

  getWindowsActiveWindow(callback) {
    // Primary method: Get foreground window process + title
    const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WU {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int c);
}
'@ -ErrorAction SilentlyContinue
$h = [WU]::GetForegroundWindow()
$pid2 = 0
[WU]::GetWindowThreadProcessId($h, [ref]$pid2) | Out-Null
$sb = New-Object System.Text.StringBuilder(256)
[WU]::GetWindowText($h, $sb, 256) | Out-Null
$title = $sb.ToString()
$proc = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
$pname = if ($proc) { $proc.ProcessName } else { 'unknown' }
Write-Output "$pname|||$title"
`.trim();

    exec(`powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
      { timeout: 4500, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout || !stdout.trim()) {
          return this.getWindowsFallback(callback);
        }
        const parts = stdout.trim().split('|||');
        const procName = (parts[0] || '').trim();
        const title = (parts[1] || '').trim();
        if (!procName || procName === 'unknown') {
          return this.getWindowsFallback(callback);
        }
        callback(null, { appName: procName, windowTitle: title });
      }
    );
  }

  getWindowsFallback(callback) {
    // Fallback: find process with focused window via MainWindowTitle
    exec(
      `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "` +
      `Get-Process | Where-Object {$_.MainWindowTitle -ne '' -and $_.MainWindowTitle -ne $null} | ` +
      `Sort-Object -Property CPU -Descending | Select-Object -First 1 | ` +
      `ForEach-Object { Write-Output ($_.ProcessName + '|||' + $_.MainWindowTitle) }"`,
      { timeout: 4000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout || !stdout.trim()) {
          callback(null, { appName: 'Windows', windowTitle: 'Desktop' });
          return;
        }
        const parts = stdout.trim().split('|||');
        callback(null, {
          appName: (parts[0] || 'Windows').trim(),
          windowTitle: (parts[1] || '').trim()
        });
      }
    );
  }

  getMacActiveWindow(callback) {
    exec(`osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true' 2>/dev/null`,
      { timeout: 3000 },
      (err, stdout) => {
        if (err) return callback(err);
        callback(null, { appName: stdout.trim() || 'Unknown', windowTitle: '' });
      }
    );
  }

  getLinuxActiveWindow(callback) {
    exec('xdotool getactivewindow getwindowname 2>/dev/null', { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout.trim()) return callback(null, { appName: 'Linux', windowTitle: '' });
      const title = stdout.trim();
      exec('xdotool getactivewindow getwindowpid 2>/dev/null', { timeout: 2000 }, (e2, pidOut) => {
        if (e2 || !pidOut.trim()) return callback(null, { appName: title, windowTitle: title });
        exec(`ps -p ${pidOut.trim()} -o comm= 2>/dev/null`, { timeout: 2000 }, (e3, appOut) => {
          callback(null, { appName: appOut ? appOut.trim() : title, windowTitle: title });
        });
      });
    });
  }
}

module.exports = ScreenTimeAgent;
