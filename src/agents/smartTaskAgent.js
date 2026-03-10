const https = require('https');
const os = require('os');
const path = require('path');
const fs = require('fs');

/**
 * AI Smart Task Assistant
 * When a task is created, it:
 * 1. Detects complexity from title/description
 * 2. Calls Claude API (if key set) to generate subtask plan
 * 3. Falls back to rule-based planning if no API key
 * 4. Saves subtasks linked to parent task
 * 5. Estimates time per subtask
 */
class SmartTaskAgent {
  constructor(db, mainWindow) {
    this.db = db;
    this.mainWindow = mainWindow;
    this._listeners = [];
  }

  start() { console.log('[SmartTask] Agent started'); }
  stop()  {}
  setMainWindow(win) { this.mainWindow = win; }
  addListener(fn) { this._listeners.push(fn); }
  notify(data) { this._listeners.forEach(fn => fn(data)); }

  getApiKey() {
    try {
      if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
      const configPath = path.join(os.homedir(), '.ai-productivity-agent', 'config.json');
      if (fs.existsSync(configPath)) {
        const c = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return c.anthropic_api_key || null;
      }
    } catch(e) {}
    return null;
  }

  async planTask(task) {
    // Only plan tasks that seem complex (more than 3 words or has deadline far away)
    const wordCount = (task.title || '').split(' ').length;
    if (wordCount < 2 && !task.description) return null;

    const apiKey = this.getApiKey();
    if (apiKey) {
      try {
        return await this._claudePlan(apiKey, task);
      } catch(e) {
        console.warn('[SmartTask] API failed, using local planner:', e.message);
      }
    }
    return this._localPlan(task);
  }

