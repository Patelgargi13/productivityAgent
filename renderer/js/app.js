const api = window.electronAPI;

// ── State ──────────────────────────────────────────────────────────
let weeklyChart = null, appUsageChart = null, browserCatChart = null;
let focusHistoryChart = null, distractionChart = null;
let allTasks = [], taskFilter = 'all', editingTaskId = null;
let allFileLogs = [], activeCategory = null;
let _popupTaskId = null;
let focusModeActive = false, selectedFocusMin = 25;
let selectedMood = 4;
let distractionAlerts = [];
let _allLifeReminders = [];   // cached from IPC
let _lrCatFilter = 'all';     // current category filter

const CATEGORY_META = {
  Documents:   { icon: '📄', color: '#6c63ff' },
  Images:      { icon: '🖼️', color: '#00d4aa' },
  Videos:      { icon: '🎬', color: '#ff6b6b' },
  Audio:       { icon: '🎵', color: '#ffd166' },
  Code:        { icon: '💻', color: '#98ff98' },
  Archives:    { icon: '📦', color: '#c896ff' },
  Executables: { icon: '⚙️', color: '#ff9f7f' },
  Others:      { icon: '📁', color: '#888' },
};

const CAT_COLORS = {
  Productive: '#00d4aa', Communication: '#6c63ff', Social: '#ff6b6b',
  Entertainment: '#ffd166', Reading: '#c896ff', System: '#888', Other: '#7fafff'
};

// Maps reminder id → category for filtering
const LR_CATEGORY_MAP = {
  water:      'hydration',
  breakfast:  'meals',
  lunch:      'meals',
  snack:      'meals',
  dinner:     'meals',
  afterlunch: 'meals',
  eyes:       'body',
  stretch:    'body',
  walk:       'body',
  posture:    'body',
  vitamins:   'body',
  breathe:    'mental',
  winddown:   'mental',
  sleep:      'mental',
  goals:      'work',
  deskclean:  'work',
  endofday:   'work',
};

// ── Init ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupFocusMode();
  setupTaskControls();
  setupFileControls();
  setupClipboard();
  setupDatePicker();
  setupBrowserDatePicker();
  setupSettings();
  setupIPCListeners();
  setupLifeReminders();
  loadDashboard();
  loadTasks();

  const today = new Date().toISOString().split('T')[0];
  document.getElementById('date-picker').value = today;
  document.getElementById('browser-date-picker').value = today;
  document.getElementById('dashboard-date').textContent =
    new Date().toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
});

// ── Navigation ─────────────────────────────────────────────────────
function setupNavigation() {
  document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.tab));
  });
}

function navigateTo(tab) {
  document.querySelectorAll('.nav-btn[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-content').forEach(s => s.classList.toggle('active', s.id === `tab-${tab}`));
  if (tab === 'dashboard')   loadDashboard();
  if (tab === 'screentime')  loadScreenTime();
  if (tab === 'browser')     loadBrowserActivity();
  if (tab === 'distraction') loadDistractionTab();
  if (tab === 'tasks')       { loadTasks(); loadLifeReminders(); }
  if (tab === 'files')       loadFileLogs();
  if (tab === 'clipboard')   loadClipboard();
  if (tab === 'mindmap')     initMindmapTab();
  if (tab === 'email')       initEmailTab();
  if (tab === 'document')    loadDocHistory();
}

// ── Dashboard ──────────────────────────────────────────────────────
async function loadDashboard() {
  const [statsRes, weeklyRes, screenRes, tasksRes] = await Promise.all([
    api.getDashboardStats(),
    api.getScreenTimeWeekly(),
    api.getScreenTimeData(new Date().toISOString().split('T')[0]),
    api.getTasks(),
  ]);

  if (statsRes.success) {
    const d = statsRes.data;
    document.getElementById('stat-tasks-done').textContent    = d.completedToday;
    document.getElementById('stat-tasks-pending').textContent  = d.pendingTasks;
    document.getElementById('stat-screen-time').textContent   = formatDuration(d.todayScreenTime);
    document.getElementById('stat-files').textContent         = d.filesOrganized;
    document.getElementById('stat-clipboard').textContent     = d.clipboardItems || 0;
    document.getElementById('stat-emails').textContent        = d.emailsAnalyzed || 0;
    document.getElementById('stat-docs').textContent          = d.documentsAnalyzed || 0;
  }

  try {
    const patternRes = await api.getWorkPattern();
    if (patternRes && patternRes.success && patternRes.data) {
      const p = patternRes.data;
      document.getElementById('stat-focus-score').textContent = p.focus_score + '%';
      if (p.recommendation) {
        document.getElementById('insight-text').textContent = p.recommendation;
        document.getElementById('insight-banner').classList.remove('hidden');
      }
    }
  } catch(e) {}

  if (weeklyRes.success) renderWeeklyChart(weeklyRes.data);

  if (screenRes.success && screenRes.data.length) {
    const topApps = screenRes.data.slice(0, 5);
    const total = screenRes.data.reduce((s, d) => s + d.duration_seconds, 0);
    document.getElementById('top-apps-list').innerHTML = topApps.map(a => `
      <div class="mini-row">
        <div class="mini-row-icon" style="background:${appColor(a.app_name)}22;color:${appColor(a.app_name)}">${appInitial(a.app_name)}</div>
        <div class="mini-row-body">
          <div class="mini-row-name">${escHtml(a.app_name)}</div>
          <div class="mini-row-bar"><div style="height:3px;border-radius:2px;background:${appColor(a.app_name)};width:${total?Math.round(a.duration_seconds/total*100):0}%"></div></div>
        </div>
        <div class="mini-row-time">${formatDuration(a.duration_seconds)}</div>
      </div>`).join('');
  } else {
    document.getElementById('top-apps-list').innerHTML = '<div class="empty-state">No screen time data yet</div>';
  }

  if (tasksRes.success) {
    allTasks = tasksRes.data;
    const upcoming = allTasks.filter(t => t.status !== 'completed' && t.deadline).sort((a,b) => new Date(a.deadline)-new Date(b.deadline)).slice(0, 4);
    document.getElementById('pending-badge').textContent = allTasks.filter(t => t.status !== 'completed').length;
    document.getElementById('upcoming-tasks-list').innerHTML = upcoming.length
      ? upcoming.map(t => `
        <div class="mini-row" style="cursor:pointer" onclick="navigateTo('tasks')">
          <div class="mini-row-icon" style="background:${t.priority==='high'?'rgba(255,107,107,0.15)':'rgba(108,99,255,0.15)'}">
            ${t.priority==='high'?'🔴':'📌'}
          </div>
          <div class="mini-row-body">
            <div class="mini-row-name">${escHtml(t.title)}</div>
            <div style="font-size:11px;color:var(--text-muted)">${t.deadline ? formatDeadlineFull(t.deadline) : ''}</div>
          </div>
        </div>`).join('')
      : '<div class="empty-state">No upcoming deadlines</div>';
  }
}

function renderWeeklyChart(data) {
  const ctx = document.getElementById('weeklyChart').getContext('2d');
  if (weeklyChart) weeklyChart.destroy();
  if (!data.length) return;
  weeklyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => { const dt = new Date(d.date); return dt.toLocaleDateString('en',{weekday:'short'}); }),
      datasets: [{ data: data.map(d => +(d.total_seconds/3600).toFixed(1)), backgroundColor: '#6c63ff88', borderColor: '#6c63ff', borderWidth: 2, borderRadius: 6 }]
    },
    options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { display: false } },
      scales: { x: { grid: { display: false }, ticks: { color: '#6b6b8a' } }, y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6b6b8a', callback: v => `${v}h` } } }
    }
  });
}

