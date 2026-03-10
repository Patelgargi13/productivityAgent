const os = require('os');
const path = require('path');

/**
 * AI Work Pattern Analyzer
 * Runs every 30 minutes, studies screen time + task completion patterns,
 * learns peak productivity hours, focus streaks, best/worst days.
 * Stores insights in DB and sends them to renderer.
 */
class WorkPatternAgent {
  constructor(db, mainWindow) {
    this.db = db;
    this.mainWindow = mainWindow;
    this.interval = null;
    this.ANALYZE_INTERVAL = 30 * 60 * 1000; // every 30 min
    this._sessionStart = Date.now();
    this._lastActivity = Date.now();
    this._activityBuffer = []; // {hour, appName, category, ts}
  }

  start() {
    console.log('[WorkPattern] Agent started');
    this.interval = setInterval(() => this.analyze(), this.ANALYZE_INTERVAL);
    // Also analyze on startup after 5s delay (data may already exist)
    setTimeout(() => this.analyze(), 5000);
  }

  stop() { if (this.interval) clearInterval(this.interval); }
  setMainWindow(win) { this.mainWindow = win; }
  addListener(fn) { if (!this._listeners) this._listeners = []; this._listeners.push(fn); }
  notify(data) { (this._listeners||[]).forEach(fn => fn(data)); }

  // Called by screenTimeAgent on each poll so we get real-time data
  recordActivity(appName, category) {
    const hour = new Date().getHours();
    this._lastActivity = Date.now();
    this._activityBuffer.push({ hour, appName, category: category || 'Other', ts: Date.now() });
    // Keep buffer to last 2 hours worth
    if (this._activityBuffer.length > 1440) this._activityBuffer = this._activityBuffer.slice(-720);
  }

  analyze() {
    try {
      const insights = this._buildInsights();
      if (!insights) return;
      this.db.saveWorkPatternInsights(insights);
      this.notify(insights);
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('work-pattern-update', insights);
      }
      console.log('[WorkPattern] Analysis complete —', insights.summary);
    } catch(e) {
      console.error('[WorkPattern] Error:', e.message);
    }
  }

  _buildInsights() {
    const today = new Date().toISOString().split('T')[0];
    const screenData = this.db.getScreenTimeByDate(today);
    const tasks = this.db.getTasks ? this.db.getTasks() : [];
    const history = this.db.getWorkPatternHistory ? this.db.getWorkPatternHistory(7) : [];

    if (!screenData.length) return null;

    const totalSeconds = screenData.reduce((s, r) => s + r.duration_seconds, 0);
    const now = new Date();
    const hour = now.getHours();

    // ── Peak hour detection ─────────────────────────────────────
    // Use buffer activity by hour
    const hourMap = {};
    this._activityBuffer.forEach(a => {
      hourMap[a.hour] = (hourMap[a.hour] || 0) + 1;
    });
    const peakHour = Object.entries(hourMap).sort((a,b) => b[1]-a[1])[0];
    const peakHourLabel = peakHour ? this._formatHour(parseInt(peakHour[0])) : null;

    // ── Productive vs distracted ratio today ────────────────────
    const productiveApps = ['VS Code', 'Visual Studio', 'Figma', 'Notion', 'Word', 'Excel', 'Chrome', 'Edge'];
    const distractingApps = ['YouTube', 'Instagram', 'Facebook', 'Twitter', 'Netflix', 'Spotify', 'Discord'];
    let productiveSecs = 0, distractingSecs = 0;
    screenData.forEach(r => {
      if (productiveApps.some(a => r.app_name.includes(a))) productiveSecs += r.duration_seconds;
      else if (distractingApps.some(a => r.app_name.includes(a))) distractingSecs += r.duration_seconds;
    });
    const focusScore = totalSeconds > 0 ? Math.round((productiveSecs / totalSeconds) * 100) : 0;

    // ── Focus streak (consecutive focused hours) ─────────────────
    let focusStreak = 0;
    for (let h = hour; h >= Math.max(0, hour - 8); h--) {
      const activity = this._activityBuffer.filter(a => a.hour === h);
      const distracting = activity.filter(a =>
        ['Entertainment', 'Social'].includes(a.category)
      ).length;
      const total = activity.length;
      if (total === 0) break;
      if (distracting / total < 0.3) focusStreak++;
      else break;
    }

    // ── Task completion rate ─────────────────────────────────────
    const completedToday = tasks.filter(t =>
      t.status === 'completed' && t.completed_at && t.completed_at.startsWith(today)
    ).length;
    const pendingCount = tasks.filter(t => t.status !== 'completed').length;

    // ── Best time recommendation ─────────────────────────────────
    let recommendation = null;
    if (hour >= 14 && hour <= 16 && focusScore < 50) {
      recommendation = 'Your afternoon focus tends to dip — try a 5-min break then tackle your hardest task.';
    } else if (hour >= 9 && hour <= 11 && focusScore > 60) {
      recommendation = 'You\'re in peak morning focus! Great time for deep work.';
    } else if (focusStreak >= 3) {
      recommendation = `Impressive! You've been focused for ${focusStreak} hours straight. Consider a short break soon.`;
    } else if (pendingCount > 5) {
      recommendation = `You have ${pendingCount} pending tasks. Consider prioritizing your top 3 for today.`;
    }

    // ── Weekly pattern (from history) ────────────────────────────
    const dayScores = {};
    history.forEach(h => {
      if (h.focus_score !== undefined) dayScores[h.date] = h.focus_score;
    });
    const bestDay = Object.entries(dayScores).sort((a,b) => b[1]-a[1])[0];

    const summary = `Focus: ${focusScore}% | Streak: ${focusStreak}h | Tasks done: ${completedToday}`;

    return {
      date: today,
      analyzed_at: now.toISOString(),
      focus_score: focusScore,
      focus_streak_hours: focusStreak,
      peak_hour: peakHourLabel,
      productive_seconds: productiveSecs,
      distracting_seconds: distractingSecs,
      total_seconds: totalSeconds,
      tasks_completed_today: completedToday,
      tasks_pending: pendingCount,
      recommendation,
      best_day: bestDay ? bestDay[0] : null,
      summary
    };
  }

  _formatHour(h) {
    if (h === 0) return '12 AM';
    if (h < 12) return `${h} AM`;
    if (h === 12) return '12 PM';
    return `${h - 12} PM`;
  }
}

module.exports = WorkPatternAgent;