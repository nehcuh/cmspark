// Actual confirmation card + recorded producer frames, isolated synthetic transport.
const fs = require('node:fs'); const path = require('node:path');
const frontend = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2]); fs.mkdirSync(out, { recursive: true });
const frames = fs.readFileSync(path.join(frontend, 'tests/fixtures/confirmation-preview-532.json'), 'utf8');
const entry = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfirmElevated } from './src/cockpit/CockpitApp';
import { confirmationPreviewFromMessage } from './src/sidepanel/utils/confirmation-preview';
const frames = ${frames};
const root = createRoot(document.getElementById('confirmation'));
window.sent = []; window.resolved = [];
window.chrome = {runtime:{sendMessage: msg => {window.sent.push(msg); return Promise.resolve({ok:true});}}};
window.showCase = (mode, id) => {
 const frame = {...frames[mode],confirmation_id:id};
 if (mode==='success') {
  const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;
  frame.preview_image=canvas.toDataURL('image/jpeg').split(',')[1];
 }
 root.render(createElement(ConfirmElevated,{request:{...frame,...confirmationPreviewFromMessage(frame)},threadId:'controlled-owner',onResolved:id=>window.resolved.push(id)}));
};
window.showCase('capture','capture-initial');
`;
const result = require('esbuild').buildSync({stdin:{contents:entry,resolveDir:frontend,loader:'tsx'},bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,define:{'process.env.NODE_ENV':'"production"'}});
fs.writeFileSync(path.join(out,'fixture.js'),result.outputFiles[0].text);
fs.writeFileSync(path.join(out,'fixture.html'),'<!doctype html><meta charset="utf-8"><style>body{background:#181c22;margin:20px;color:white;font-family:sans-serif}</style><div id="confirmation"></div>');