// ── Screen Time ────────────────────────────────────────────────────
function setupDatePicker() {
  document.getElementById('date-picker').addEventListener('change', loadScreenTime);
}
async function loadScreenTime() {
  const date = document.getElementById('date-picker').value;
  const res = await api.getScreenTimeData(date);
  if (!res.success) return;
  const data = res.data;
  const total = data.reduce((s, d) => s + d.duration_seconds, 0);
  document.getElementById('total-screen-time').textContent = `Total: ${formatDuration(total)}`;
  renderAppUsageChart(data.slice(0, 12));
  renderAppRows(data, total);
}
function renderAppUsageChart(data) {
  const ctx = document.getElementById('appUsageChart').getContext('2d');
  if (appUsageChart) appUsageChart.destroy();
  if (!data.length) return;
  const palette = ['#6c63ff','#00d4aa','#ff6b6b','#ffd166','#98ff98','#c896ff','#ff9f7f','#7fafff','#ffb3c6','#b5ead7','#ffdac1','#e2f0cb'];
  appUsageChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: data.map(d => d.app_name), datasets: [{ data: data.map(d => +(d.duration_seconds/60).toFixed(1)), backgroundColor: data.map((_,i) => palette[i%palette.length]), borderRadius: 6, borderSkipped: false }] },
    options: { indexAxis:'y', responsive:true, maintainAspectRatio:true, plugins:{ legend:{display:false} }, scales:{ x:{grid:{color:'rgba(255,255,255,0.04)'},ticks:{color:'#6b6b8a',callback:v=>`${v}m`}}, y:{grid:{display:false},ticks:{color:'#e8e8f0',font:{size:12}}} } }
  });
}
function renderAppRows(data, total) {
  const container = document.getElementById('app-rows-container');
  if (!data.length) { container.innerHTML = '<div class="empty-state">No data yet — use your computer and come back!</div>'; return; }
  container.innerHTML = data.map(d => {
    const pct = total ? Math.round(d.duration_seconds/total*100) : 0;
    const color = appColor(d.app_name);
    return `<div class="app-row"><div class="app-icon-placeholder" style="background:${color}22;color:${color}">${appInitial(d.app_name)}</div><div class="app-row-info"><div class="app-row-name">${escHtml(d.app_name)}</div><div class="app-row-bar"><div class="app-row-bar-fill" style="width:${pct}%;background:${color}"></div></div></div><div class="app-row-time">${formatDuration(d.duration_seconds)}</div><div class="app-row-pct">${pct}%</div></div>`;
  }).join('');
}

// ── Browser Activity ───────────────────────────────────────────────
function setupBrowserDatePicker() {
  document.getElementById('browser-date-picker').addEventListener('change', loadBrowserActivity);
}
async function loadBrowserActivity() {
  const date = document.getElementById('browser-date-picker').value;
  const [sitesRes, catRes] = await Promise.all([api.getBrowserActivity(date), api.getBrowserByCategory(date)]);
  const ctx = document.getElementById('browserCatChart').getContext('2d');
  if (browserCatChart) browserCatChart.destroy();
  if (catRes.success && catRes.data.length) {
    const total = catRes.data.reduce((s,r) => s+r.seconds, 0);
    document.getElementById('browser-total').textContent = `Total: ${formatDuration(total)}`;
    browserCatChart = new Chart(ctx, {
      type: 'doughnut',
      data: { labels: catRes.data.map(d=>d.category), datasets: [{ data: catRes.data.map(d=>d.seconds), backgroundColor: catRes.data.map(d=>CAT_COLORS[d.category]||'#888'), borderWidth: 0 }] },
      options: { responsive:true, maintainAspectRatio:true, plugins:{ legend:{ position:'bottom', labels:{color:'#6b6b8a',padding:10,font:{size:11}} } } }
    });
  }
  const el = document.getElementById('browser-sites-list');
  if (!sitesRes.success || !sitesRes.data.length) { el.innerHTML = '<div class="empty-state">No browser activity recorded yet</div>'; return; }
  el.innerHTML = sitesRes.data.slice(0, 30).map(s => `
    <div class="site-row">
      <span class="site-cat-badge" style="background:${CAT_COLORS[s.category]||'#888'}22;color:${CAT_COLORS[s.category]||'#888'}">${s.category}</span>
      <span class="site-name">${escHtml(s.site)}</span>
      <span class="site-time">${formatDuration(s.seconds)}</span>
    </div>`).join('');
}

// ── Focus Mode ─────────────────────────────────────────────────────
function setupFocusMode() {
  document.querySelectorAll('.focus-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.focus-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedFocusMin = parseInt(btn.dataset.min);
    });
  });
  document.getElementById('btn-focus-toggle').addEventListener('click', toggleFocusMode);
}
async function toggleFocusMode() {
  const btn = document.getElementById('btn-focus-toggle');
  const badge = document.getElementById('focus-mode-status');
  if (!focusModeActive) {
    await api.enableFocusMode(selectedFocusMin);
    focusModeActive = true;
    btn.textContent = '⏹ Stop Focus Mode';
    btn.style.background = 'var(--danger)';
    badge.textContent = 'ON';
    badge.className = 'focus-badge on';
    showToast(`🎯 Focus mode ON for ${selectedFocusMin} min!`, 'success');
  } else {
    await api.disableFocusMode();
    focusModeActive = false;
    btn.textContent = '🎯 Start Focus Mode';
    btn.style.background = '';
    badge.textContent = 'OFF';
    badge.className = 'focus-badge off';
    showToast('Focus mode ended', 'info');
  }
}
async function loadDistractionTab() {
  const statsRes = await api.getDistractionStats();
  if (statsRes.success) {
    const s = statsRes.data;
    if (s.distractedMinutes > 0) {
      document.getElementById('distraction-log').innerHTML = `
        <div class="site-row"><span class="site-cat-badge" style="background:rgba(255,209,102,0.15);color:#ffd166">TODAY</span>
        <span class="site-name">Distracted for <strong>${s.distractedMinutes} min</strong></span></div>
        ${distractionAlerts.slice(-5).reverse().map(a => `
          <div class="site-row">
            <span class="site-cat-badge" style="background:${a.level==='urgent'?'rgba(255,107,107,0.15)':'rgba(255,209,102,0.15)'};color:${a.level==='urgent'?'var(--danger)':'#ffd166'}">${a.level}</span>
            <span class="site-name">${escHtml(a.body||'')}</span>
          </div>`).join('')}`;
    } else {
      document.getElementById('distraction-log').innerHTML = '<div class="empty-state">No distraction alerts today 🎉</div>';
    }
  }
  const screenRes = await api.getScreenTimeData(new Date().toISOString().split('T')[0]);
  if (screenRes.success && screenRes.data.length) {
    const ctx = document.getElementById('distractionChart').getContext('2d');
    if (distractionChart) distractionChart.destroy();
    const productive  = screenRes.data.filter(r => !isDistractingApp(r.app_name)).reduce((s,r)=>s+r.duration_seconds,0);
    const distracting = screenRes.data.filter(r => isDistractingApp(r.app_name)).reduce((s,r)=>s+r.duration_seconds,0);
    const other = Math.max(0, screenRes.data.reduce((s,r)=>s+r.duration_seconds,0) - productive - distracting);
    distractionChart = new Chart(ctx, {
      type: 'doughnut',
      data: { labels:['Productive','Distracting','Other'], datasets:[{data:[productive/60,distracting/60,other/60],backgroundColor:['#00d4aa','#ff6b6b','#6b6b8a'],borderWidth:0}] },
      options: { responsive:true, maintainAspectRatio:true, plugins:{ legend:{position:'bottom',labels:{color:'#6b6b8a',padding:10,font:{size:11}}}, tooltip:{callbacks:{label:c=>`${Math.round(c.raw)}m`}} } }
    });
  }
}
function isDistractingApp(name) {
  if (!name) return false;
  return ['youtube','netflix','facebook','instagram','twitter','tiktok','reddit','discord','spotify','twitch'].some(d => name.toLowerCase().includes(d));
}

