// Cliente WebRTC: pareamento aleatório, chat e troca de fonte (câmera ou arquivo).
const $ = (id) => document.getElementById(id);
const videoLocal = $('local');
const videoRemoto = $('remoto');
const origemArquivo = $('origemArquivo');
const selo = $('seloRemoto');

const STUN = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

let ws;
let pc = null;
let streamCamera = null;
let streamArquivo = null;
let fonteAtual = 'camera';
let ativo = false;

function status(texto) { $('status').textContent = texto; }

function sistema(texto) {
  const p = document.createElement('div');
  p.className = 'sis';
  p.textContent = texto;
  $('mensagens').appendChild(p);
  $('mensagens').scrollTop = 1e9;
}

function mensagem(texto, minha) {
  const p = document.createElement('div');
  if (minha) p.className = 'eu';
  p.textContent = (minha ? 'Você: ' : 'Parceiro: ') + texto;
  $('mensagens').appendChild(p);
  $('mensagens').scrollTop = 1e9;
}

function enviar(msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }

// ---------- Mídia ----------
async function abrirCamera() {
  if (streamCamera) return streamCamera;
  try {
    streamCamera = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (e) {
    sistema('Não foi possível acessar a câmera: ' + e.message);
  }
  return streamCamera;
}

function capturarArquivo() {
  const captura = origemArquivo.captureStream || origemArquivo.mozCaptureStream;
  if (!captura) { sistema('Este navegador não suporta transmitir arquivos.'); return null; }
  return captura.call(origemArquivo);
}

async function escolherArquivo() {
  const arq = $('arquivo').files[0];
  if (!arq) return false;
  origemArquivo.src = URL.createObjectURL(arq);
  origemArquivo.muted = false;
  await origemArquivo.play().catch(() => {});
  streamArquivo = capturarArquivo();
  return !!streamArquivo;
}

function streamDaFonte() {
  return fonteAtual === 'arquivo' ? streamArquivo : streamCamera;
}

async function aplicarFonte() {
  const stream = streamDaFonte();
  videoLocal.srcObject = stream;
  if (pc) {
    for (const tipo of ['video', 'audio']) {
      const sender = pc.getSenders().find((s) => s.track?.kind === tipo || s.kindEsperado === tipo);
      const track = stream?.getTracks().find((t) => t.kind === tipo) || null;
      if (sender) await sender.replaceTrack(track);
    }
  }
  enviar({ type: 'source', kind: fonteAtual });
}

// ---------- WebRTC ----------
function criarConexao() {
  pc = new RTCPeerConnection(STUN);
  const stream = streamDaFonte();
  for (const tipo of ['video', 'audio']) {
    const track = stream?.getTracks().find((t) => t.kind === tipo) || null;
    const tr = pc.addTransceiver(track || tipo, { direction: 'sendrecv' });
    tr.sender.kindEsperado = tipo;
  }
  pc.onicecandidate = (e) => e.candidate && enviar({ type: 'candidate', candidate: e.candidate });
  pc.ontrack = (e) => { videoRemoto.srcObject = e.streams[0] || new MediaStream([e.track]); };
  pc.onconnectionstatechange = () => {
    if (pc?.connectionState === 'connected') status('Conectado');
  };
  enviar({ type: 'source', kind: fonteAtual });
}

function fecharConexao() {
  if (pc) { pc.close(); pc = null; }
  videoRemoto.srcObject = null;
  selo.hidden = true;
  $('textoChat').disabled = true;
  $('btnEnviar').disabled = true;
}

async function tratar(msg) {
  switch (msg.type) {
    case 'online': return status(`Online: ${msg.total}`);
    case 'waiting': return sistema('Procurando alguém...');
    case 'matched': {
      fecharConexao();
      criarConexao();
      $('mensagens').innerHTML = '';
      sistema('Parceiro encontrado. Diga olá!');
      $('textoChat').disabled = false;
      $('btnEnviar').disabled = false;
      if (msg.initiator) {
        const oferta = await pc.createOffer();
        await pc.setLocalDescription(oferta);
        enviar({ type: 'offer', sdp: pc.localDescription });
      }
      return;
    }
    case 'offer':
      await pc.setRemoteDescription(msg.sdp);
      const resposta = await pc.createAnswer();
      await pc.setLocalDescription(resposta);
      return enviar({ type: 'answer', sdp: pc.localDescription });
    case 'answer': return pc.setRemoteDescription(msg.sdp);
    case 'candidate': return pc?.addIceCandidate(msg.candidate).catch(() => {});
    case 'source': selo.hidden = msg.kind !== 'arquivo'; return;
    case 'chat': return mensagem(msg.text, false);
    case 'partner-left':
      fecharConexao();
      sistema('O parceiro saiu.');
      if (ativo) procurar();
      return;
  }
}

function procurar() { enviar({ type: 'search' }); }

// ---------- Interface ----------
$('btnIniciar').onclick = async () => {
  if (fonteAtual === 'camera') await abrirCamera();
  else if (!streamArquivo) return sistema('Escolha um arquivo de vídeo primeiro.');
  ativo = true;
  videoLocal.srcObject = streamDaFonte();
  $('btnIniciar').disabled = true;
  $('btnProximo').disabled = false;
  $('btnParar').disabled = false;
  procurar();
};

$('btnProximo').onclick = () => { fecharConexao(); procurar(); };

$('btnParar').onclick = () => {
  ativo = false;
  enviar({ type: 'stop' });
  fecharConexao();
  $('btnIniciar').disabled = false;
  $('btnProximo').disabled = true;
  $('btnParar').disabled = true;
  sistema('Conversa encerrada.');
};

document.querySelectorAll('input[name=fonte]').forEach((r) => {
  r.onchange = async () => {
    fonteAtual = r.value;
    const arq = fonteAtual === 'arquivo';
    $('btnArquivo').hidden = !arq;
    if (arq && !streamArquivo) return $('arquivo').click();
    if (!arq) await abrirCamera();
    if (ativo) await aplicarFonte();
  };
});

$('btnArquivo').onclick = () => $('arquivo').click();

$('arquivo').onchange = async () => {
  if (await escolherArquivo()) {
    $('btnArquivo').hidden = false;
    if (ativo) await aplicarFonte();
    else videoLocal.srcObject = streamArquivo;
  }
};

$('formChat').onsubmit = (e) => {
  e.preventDefault();
  const texto = $('textoChat').value.trim();
  if (!texto) return;
  enviar({ type: 'chat', text: texto });
  mensagem(texto, true);
  $('textoChat').value = '';
};

function conectar() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onmessage = (e) => tratar(JSON.parse(e.data));
  ws.onclose = () => { status('Desconectado. Reconectando...'); setTimeout(conectar, 2000); };
}
conectar();
