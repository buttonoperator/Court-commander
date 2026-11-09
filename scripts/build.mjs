// Builds the single-file app: bundles src/app (Preact + JSX) and src/styles with esbuild, inlines
// fonts and images as data URLs, and writes ./index.html (the file GitHub Pages serves).
//   node scripts/build.mjs [--version 2026-11-09-1] [--out path] [--dev]
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const dev = process.argv.includes('--dev');
const today = new Date().toISOString().slice(0, 10);
const version = arg('version', process.env.APP_VERSION || `${today}-v2`);
const out = path.resolve(root, arg('out', 'index.html'));

const common = { bundle: true, write: false, minify: !dev, legalComments: 'none', loader: { '.png': 'dataurl', '.woff2': 'dataurl' }, logLevel: 'warning' };

const js = await build({
  ...common,
  entryPoints: [path.join(root, 'src/app/main.jsx')],
  format: 'iife',
  target: ['safari15', 'chrome100'],
  jsx: 'automatic',
  jsxImportSource: 'preact',
  define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
});
const css = await build({ ...common, entryPoints: [path.join(root, 'src/styles/app.css')], target: ['safari15', 'chrome100'] });

const dataUrl = (file) => `data:image/png;base64,${fs.readFileSync(path.join(root, 'src/assets', file)).toString('base64')}`;
// A literal "</script" inside the bundle would end the inline script early.
const jsText = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
const cssText = css.outputFiles[0].text.replace(/<\/style/gi, '<\\/style');

const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8')
  .replace('{{VERSION}}', version)
  .replace('{{FAVICON}}', dataUrl('favicon.png'))
  .replace('{{TOUCH_ICON}}', dataUrl('touch-icon.png'))
  .replace('{{CSS}}', () => cssText)
  .replace('{{JS}}', () => jsText);

fs.writeFileSync(out, html);
console.log(`built ${path.relative(root, out)} · version ${version} · ${(html.length / 1024).toFixed(0)} KB (js ${(jsText.length / 1024).toFixed(0)} KB, css ${(cssText.length / 1024).toFixed(0)} KB)`);