// ── Tasks ──────────────────────────────────────────────────────────
function setupTaskControls() {
  document.getElementById('btn-add-task').addEventListener('click', () => {
    editingTaskId = null;
    document.getElementById('task-form-title').textContent = 'New Task';
    document.getElementById('task-title').value = '';
    document.getElementById('task-desc').value = '';
    document.getElementById('task-deadline').value = '';
    document.getElementById('task-priority').value = 'medium';
    document.getElementById('task-form-card').classList.remove('hidden');
  });
  document.getElementById('btn-cancel-task').addEventListener('click', () => document.getElementById('task-form-card').classList.add('hidden'));
  document.getElementById('btn-save-task').addEventListener('click', saveTask);
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      taskFilter = btn.dataset.filter;
      renderTasks();
    });
  });
}
async function saveTask() {
  const title = document.getElementById('task-title').value.trim();
  if (!title) { showToast('Task title is required', 'error'); return; }
  const task = { title, description: document.getElementById('task-desc').value.trim(), deadline: document.getElementById('task-deadline').value || null, priority: document.getElementById('task-priority').value };
  let savedId;
  if (editingTaskId) {
    await api.updateTask(editingTaskId, task);
    showToast('Task updated', 'success');
  } else {
    const res = await api.createTask(task);
    if (res.success) savedId = res.data?.id;
    showToast('Task created! Generating AI plan...', 'success');
  }
  document.getElementById('task-form-card').classList.add('hidden');
  await loadTasks();
  if (savedId) {
    setTimeout(async () => {
      const planRes = await api.planTask(savedId);
      if (planRes.success) { showToast('✅ AI plan ready — click task to view', 'success'); loadTasks(); }
    }, 500);
  }
}
async function loadTasks() {
  const res = await api.getTasks();
  if (res.success) { allTasks = res.data; renderTasks(); }
}
function renderTasks() {
  const el = document.getElementById('tasks-list');
  let filtered = allTasks;
  if (taskFilter !== 'all') filtered = allTasks.filter(t => t.status === taskFilter);
  document.getElementById('pending-badge').textContent = allTasks.filter(t => t.status !== 'completed').length;
  if (!filtered.length) { el.innerHTML = '<div class="empty-state">No tasks found</div>'; return; }
  el.innerHTML = filtered.map(t => {
    const isComplete = t.status === 'completed';
    const dl = t.deadline ? getDeadlineClass(t.deadline) : null;
    const deadlineDisplay = t.deadline ? formatDeadlineFull(t.deadline) : null;
    const hasPlan = t.has_plan && t.subtasks && t.subtasks.length;
    const doneSubtasks = hasPlan ? t.subtasks.filter(s=>s.status==='completed').length : 0;
    return `
      <div class="task-card ${isComplete?'completed':''}">
        <div class="task-check ${isComplete?'done':''}" onclick="toggleTask(${t.id},${isComplete})">${isComplete?'✓':''}</div>
        <div class="task-body">
          <div class="task-title">${escHtml(t.title)}</div>
          ${t.description ? `<div class="task-desc">${escHtml(t.description)}</div>` : ''}
          <div class="task-meta">
            <span class="priority-label pl-${t.priority}">${t.priority.toUpperCase()}</span>
            ${deadlineDisplay ? `<span class="deadline-badge ${dl?dl.cls:''}">🕐 ${deadlineDisplay}</span>` : ''}
            ${hasPlan ? `<span class="deadline-badge" style="background:rgba(0,212,170,0.1);color:var(--success);cursor:pointer" onclick="showTaskPlan(${t.id})">📋 Plan ${doneSubtasks}/${t.subtasks.length}</span>` : ''}
          </div>
        </div>
        <div class="task-actions">
          ${!hasPlan && !isComplete ? `<button class="btn btn-sm btn-ghost" onclick="generatePlan(${t.id})" style="color:var(--accent-2)">🤖 Plan</button>` : ''}
          ${!isComplete ? `<button class="btn btn-sm btn-ghost" onclick="editTask(${t.id})">Edit</button>` : ''}
          <button class="btn btn-sm btn-ghost" onclick="deleteTask(${t.id})" style="color:var(--danger)">Del</button>
        </div>
      </div>`;
  }).join('');
}
window.generatePlan = async function(id) {
  showToast('🤖 Generating AI plan...', 'info');
  const res = await api.planTask(id);
  if (res.success) { showToast('✅ Plan ready!', 'success'); loadTasks(); showTaskPlan(id); }
  else showToast('Plan failed: ' + (res.error||'unknown'), 'error');
};
window.showTaskPlan = function(id) {
  const task = allTasks.find(t => t.id === id);
  if (!task || !task.subtasks) return;
  const modal = document.getElementById('plan-modal');
  document.getElementById('plan-modal-title').textContent = `📋 Plan: ${task.title}`;
  document.getElementById('plan-modal-body').innerHTML = `
    <div style="display:flex;gap:12px;margin-bottom:14px;flex-wrap:wrap;">
      <span class="clip-cat cat-Code">~${task.estimated_hours||'?'}h total</span>
      <span class="clip-cat" style="background:rgba(108,99,255,0.1);color:var(--accent)">${task.subtasks.length} subtasks</span>
    </div>
    <div class="subtask-list">
      ${task.subtasks.map(s => `
        <div class="subtask-item">
          <div class="subtask-check ${s.status==='completed'?'done':''}" onclick="completeSubtask(${s.id}, this)">${s.status==='completed'?'✓':''}</div>
          <span class="subtask-day">Day ${s.day}</span>
          <div style="flex:1"><div class="subtask-title">${escHtml(s.title)}</div>${s.description?`<div style="font-size:11px;color:var(--text-muted);margin-top:2px">${escHtml(s.description)}</div>`:''}</div>
          <span class="subtask-hours">${s.duration_hours}h</span>
        </div>`).join('')}
    </div>
    ${task.tip ? `<div class="plan-tip">💡 ${escHtml(task.tip)}</div>` : ''}`;
  modal.classList.remove('hidden');
};
window.completeSubtask = async function(id, el) {
  await api.completeSubtask(id);
  el.classList.add('done'); el.textContent = '✓';
  loadTasks();
};
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-close-plan').addEventListener('click', () => document.getElementById('plan-modal').classList.add('hidden'));
  document.getElementById('plan-backdrop').addEventListener('click', () => document.getElementById('plan-modal').classList.add('hidden'));
});
async function toggleTask(id, isComplete) {
  if (isComplete) await api.updateTask(id, { status: 'pending', completed_at: null });
  else { await api.completeTask(id); showToast('Task completed! ✓', 'success'); }
  loadTasks();
}
async function deleteTask(id) {
  if (!confirm('Delete this task?')) return;
  await api.deleteTask(id); loadTasks();
}
function editTask(id) {
  const task = allTasks.find(t => t.id === id);
  if (!task) return;
  editingTaskId = id;
  document.getElementById('task-form-title').textContent = 'Edit Task';
  document.getElementById('task-title').value   = task.title;
  document.getElementById('task-desc').value    = task.description || '';
  document.getElementById('task-deadline').value = task.deadline ? toLocalDateTimeInput(new Date(task.deadline)) : '';
  document.getElementById('task-priority').value = task.priority;
  document.getElementById('task-form-card').classList.remove('hidden');
  document.getElementById('task-form-card').scrollIntoView({ behavior:'smooth' });
}
window.toggleTask = toggleTask;
window.deleteTask = deleteTask;
window.editTask   = editTask;

