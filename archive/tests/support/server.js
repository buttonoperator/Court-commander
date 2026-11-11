// Minimal static server (no dependencies). Serves ONLY index.html (at / and /index.html) from the repo root,
// so a LAN copy cannot expose .git, node_modules or other files.
//   HOST (default 127.0.0.1) and PORT (default 4173) override the bind address.
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' };
http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p !== '/' && p !== '/index.html') { res.writeHead(404); return res.end('not found'); }
  const file = path.join(root, 'index.html');
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(Number(process.env.PORT) || 4173, process.env.HOST || '127.0.0.1');
