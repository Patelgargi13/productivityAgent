const { Notification } = require('electron');

/**
 * Task Reminder Agent
 * - Checks user tasks every 60s and notifies for due/overdue tasks
 * - Built-in life reminders: water, meals, eyes, stretch, sleep, etc.
 * - All built-in reminders can be toggled ON/OFF individually
 */
class TaskReminderAgent {
  constructor(db, mainWindow) {
    this.db = db;
    this.mainWindow = mainWindow;
    this.interval = null;
    this.lifeInterval = null;
    this.CHECK_INTERVAL    = 60 * 1000;  // check tasks every 1 min
    this.LIFE_INTERVAL     = 60 * 1000;  // check life reminders every 1 min
    this.WARN_AHEAD_MINUTES = 30;
    this._notifiedOverdue  = new Set();

    // ── Built-in life reminders config ───────────────────────────────
    // Each entry: { id, label, emoji, enabled, type, interval?, times? }
    //   type: 'interval' → fires every N minutes while app is open
    //   type: 'daily'    → fires once per day at specified time(s) HH:MM
    this.lifeReminders = [

      // 💧 Hydration
      { id: 'water',         label: 'Drink Water',          emoji: '💧', enabled: true,  type: 'interval', intervalMins: 30,  body: 'Stay hydrated! Drink a glass of water 💧' },

      // 🍽️ Meals
      { id: 'breakfast',     label: 'Breakfast',            emoji: '🍳', enabled: true,  type: 'daily',    times: ['08:30'],  body: 'Good morning! Have your breakfast before starting work 🍳' },
      { id: 'lunch',         label: 'Lunch',                emoji: '🥗', enabled: true,  type: 'daily',    times: ['13:00'],  body: 'Lunch time! Step away from the screen and eat 🥗' },
      { id: 'snack',         label: 'Evening Snack',        emoji: '🍎', enabled: true,  type: 'daily',    times: ['16:30'],  body: 'Time for a light snack to keep your energy up 🍎' },
      { id: 'dinner',        label: 'Dinner',               emoji: '🍛', enabled: true,  type: 'daily',    times: ['20:00'],  body: 'Dinner time! Have a good meal and relax 🍛' },

      // 👁️ Eye Care
      { id: 'eyes',          label: '20-20-20 Eye Rule',    emoji: '👁️', enabled: true,  type: 'interval', intervalMins: 20,  body: 'Look at something 20 feet away for 20 seconds. Your eyes need a break! 👁️' },

      // 🧘 Body Movement
      { id: 'stretch',       label: 'Stretch Break',        emoji: '🧘', enabled: true,  type: 'interval', intervalMins: 60,  body: 'Stand up and stretch for 2 minutes. Your body will thank you! 🧘' },
      { id: 'walk',          label: 'Short Walk',           emoji: '🚶', enabled: true,  type: 'interval', intervalMins: 120, body: 'Take a 5-minute walk. Movement boosts focus and energy! 🚶' },

      // 💊 Health
      { id: 'vitamins',      label: 'Vitamins / Medication',emoji: '💊', enabled: false, type: 'daily',    times: ['09:00'],  body: 'Don\'t forget your vitamins or medication! 💊' },
      { id: 'afterlunch',    label: 'Post-lunch Walk',      emoji: '🌿', enabled: true,  type: 'daily',    times: ['13:45'],  body: 'A short 10-minute walk after lunch helps digestion and focus 🌿' },

      // 🧠 Mental Wellness
      { id: 'breathe',       label: 'Deep Breathing',       emoji: '☁️', enabled: true,  type: 'interval', intervalMins: 90,  body: 'Take 5 deep breaths. Reset your mind and reduce stress ☁️' },
      { id: 'winddown',      label: 'Wind Down',            emoji: '🌙', enabled: true,  type: 'daily',    times: ['22:00'],  body: 'Start winding down. Avoid screens and relax before bed 🌙' },
      { id: 'sleep',         label: 'Sleep Reminder',       emoji: '😴', enabled: true,  type: 'daily',    times: ['23:00'],  body: 'Time to sleep! Good rest = better tomorrow 😴' },

      // 📝 Work Habits
      { id: 'goals',         label: 'Set Daily Goals',      emoji: '🎯', enabled: true,  type: 'daily',    times: ['09:00'],  body: 'What are your top 3 goals for today? Set them now! 🎯' },
      { id: 'deskclean',     label: 'Desk Cleanup',         emoji: '🗂️', enabled: true,  type: 'interval', intervalMins: 120, body: 'Quick 2-minute desk cleanup — a clean space = clear mind 🗂️' },
      { id: 'endofday',      label: 'End of Day Review',    emoji: '📝', enabled: true,  type: 'daily',    times: ['18:00'],  body: 'Write down 3 things you accomplished today. Great work! 📝' },
      { id: 'posture',       label: 'Posture Check',        emoji: '🪑', enabled: true,  type: 'interval', intervalMins: 45,  body: 'Check your posture! Sit straight, shoulders back 🪑' },
    ];

    // Tracks last-fired time for interval reminders (in memory)
    this._lastFired = {};    // { reminderId: timestamp }
    // Tracks which daily reminders already fired today
    this._dailyFired = {};   // { 'reminderId_HH:MM': 'YYYY-MM-DD' }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────
  start() {
    console.log('[TaskReminder] Agent started');
    this.interval     = setInterval(() => this.checkTasks(),         this.CHECK_INTERVAL);
    this.lifeInterval = setInterval(() => this.checkLifeReminders(), this.LIFE_INTERVAL);
    this.checkTasks();
    this.checkLifeReminders();
  }

  stop() {
    if (this.interval)     clearInterval(this.interval);
    if (this.lifeInterval) clearInterval(this.lifeInterval);
    console.log('[TaskReminder] Agent stopped');
  }

  setMainWindow(win) { this.mainWindow = win; }

  // ── User Task Reminders ───────────────────────────────────────────
  checkTasks() {
    try {
      const dueSoon = this.db.getPendingTasksDueSoon(this.WARN_AHEAD_MINUTES);
      dueSoon.forEach(task => {
        this.sendTaskNotification(task);
        this.db.markTaskNotified(task.id);
        this._sendToRenderer('task-reminder', {
          id: task.id, title: task.title,
          deadline: task.deadline, priority: task.priority
        });
      });

      const overdue = this.getOverdueTasks();
      overdue.forEach(task => this.sendOverdueNotification(task));
    } catch (err) {
      console.error('[TaskReminder] Error checking tasks:', err);
    }
  }

  sendTaskNotification(task) {
    if (!Notification.isSupported()) return;
    const minutesLeft = Math.round((new Date(task.deadline) - Date.now()) / 60000);
    const n = new Notification({
      title: `⏰ Task Due Soon: ${task.title}`,
      body:  minutesLeft <= 0
        ? `This task is due NOW! Priority: ${task.priority}`
        : `Due in ${minutesLeft} minute${minutesLeft !== 1 ? 's' : ''}. Priority: ${task.priority}`,
      urgency: task.priority === 'high' ? 'critical' : 'normal'
    });
    n.on('click', () => this._focusTab('tasks'));
    n.show();
    console.log(`[TaskReminder] Task due: "${task.title}" in ${minutesLeft}m`);
  }

  sendOverdueNotification(task) {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: `🔴 OVERDUE: ${task.title}`,
      body:  'This task is overdue! Please update its status.',
      urgency: 'critical'
    });
    n.on('click', () => this._focusTab('tasks'));
    n.show();
  }

  getOverdueTasks() {
    const now = new Date();
    return this.db.getTasks('pending').filter(t => {
      if (!t.deadline || this._notifiedOverdue.has(t.id)) return false;
      if (new Date(t.deadline) < now) { this._notifiedOverdue.add(t.id); return true; }
      return false;
    });
  }

  // ── Built-in Life Reminders ───────────────────────────────────────
  checkLifeReminders() {
    const now     = new Date();
    const nowMins = now.getHours() * 60 + now.getMinutes(); // minutes since midnight
    const today   = now.toISOString().split('T')[0];        // YYYY-MM-DD
    const nowTs   = now.getTime();

    this.lifeReminders.forEach(r => {
      if (!r.enabled) return;

      if (r.type === 'interval') {
        // Fire every N minutes — check if enough time has passed
        const last      = this._lastFired[r.id] || 0;
        const intervalMs = r.intervalMins * 60 * 1000;
        if (nowTs - last >= intervalMs) {
          this._lastFired[r.id] = nowTs;
          // Don't fire interval reminders at night (11PM – 7AM)
          const hour = now.getHours();
          if (hour >= 7 && hour < 23) {
            this._fireLifeReminder(r);
          }
        }

      } else if (r.type === 'daily') {
        // Fire once per day at each specified HH:MM time
        r.times.forEach(timeStr => {
          const [hh, mm] = timeStr.split(':').map(Number);
          const targetMins = hh * 60 + mm;
          const key = `${r.id}_${timeStr}`;

          // Fire if within 1 minute window and not already fired today
          if (Math.abs(nowMins - targetMins) <= 1 && this._dailyFired[key] !== today) {
            this._dailyFired[key] = today;
            this._fireLifeReminder(r);
          }
        });
      }
    });
  }

  _fireLifeReminder(reminder) {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title:   `${reminder.emoji} ${reminder.label}`,
      body:    reminder.body,
      urgency: 'normal'
    });
    n.on('click', () => {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.focus();
    });
    n.show();
    console.log(`[LifeReminder] Fired: ${reminder.label}`);
    this._sendToRenderer('life-reminder', {
      id:    reminder.id,
      label: reminder.label,
      emoji: reminder.emoji,
      body:  reminder.body
    });
  }

  // ── Settings API (called from IPC handlers) ───────────────────────

  // Get all life reminders with their current enabled state
  getLifeReminders() {
    return this.lifeReminders.map(r => ({
      id:          r.id,
      label:       r.label,
      emoji:       r.emoji,
      enabled:     r.enabled,
      type:        r.type,
      intervalMins: r.intervalMins || null,
      times:       r.times || null,
      body:        r.body
    }));
  }

  // Toggle a specific reminder ON or OFF
  toggleLifeReminder(id, enabled) {
    const r = this.lifeReminders.find(r => r.id === id);
    if (!r) return { success: false, error: 'Reminder not found' };
    r.enabled = enabled;
    // Reset its last-fired so it doesn't immediately fire when re-enabled
    if (enabled) this._lastFired[id] = Date.now();
    console.log(`[LifeReminder] ${id} → ${enabled ? 'ON' : 'OFF'}`);
    return { success: true, id, enabled };
  }

  // Update interval minutes for an interval-type reminder
  updateReminderInterval(id, intervalMins) {
    const r = this.lifeReminders.find(r => r.id === id && r.type === 'interval');
    if (!r) return { success: false, error: 'Reminder not found' };
    r.intervalMins = intervalMins;
    this._lastFired[id] = Date.now(); // reset timer
    return { success: true, id, intervalMins };
  }

  // Update daily time(s) for a daily-type reminder
  updateReminderTimes(id, times) {
    const r = this.lifeReminders.find(r => r.id === id && r.type === 'daily');
    if (!r) return { success: false, error: 'Reminder not found' };
    r.times = times;
    return { success: true, id, times };
  }

  // Fire a reminder immediately (for testing from UI)
  testReminder(id) {
    const r = this.lifeReminders.find(r => r.id === id);
    if (!r) return { success: false, error: 'Not found' };
    this._fireLifeReminder(r);
    return { success: true };
  }

  // ── Helpers ───────────────────────────────────────────────────────
  _sendToRenderer(channel, data) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  _focusTab(tab) {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.focus();
      this.mainWindow.webContents.send('show-notification', { type: 'navigate', tab });
    }
  }
}

module.exports = TaskReminderAgent;