// ── File Organizer ─────────────────────────────────────────────────
function setupFileControls() {
  document.getElementById('btn-scan').addEventListener('click', async () => {
    const btn = document.getElementById('btn-scan');
    btn.textContent = '⟳ Scanning...'; btn.disabled = true;
    const res = await api.triggerScan();
    btn.textContent = '⟳ Scan Downloads'; btn.disabled = false;
    if (res.success) { showToast(`Scan complete: ${res.data.organized} files organized`, 'success'); loadFileLogs(); }
  });
  document.getElementById('btn-back-categories').addEventListener('click', () => {
    activeCategory = null;
    document.getElementById('files-panel').classList.add('hidden');
    document.getElementById('recent-activity').style.display = '';
    document.getElementById('category-grid').style.display = '';
  });
}
async function loadFileLogs() {
  const logsRes = await api.getFileLogs();
  if (logsRes.success) allFileLogs = logsRes.data;
  const catCounts = {};
  allFileLogs.forEach(f => { catCounts[f.category] = (catCounts[f.category]||0)+1; });
  const totalFiles = allFileLogs.length;
  document.getElementById('total-files-count').textContent = totalFiles > 0 ? `${totalFiles} files organized` : '';
  renderCategoryGrid(catCounts, totalFiles);
  renderRecentActivity(allFileLogs.slice(0, 50));
}
function renderCategoryGrid(catCounts, total) {
  document.getElementById('category-grid').innerHTML = Object.keys(CATEGORY_META).map(cat => {
    const meta = CATEGORY_META[cat]; const count = catCounts[cat] || 0;
    const pct = total > 0 ? Math.round(count/total*100) : 0;
    return `<div class="category-folder" style="--folder-color:${meta.color}" onclick="showCategoryFiles('${cat}')">
      <div class="folder-icon">${meta.icon}</div><div class="folder-name">${cat}</div>
      <div class="folder-count">${count}</div><div class="folder-label">files</div>
      <div class="folder-bar"><div class="folder-bar-fill" style="width:${pct}%;background:${meta.color}"></div></div>
    </div>`;
  }).join('');
}
window.showCategoryFiles = function(category) {
  const meta = CATEGORY_META[category]||{icon:'📁',color:'#888'};
  const files = allFileLogs.filter(f => f.category === category);
  document.getElementById('files-panel').classList.remove('hidden');
  document.getElementById('files-panel-title').textContent = `${meta.icon} ${category}`;
  document.getElementById('files-panel-title').style.color = meta.color;
  document.getElementById('files-panel-count').textContent = `${files.length} files`;
  document.getElementById('recent-activity').style.display = 'none';
  document.getElementById('category-grid').style.display = 'none';
  const list = document.getElementById('files-panel-list');
  if (!files.length) { list.innerHTML = '<div class="empty-state">No files in this category yet.</div>'; return; }
  list.innerHTML = files.map(f => `
    <div class="file-log-item">
      <span class="file-cat-badge cat-${f.category}" style="background:${meta.color}22;color:${meta.color}">${(f.file_type||'?').toUpperCase()}</span>
      <span class="file-name" title="${escHtml(f.file_name)}">${escHtml(f.file_name)}</span>
      <span class="file-time">${formatFileSize(f.size_bytes)}</span>
      <span class="file-time">${formatDateShort(f.organized_at)}</span>
    </div>`).join('');
};
function renderRecentActivity(logs) {
  const el = document.getElementById('file-log-list');
  document.getElementById('file-log-count').textContent = `${allFileLogs.length} total`;
  if (!logs.length) { el.innerHTML = '<div class="empty-state">No files organized yet.</div>'; return; }
  el.innerHTML = logs.map(f => `
    <div class="file-log-item">
      <span class="file-cat-badge cat-${f.category}">${f.category}</span>
      <span class="file-name">${escHtml(f.file_name)}</span>
      <span class="file-time" style="color:var(--text-muted);font-size:11px">${formatFileSize(f.size_bytes)}</span>
      <span class="file-time">${formatDateShort(f.organized_at)}</span>
    </div>`).join('');
}

// ── Clipboard ──────────────────────────────────────────────────────
function setupClipboard() {
  document.getElementById('clipboard-filter').addEventListener('change', loadClipboard);
  document.getElementById('btn-clear-clipboard').addEventListener('click', async () => {
    if (!confirm('Clear all clipboard history?')) return;
    await api.clearClipboard(); loadClipboard(); showToast('Clipboard cleared', 'info');
  });
}
async function loadClipboard() {
  const cat = document.getElementById('clipboard-filter').value;
  const res = await api.getClipboard({ limit: 200, category: cat || undefined });
  const el = document.getElementById('clipboard-list');
  if (!res.success || !res.data.length) {
    el.innerHTML = `<div class="empty-state">No clipboard history${cat ? ` for ${cat}` : ''}. Copy something!</div>`;
    renderClipboardStats([]); return;
  }
  renderClipboardStats(res.data);
  el.innerHTML = res.data.map(item => `
    <div class="clip-item" onclick="copyToClipboard('${encodeURIComponent(item.content)}', ${item.id})">
      <span class="clip-cat cat-${item.category}">${item.category}</span>
      <span class="clip-content" title="${escHtml(item.content)}">${escHtml(item.content.slice(0,120))}${item.content.length>120?'…':''}</span>
      <span class="clip-meta">${formatDateShort(item.copied_at)}</span>
      <button class="clip-delete" onclick="event.stopPropagation();deleteClip(${item.id})">✕</button>
    </div>`).join('');
}
function renderClipboardStats(items) {
  const cats = {};
  items.forEach(i => { cats[i.category] = (cats[i.category]||0)+1; });
  document.getElementById('clipboard-stats').innerHTML =
    `<span class="clip-stat">Total: ${items.length}</span>` +
    Object.entries(cats).map(([c,n]) => `<span class="clip-stat cat-${c}" style="background:transparent">${c}: ${n}</span>`).join('');
}
window.copyToClipboard = async function(encoded) {
  try { await navigator.clipboard.writeText(decodeURIComponent(encoded)); showToast('Copied! ✓', 'success'); }
  catch(e) { showToast('Copy failed', 'error'); }
};
window.deleteClip = async function(id) { await api.deleteClipboardEntry(id); loadClipboard(); };

// ── IPC Listeners ──────────────────────────────────────────────────
function setupIPCListeners() {
  api.onTaskReminder((data) => { showTaskDuePopup(data); loadTasks(); });
  api.onFileOrganized((data) => {
    showToast(`📁 Moved "${data.file_name}" → ${data.category}`, 'info');
    if (document.getElementById('tab-files').classList.contains('active')) loadFileLogs();
  });
  api.onScreenTimeUpdate(() => {
    clearTimeout(window._screenRefresh);
    window._screenRefresh = setTimeout(() => {
      if (document.getElementById('tab-dashboard').classList.contains('active')) loadDashboard();
    }, 15000);
  });
  api.onClipboardNew((data) => {
    showToast(`📋 Copied: ${data.category} — ${data.content.slice(0,30)}`, 'info');
    if (document.getElementById('tab-clipboard').classList.contains('active')) loadClipboard();
  });
  api.onWorkPatternUpdate((data) => {
    if (data.recommendation) {
      document.getElementById('insight-text').textContent = data.recommendation;
      document.getElementById('insight-banner').classList.remove('hidden');
    }
  });
  api.onDistractionAlert((data) => { distractionAlerts.push(data); showDistractionPopup(data); });
  api.onStandupPrompt(() => { showToast('🌅 Good morning! Check your MindMap Coach', 'info'); navigateTo('mindmap'); });
  api.onFocusModeEnded(() => {
    focusModeActive = false;
    document.getElementById('btn-focus-toggle').textContent = '🎯 Start Focus Mode';
    document.getElementById('btn-focus-toggle').style.background = '';
    document.getElementById('focus-mode-status').textContent = 'OFF';
    document.getElementById('focus-mode-status').className = 'focus-badge off';
    showToast('🎉 Focus session complete!', 'success');
  });

  // Life reminder toast — shows popup when a life reminder fires
  if (api.onLifeReminder) {
    api.onLifeReminder((data) => {
      showToast(`${data.emoji} ${data.label}: ${data.body}`, 'info');
    });
  }
}

// ── Task Due Popup ─────────────────────────────────────────────────
function showTaskDuePopup(data) {
  _popupTaskId = data.id;
  document.getElementById('task-popup-title').textContent = `⏰ ${data.title}`;
  const deadline = new Date(data.deadline);
  const diffMins = Math.round((deadline - Date.now()) / 60000);
  const timeStr = deadline.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit', hour12:true });
  document.getElementById('task-popup-sub').textContent = diffMins <= 0 ? `Due now! (${data.priority} priority)` : `Due at ${timeStr} — ${diffMins} min left · ${data.priority} priority`;
  document.getElementById('task-due-popup').classList.remove('hidden');
  clearTimeout(window._popupTimer);
  window._popupTimer = setTimeout(() => dismissTaskPopup(false), 30000);
}
window.dismissTaskPopup = function(markDone) {
  document.getElementById('task-due-popup').classList.add('hidden');
  clearTimeout(window._popupTimer);
  if (markDone && _popupTaskId) { api.completeTask(_popupTaskId).then(() => { showToast('Task marked complete ✓', 'success'); loadTasks(); }); }
};
function showDistractionPopup(data) {
  document.getElementById('distraction-popup-title').textContent = data.title;
  document.getElementById('distraction-popup-sub').textContent   = data.body || '';
  const popup = document.getElementById('distraction-popup');
  popup.classList.remove('hidden');
  popup.style.borderColor = data.level === 'urgent' ? 'var(--danger)' : 'var(--warning)';
  setTimeout(() => popup.classList.add('hidden'), 20000);
}

