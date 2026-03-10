// mindMapAgent.js — MindMap Daily Coach
// Place in: src/agents/mindMapAgent.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const { callAI } = require('./aiProvider');

const DATA_DIR   = path.join(os.homedir(), '.ai-productivity-agent');
const CACHE_FILE = path.join(DATA_DIR, 'mindmap-last-report.json');

class MindMapAgent {
  constructor(db) {
    this.db = db;
    this.lastReport = null;
    this.mainWindow = null;
    this.loadCache();
  }

  // ── Required by main.js ───────────────────────────────────────────
  start()            { console.log('[MindMap] Agent started'); }
  stop()             { console.log('[MindMap] Agent stopped'); }
  setMainWindow(win) { this.mainWindow = win; }

  // ── Cache ─────────────────────────────────────────────────────────
  loadCache() {
    try {
      if (fs.existsSync(CACHE_FILE))
        this.lastReport = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch (e) { this.lastReport = null; }
  }

  saveCache(report) {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(CACHE_FILE, JSON.stringify(report, null, 2));
    } catch (e) { console.warn('[MindMap] Cache save failed:', e.message); }
  }

  isTodaysCacheValid() {
    if (!this.lastReport?.generatedAt) return false;
    return new Date().toDateString() === new Date(this.lastReport.generatedAt).toDateString();
  }

