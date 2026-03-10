const os = require('os');
const path = require('path');
const fs = require('fs');

function setup(ipcMain, db, agents, mainWindow) {
  const { screenTimeAgent, taskReminderAgent, fileOrganizerAgent,
          clipboardAgent, standupAgent, browserActivityAgent,
          workPatternAgent, distractionDetectorAgent, smartTaskAgent,
          emailAgent, documentAgent, mindMapAgent } = agents;

  // ── Screen Time ───────────────────────────────────────────────────
  ipcMain.handle('get-screen-time', async (_, date) => {
    try { return { success: true, data: db.getScreenTimeByDate(date || new Date().toISOString().split('T')[0]) }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('get-screen-time-weekly', async () => {
    try { return { success: true, data: db.getScreenTimeWeekly() }; }
    catch (e) { return { success: false, error: e.message }; }
  });
  screenTimeAgent.addListener((data) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('screen-time-update', data);
  });

  // ── Tasks ─────────────────────────────────────────────────────────
  ipcMain.handle('get-tasks',      async () => { try { return { success: true, data: db.getTasks() }; } catch(e) { return { success: false, error: e.message }; } });
  ipcMain.handle('create-task',    async (_, t) => { try { return { success: true, data: db.createTask(t) }; } catch(e) { return { success: false, error: e.message }; } });
  ipcMain.handle('update-task',    async (_, id, u) => { try { return { success: true, data: db.updateTask(id, u) }; } catch(e) { return { success: false, error: e.message }; } });
  ipcMain.handle('delete-task',    async (_, id) => { try { return { success: true, data: db.deleteTask(id) }; } catch(e) { return { success: false, error: e.message }; } });
  ipcMain.handle('complete-task',  async (_, id) => { try { return { success: true, data: db.completeTask(id) }; } catch(e) { return { success: false, error: e.message }; } });
  taskReminderAgent.addListener = (fn) => taskReminderAgent.listeners ? taskReminderAgent.listeners.push(fn) : null;

  // ── Life Reminders ────────────────────────────────────────────────
  // Get all 17 built-in reminders with their enabled state
  ipcMain.handle('get-life-reminders', async () => {
    try { return { success: true, data: taskReminderAgent.getLifeReminders() }; }
    catch(e) { return { success: false, error: e.message }; }
  });
  // Toggle a reminder ON or OFF  →  invoke('toggle-life-reminder', 'water', false)
  ipcMain.handle('toggle-life-reminder', async (_, id, enabled) => {
    try { return taskReminderAgent.toggleLifeReminder(id, enabled); }
    catch(e) { return { success: false, error: e.message }; }
  });
  // Fire a reminder immediately for testing  →  invoke('test-life-reminder', 'water')
  ipcMain.handle('test-life-reminder', async (_, id) => {
    try { return taskReminderAgent.testReminder(id); }
    catch(e) { return { success: false, error: e.message }; }
  });
  // Change interval minutes  →  invoke('update-reminder-interval', 'water', 45)
  ipcMain.handle('update-reminder-interval', async (_, id, intervalMins) => {
    try { return taskReminderAgent.updateReminderInterval(id, intervalMins); }
    catch(e) { return { success: false, error: e.message }; }
  });
  // Change daily time(s)  →  invoke('update-reminder-times', 'lunch', ['12:30'])
  ipcMain.handle('update-reminder-times', async (_, id, times) => {
    try { return taskReminderAgent.updateReminderTimes(id, times); }
    catch(e) { return { success: false, error: e.message }; }
  });

  // ── File Organizer ────────────────────────────────────────────────
  ipcMain.handle('get-file-logs',  async () => { try { return { success: true, data: db.getFileLogs() }; } catch(e) { return { success: false, error: e.message }; } });
  ipcMain.handle('get-file-stats', async () => { try { return { success: true, data: db.getFileStats() }; } catch(e) { return { success: false, error: e.message }; } });
  ipcMain.handle('trigger-scan',   async () => { try { return { success: true, data: fileOrganizerAgent.scanNow() }; } catch(e) { return { success: false, error: e.message }; } });
  fileOrganizerAgent.addListener((data) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('file-organized', data);
  });

  // ── Dashboard ─────────────────────────────────────────────────────
  ipcMain.handle('get-dashboard-stats', async () => {
    try { return { success: true, data: db.getDashboardStats() }; }
    catch (e) { return { success: false, error: e.message }; }
  });

  // ── Clipboard ─────────────────────────────────────────────────────
  ipcMain.handle('get-clipboard', async (_, opts) => {
    try { return { success: true, data: db.getClipboardHistory(opts?.limit || 100, opts?.category) }; }
    catch(e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('delete-clipboard-entry', async (_, id) => {
    try { db.deleteClipboardEntry(id); return { success: true }; }
    catch(e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('clear-clipboard', async () => {
    try { db.clearClipboardHistory(); return { success: true }; }
    catch(e) { return { success: false, error: e.message }; }
  });
  clipboardAgent.addListener((data) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('clipboard-new', data);
  });

  // ── Standup ───────────────────────────────────────────────────────
  ipcMain.handle('save-standup', async (_, data) => {
    try { return { success: true, data: db.saveStandup(data) }; }
    catch(e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('get-standup-today', async () => {
    try {
      const today = new Date().toISOString().split('T')[0];
      return { success: true, data: db.getStandupByDate(today) };
    } catch(e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('get-standup-history', async () => {
    try { return { success: true, data: db.getStandupHistory(30) }; }
    catch(e) { return { success: false, error: e.message }; }
  });

  // ── Browser Activity ──────────────────────────────────────────────
  ipcMain.handle('get-browser-activity', async (_, date) => {
    try {
      const d = date || new Date().toISOString().split('T')[0];
      return { success: true, data: db.getBrowserActivityByDate(d) };
    } catch(e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('get-browser-by-category', async (_, date) => {
    try {
      const d = date || new Date().toISOString().split('T')[0];
      return { success: true, data: db.getBrowserActivityByCategory(d) };
    } catch(e) { return { success: false, error: e.message }; }
  });
  browserActivityAgent.addListener((data) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('browser-activity-update', data);
  });

  // ── Work Pattern ───────────────────────────────────────────────────
  ipcMain.handle('get-work-pattern', async () => {
    try { return { success: true, data: db.getLatestInsights() }; }
    catch(e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('get-work-pattern-history', async (_, days) => {
    try { return { success: true, data: db.getWorkPatternHistory(days || 7) }; }
    catch(e) { return { success: false, error: e.message }; }
  });
  workPatternAgent.addListener((data) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('work-pattern-update', data);
  });

  // ── Distraction Detector ───────────────────────────────────────────
  ipcMain.handle('get-distraction-stats', async () => {
    try { return { success: true, data: distractionDetectorAgent.getStats() }; }
    catch(e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('enable-focus-mode', async (_, minutes) => {
    try { distractionDetectorAgent.enableFocusMode(minutes || 25); return { success: true }; }
    catch(e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('disable-focus-mode', async () => {
    try { distractionDetectorAgent.disableFocusMode(); return { success: true }; }
    catch(e) { return { success: false, error: e.message }; }
  });
  distractionDetectorAgent.addListener((data) => {
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send('distraction-alert', data);
  });

  // ── Smart Task ─────────────────────────────────────────────────────
  ipcMain.handle('plan-task', async (_, taskId) => {
    try {
      const tasks = db.getTasks();
      const task = tasks.find(t => t.id === taskId);
      if (!task) return { success: false, error: 'Task not found' };
      const plan = await smartTaskAgent.planTask(task);
      if (!plan) return { success: false, error: 'Could not generate plan' };
      const subtasks = db.saveSubtasks(taskId, plan.subtasks);
      return { success: true, data: { ...plan, subtasks, taskId } };
    } catch(e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('complete-subtask', async (_, subtaskId) => {
    try { return { success: true, data: db.updateSubtaskStatus(subtaskId, 'completed') }; }
    catch(e) { return { success: false, error: e.message }; }
  });

  // ── Email Manager ──────────────────────────────────────────────────
  ipcMain.handle('analyze-email', async (_, rawText) => {
    try {
      const result = await emailAgent.analyzeEmail(rawText);
      const saved  = db.saveEmail({ raw_text: rawText.slice(0,500), ...result });
      return { success: true, data: { ...result, id: saved.id } };
    } catch(e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('get-emails', async () => {
    try { return { success: true, data: db.getEmails() }; }
    catch(e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('delete-email', async (_, id) => {
    try { db.deleteEmail(id); return { success: true }; }
    catch(e) { return { success: false, error: e.message }; }
  });

  // ── Gmail ──────────────────────────────────────────────────────────
  ipcMain.handle('gmail-status', async () => ({
    success: true,
    connected: emailAgent.isGmailConnected(),
    account:   emailAgent.getGmailAccount()?.email || null
  }));
  ipcMain.handle('gmail-connect', async (_, email, appPassword) => {
    try {
      emailAgent.saveGmailAccount(email.trim(), appPassword.replace(/\s/g,''));
      const emails = await emailAgent.fetchGmailEmails(1);
      return { success: true, count: emails.length };
    } catch(e) {
      emailAgent.disconnectGmail();
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('gmail-fetch', async (_, maxResults) => {
    try {
      const emails = await emailAgent.analyzeGmailEmails(maxResults || 15);
      return { success: true, data: emails };
    } catch(e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('gmail-disconnect', async () => {
    try { emailAgent.disconnectGmail(); return { success: true }; }
    catch(e) { return { success: false, error: e.message }; }
  });

  // ── MindMap Daily Coach ────────────────────────────────────────────
  ipcMain.handle('mindmap-get-report', async () => {
    try {
      const report = await mindMapAgent.generateReport();
      return { success: true, data: report };
    } catch(e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('mindmap-refresh', async () => {
    try {
      const report = await mindMapAgent.forceRegenerate();
      return { success: true, data: report };
    } catch(e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('mindmap-shareable', async () => {
    try {
      const text = mindMapAgent.generateShareableReport();
      return { success: true, data: text };
    } catch(e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('mindmap-save-mood', async (_, mood, blockers) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const existing = (db.data.standups||[]).find(s => s.date === today);
      if (existing) {
        existing.mood = mood;
        if (blockers) existing.blockers = blockers;
        db._markDirty();
      }
      return { success: true };
    } catch(e) { return { success: false, error: e.message }; }
  });

  // ── Document Explainer ─────────────────────────────────────────────
  ipcMain.handle('analyze-document-text', async (_, text, context) => {
    try {
      const result = await documentAgent.analyzeText(text, context || '');
      const saved = db.saveDocument({ raw_preview: text.slice(0,300), file_name: 'Pasted text', ...result });
      return { success: true, data: { ...result, id: saved.id } };
    } catch(e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('analyze-document-file', async (_, filePath, context) => {
    try {
      const extracted = await documentAgent.extractText(filePath);
      const result    = await documentAgent.analyzeText(extracted.text, context || '');
      const fileName  = require('path').basename(filePath);
      const saved     = db.saveDocument({ raw_preview: extracted.text.slice(0,300), file_name: fileName, pages: extracted.pages, ...result });
      return { success: true, data: { ...result, id: saved.id, file_name: fileName, pages: extracted.pages } };
    } catch(e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('get-documents', async () => {
    try { return { success: true, data: db.getDocuments() }; }
    catch(e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('delete-document', async (_, id) => {
    try { db.deleteDocument(id); return { success: true }; }
    catch(e) { return { success: false, error: e.message }; }
  });

  // ── Settings / API Key ─────────────────────────────────────────────
  const configDir  = path.join(os.homedir(), '.ai-productivity-agent');
  const configPath = path.join(configDir, 'config.json');
  ipcMain.handle('save-api-key', async (_, key) => {
    try {
      const trimmedKey = (key || '').trim();
      if (!trimmedKey) return { success: false, error: 'Empty key' };
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
      const existing = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
      existing.anthropic_api_key = trimmedKey;
      fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
      process.env.ANTHROPIC_API_KEY = trimmedKey;
      const verify = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      console.log('[Settings] API key saved. Length:', verify.anthropic_api_key?.length);
      return { success: true };
    } catch(e) {
      console.error('[Settings] save-api-key error:', e.message);
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('get-api-key', async () => {
    try {
      if (fs.existsSync(configPath)) {
        const c = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return { success: true, data: c.anthropic_api_key || '' };
      }
      return { success: true, data: process.env.ANTHROPIC_API_KEY || '' };
    } catch(e) { return { success: true, data: '' }; }
  });
}

module.exports = { setup };