// ── Settings ───────────────────────────────────────────────────────
function setupSettings() {
  document.getElementById('btn-open-settings').addEventListener('click', async () => {
    document.getElementById('settings-modal').classList.remove('hidden');
    const res = await api.getApiKey();
    if (res.success && res.data) {
      document.getElementById('api-key-input').value = res.data;
      document.getElementById('api-key-status').textContent = '✅ API key saved';
      document.getElementById('api-key-status').style.color = 'var(--success)';
    }
  });
  document.getElementById('btn-close-settings').addEventListener('click', () => document.getElementById('settings-modal').classList.add('hidden'));
  document.getElementById('settings-backdrop').addEventListener('click', () => document.getElementById('settings-modal').classList.add('hidden'));
  document.getElementById('btn-save-api-key').addEventListener('click', async () => {
    const key = document.getElementById('api-key-input').value.trim();
    const status = document.getElementById('api-key-status');
    if (!key) { status.textContent = '⚠ Please enter an API key'; status.style.color = 'var(--warning)'; return; }
    const res = await api.saveApiKey(key);
    if (res.success) { status.textContent = '✅ Saved! AI features enabled'; status.style.color = 'var(--success)'; showToast('API key saved!', 'success'); }
  });
}

// ── Deadline Presets ───────────────────────────────────────────────
window.setDeadlinePreset = function(minutes) { document.getElementById('task-deadline').value = toLocalDateTimeInput(new Date(Date.now() + minutes*60000)); };
window.setDeadlineTomorrow9am = function() { const d = new Date(); d.setDate(d.getDate()+1); d.setHours(9,0,0,0); document.getElementById('task-deadline').value = toLocalDateTimeInput(d); };

// ══════════════════════════════════════════════════════════════════
// ── LIFE REMINDERS UI ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

function setupLifeReminders() {
  // Category filter tabs
  document.querySelectorAll('.lr-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lr-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _lrCatFilter = btn.dataset.lrcat;
      renderLifeReminders();
    });
  });

  // Enable/Disable all
  document.getElementById('btn-lr-enable-all').addEventListener('click', async () => {
    for (const r of _allLifeReminders) {
      if (!r.enabled) await api.invoke('toggle-life-reminder', r.id, true);
    }
    showToast('All reminders enabled ✓', 'success');
    loadLifeReminders();
  });
  document.getElementById('btn-lr-disable-all').addEventListener('click', async () => {
    for (const r of _allLifeReminders) {
      if (r.enabled) await api.invoke('toggle-life-reminder', r.id, false);
    }
    showToast('All reminders disabled', 'info');
    loadLifeReminders();
  });
}

async function loadLifeReminders() {
  try {
    const res = await api.invoke('get-life-reminders');
    if (!res.success) return;
    _allLifeReminders = res.data;
    renderLifeReminders();
    updateLifeReminderStats();
  } catch(e) {
    document.getElementById('lr-grid').innerHTML = '<div class="lr-empty">Life reminders not available</div>';
  }
}

function renderLifeReminders() {
  const grid = document.getElementById('lr-grid');
  let reminders = _allLifeReminders;

  // Apply category filter
  if (_lrCatFilter !== 'all') {
    reminders = reminders.filter(r => LR_CATEGORY_MAP[r.id] === _lrCatFilter);
  }

  if (!reminders.length) {
    grid.innerHTML = '<div class="lr-empty">No reminders in this category</div>';
    return;
  }

  grid.innerHTML = reminders.map(r => {
    const schedule = r.type === 'interval'
      ? `Every ${r.intervalMins} min`
      : `Daily at ${(r.times || []).join(', ')}`;

    return `
      <div class="lr-card ${r.enabled ? 'enabled' : ''}" id="lr-card-${r.id}">
        <div class="lr-emoji">${r.emoji}</div>
        <div class="lr-info">
          <div class="lr-label">${escHtml(r.label)}</div>
          <div class="lr-schedule">⏰ ${schedule}</div>
          <div class="lr-body-text">${escHtml(r.body)}</div>
        </div>
        <div class="lr-actions">
          <label class="lr-toggle" title="${r.enabled ? 'Click to disable' : 'Click to enable'}">
            <input type="checkbox" ${r.enabled ? 'checked' : ''}
              onchange="toggleLifeReminder('${r.id}', this.checked)">
            <span class="lr-toggle-slider"></span>
          </label>
          <button class="lr-test-btn" onclick="testLifeReminder('${r.id}')">Test 🔔</button>
        </div>
      </div>`;
  }).join('');
}

function updateLifeReminderStats() {
  const total    = _allLifeReminders.length;
  const active   = _allLifeReminders.filter(r => r.enabled).length;
  const interval = _allLifeReminders.filter(r => r.type === 'interval').length;
  const daily    = _allLifeReminders.filter(r => r.type === 'daily').length;

  document.getElementById('lr-stat-total').textContent    = total;
  document.getElementById('lr-stat-on').textContent       = active;
  document.getElementById('lr-stat-interval').textContent = interval;
  document.getElementById('lr-stat-daily').textContent    = daily;
  document.getElementById('lr-enabled-count').textContent = `${active} of ${total} active`;
}

window.toggleLifeReminder = async function(id, enabled) {
  try {
    await api.invoke('toggle-life-reminder', id, enabled);
    // Update local cache immediately for snappy UI
    const r = _allLifeReminders.find(r => r.id === id);
    if (r) r.enabled = enabled;
    // Update card class
    const card = document.getElementById(`lr-card-${id}`);
    if (card) card.classList.toggle('enabled', enabled);
    updateLifeReminderStats();
    showToast(enabled ? `✅ ${id} reminder ON` : `🔕 ${id} reminder OFF`, enabled ? 'success' : 'info');
  } catch(e) {
    showToast('Failed to update reminder', 'error');
  }
};

window.testLifeReminder = async function(id) {
  try {
    await api.invoke('test-life-reminder', id);
    showToast('🔔 Test notification sent!', 'success');
  } catch(e) {
    showToast('Test failed', 'error');
  }
};

// ── MindMap Daily Coach ────────────────────────────────────────────
let _mindmapReport = null;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-mindmap-refresh').addEventListener('click', async () => {
    showMindmapLoading();
    const res = await api.mindmapRefresh();
    if (res.success) renderMindmapReport(res.data);
    else showToast('Refresh failed: ' + res.error, 'error');
  });
  document.getElementById('btn-mindmap-share').addEventListener('click', async () => {
    const res = await api.mindmapShareable();
    if (!res.success) { showToast('Failed to generate report', 'error'); return; }
    try { await navigator.clipboard.writeText(res.data); showToast('📤 Report copied to clipboard!', 'success'); }
    catch(e) { showToast('Copy failed', 'error'); }
  });
  document.getElementById('btn-copy-standup').addEventListener('click', () => {
    if (!_mindmapReport) return;
    const s = _mindmapReport.standup;
    if (!s) return;
    const text = `✅ Yesterday: ${s.yesterday||''}\n🎯 Today: ${s.today||''}\n🚧 Blockers: ${s.blockers||'None'}`;
    navigator.clipboard.writeText(text).then(() => showToast('Standup copied! ✓', 'success'));
  });
  document.getElementById('mm-blockers-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (val) { api.mindmapSaveMood(null, val); showToast('Blockers saved ✓', 'success'); }
    }
  });
  if (api.onMindmapReport) {
    api.onMindmapReport(report => {
      _mindmapReport = report;
      if (document.getElementById('tab-mindmap').classList.contains('active')) renderMindmapReport(report);
    });
  }
});

