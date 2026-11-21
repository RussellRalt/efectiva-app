import fs from 'fs';
import path from 'path';

const files = [
  'index.html',
  'style.css',
  'script.js',
  'ai_chat.js',
  'modals.js',
  'auth.js',
  'manifest.json',
  'sw.js',
  'icon-192.png',
  'icon-512.png'
];

fs.mkdirSync('www', { recursive: true });
for (const f of files) {
  if (fs.existsSync(f)) {
    fs.copyFileSync(f, path.join('www', f));
  }
}
console.log('Copied web assets into www/');
