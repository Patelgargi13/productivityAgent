/**
 * Daily Standup Agent
 * Stores standup entries (yesterday/today/blockers)
 * Triggers daily prompt at configurable time (default 9am)
 */
class StandupAgent {
  constructor(db, mainWindow) {
    this.db = db;
    this.mainWindow = mainWindow;
    this.interval = null;
    this._promptedToday = false;
    this._promptHour = 9; // 9am
  }

  start() {
    console.log('[Standup] Agent started');
    this.interval = setInterval(() => this.checkTime(), 60000);
    this.checkTime();
  }

  stop() { if (this.interval) clearInterval(this.interval); }

  setMainWindow(win) { this.mainWindow = win; }

  checkTime() {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const hour = now.getHours();

    // Only prompt once per day at the configured hour
    if (hour === this._promptHour && !this._promptedToday) {
      const alreadyDone = this.db.getStandupByDate(today);
      if (!alreadyDone) {
        this._promptedToday = true;
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('standup-prompt', { date: today });
        }
      }
    }

    // Reset daily flag at midnight
    if (hour === 0) this._promptedToday = false;
  }

  saveStandup(data) {
    return this.db.saveStandup(data);
  }

  getHistory(limit = 30) {
    return this.db.getStandupHistory(limit);
  }
}

module.exports = StandupAgent;