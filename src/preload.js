const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Screen Time
  getScreenTimeData:   (date) => ipcRenderer.invoke('get-screen-time', date),
  getScreenTimeWeekly: ()     => ipcRenderer.invoke('get-screen-time-weekly'),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
onLifeReminder: (cb) => ipcRenderer.on('life-reminder-fired', (_, data) => cb(data)),

  // Tasks
  getTasks:     ()         => ipcRenderer.invoke('get-tasks'),
  createTask:   (t)        => ipcRenderer.invoke('create-task', t),
  updateTask:   (id, u)    => ipcRenderer.invoke('update-task', id, u),
  deleteTask:   (id)       => ipcRenderer.invoke('delete-task', id),
  completeTask: (id)       => ipcRenderer.invoke('complete-task', id),

  // File Organizer
  getFileLogs:  () => ipcRenderer.invoke('get-file-logs'),
  getFileStats: () => ipcRenderer.invoke('get-file-stats'),
  triggerScan:  () => ipcRenderer.invoke('trigger-scan'),

  // Dashboard
  getDashboardStats: () => ipcRenderer.invoke('get-dashboard-stats'),

  // Clipboard
  getClipboard:          (opts) => ipcRenderer.invoke('get-clipboard', opts),
  deleteClipboardEntry:  (id)   => ipcRenderer.invoke('delete-clipboard-entry', id),
  clearClipboard:        ()     => ipcRenderer.invoke('clear-clipboard'),

  // Standup
  saveStandup:        (data) => ipcRenderer.invoke('save-standup', data),
  getStandupToday:    ()     => ipcRenderer.invoke('get-standup-today'),
  getStandupHistory:  ()     => ipcRenderer.invoke('get-standup-history'),

  // Browser Activity
  getBrowserActivity:    (date) => ipcRenderer.invoke('get-browser-activity', date),
  getBrowserByCategory:  (date) => ipcRenderer.invoke('get-browser-by-category', date),

  // Work Pattern
  getWorkPattern:        ()     => ipcRenderer.invoke('get-work-pattern'),
  getWorkPatternHistory: (days) => ipcRenderer.invoke('get-work-pattern-history', days),

  // Distraction Detector
  getDistractionStats:  ()    => ipcRenderer.invoke('get-distraction-stats'),
  enableFocusMode:      (min) => ipcRenderer.invoke('enable-focus-mode', min),
  disableFocusMode:     ()    => ipcRenderer.invoke('disable-focus-mode'),

  // Smart Task
  planTask:        (id)  => ipcRenderer.invoke('plan-task', id),
  completeSubtask: (id)  => ipcRenderer.invoke('complete-subtask', id),

  // Email Manager
  analyzeEmail:  (text)             => ipcRenderer.invoke('analyze-email', text),
  getEmails:     ()                 => ipcRenderer.invoke('get-emails'),
  deleteEmail:   (id)               => ipcRenderer.invoke('delete-email', id),

  // MindMap Daily Coach
  mindmapGetReport:  ()              => ipcRenderer.invoke('mindmap-get-report'),
  mindmapRefresh:    ()              => ipcRenderer.invoke('mindmap-refresh'),
  mindmapShareable:  ()              => ipcRenderer.invoke('mindmap-shareable'),
  mindmapSaveMood:   (mood, blockers)=> ipcRenderer.invoke('mindmap-save-mood', mood, blockers),
  onMindmapReport:   (cb)            => ipcRenderer.on('mindmap-report', (_, d) => cb(d)),
  gmailStatus:      ()                   => ipcRenderer.invoke('gmail-status'),
  gmailConnect:     (email, password)    => ipcRenderer.invoke('gmail-connect', email, password),
  gmailFetch:       (n)                  => ipcRenderer.invoke('gmail-fetch', n),
  gmailDisconnect:  ()                   => ipcRenderer.invoke('gmail-disconnect'),

  // Document Explainer
  analyzeDocumentText: (text, ctx)  => ipcRenderer.invoke('analyze-document-text', text, ctx),
  analyzeDocumentFile: (path, ctx)  => ipcRenderer.invoke('analyze-document-file', path, ctx),
  getDocuments:        ()           => ipcRenderer.invoke('get-documents'),
  deleteDocument:      (id)         => ipcRenderer.invoke('delete-document', id),

  // API Key
  saveApiKey: (key) => ipcRenderer.invoke('save-api-key', key),
  getApiKey:  ()    => ipcRenderer.invoke('get-api-key'),

  // Events
  onTaskReminder:        (cb) => ipcRenderer.on('task-reminder',         (_, d) => cb(d)),
  onFileOrganized:       (cb) => ipcRenderer.on('file-organized',        (_, d) => cb(d)),
  onScreenTimeUpdate:    (cb) => ipcRenderer.on('screen-time-update',    (_, d) => cb(d)),
  onClipboardNew:        (cb) => ipcRenderer.on('clipboard-new',         (_, d) => cb(d)),
  onStandupPrompt:       (cb) => ipcRenderer.on('standup-prompt',        (_, d) => cb(d)),
  onBrowserActivityUpdate:(cb)=> ipcRenderer.on('browser-activity-update',(_, d) => cb(d)),
  onWorkPatternUpdate:   (cb) => ipcRenderer.on('work-pattern-update',    (_, d) => cb(d)),
  onDistractionAlert:    (cb) => ipcRenderer.on('distraction-alert',      (_, d) => cb(d)),
  onFocusModeEnded:      (cb) => ipcRenderer.on('focus-mode-ended',       (_, d) => cb(d)),
  removeAllListeners:    (ch) => ipcRenderer.removeAllListeners(ch),
});