#!/usr/bin/env node
/**
 * setup.js — Run this ONCE before first launch
 * Usage: node setup.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('\n⚡ AI Productivity Agent — Setup\n');

const nodeVer = parseInt(process.versions.node.split('.')[0]);
if (nodeVer < 16) {
  console.error('Node.js 16+ required. Please update from https://nodejs.org');
  process.exit(1);
}
console.log('✓ Node.js', process.versions.node);

console.log('\n📦 Installing dependencies...\n');
try {
  execSync('npm install', { stdio: 'inherit', cwd: __dirname });
  console.log('\n✓ Dependencies installed (no compilation required!)');
} catch (e) {
  console.error('npm install failed. Check your internet connection.');
  process.exit(1);
}

// Create data directory
const dataDir = path.join(os.homedir(), '.ai-productivity-agent');
if (!fs.existsSync(dataDir)) { fs.mkdirSync(dataDir, { recursive: true }); }
console.log('✓ Data directory ready:', dataDir);

// Create Organized output folders
const cats = ['Documents', 'Images', 'Videos', 'Audio', 'Code', 'Archives', 'Executables', 'Others'];
cats.forEach(cat => {
  const dir = path.join(os.homedir(), 'Organized', cat);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});
console.log('✓ Created ~/Organized/ folders');

console.log('\n✅ Setup complete! Run: npm start\n');
console.log('Optional — AI meeting summaries:');
console.log('  Windows:  set ANTHROPIC_API_KEY=sk-ant-...');
console.log('  Mac/Linux: export ANTHROPIC_API_KEY=sk-ant-...\n');
