const path = require('path');
const os = require('os');
const fs = require('fs');

/**
 * DatabaseManager — pure JavaScript, zero native compilation
 * Uses a JSON file as database. No sqlite, no build tools, works everywhere.
 */
class DatabaseManager {
  constructor() {
    const dataDir = path.join(os.homedir(), '.ai-productivity-agent');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    this.dbPath = path.join(dataDir, 'productivity.json');
    this.data = null;
    this._dirty = false;
  }

  initialize() {
    if (fs.existsSync(this.dbPath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
        console.log('[DB] Loaded from', this.dbPath);
      } catch (e) {
        console.warn('[DB] Corrupt file, resetting');
        this.data = this._emptyStore();
      }
    } else {
      this.data = this._emptyStore();
      console.log('[DB] Created new database at', this.dbPath);
    }
    setInterval(() => { if (this._dirty) this._flush(); }, 5000);
  }

  _emptyStore() {
    return { screen_time: [], tasks: [], meetings: [], file_logs: [], clipboard: [], standups: [], browser_activity: [], work_pattern: [], emails: [], documents: [], _nextId: 1 };
  }

  _id() { const id = this.data._nextId++; this._dirty = true; return id; }
  _markDirty() { this._dirty = true; }

  _flush() {
    try { fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2), 'utf8'); this._dirty = false; }
    catch (e) { console.error('[DB] Save error:', e.message); }
  }

  save() { this._flush(); }

  // ── SCREEN TIME ──
  upsertScreenTime(appName, windowTitle, date, seconds) {
    const r = this.data.screen_time.find(r => r.app_name === appName && r.date === date);
    if (r) { r.duration_seconds += seconds; r.window_title = windowTitle; }
    else this.data.screen_time.push({ id: this._id(), app_name: appName, window_title: windowTitle, date, duration_seconds: seconds, created_at: new Date().toISOString() });
    this._markDirty();
  }

  getScreenTimeByDate(date) {
    return this.data.screen_time.filter(r => r.date === date).sort((a,b) => b.duration_seconds - a.duration_seconds);
  }

  getScreenTimeWeekly() {
    const result = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const date = d.toISOString().split('T')[0];
      const total = this.data.screen_time.filter(r => r.date === date).reduce((s,r) => s + r.duration_seconds, 0);
      result.push({ date, total });
    }
    return result;
  }

  // ── TASKS ──
  createTask(task) {
    const t = { id: this._id(), title: task.title, description: task.description || '', deadline: task.deadline || null, priority: task.priority || 'medium', status: 'pending', notified: 0, created_at: new Date().toISOString(), completed_at: null };
    this.data.tasks.push(t); this._markDirty(); return t;
  }

  getTasks(status = null) {
    let tasks = status ? this.data.tasks.filter(t => t.status === status) : [...this.data.tasks];
    const order = { pending: 0, 'in-progress': 1, completed: 2 };
    return tasks.sort((a,b) => {
      if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      if (a.deadline && b.deadline) return new Date(a.deadline) - new Date(b.deadline);
      return a.deadline ? -1 : b.deadline ? 1 : 0;
    });
  }

  updateTask(id, updates) {
    const t = this.data.tasks.find(t => t.id === id);
    if (!t) return null;
    Object.assign(t, updates); this._markDirty(); return t;
  }

  deleteTask(id) { this.data.tasks = this.data.tasks.filter(t => t.id !== id); this._markDirty(); }

  getPendingTasksDueSoon(minutesAhead = 30) {
    const now = new Date(), future = new Date(now.getTime() + minutesAhead * 60000);
    return this.data.tasks.filter(t => t.status !== 'completed' && !t.notified && t.deadline && new Date(t.deadline) <= future && new Date(t.deadline) >= now);
  }

  markTaskNotified(id) {
    const t = this.data.tasks.find(t => t.id === id);
    if (t) { t.notified = 1; this._markDirty(); }
  }

  // ── MEETINGS ──
  createMeeting(title) {
    const m = { id: this._id(), title, transcript: '', summary: '', duration_seconds: 0, started_at: new Date().toISOString(), ended_at: null, status: 'recording' };
    this.data.meetings.push(m); this._markDirty(); return m;
  }

  updateMeeting(id, updates) {
    const m = this.data.meetings.find(m => m.id === id);
    if (!m) return null;
    Object.assign(m, updates); this._markDirty(); return m;
  }

  getMeetings() { return [...this.data.meetings].reverse(); }
  getMeetingById(id) { return this.data.meetings.find(m => m.id === id) || null; }

  appendTranscript(id, text) {
    const m = this.data.meetings.find(m => m.id === id);
    if (m) { m.transcript += (m.transcript ? '\n' : '') + text; this._markDirty(); }
  }

  // ── FILE LOGS ──
  logFileMove(data) {
    this.data.file_logs.push({ id: this._id(), ...data, organized_at: new Date().toISOString() });
    this._markDirty();
  }

  getFileLogs(limit = 100) { return [...this.data.file_logs].reverse().slice(0, limit); }

  getFileStats() {
    const cutoff = new Date(Date.now() - 30 * 24 * 3600000);
    const stats = {};
    this.data.file_logs.filter(f => new Date(f.organized_at) >= cutoff).forEach(f => { stats[f.category] = (stats[f.category] || 0) + 1; });
    return Object.entries(stats).map(([category, count]) => ({ category, count })).sort((a,b) => b.count - a.count);
  }

  // ── WORK PATTERN ──
  saveWorkPatternInsights(insights) {
    if (!this.data.work_pattern) this.data.work_pattern = [];
    const idx = this.data.work_pattern.findIndex(w => w.date === insights.date);
    if (idx >= 0) this.data.work_pattern[idx] = { ...this.data.work_pattern[idx], ...insights };
    else this.data.work_pattern.unshift({ id: this._id(), ...insights });
    if (this.data.work_pattern.length > 90) this.data.work_pattern = this.data.work_pattern.slice(0, 90);
    this._markDirty();
  }
  getWorkPatternHistory(days = 7) {
    if (!this.data.work_pattern) return [];
    return this.data.work_pattern.slice(0, days);
  }
  getLatestInsights() {
    if (!this.data.work_pattern || !this.data.work_pattern.length) return null;
    return this.data.work_pattern[0];
  }

  // ── SUBTASKS (linked to parent task) ──
  saveSubtasks(parentTaskId, subtasks) {
    const task = this.data.tasks.find(t => t.id === parentTaskId);
    if (!task) return false;
    task.subtasks = subtasks.map((s, i) => ({
      id: this._id(),
      parent_id: parentTaskId,
      title: s.title,
      description: s.description || '',
      day: s.day || (i + 1),
      duration_hours: s.duration_hours || 1,
      status: 'pending',
      created_at: new Date().toISOString()
    }));
    task.has_plan = true;
    task.estimated_hours = subtasks.reduce((s, t) => s + (t.duration_hours || 1), 0);
    this._markDirty();
    return task.subtasks;
  }
  updateSubtaskStatus(subtaskId, status) {
    for (const task of this.data.tasks) {
      if (!task.subtasks) continue;
      const sub = task.subtasks.find(s => s.id === subtaskId);
      if (sub) { sub.status = status; this._markDirty(); return true; }
    }
    return false;
  }
  saveClipboardEntry(entry) {
    if (!this.data.clipboard) this.data.clipboard = [];
    this.data.clipboard.unshift({ id: this._id(), ...entry });
    if (this.data.clipboard.length > 500) this.data.clipboard = this.data.clipboard.slice(0, 500);
    this._markDirty();
  }
  getClipboardHistory(limit = 100, category = null) {
    if (!this.data.clipboard) return [];
    let items = this.data.clipboard;
    if (category) items = items.filter(i => i.category === category);
    return items.slice(0, limit);
  }
  deleteClipboardEntry(id) {
    if (!this.data.clipboard) return;
    this.data.clipboard = this.data.clipboard.filter(i => i.id !== id);
    this._markDirty();
  }
  clearClipboardHistory() {
    this.data.clipboard = [];
    this._markDirty();
  }

  // ── STANDUP ──
  saveStandup(entry) {
    if (!this.data.standups) this.data.standups = [];
    const date = entry.date || new Date().toISOString().split('T')[0];
    const existing = this.data.standups.findIndex(s => s.date === date);
    if (existing >= 0) {
      this.data.standups[existing] = { ...this.data.standups[existing], ...entry, updated_at: new Date().toISOString() };
    } else {
      this.data.standups.unshift({ id: this._id(), ...entry, date, created_at: new Date().toISOString() });
    }
    this._markDirty();
    return date;
  }
  getStandupByDate(date) {
    if (!this.data.standups) return null;
    return this.data.standups.find(s => s.date === date) || null;
  }
  getStandupHistory(limit = 30) {
    if (!this.data.standups) return [];
    return this.data.standups.slice(0, limit);
  }

  // ── BROWSER ACTIVITY ──
  saveBrowserActivity(entry) {
    if (!this.data.browser_activity) this.data.browser_activity = [];
    const r = this.data.browser_activity.find(r => r.site === entry.site && r.date === entry.date);
    if (r) { r.seconds += entry.seconds; r.title = entry.title; }
    else this.data.browser_activity.push({ id: this._id(), ...entry, created_at: new Date().toISOString() });
    this._markDirty();
  }
  getBrowserActivityByDate(date) {
    if (!this.data.browser_activity) return [];
    return this.data.browser_activity.filter(r => r.date === date).sort((a,b) => b.seconds - a.seconds);
  }
  getBrowserActivityByCategory(date) {
    const rows = this.getBrowserActivityByDate(date);
    const cats = {};
    rows.forEach(r => { cats[r.category] = (cats[r.category] || 0) + r.seconds; });
    return Object.entries(cats).map(([category, seconds]) => ({ category, seconds })).sort((a,b) => b.seconds - a.seconds);
  }

  // ── DASHBOARD ──
  getDashboardStats() {
    const today = new Date().toISOString().split('T')[0];
    return {
      totalTasks: this.data.tasks.length,
      pendingTasks: this.data.tasks.filter(t => t.status !== 'completed').length,
      completedToday: this.data.tasks.filter(t => t.status === 'completed' && t.completed_at && t.completed_at.startsWith(today)).length,
      totalMeetings: (this.data.meetings || []).length,
      filesOrganized: this.data.file_logs.length,
      clipboardItems: (this.data.clipboard || []).length,
      emailsAnalyzed: (this.data.emails || []).length,
      documentsAnalyzed: (this.data.documents || []).length,
      todayStandup: !!(this.data.standups || []).find(s => s.date === today),
      todayScreenTime: this.data.screen_time.filter(r => r.date === today).reduce((s,r) => s + r.duration_seconds, 0)
    };
  }

  // ── EMAILS ──
  saveEmail(entry) {
    if (!this.data.emails) this.data.emails = [];
    const record = { id: this._id(), ...entry, analyzed_at: new Date().toISOString() };
    this.data.emails.unshift(record);
    if (this.data.emails.length > 200) this.data.emails = this.data.emails.slice(0, 200);
    this._markDirty();
    return record;
  }
  getEmails(limit = 50) {
    return (this.data.emails || []).slice(0, limit);
  }
  deleteEmail(id) {
    this.data.emails = (this.data.emails || []).filter(e => e.id !== id);
    this._markDirty();
  }

  // ── DOCUMENTS ──
  saveDocument(entry) {
    if (!this.data.documents) this.data.documents = [];
    const record = { id: this._id(), ...entry, analyzed_at: new Date().toISOString() };
    this.data.documents.unshift(record);
    if (this.data.documents.length > 100) this.data.documents = this.data.documents.slice(0, 100);
    this._markDirty();
    return record;
  }
  getDocuments(limit = 30) {
    return (this.data.documents || []).slice(0, limit);
  }
  deleteDocument(id) {
    this.data.documents = (this.data.documents || []).filter(d => d.id !== id);
    this._markDirty();
  }
}

module.exports = DatabaseManager;