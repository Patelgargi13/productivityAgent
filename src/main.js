require('dotenv').config();
const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const DatabaseManager    = require('./database/db');
const ScreenTimeAgent    = require('./agents/screenTimeAgent');
const TaskReminderAgent  = require('./agents/taskReminderAgent');
const FileOrganizerAgent = require('./agents/fileOrganizerAgent');
const ClipboardAgent     = require('./agents/clipboardAgent');
const StandupAgent       = require('./agents/standupAgent');
const BrowserActivityAgent   = require('./agents/browserActivityAgent');
const WorkPatternAgent       = require('./agents/workPatternAgent');
const DistractionDetectorAgent = require('./agents/distractionDetectorAgent');
const SmartTaskAgent         = require('./agents/smartTaskAgent');
const EmailAgent             = require('./agents/emailAgent');
const DocumentAgent          = require('./agents/documentAgent');
const MindMapAgent           = require('./agents/mindMapAgent');

let mainWindow, db;
let screenTimeAgent, taskReminderAgent, fileOrganizerAgent;
let clipboardAgent, standupAgent, browserActivityAgent;
let workPatternAgent, distractionDetectorAgent, smartTaskAgent;
let emailAgent, documentAgent, mindMapAgent;

app.commandLine.appendSwitch('enable-speech-dispatcher');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('disable-web-security');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1100, minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false,
    },
    backgroundColor: '#0a0a0f',
    show: false,
  });

  session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(true));
  session.defaultSession.setPermissionCheckHandler(() => true);

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    details.requestHeaders['User-Agent'] =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    callback({ requestHeaders: details.requestHeaders });
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  db = new DatabaseManager();
  db.initialize();

  screenTimeAgent     = new ScreenTimeAgent(db);
  taskReminderAgent   = new TaskReminderAgent(db, null);
  fileOrganizerAgent  = new FileOrganizerAgent(db);
  clipboardAgent      = new ClipboardAgent(db);
  standupAgent        = new StandupAgent(db, null);
  browserActivityAgent     = new BrowserActivityAgent(db);
  workPatternAgent         = new WorkPatternAgent(db, null);
  distractionDetectorAgent = new DistractionDetectorAgent(db, null);
  smartTaskAgent           = new SmartTaskAgent(db, null);
  emailAgent               = new EmailAgent(db);
  documentAgent            = new DocumentAgent(db);
  mindMapAgent             = new MindMapAgent(db, null);

  screenTimeAgent.start();
  taskReminderAgent.start();
  fileOrganizerAgent.start();
  clipboardAgent.start();
  browserActivityAgent.start();
  workPatternAgent.start();
  distractionDetectorAgent.start();
  smartTaskAgent.start();
  emailAgent.start();
  documentAgent.start();
  mindMapAgent.start();

  // Feed screen time data into pattern + distraction agents
  screenTimeAgent.addListener((data) => {
    workPatternAgent.recordActivity(data.appName, null);
  });

  createWindow();

  taskReminderAgent.setMainWindow(mainWindow);
  standupAgent.setMainWindow(mainWindow);
  workPatternAgent.setMainWindow(mainWindow);
  distractionDetectorAgent.setMainWindow(mainWindow);
  smartTaskAgent.setMainWindow(mainWindow);
  mindMapAgent.setMainWindow(mainWindow);

  const ipcHandlers = require('./ipc/handlers');
  ipcHandlers.setup(ipcMain, db, {
    screenTimeAgent, taskReminderAgent, fileOrganizerAgent,
    clipboardAgent, standupAgent, browserActivityAgent,
    workPatternAgent, distractionDetectorAgent, smartTaskAgent,
    emailAgent, documentAgent, mindMapAgent
  }, mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (db) db.save();
  [screenTimeAgent, taskReminderAgent, fileOrganizerAgent, clipboardAgent,
   browserActivityAgent, workPatternAgent, distractionDetectorAgent, smartTaskAgent,
   emailAgent, documentAgent, mindMapAgent]
    .forEach(a => a && a.stop && a.stop());
  if (process.platform !== 'darwin') app.quit();
});