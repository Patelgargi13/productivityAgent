const { Notification } = require('electron');

/**
 * AI Distraction Detector
 * Monitors screen time data in real time.
 * Triggers alerts when user spends too long on distracting apps/sites.
 * Escalating warnings: gentle → firm → urgent
 */
class DistractionDetectorAgent {
  constructor(db, mainWindow) {
    this.db = db;
    this.mainWindow = mainWindow;
    this.interval = null;
    this.CHECK_INTERVAL = 60 * 1000; // check every minute

    // Thresholds in minutes before alerting
    this.THRESHOLDS = {
      gentle: 10,   // 10 min → gentle nudge
      firm:   20,   // 20 min → firm reminder
      urgent: 35,   // 35 min → urgent alert
    };

    // Track consecutive distracted minutes per session
    this._distractedMinutes = 0;
    this._lastAlertLevel = null;
    this._lastAlertTime = 0;
    this._focusMode = false;
    this._listeners = [];
  }

  start() {
    console.log('[DistractionDetector] Agent started');
    this.interval = setInterval(() => this.check(), this.CHECK_INTERVAL);
  }

  stop() { if (this.interval) clearInterval(this.interval); }
  setMainWindow(win) { this.mainWindow = win; }
  addListener(fn) { this._listeners.push(fn); }
  notify(data) { this._listeners.forEach(fn => fn(data)); }

  enableFocusMode(durationMinutes = 25) {
    this._focusMode = true;
    this._focusModeEnd = Date.now() + durationMinutes * 60000;
    console.log(`[DistractionDetector] Focus mode ON for ${durationMinutes} min`);
    setTimeout(() => {
      this._focusMode = false;
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('focus-mode-ended', {});
      }
    }, durationMinutes * 60000);
  }

  disableFocusMode() { this._focusMode = false; }

  isDistracting(appName) {
    if (!appName) return false;
    const name = appName.toLowerCase();
    return [
      'youtube', 'netflix', 'twitch', 'hulu', 'prime video', 'disney',
      'facebook', 'instagram', 'twitter', 'tiktok', 'snapchat', 'reddit',
      'whatsapp', 'telegram', 'discord', 'spotify',
      '9gag', 'buzzfeed', 'entertainment', 'gaming',
    ].some(d => name.includes(d));
  }

  check() {
    try {
      const today = new Date().toISOString().split('T')[0];
      const screenData = this.db.getScreenTimeByDate(today);

      // Sum distraction time in last 60 minutes
      const now = Date.now();
      const distractingApps = screenData.filter(r => this.isDistracting(r.app_name));
      const distractingSecs = distractingApps.reduce((s, r) => s + r.duration_seconds, 0);
      this._distractedMinutes = Math.floor(distractingSecs / 60);

      const timeSinceLastAlert = now - this._lastAlertTime;
      const cooldown = 10 * 60 * 1000; // 10 min cooldown between alerts

      if (timeSinceLastAlert < cooldown) return;

      let alertLevel = null;
      let message = null;
      const topDistraction = distractingApps[0];

      if (this._distractedMinutes >= this.THRESHOLDS.urgent && this._lastAlertLevel !== 'urgent') {
        alertLevel = 'urgent';
        message = {
          title: '🚨 Focus Alert — You\'ve been distracted for ' + this._distractedMinutes + ' min!',
          body: topDistraction
            ? `Mostly on ${topDistraction.app_name}. Your pending tasks are waiting. Close distractions now?`
            : 'Time to refocus. Your tasks are waiting!',
          level: 'urgent',
          minutes: this._distractedMinutes
        };
      } else if (this._distractedMinutes >= this.THRESHOLDS.firm && !['firm','urgent'].includes(this._lastAlertLevel)) {
        alertLevel = 'firm';
        message = {
          title: '⚠ Hey! ' + this._distractedMinutes + ' min on distractions',
          body: topDistraction
            ? `You\'ve spent ${this._distractedMinutes} min on ${topDistraction.app_name}. Want to switch to your tasks?`
            : 'Consider switching back to productive work.',
          level: 'firm',
          minutes: this._distractedMinutes
        };
      } else if (this._distractedMinutes >= this.THRESHOLDS.gentle && !this._lastAlertLevel) {
        alertLevel = 'gentle';
        message = {
          title: '💡 Quick check-in',
          body: topDistraction
            ? `${this._distractedMinutes} min on ${topDistraction.app_name} — just a gentle reminder of your tasks!`
            : 'You\'ve been away from productive work for a bit.',
          level: 'gentle',
          minutes: this._distractedMinutes
        };
      }

      if (alertLevel && message) {
        this._lastAlertLevel = alertLevel;
        this._lastAlertTime = now;
        this._sendAlert(message);

        // Reset alert level if user gets back to work
        setTimeout(() => {
          const newData = this.db.getScreenTimeByDate(today);
          const newDistracting = newData.filter(r => this.isDistracting(r.app_name))
                                        .reduce((s,r) => s + r.duration_seconds, 0) / 60;
          if (newDistracting < this._distractedMinutes + 2) {
            // User didn't keep browsing — reset
            this._lastAlertLevel = null;
          }
        }, 5 * 60 * 1000);
      }

      // If focus mode is active and user is distracted → immediate alert
      if (this._focusMode && this._distractedMinutes > 0 && timeSinceLastAlert > 2 * 60 * 1000) {
        this._lastAlertTime = now;
        this._sendAlert({
          title: '🎯 Focus Mode Active!',
          body: `You opened ${topDistraction?.app_name || 'a distraction'}. Stay focused — you can do it!`,
          level: 'focus-mode',
          minutes: this._distractedMinutes
        });
      }

    } catch(e) {
      console.error('[DistractionDetector] Error:', e.message);
    }
  }

  _sendAlert(message) {
    // Desktop notification
    if (Notification.isSupported()) {
      const n = new Notification({
        title: message.title,
        body: message.body,
        urgency: message.level === 'urgent' ? 'critical' : 'normal',
      });
      n.on('click', () => {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.focus();
          this.mainWindow.webContents.send('navigate-to', { tab: 'tasks' });
        }
      });
      n.show();
    }

    // In-app notification
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('distraction-alert', message);
    }

    this.notify(message);
    console.log(`[DistractionDetector] Alert (${message.level}): ${this._distractedMinutes} min distracted`);
  }

  getStats() {
    return {
      distractedMinutes: this._distractedMinutes,
      focusMode: this._focusMode,
      lastAlertLevel: this._lastAlertLevel,
    };
  }
}

module.exports = DistractionDetectorAgent;