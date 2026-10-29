// Webhook que responde no Direct (private reply) a quem comenta no seu vídeo.
// Sem dependências: usa o fetch nativo do Node 22.
const http = require('http');
const crypto = require('crypto');

const cfg = {
  porta: process.env.PORT || 4000,
  verifyToken: process.env.VERIFY_TOKEN,          // texto que você define no painel da Meta
  appSecret: process.env.APP_SECRET,              // segredo do app (valida a assinatura)
  igUserId: process.env.IG_USER_ID,               // ID da conta profissional
  token: process.env.IG_ACCESS_TOKEN,             // token da conta (Instagram Login)
  graph: process.env.GRAPH_BASE || 'https://graph.instagram.com',
  versao: process.env.GRAPH_VERSION || 'v23.0',   // [A VERIFICAR] versão vigente na Meta
  palavra: (process.env.KEYWORD || '').toLowerCase().trim(), // vazio = responde a todo comentário
  mediaId: process.env.MEDIA_ID || '',            // vazio = qualquer publicação
  mensagem: process.env.MESSAGE_TEXT || 'Oi! Aqui está o seu arquivo:',
  arquivoUrl: process.env.FILE_URL || '',         // link público do arquivo
};

for (const k of ['verifyToken', 'appSecret', 'igUserId', 'token']) {
  if (!cfg[k]) { console.error(`Variável de ambiente ausente: ${k}`); process.exit(1); }
}

const respondidos = new Set(); // evita responder duas vezes ao mesmo comentário

function assinaturaValida(corpo, cabecalho) {
  if (!cabecalho) return false;
  const esperado = 'sha256=' + crypto.createHmac('sha256', cfg.appSecret).update(corpo).digest('hex');
  const a = Buffer.from(esperado), b = Buffer.from(cabecalho);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function respostaPrivada(commentId) {
  const texto = cfg.arquivoUrl ? `${cfg.mensagem}\n${cfg.arquivoUrl}` : cfg.mensagem;
  const r = await fetch(`${cfg.graph}/${cfg.versao}/${cfg.igUserId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text: texto } }),
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(dados)}`);
  return dados;
}

async function tratarComentario(c) {
  if (!c || !c.id || respondidos.has(c.id)) return;
  if (c.from?.id === cfg.igUserId) return;                         // ignora o próprio comentário
  if (cfg.mediaId && c.media?.id !== cfg.mediaId) return;          // só o vídeo configurado
  if (cfg.palavra && !(c.text || '').toLowerCase().includes(cfg.palavra)) return;
  respondidos.add(c.id);
  try {
    await respostaPrivada(c.id);
    console.log(`DM enviado ao comentário ${c.id} (@${c.from?.username || '?'})`);
  } catch (e) {
    respondidos.delete(c.id);
    console.error(`Falha no comentário ${c.id}: ${e.message}`);
  }
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');

  // Verificação do webhook (GET) feita pela Meta ao cadastrar a URL
  if (req.method === 'GET' && url.pathname === '/webhook') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' &&
               url.searchParams.get('hub.verify_token') === cfg.verifyToken;
    res.writeHead(ok ? 200 : 403);
    return res.end(ok ? url.searchParams.get('hub.challenge') : '');
  }

  if (req.method === 'POST' && url.pathname === '/webhook') {
    const partes = [];
    req.on('data', (p) => partes.push(p));
    req.on('end', () => {
      const corpo = Buffer.concat(partes);
      if (!assinaturaValida(corpo, req.headers['x-hub-signature-256'])) {
        res.writeHead(401); return res.end();
      }
      res.writeHead(200); res.end('ok'); // responde logo; a Meta reenvia se demorar
      let json;
      try { json = JSON.parse(corpo); } catch { return; }
      for (const entrada of json.entry || []) {
        for (const mudanca of entrada.changes || []) {
          if (mudanca.field === 'comments') tratarComentario(mudanca.value);
        }
      }
    });
    return;
  }

  res.writeHead(404); res.end();
}).listen(cfg.porta, () => console.log(`Webhook em http://localhost:${cfg.porta}/webhook`));