async function initMindmapTab() {
  if (_mindmapReport) { renderMindmapReport(_mindmapReport); return; }
  showMindmapLoading();
  const res = await api.mindmapGetReport();
  if (res.success) { _mindmapReport = res.data; renderMindmapReport(res.data); }
  else { showToast('Could not load report: ' + res.error, 'error'); hideMindmapLoading(); }
}
function showMindmapLoading() {
  document.getElementById('mindmap-loading').classList.remove('hidden');
  document.getElementById('mindmap-report').classList.add('hidden');
}
function hideMindmapLoading() {
  document.getElementById('mindmap-loading').classList.add('hidden');
  document.getElementById('mindmap-report').classList.remove('hidden');
}
function renderMindmapReport(report) {
  if (!report) return;
  _mindmapReport = report;
  hideMindmapLoading();
  const ai  = report.ai || report;
  const ctx = report.context || null;
  const stats = report.stats || {};
  const badge = document.getElementById('mindmap-source-badge');
  badge.style.display = 'inline-flex';
  const provider = report.provider || report.source || 'local';
  if (provider !== 'local') { badge.textContent = `🤖 AI Powered (${provider})`; badge.className = 'gmail-badge connected'; }
  else { badge.textContent = '⚡ Local Analysis'; badge.className = 'gmail-badge disconnected'; }
  document.getElementById('mindmap-date-label').textContent = new Date().toLocaleDateString('en-IN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const hour = new Date().getHours();
  document.getElementById('mindmap-greeting-emoji').textContent = hour < 12 ? '🌅' : hour < 17 ? '☀️' : '🌙';
  document.getElementById('mindmap-greeting-text').textContent  = ai.greeting || 'Good day!';
  const burnoutCard = document.getElementById('mindmap-burnout-card');
  const burnoutLevel = ai.burnout_level || 'low';
  if (burnoutLevel === 'high') { burnoutCard.classList.remove('hidden','medium'); document.getElementById('mindmap-burnout-text').textContent = ai.burnout_status || ''; }
  else if (burnoutLevel === 'medium') { burnoutCard.classList.remove('hidden'); burnoutCard.classList.add('medium'); document.getElementById('mindmap-burnout-text').textContent = ai.burnout_status || ''; }
  else burnoutCard.classList.add('hidden');
  const todayHours = ctx ? ctx.screen?.todayHours  : (stats.totalMinutes ? (stats.totalMinutes/60).toFixed(1) : '0');
  const focusScore = ctx ? ctx.screen?.focusScore  : (stats.focusMinutes && stats.totalMinutes ? Math.round(stats.focusMinutes/stats.totalMinutes*100) : 0);
  const tasksDone  = ctx ? ctx.tasks?.completed    : (stats.tasksCompleted || 0);
  document.getElementById('mm-hours-today').textContent = todayHours + 'h';
  document.getElementById('mm-focus-score').textContent = focusScore + '%';
  document.getElementById('mm-tasks-done').textContent  = tasksDone;
  document.getElementById('mm-streak').textContent      = (ctx?.patterns?.streak || 0) + 'd';
  document.getElementById('mm-week-hours').textContent  = (ctx?.burnout?.totalWeekHours || 0) + 'h';
  document.getElementById('mm-today-plan').textContent    = ai.today_plan    || '';
  document.getElementById('mm-coaching-tip').textContent  = ai.coaching_tip  || '';
  document.getElementById('mm-focus-insight').textContent = ai.focus_insight || '';
  document.getElementById('mm-weekly-digest').textContent = ai.weekly_digest || '';
  document.getElementById('mm-achievement').textContent   = ai.achievement   || '';
  const qwEl = document.getElementById('mm-quick-wins');
  if (ai.quick_wins && ai.quick_wins.length) {
    qwEl.innerHTML = `<div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;">⚡ Quick Wins</div>` +
      ai.quick_wins.map((w,i) => `<div class="quick-win-item"><div class="quick-win-num">${i+1}</div><span>${escHtml(w)}</span></div>`).join('');
  }
  const standup = report.standup || null;
  if (standup) {
    document.getElementById('mm-standup-yesterday').textContent = standup.yesterday || standup.completed || 'N/A';
    document.getElementById('mm-standup-today').textContent     = standup.today     || standup.working_on || 'N/A';
    document.getElementById('mm-standup-blockers').textContent  = standup.blockers  || 'None';
  } else {
    document.getElementById('mm-standup-yesterday').textContent = 'No data yet';
    document.getElementById('mm-standup-today').textContent     = 'No data yet';
    document.getElementById('mm-standup-blockers').textContent  = 'None';
  }
  const weeklyData = ctx ? ctx.screen?.weeklyData : stats.weekDayTotals;
  if (weeklyData) renderMiniWeekChart(weeklyData);
}
function renderMiniWeekChart(weeklyData) {
  const el = document.getElementById('mm-week-chart');
  if (!weeklyData) { el.innerHTML = ''; return; }
  let entries = [];
  if (Array.isArray(weeklyData)) {
    entries = weeklyData.map(d => ({ label: new Date(d.date+'T12:00:00').toLocaleDateString('en',{weekday:'short'}), hours: d.total/3600, isToday: d.date === new Date().toISOString().split('T')[0] }));
  } else {
    entries = Object.entries(weeklyData).map(([day, hours]) => ({ label: day, hours, isToday: false }));
  }
  if (!entries.length) { el.innerHTML = ''; return; }
  const maxHrs = Math.max(...entries.map(e => e.hours), 1);
  el.innerHTML = entries.map(e => {
    const pct = Math.max((e.hours / maxHrs) * 52, e.hours > 0 ? 6 : 2);
    return `<div class="mm-week-bar-wrap" title="${e.label}: ${e.hours.toFixed(1)}h"><div class="mm-week-bar ${e.isToday ? 'today' : ''}" style="height:${pct}px;"></div><div class="mm-week-label">${e.isToday ? '●' : e.label}</div></div>`;
  }).join('');
}
window.setMood = async function(mood) {
  document.querySelectorAll('.mood-btn').forEach(b => { b.classList.toggle('active', parseInt(b.dataset.mood) === mood); });
  const blockers = document.getElementById('mm-blockers-input').value.trim();
  await api.mindmapSaveMood(mood, blockers || null);
  showToast('Mood saved ✓', 'success');
};

// ── Email Manager ──────────────────────────────────────────────────
let _gmailConnected = false;
window.openLink = function(url) { window.open(url); };
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-analyze-email').addEventListener('click', analyzeEmailManual);
  document.getElementById('btn-toggle-paste').addEventListener('click', () => { document.getElementById('manual-paste-body').classList.toggle('hidden'); });
  document.getElementById('btn-gmail-connect').addEventListener('click', connectGmail);
  document.getElementById('btn-gmail-fetch-inbox').addEventListener('click', fetchGmailInbox);
  document.getElementById('btn-gmail-disconnect').addEventListener('click', disconnectGmail);
});
async function initEmailTab() {
  const res = await api.gmailStatus();
  if (!res.success) return;
  _gmailConnected = res.connected;
  updateGmailUI(res.connected, res.account);
  loadEmailHistory();
  if (res.connected) fetchGmailInbox();
}
function updateGmailUI(connected, account) {
  const badge = document.getElementById('gmail-status-badge');
  const connectCard = document.getElementById('gmail-connect-card');
  const inboxCard = document.getElementById('gmail-inbox-card');
  const fetchBtn = document.getElementById('btn-gmail-fetch-inbox');
  const disconnectBtn = document.getElementById('btn-gmail-disconnect');
  if (connected) {
    badge.textContent = `🟢 Gmail: ${account || 'Connected'}`; badge.className = 'gmail-badge connected';
    connectCard.classList.add('hidden'); inboxCard.classList.remove('hidden');
    fetchBtn.style.display = 'inline-flex'; disconnectBtn.style.display = 'inline-flex';
  } else {
    badge.textContent = '⚪ Gmail: Not Connected'; badge.className = 'gmail-badge disconnected';
    connectCard.classList.remove('hidden'); inboxCard.classList.add('hidden');
    fetchBtn.style.display = 'none'; disconnectBtn.style.display = 'none';
  }
}
async function connectGmail() {
  const email = document.getElementById('gmail-email-input').value.trim();
  const password = document.getElementById('gmail-pass-input').value.trim();
  const errEl = document.getElementById('gmail-connect-error');
  const btn = document.getElementById('btn-gmail-connect');
  errEl.textContent = '';
  if (!email || !email.includes('@')) { errEl.textContent = '⚠ Enter a valid Gmail address'; return; }
  if (!password || password.replace(/\s/g,'').length < 16) { errEl.textContent = '⚠ App password must be 16 characters'; return; }
  btn.disabled = true; btn.textContent = '⏳ Connecting...';
  const res = await api.gmailConnect(email, password);
  btn.disabled = false; btn.textContent = '🔗 Connect Gmail';
  if (res.success) { showToast('🎉 Gmail connected!', 'success'); _gmailConnected = true; updateGmailUI(true, email); fetchGmailInbox(); }
  else { errEl.textContent = '❌ ' + res.error; }
}
async function fetchGmailInbox() {
  const count = parseInt(document.getElementById('gmail-fetch-count')?.value || '15');
  const loading = document.getElementById('gmail-loading');
  const btn = document.getElementById('btn-gmail-fetch-inbox');
  const subtitle = document.getElementById('gmail-inbox-subtitle');
  loading.classList.remove('hidden'); btn.disabled = true; btn.textContent = '⟳ Fetching...';
  subtitle.textContent = `Fetching and analyzing up to ${count} emails...`;
  const res = await api.gmailFetch(count);
  loading.classList.add('hidden'); btn.disabled = false; btn.textContent = '⟳ Fetch Emails';
  if (!res.success) { showToast('Fetch failed: ' + res.error, 'error'); subtitle.textContent = 'Error — ' + res.error; return; }
  subtitle.textContent = res.data.length ? `${res.data.length} emails fetched and analyzed by AI` : '📭 No emails found!';
  renderGmailList(res.data); loadEmailHistory();
}
function renderGmailList(emails) {
  const el = document.getElementById('gmail-email-list');
  if (!emails.length) { el.innerHTML = '<div class="empty-state">📭 No emails!</div>'; return; }
  el.innerHTML = emails.map(e => {
    const priority = e.analysis?.priority || e.urgency || 'low';
    const sender   = e.from || e.sender_name || 'Unknown';
    const subject  = e.subject || e.topic || '(no subject)';
    const summary  = e.analysis?.summary || e.summary || '';
    const dot = priority==='high'?'🔴':priority==='medium'?'🟡':'🟢';
    const badge = priority==='high'?'urgency-high':priority==='medium'?'urgency-medium':'urgency-low';
    return `<div class="gmail-item unread" onclick="showEmailDetail(${e.id})">
      <span style="font-size:20px">${dot}</span>
      <div class="gmail-subject-wrap"><div class="gmail-sender">${escHtml(sender)}</div><div class="gmail-subject">${escHtml(subject)}</div><div class="gmail-snippet">${escHtml(summary.slice(0,80))}</div></div>
      <span class="email-badge ${badge}">${priority}</span>
      <span class="gmail-time">${formatDateShort(e.analyzed_at||e.date)}</span>
    </div>`;
  }).join('');
}
window.showEmailDetail = async function(id) {
  const res = await api.getEmails();
  if (!res.success) return;
  const email = res.data.find(e => e.id === id);
  if (!email) return;
  document.getElementById('detail-subject').textContent = email.subject || email.topic || 'Email';
  document.getElementById('email-detail-body').innerHTML = buildEmailDetailHTML(email);
  document.getElementById('email-detail-panel').classList.remove('hidden');
  document.getElementById('email-detail-panel').scrollIntoView({ behavior:'smooth' });
};
window.closeEmailDetail = function() { document.getElementById('email-detail-panel').classList.add('hidden'); };
function buildEmailDetailHTML(d) {
  const a = d.analysis || d;
  const summary         = a.summary         || d.summary         || '';
  const suggested_reply = a.suggested_reply || d.suggested_reply || '';
  const priority        = a.priority        || d.urgency         || 'low';
  const category        = a.category        || d.tone            || '';
  const key_points      = a.key_points      || [];
  const sender          = d.from            || d.sender_name     || 'Unknown';
  const subject         = d.subject         || d.topic           || '(no subject)';
  const provider        = d.provider        || d.source          || 'local';
  const isAI = provider !== 'local';
  const providerBanner = isAI ? `<div style="font-size:11px;color:var(--success);padding:8px 12px;background:rgba(0,212,170,0.08);border-radius:6px;margin-bottom:12px;">🤖 AI Powered by ${provider}</div>` : '';
  const priorityColor = priority==='high'?'var(--danger)':priority==='medium'?'#ffd166':'var(--success)';
  return `${providerBanner}
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
      <span class="email-badge" style="color:${priorityColor};background:${priorityColor}22">⚡ ${priority} priority</span>
      ${category ? `<span class="email-badge" style="background:rgba(108,99,255,0.1);color:var(--accent)">${escHtml(category)}</span>` : ''}
    </div>
    <div class="email-result-section"><div class="email-result-label">👤 From</div><div class="email-result-value"><strong>${escHtml(sender)}</strong></div></div>
    <div class="email-result-section"><div class="email-result-label">📌 Subject</div><div class="email-result-value" style="font-weight:600;color:var(--accent-2)">${escHtml(subject)}</div></div>
    <div class="email-result-section"><div class="email-result-label">📝 Summary</div><div class="email-result-value">${escHtml(summary)}</div></div>
    ${key_points.length ? `<div class="email-result-section"><div class="email-result-label">🔑 Key Points</div><ul class="key-points-list">${key_points.map(p=>`<li>${escHtml(p)}</li>`).join('')}</ul></div>` : ''}
    <div class="email-result-section"><div class="email-result-label">💬 Suggested Reply <span style="font-weight:400;font-size:11px;">(click to copy)</span></div><div class="reply-box" onclick="copyReply(this)">${escHtml(suggested_reply)}</div><div class="copy-hint">Click to copy reply to clipboard</div></div>`;
}
async function disconnectGmail() {
  await api.gmailDisconnect(); _gmailConnected = false;
  updateGmailUI(false, null);
  document.getElementById('gmail-email-list').innerHTML = '';
  showToast('Gmail disconnected', 'info');
}
async function analyzeEmailManual() {
  const text = document.getElementById('email-input').value.trim();
  if (!text) { showToast('Paste an email first', 'warning'); return; }
  const btn = document.getElementById('btn-analyze-email');
  const loading = document.getElementById('email-loading');
  btn.disabled = true; btn.textContent = '⏳ Analyzing...';
  loading.classList.remove('hidden');
  document.getElementById('email-loading-text').style.display = 'block';
  const res = await api.analyzeEmail(text);
  btn.disabled = false; btn.textContent = '🤖 Analyze Email';
  loading.classList.add('hidden');
  document.getElementById('email-loading-text').style.display = 'none';
  const body = document.getElementById('email-result-body');
  body.classList.remove('hidden');
  if (!res.success) { body.innerHTML = `<div style="color:var(--danger);font-size:13px;padding:12px">❌ ${escHtml(res.error)}</div>`; return; }
  body.innerHTML = buildEmailDetailHTML(res.data);
  loadEmailHistory();
}
window.copyReply = async function(el) {
  try { await navigator.clipboard.writeText(el.textContent); el.style.borderColor = 'var(--success)'; showToast('Reply copied! ✓', 'success'); setTimeout(() => el.style.borderColor = '', 2000); }
  catch(e) { showToast('Copy failed', 'error'); }
};
async function loadEmailHistory() {
  const res = await api.getEmails();
  const el = document.getElementById('email-history-list');
  const count = document.getElementById('email-history-count');
  if (!res.success || !res.data.length) { el.innerHTML = '<div class="empty-state">No emails analyzed yet</div>'; count.textContent = ''; return; }
  count.textContent = `${res.data.length} emails`;
  el.innerHTML = res.data.map(e => {
    const a = e.analysis || e;
    const priority = a.priority || e.urgency || 'low';
    const sender   = e.from || e.sender_name || 'Unknown';
    const subject  = e.subject || e.topic || '';
    const dot = priority==='high'?'🔴':priority==='medium'?'🟡':'🟢';
    const badge = priority==='high'?'urgency-high':priority==='medium'?'urgency-medium':'urgency-low';
    return `<div class="email-history-item" onclick="showEmailDetail(${e.id})" style="cursor:pointer;">
      <span style="font-size:18px">${dot}</span>
      <span class="email-sender">${escHtml(sender)}</span>
      <span class="email-topic">${escHtml(subject)}</span>
      <span class="email-badge ${badge}">${priority}</span>
      <span class="email-time">${formatDateShort(e.analyzed_at||e.date)}</span>
      <button class="clip-delete" onclick="event.stopPropagation();deleteEmailEntry(${e.id})">✕</button>
    </div>`;
  }).join('');
}
window.deleteEmailEntry = async function(id) { await api.deleteEmail(id); loadEmailHistory(); };