  async _claudePlan(apiKey, task) {
    const deadlineStr = task.deadline
      ? `Deadline: ${new Date(task.deadline).toLocaleDateString('en-US', { weekday:'long', month:'short', day:'numeric' })}`
      : 'No specific deadline';

    const prompt = `You are a productivity assistant. A user created this task:

Title: "${task.title}"
${task.description ? `Description: "${task.description}"` : ''}
${deadlineStr}
Priority: ${task.priority || 'medium'}

Generate a practical daily plan with 3-6 subtasks. Respond ONLY with valid JSON (no markdown, no explanation):
{
  "complexity": "simple|medium|complex",
  "estimated_hours": <number>,
  "subtasks": [
    { "title": "...", "day": 1, "duration_hours": <number>, "description": "..." }
  ],
  "tip": "one short productivity tip for this task"
}`;

    const payload = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    });

    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const text = parsed.content?.[0]?.text || '';
            const clean = text.replace(/```json|```/g, '').trim();
            const plan = JSON.parse(clean);
            resolve({ ...plan, source: 'claude' });
          } catch(e) { reject(new Error('Bad API response: ' + e.message)); }
        });
      });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  _localPlan(task) {
    const title = (task.title || '').toLowerCase();
    const desc  = (task.description || '').toLowerCase();
    const combined = title + ' ' + desc;

    // Detect task type
    const isCode    = /\b(build|code|develop|implement|create|write|api|app|feature|bug|fix)\b/.test(combined);
    const isDesign  = /\b(design|ui|ux|wireframe|mockup|prototype|figma|layout)\b/.test(combined);
    const isResearch= /\b(research|study|learn|read|analyze|review|compare)\b/.test(combined);
    const isContent = /\b(write|blog|post|article|report|document|presentation)\b/.test(combined);
    const isMeeting = /\b(meeting|call|interview|presentation|demo|pitch)\b/.test(combined);

    let subtasks = [];
    let estimated_hours = 4;
    let complexity = 'medium';
    let tip = 'Break this into smaller steps and tackle one at a time.';

    if (isCode) {
      complexity = 'complex'; estimated_hours = 8;
      subtasks = [
        { title: 'Plan & Research', day: 1, duration_hours: 1, description: 'Define requirements, research similar solutions, plan architecture' },
        { title: 'Setup & Scaffolding', day: 1, duration_hours: 1, description: 'Set up project structure, install dependencies' },
        { title: 'Core Implementation', day: 2, duration_hours: 3, description: 'Build the main functionality' },
        { title: 'Testing & Debugging', day: 3, duration_hours: 2, description: 'Write tests, fix bugs, edge cases' },
        { title: 'Polish & Documentation', day: 4, duration_hours: 1, description: 'Clean up code, add comments, README' },
      ];
      tip = 'Start with a working prototype — you can always improve it later.';
    } else if (isDesign) {
      complexity = 'medium'; estimated_hours = 6;
      subtasks = [
        { title: 'Inspiration & References', day: 1, duration_hours: 1, description: 'Collect inspiration, define style guide' },
        { title: 'Wireframing', day: 1, duration_hours: 2, description: 'Create low-fidelity wireframes' },
        { title: 'High-Fidelity Design', day: 2, duration_hours: 2, description: 'Build detailed mockups' },
        { title: 'Review & Iterate', day: 3, duration_hours: 1, description: 'Get feedback and refine' },
      ];
      tip = 'Start ugly — get the layout right before worrying about visual polish.';
    } else if (isResearch) {
      complexity = 'medium'; estimated_hours = 4;
      subtasks = [
        { title: 'Define Research Questions', day: 1, duration_hours: 0.5, description: 'What exactly do you need to find out?' },
        { title: 'Gather Sources', day: 1, duration_hours: 1.5, description: 'Find articles, docs, and references' },
        { title: 'Read & Take Notes', day: 2, duration_hours: 1.5, description: 'Digest information, highlight key points' },
        { title: 'Summarize Findings', day: 2, duration_hours: 0.5, description: 'Write a concise summary' },
      ];
      tip = 'Use the Feynman technique — explain it simply to make sure you understand it.';
    } else if (isContent) {
      complexity = 'medium'; estimated_hours = 5;
      subtasks = [
        { title: 'Outline & Structure', day: 1, duration_hours: 0.5, description: 'Plan sections and key points' },
        { title: 'First Draft', day: 1, duration_hours: 2, description: 'Write without editing — just get words down' },
        { title: 'Edit & Revise', day: 2, duration_hours: 1.5, description: 'Improve clarity, fix errors' },
        { title: 'Final Review', day: 2, duration_hours: 1, description: 'Proofread and finalize' },
      ];
      tip = 'Write the first draft fast and messy — editing is easier than a blank page.';
    } else if (isMeeting) {
      complexity = 'simple'; estimated_hours = 2;
      subtasks = [
        { title: 'Prepare Agenda', day: 1, duration_hours: 0.5, description: 'List key topics and questions' },
        { title: 'Gather Materials', day: 1, duration_hours: 0.5, description: 'Collect relevant data, slides, or demos' },
        { title: 'Rehearse Key Points', day: 1, duration_hours: 0.5, description: 'Practice your main talking points' },
        { title: 'Follow-up Notes', day: 2, duration_hours: 0.5, description: 'Write action items after the meeting' },
      ];
      tip = 'Prepare 3 key things you want to communicate — keep it focused.';
    } else {
      complexity = 'simple'; estimated_hours = 3;
      subtasks = [
        { title: 'Plan the approach', day: 1, duration_hours: 0.5, description: 'Define what "done" looks like' },
        { title: 'Execute main work', day: 1, duration_hours: 2, description: 'Do the core work' },
        { title: 'Review & Complete', day: 2, duration_hours: 0.5, description: 'Check quality and wrap up' },
      ];
    }

    // Adjust to deadline if available
    if (task.deadline) {
      const daysLeft = Math.ceil((new Date(task.deadline) - Date.now()) / 86400000);
      if (daysLeft < subtasks.length && daysLeft > 0) {
        // Compress into fewer days
        subtasks = subtasks.map((s, i) => ({ ...s, day: Math.min(i + 1, daysLeft) }));
      }
    }

    return { complexity, estimated_hours, subtasks, tip, source: 'local' };
  }
}

module.exports = SmartTaskAgent;