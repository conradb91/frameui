// Uses Electron's bundled Node runtime; static projects need no Python install.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const types = { '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm' };
(async () => {
  const root = await fs.realpath(process.argv[2]);
  const port = Number(process.argv[3]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local port');
  http.createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
      const route = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (route.split('/').some(s => s.startsWith('.') || ['node_modules', 'vendor'].includes(s))) throw new Error('Private path');
      let file = path.resolve(root, '.' + route);
      if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
      file = await fs.realpath(file);
      const relative = path.relative(root, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Outside project');
      const type = types[path.extname(file).toLowerCase()];
      if (!type) throw new Error('Unsupported asset');
      response.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : await fs.readFile(file));
    } catch { if (!response.headersSent) response.writeHead(404); response.end('Page not found'); }
  }).listen(port, '127.0.0.1', () => console.log(`Local application ready at http://127.0.0.1:${port}`));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
