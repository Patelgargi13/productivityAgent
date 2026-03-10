// documentAgent.js — Document summarizer + suggestions
// Place in: src/agents/documentAgent.js

const fs = require('fs');
const path = require('path');
const { callAI } = require('./aiProvider');

class DocumentAgent {
  constructor(db) {
    this.db = db;
    this.mainWindow = null;
  }

  // ── Required by main.js ───────────────────────────────────────────
  start()            { console.log('[Document] Agent started'); }
  stop()             { console.log('[Document] Agent stopped'); }
  setMainWindow(win) { this.mainWindow = win; }

  // ── Extract text from file ────────────────────────────────────────
  async extractText(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    if (['.txt','.md','.csv','.json','.js','.py','.html','.css','.xml'].includes(ext)) {
      const text = fs.readFileSync(filePath, 'utf8');
      return { text, pages: 1 };
    }

    if (ext === '.pdf') {
      try {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(fs.readFileSync(filePath));
        return { text: data.text, pages: data.numpages };
      } catch (e) {
        throw new Error('PDF reading requires: npm install pdf-parse');
      }
    }

    throw new Error(`Unsupported file type: ${ext}. Supported: .txt .md .pdf .csv .json`);
  }

  // ── Analyze text ──────────────────────────────────────────────────
  async analyzeText(text, context = '') {
    if (!text || text.trim().length < 20) return { error: 'Text too short' };

    const truncated = text.slice(0, 3000);
    const prompt = `Analyze this document and respond ONLY in valid JSON, no markdown.

Context: ${context || 'General document'}
Content:
${truncated}

JSON format:
{
  "title": "inferred title",
  "summary": "3-4 sentence summary",
  "document_type": "report|email|article|contract|notes|presentation|other",
  "key_points": ["point1","point2","point3","point4"],
  "action_items": ["action1","action2"],
  "sentiment": "positive|neutral|negative|mixed",
  "word_count_estimate": 500,
  "suggestions": ["suggestion1","suggestion2"],
  "tags": ["tag1","tag2","tag3"]
}`;

    const localFallback = () => {
      const words = text.trim().split(/\s+/);
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
      return JSON.stringify({
        title: context || 'Document',
        summary: sentences.slice(0,3).join('. ')+'.',
        document_type: 'other',
        key_points: sentences.slice(0,4).map(s=>s.trim().slice(0,100)),
        action_items: ['Review document','Follow up on key points'],
        sentiment: 'neutral',
        word_count_estimate: words.length,
        suggestions: ['Add more structure','Add a clear conclusion'],
        tags: ['document','review']
      });
    };

    try {
      const { text: aiText, provider } = await callAI(prompt, localFallback);
      const analysis = JSON.parse(aiText.replace(/```json|```/g,'').trim());

      const entry = {
        id: this.db._nextId++,
        filename: context || 'document',
        analyzed_at: new Date().toISOString(),
        char_count: text.length,
        analysis,
        provider
      };
      this.db.push('documents', entry);
      this.db.save();

      return { success: true, analysis, provider, id: entry.id };
    } catch (e) {
      const fallback = JSON.parse(localFallback());
      return { success: true, analysis: fallback, provider: 'local' };
    }
  }

  getDocuments()      { return (this.db.get('documents')||[]).slice(-30).reverse(); }
  deleteDocument(id)  { this.db.data.documents=(this.db.data.documents||[]).filter(d=>d.id!==id); this.db.save(); return {success:true}; }
}

module.exports = DocumentAgent;