  async forceRegenerate() {
    this.lastReport = null;
    try { if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE); } catch (e) {}
    return await this.generateReport();
  }

  // ── Generate report ───────────────────────────────────────────────
  async generateReport() {
    if (this.isTodaysCacheValid()) {
      console.log('[MindMap] Returning cached report');
      return this.lastReport;
    }

    const today    = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"

    // Use proper DB methods from DatabaseManager
    const screenTime     = this.db.getScreenTimeByDate(today);           // [{app_name, duration_seconds, category}]
    const tasks          = this.db.getTasks();                            // all tasks
    const completedToday = tasks.filter(t =>
      t.status === 'completed' && t.completed_at && t.completed_at.startsWith(today)
    );
    const pendingTasks   = tasks.filter(t => t.status !== 'completed');
    const weeklyData     = this.db.getScreenTimeWeekly();                 // [{date, total}]

    const totalMins = screenTime.reduce((s, e) => s + (e.duration_seconds || 0), 0) / 60;
    const focusMins = screenTime
      .filter(e => ['development', 'productivity', 'design'].includes(e.category))
      .reduce((s, e) => s + (e.duration_seconds || 0), 0) / 60;

    const topApps = screenTime.slice(0, 5)
      .map(e => `${e.app_name}:${Math.round((e.duration_seconds || 0) / 60)}min`);

    const weekDayTotals = {};
    weeklyData.forEach(({ date, total }) => {
      const day = new Date(date).toLocaleDateString('en', { weekday: 'short' });
      weekDayTotals[day] = Math.round((total || 0) / 3600 * 10) / 10;
    });
    const weekValues = weeklyData.map(d => (d.total || 0) / 3600);
    const heavyDays  = weekValues.filter(h => h > 8).length;
    const avgHours   = weekValues.reduce((a, b) => a + b, 0) / 7;

    // ── Local fallback ────────────────────────────────────────────
    const localFallback = () => JSON.stringify({
      greeting:       `Good ${this._timeOfDay()}! Here's your daily coaching report.`,
      coaching_tip:   totalMins > 360
                        ? "You've had a long session — take a break!"
                        : 'Start with your most important task first.',
      focus_insight:  `${Math.round(focusMins)} min focused work today (${Math.round(focusMins / Math.max(totalMins, 1) * 100)}% focus score).`,
      today_plan:     completedToday.length > 0
                        ? `Great job completing ${completedToday.length} task(s)! Keep going.`
                        : `You have ${pendingTasks.length} pending tasks — pick the top priority.`,
      burnout_status: heavyDays >= 3
                        ? '⚠️ Several heavy days this week. Take breaks!'
                        : '✅ Work schedule looks balanced.',
      achievement:    completedToday.length > 0
                        ? `🏆 Completed ${completedToday.length} task(s) today!`
                        : '💪 Keep pushing forward!',
      weekly_digest:  `Averaged ${avgHours.toFixed(1)}h/day this week. Top: ${topApps.slice(0, 2).join(', ') || 'N/A'}.`,
      quick_wins:     ['Take a 5-min break and stretch', 'Review your top pending task', 'Drink water and reset focus'],
      burnout_level:  heavyDays >= 3 ? 'high' : heavyDays >= 1 ? 'medium' : 'low'
    });

    const prompt = `You are a productivity coach. Generate a daily coaching report in JSON only, no markdown.

TODAY: screen time ${Math.round(totalMins)}min, focus ${Math.round(focusMins)}min, tasks completed ${completedToday.length}, pending ${pendingTasks.length}, top apps: ${topApps.join(', ') || 'none'}
WEEK: ${heavyDays} days over 8h, avg ${avgHours.toFixed(1)}h/day

Respond ONLY with this JSON (no extra text, no backticks):
{
  "greeting": "personalized warm greeting",
  "coaching_tip": "specific actionable tip for today",
  "focus_insight": "insight about their focus today",
  "today_plan": "plan/recommendation for rest of today",
  "burnout_status": "honest burnout assessment",
  "achievement": "celebrate something positive",
  "weekly_digest": "2-sentence week summary with numbers",
  "quick_wins": ["win1", "win2", "win3"],
  "burnout_level": "low|medium|high"
}`;

    try {
      const { text, provider } = await callAI(prompt, localFallback);
      const data = JSON.parse(text.replace(/```json|```/g, '').trim());
      console.log(`[MindMap] Report generated with ${provider}`);

      // Auto-save standup if none today — uses db.saveStandup() / db.getStandupByDate()
      const existingStandup = this.db.getStandupByDate(today);
      if (!existingStandup) {
        this.db.saveStandup({
          date:           today,
          auto_generated: true,
          completed:      completedToday.map(t => t.title).join(', ') || 'None',
          working_on:     pendingTasks.slice(0, 3).map(t => t.title).join(', ') || 'General work',
          blockers:       'None'
        });
      }

      const report = {
        ...data,
        stats: {
          totalMinutes:   Math.round(totalMins),
          focusMinutes:   Math.round(focusMins),
          tasksCompleted: completedToday.length,
          tasksPending:   pendingTasks.length,
          topApps,
          weekDayTotals
        },
        provider,
        generatedAt: new Date().toISOString()
      };
      this.lastReport = report;
      this.saveCache(report);
      return report;

    } catch (e) {
      console.error('[MindMap] Report generation failed:', e.message);
      const fallback = JSON.parse(localFallback());
      const report = {
        ...fallback,
        stats: {
          totalMinutes:   Math.round(totalMins),
          focusMinutes:   Math.round(focusMins),
          tasksCompleted: completedToday.length,
          tasksPending:   pendingTasks.length,
          topApps,
          weekDayTotals
        },
        provider:    'local',
        generatedAt: new Date().toISOString()
      };
      this.lastReport = report;
      this.saveCache(report);
      return report;
    }
  }

  // ── Shareable text report ─────────────────────────────────────────
  generateShareableReport() {
    const r = this.lastReport;
    if (!r) return 'No report yet. Open MindMap Coach tab first.';
    const date = new Date().toLocaleDateString('en', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    return `📊 FlowAgent Daily Report — ${date}
━━━━━━━━━━━━━━━━━━━━━━━━━

${r.greeting}

🎯 TODAY
${r.focus_insight}
Screen: ${r.stats?.totalMinutes || 0}min | Focus: ${r.stats?.focusMinutes || 0}min | Tasks done: ${r.stats?.tasksCompleted || 0}

💡 TIP
${r.coaching_tip}

🏆 ACHIEVEMENT
${r.achievement}

📈 WEEK
${r.weekly_digest}

⚡ QUICK WINS
${(r.quick_wins || []).map((w, i) => `${i + 1}. ${w}`).join('\n')}

🔥 BURNOUT: ${r.burnout_status}
━━━━━━━━━━━━━━━━━━━━━━━━━
FlowAgent AI (${r.provider || 'local'})`;
  }

  // ── Save mood — uses db.saveStandup() ────────────────────────────
  saveMood(mood, blockers) {
    const today = new Date().toISOString().split('T')[0];
    this.db.saveStandup({ date: today, mood, blockers: blockers || 'None' });
    return { success: true };
  }

  _timeOfDay() {
    const h = new Date().getHours();
    return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
  }
}

module.exports = MindMapAgent;