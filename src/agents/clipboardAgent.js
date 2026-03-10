const { clipboard } = require('electron');

/**
 * Clipboard History Agent
 * Polls clipboard every 2s, saves new text entries,
 * categorizes them (code, URL, email, note)
 */
class ClipboardAgent {
  constructor(db) {
    this.db = db;
    this.interval = null;
    this.last = null;
    this.listeners = [];
  }

  start() {
    console.log('[Clipboard] Agent started');
    this.last = clipboard.readText();
    this.interval = setInterval(() => this.poll(), 2000);
  }

  stop() { if (this.interval) clearInterval(this.interval); }
  addListener(fn) { this.listeners.push(fn); }
  notify(data) { this.listeners.forEach(fn => fn(data)); }

  poll() {
    try {
      const text = clipboard.readText();
      if (!text || text === this.last || text.length > 10000) return;
      this.last = text;
      const entry = {
        content: text,
        category: this.categorize(text),
        copied_at: new Date().toISOString(),
        char_count: text.length
      };
      this.db.saveClipboardEntry(entry);
      this.notify(entry);
    } catch(e) {}
  }

  categorize(text) {
    const t = text.trim();
    if (/^https?:\/\//i.test(t)) return 'URL';
    if (/^[\w.+-]+@[\w-]+\.\w+$/.test(t)) return 'Email';
    if (/^\s*(function|const|let|var|import|class|def |if |for |while |SELECT |INSERT |<\w)/m.test(t)) return 'Code';
    if (/^\d[\d\s\-+()]{7,}$/.test(t)) return 'Phone';
    if (t.length < 50) return 'Snippet';
    return 'Note';
  }
}

module.exports = ClipboardAgent;