// Servidor de sinalização: serve os arquivos estáticos, forma pares aleatórios
// e repassa mensagens WebRTC e de chat entre os dois lados.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORTA = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const servidor = http.createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const arquivo = path.normalize(path.join(PUBLIC, url));
  if (!arquivo.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(arquivo, (erro, dados) => {
    if (erro) { res.writeHead(404); return res.end('Não encontrado'); }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream' });
    res.end(dados);
  });
});

const wss = new WebSocketServer({ server: servidor });
let fila = null; // cliente aguardando par

function enviar(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function desparear(ws) {
  if (fila === ws) fila = null;
  const par = ws.par;
  if (par) {
    par.par = null;
    ws.par = null;
    enviar(par, { type: 'partner-left' });
  }
}

function procurar(ws) {
  desparear(ws);
  if (fila && fila !== ws && fila.readyState === 1) {
    const outro = fila;
    fila = null;
    ws.par = outro;
    outro.par = ws;
    enviar(outro, { type: 'matched', initiator: true });
    enviar(ws, { type: 'matched', initiator: false });
  } else {
    fila = ws;
    enviar(ws, { type: 'waiting' });
  }
}

wss.on('connection', (ws) => {
  ws.par = null;
  enviar(ws, { type: 'online', total: wss.clients.size });

  ws.on('message', (bruto) => {
    let msg;
    try { msg = JSON.parse(bruto); } catch { return; }
    switch (msg.type) {
      case 'search': return procurar(ws);
      case 'stop': return desparear(ws);
      case 'offer':
      case 'answer':
      case 'candidate':
      case 'source':
        return enviar(ws.par, msg);
      case 'chat':
        if (typeof msg.text === 'string') {
          enviar(ws.par, { type: 'chat', text: msg.text.slice(0, 500) });
        }
        return;
    }
  });

  ws.on('close', () => desparear(ws));
});

servidor.listen(PORTA, () => console.log(`Servidor em http://localhost:${PORTA}`));