// ── Document Explainer ─────────────────────────────────────────────
let _docFilePath = null;
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-analyze-doc').addEventListener('click', analyzeDocument);
  const zone = document.getElementById('doc-drop-zone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); const file = e.dataTransfer.files[0]; if (file) handleDocFile(file); });
  zone.addEventListener('click', () => document.getElementById('doc-file-input').click());
  document.getElementById('doc-file-input').addEventListener('change', e => { if (e.target.files[0]) handleDocFile(e.target.files[0]); });
});
function handleDocFile(file) {
  _docFilePath = file.path || null;
  const zone = document.getElementById('doc-drop-zone');
  zone.classList.add('has-file');
  zone.innerHTML = `<div style="font-size:28px">📄</div><div style="font-weight:600;margin:6px 0 2px;color:var(--success)">${escHtml(file.name)}</div><div style="font-size:12px;color:var(--text-muted)">${formatFileSize(file.size)} · Ready to analyze</div><button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="event.stopPropagation();clearDocFile()">✕ Remove</button>`;
  document.getElementById('doc-text-input').value = '';
}
window.clearDocFile = function() {
  _docFilePath = null;
  const zone = document.getElementById('doc-drop-zone');
  zone.classList.remove('has-file');
  zone.innerHTML = `<div style="font-size:32px">📂</div><div style="font-weight:600;margin:8px 0 4px">Drop file here</div><div style="font-size:12px;color:var(--text-muted)">Supports .txt, .pdf, .docx, .md</div><input type="file" id="doc-file-input" accept=".txt,.pdf,.docx,.md" style="display:none"><button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="document.getElementById('doc-file-input').click()">Browse File</button>`;
  document.getElementById('doc-file-input').addEventListener('change', e => { if (e.target.files[0]) handleDocFile(e.target.files[0]); });
};
async function analyzeDocument() {
  const pastedText = document.getElementById('doc-text-input').value.trim();
  const context = document.getElementById('doc-context-input').value.trim();
  if (!pastedText && !_docFilePath) { showToast('Please upload a file or paste text', 'warning'); return; }
  const btn = document.getElementById('btn-analyze-doc');
  const loading = document.getElementById('doc-loading');
  btn.disabled = true; btn.textContent = '🤖 Analyzing...'; loading.classList.remove('hidden');
  let res;
  if (_docFilePath) res = await api.analyzeDocumentFile(_docFilePath, context);
  else              res = await api.analyzeDocumentText(pastedText, context);
  btn.disabled = false; btn.textContent = '🤖 Analyze Document'; loading.classList.add('hidden');
  if (!res.success) { showToast('Analysis failed: ' + res.error, 'error'); return; }
  renderDocResult(res.data); loadDocHistory();
}
function renderDocResult(d) {
  document.getElementById('doc-result-empty').classList.add('hidden');
  const body = document.getElementById('doc-result-body');
  body.classList.remove('hidden');
  const a = d.analysis || d;
  const provider = d.provider || d.source || 'local';
  const providerNote = provider !== 'local' ? `<div style="font-size:11px;color:var(--success);margin-bottom:12px;">🤖 AI Powered by ${provider}</div>` : '';
  const sentiment = a.sentiment || 'neutral';
  const sentimentIcon = { positive:'😊', negative:'😟', neutral:'😐', mixed:'🤔' }[sentiment] || '😐';
  const keyPoints = a.key_points || [];
  const actionItems = a.action_items || [];
  const suggestions = a.suggestions || a.project_suggestions || [];
  body.innerHTML = `${providerNote}
    <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
      <span class="doc-type-badge">${a.document_type||'document'}</span>
      <span class="email-badge" style="background:rgba(108,99,255,0.1);color:var(--accent)">${(a.word_count_estimate||a.word_count||0).toLocaleString()} words</span>
      <span class="email-badge" style="background:var(--bg-hover);color:var(--text)">${sentimentIcon} ${sentiment}</span>
      ${d.pages ? `<span class="email-badge" style="background:var(--bg-hover);color:var(--text-muted)">${d.pages} pages</span>` : ''}
    </div>
    <div class="email-result-section"><div class="email-result-label">📋 Summary</div><div class="email-result-value">${escHtml(a.summary||'')}</div></div>
    ${keyPoints.length ? `<div class="email-result-section"><div class="email-result-label">🔑 Key Points</div><ul class="key-points-list">${keyPoints.map(p=>`<li>${escHtml(p)}</li>`).join('')}</ul></div>` : ''}
    ${actionItems.length ? `<div class="email-result-section"><div class="email-result-label">✅ Action Items</div><ul class="key-points-list">${actionItems.map(a=>`<li style="color:var(--warning)">${escHtml(a)}</li>`).join('')}</ul></div>` : ''}
    ${suggestions.length ? `<div class="email-result-section"><div class="email-result-label">💡 Suggestions</div><div class="suggestions-list">${suggestions.map((s,i)=>`<div class="suggestion-item"><div class="suggestion-num">${i+1}</div><div>${escHtml(s)}</div></div>`).join('')}</div></div>` : ''}`;
}
async function loadDocHistory() {
  const res = await api.getDocuments();
  const el = document.getElementById('doc-history-list');
  const count = document.getElementById('doc-history-count');
  if (!res.success || !res.data.length) { el.innerHTML = '<div class="empty-state">No documents analyzed yet</div>'; count.textContent = ''; return; }
  count.textContent = `${res.data.length} documents`;
  el.innerHTML = res.data.map(d => {
    const a = d.analysis || d;
    return `<div class="doc-history-item">
      <span style="font-size:18px">📄</span>
      <span class="doc-filename">${escHtml(d.filename||d.file_name||d.title||'Document')}</span>
      <span class="doc-type-badge">${a.document_type||'text'}</span>
      <span style="font-size:12px;color:var(--text-muted);flex-shrink:0">${(a.word_count_estimate||a.word_count||0).toLocaleString()}w</span>
      <span class="doc-time">${formatDateShort(d.analyzed_at)}</span>
      <button class="clip-delete" onclick="deleteDocEntry(${d.id})">✕</button>
    </div>`;
  }).join('');
}
window.deleteDocEntry = async function(id) { await api.deleteDocument(id); loadDocHistory(); };

