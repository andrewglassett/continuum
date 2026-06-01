const http = require('http');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

const PORT = 3000;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
};

// Injected into HTML responses to open a WebSocket back to this server.
const LIVERELOAD_SNIPPET = `
<script>
(function(){
  const ws = new WebSocket('ws://localhost:${PORT}/__reload');
  ws.onmessage = () => location.reload();
  ws.onclose   = () => console.log('[live] server closed');
})();
</script>`;

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  let urlPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(ROOT, urlPath);
  const ext = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const mime = MIME[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });

    if (ext === '.html') {
      // Inject live-reload snippet before </body>
      const html = data.toString().replace('</body>', `${LIVERELOAD_SNIPPET}\n</body>`);
      res.end(html);
    } else {
      res.end(data);
    }
  });
});

// ── WebSocket server (hand-rolled, no extra deps) ─────────────────────────────

const clients = new Set();

server.on('upgrade', (req, socket) => {
  if (req.url !== '/__reload') { socket.destroy(); return; }

  // WebSocket handshake
  const key = req.headers['sec-websocket-key'];
  const accept = require('crypto')
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  clients.add(socket);
  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
});

function sendReload() {
  // WebSocket text frame: FIN + opcode 0x1, 6-byte payload "reload"
  const payload = Buffer.from('reload');
  const frame = Buffer.alloc(2 + payload.length);
  frame[0] = 0x81;          // FIN + text opcode
  frame[1] = payload.length;
  payload.copy(frame, 2);
  for (const socket of clients) {
    try { socket.write(frame); } catch {}
  }
}

// ── File watcher ─────────────────────────────────────────────────────────────

chokidar
  .watch(['./**/*.html', './**/*.css', './**/*.js'], {
    ignored: /node_modules/,
    ignoreInitial: true,
  })
  .on('change', file => {
    console.log(`[live] changed: ${file}`);
    sendReload();
  });

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`[live] http://localhost:${PORT}`);
});
