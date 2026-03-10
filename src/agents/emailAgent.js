// emailAgent.js — AI Email Manager
// Place in: src/agents/emailAgent.js

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { callAI } = require('./aiProvider');

const DATA_DIR         = path.join(os.homedir(), '.ai-productivity-agent');
const GMAIL_CREDS_FILE = path.join(DATA_DIR, 'gmail-account.json');

class EmailAgent {
  constructor(db) {
    this.db         = db;
    this.mainWindow = null;
  }

  // ── Required by main.js ───────────────────────────────────────────
  start()            { console.log('[Email] Agent started'); }
  stop()             { console.log('[Email] Agent stopped'); }
  setMainWindow(win) { this.mainWindow = win; }

  // ── Gmail credentials ─────────────────────────────────────────────
  isGmailConnected() {
    try {
      if (!fs.existsSync(GMAIL_CREDS_FILE)) return false;
      const creds = JSON.parse(fs.readFileSync(GMAIL_CREDS_FILE, 'utf8'));
      return !!(creds?.email && creds?.appPassword);
    } catch (e) { return false; }
  }

  getGmailAccount() {
    try {
      if (!fs.existsSync(GMAIL_CREDS_FILE)) return null;
      return JSON.parse(fs.readFileSync(GMAIL_CREDS_FILE, 'utf8'));
    } catch (e) { return null; }
  }

  saveGmailAccount(email, appPassword) {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(GMAIL_CREDS_FILE, JSON.stringify({ email, appPassword }, null, 2));
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  disconnectGmail() {
    try {
      if (fs.existsSync(GMAIL_CREDS_FILE)) fs.unlinkSync(GMAIL_CREDS_FILE);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ── Fetch emails via IMAP ─────────────────────────────────────────
  async fetchGmailEmails(limit = 15) {
    const creds = this.getGmailAccount();
    if (!creds) throw new Error('Gmail not connected');

    let Imap, simpleParser;
    try {
      Imap         = require('imap');
      simpleParser = require('mailparser').simpleParser;
    } catch (e) {
      throw new Error('Run: npm install imap mailparser');
    }

    const rawEmails = await new Promise((resolve, reject) => {
      const imap = new Imap({
        user:     creds.email,
        password: creds.appPassword,
        host:     'imap.gmail.com',
        port:     993,
        tls:      true,
        tlsOptions: { rejectUnauthorized: false }
      });

      const emails = [];

      imap.once('ready', () => {
        imap.openBox('INBOX', true, (err, box) => {
          if (err) { imap.end(); return reject(err); }

          const total = box.messages.total;
          const start = Math.max(1, total - limit + 1);
          const fetch = imap.seq.fetch(`${start}:${total}`, { bodies: '' });

          fetch.on('message', msg => {
            let buffer = '';
            msg.on('body', stream => { stream.on('data', c => buffer += c.toString()); });
            msg.once('end', () => emails.push(buffer));
          });

          fetch.once('error', reject);
          fetch.once('end',   () => imap.end());
        });
      });

      imap.once('end',   () => resolve(emails));
      imap.once('error', reject);
      imap.connect();
    });

    const parsed = [];
    for (const raw of rawEmails.reverse()) {
      try {
        const mail = await simpleParser(raw);
        parsed.push({
          from:    mail.from?.text || 'Unknown',
          subject: mail.subject    || '(no subject)',
          body:    mail.text       || mail.html || '',
          date:    mail.date       || new Date()
        });
      } catch (e) { /* skip malformed */ }
    }
    return parsed;
  }

  // ── Analyze a single email ────────────────────────────────────────
  // input: string (pasted text) OR object {from, subject, body, date}
  async analyzeEmail(input) {
    let emailText, fromAddr, subject, date;

    if (typeof input === 'string') {
      emailText = input;
      fromAddr  = 'Manual paste';
      subject   = emailText.slice(0, 60);
      date      = new Date().toISOString();
    } else {
      fromAddr  = input.from    || 'Unknown';
      subject   = input.subject || '(no subject)';
      emailText = `From: ${fromAddr}\nSubject: ${subject}\n\n${input.body || ''}`;
      date      = input.date ? new Date(input.date).toISOString() : new Date().toISOString();
    }

    const localFallback = () => JSON.stringify({
      summary:         `Email from ${fromAddr}: ${subject}`,
      sentiment:       'neutral',
      priority:        'low',
      action_required: false,
      suggested_reply: `Dear ${fromAddr},\n\nThank you for reaching out regarding "${subject}". I have received your email and will review the details and respond accordingly.\n\nBest regards`,
      key_points:      ['Email received and logged'],
      category:        'general'
    });

    const prompt = `Analyze this email and respond ONLY with JSON (no markdown, no backticks):

${emailText.slice(0, 2000)}

{
  "summary": "2-3 sentence plain-text summary",
  "sentiment": "positive|neutral|negative|urgent",
  "priority": "high|medium|low",
  "action_required": true or false,
  "suggested_reply": "polite professional reply text",
  "key_points": ["point1", "point2"],
  "category": "work|personal|marketing|finance|general"
}`;

    const { text, provider } = await callAI(prompt, localFallback);
    const analysis = JSON.parse(text.replace(/```json|```/g, '').trim());

    // ✅ Uses db.saveEmail() — the correct DatabaseManager method
    const record = this.db.saveEmail({
      from:     fromAddr,
      subject,
      body:     emailText.slice(0, 500),
      date,
      analyzed: true,
      analysis,
      provider
    });

    console.log(`[Email] Analyzed "${subject}" from ${fromAddr} using ${provider}`);
    return record;
  }

  // ── Fetch + analyze all fetched emails ───────────────────────────
  async analyzeGmailEmails(limit = 15) {
    const rawEmails = await this.fetchGmailEmails(limit);
    const results   = [];
    for (const email of rawEmails) {
      try {
        const result = await this.analyzeEmail(email);
        results.push(result);
      } catch (e) {
        console.warn('[Email] Skipped one email:', e.message);
      }
    }
    return results;
  }

  // ── DB read/delete ────────────────────────────────────────────────
  // ✅ Uses db.getEmails() and db.deleteEmail() from DatabaseManager
  getEmails(limit = 50) {
    return this.db.getEmails(limit);
  }

  deleteEmail(id) {
    this.db.deleteEmail(id);
    return { success: true };
  }
}

module.exports = EmailAgent;