// ── Helpers ────────────────────────────────────────────────────────
function appColor(name) {
  const colors = ['#6c63ff','#00d4aa','#ff6b6b','#ffd166','#c896ff','#ff9f7f','#7fafff','#98ff98'];
  let h = 0; for (let i=0;i<(name||'').length;i++) h = name.charCodeAt(i)+((h<<5)-h);
  return colors[Math.abs(h)%colors.length];
}
function appInitial(n) { return (n||'?').replace(/[^a-zA-Z0-9]/g,'').charAt(0).toUpperCase()||'?'; }
function formatDuration(s) {
  if (!s || s===0) return '0m';
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
  return h>0 ? `${h}h ${m}m` : `${m}m`;
}
function formatFileSize(b) {
  if (!b||b===0) return '';
  if (b<1024) return `${b}B`;
  if (b<1048576) return `${(b/1024).toFixed(0)}KB`;
  return `${(b/1048576).toFixed(1)}MB`;
}
function formatDateShort(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN',{month:'short',day:'numeric'});
}
function formatDeadlineFull(deadline) {
  if (!deadline) return null;
  const d = new Date(deadline); if (isNaN(d)) return deadline;
  const now = new Date(); const diffMs = d - now;
  const diffMins = Math.round(diffMs/60000); const diffDays = Math.round(diffMs/86400000);
  const dateStr = d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
  const timeStr = d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
  if (diffMs<0) return `${dateStr} ${timeStr} (overdue)`;
  if (diffMins<60) return `${dateStr} ${timeStr} (${diffMins}m left)`;
  if (diffDays<1) return `${dateStr} ${timeStr} (${Math.round(diffMs/3600000)}h left)`;
  if (diffDays===1) return `${dateStr} ${timeStr} (tomorrow)`;
  return `${dateStr} ${timeStr} (${diffDays}d left)`;
}
function getDeadlineClass(deadline) {
  const diff = new Date(deadline) - Date.now();
  if (diff < 0)          return { cls:'overdue' };
  if (diff < 3600000)    return { cls:'urgent' };
  if (diff < 86400000)   return { cls:'soon' };
  if (diff < 172800000)  return { cls:'upcoming' };
  return null;
}
function toLocalDateTimeInput(d) {
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function showToast(message, type='info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = {success:'✓',error:'✕',info:'ℹ',warning:'⚠'};
  toast.innerHTML = `<span>${icons[type]||'ℹ'}</span><span>${escHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}