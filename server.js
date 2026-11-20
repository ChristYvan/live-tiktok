// Local : node server.js ton_pseudo_tiktok
// En ligne : variable d'environnement TIKTOK_USER (le serveur attend que ton live démarre)
import { TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';
import { WebSocketServer } from 'ws';
import http from 'http';
import fs from 'fs';

const USER = (process.argv[2] || process.env.TIKTOK_USER || '').replace('@', '');
if (!USER) { console.log('Usage : node server.js ton_pseudo_tiktok (ou variable TIKTOK_USER)'); process.exit(1); }

const PORT = process.env.PORT || 8080;
const server = http.createServer((req, res) => {
  if (req.url === '/health') return res.end('ok');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.readFileSync(new URL('./course-avatars.html', import.meta.url)));
});
const wss = new WebSocketServer({ server });
const send = o => { const m = JSON.stringify(o); wss.clients.forEach(c => c.readyState === 1 && c.send(m)); };

// Vrais drapeaux : la page demande un drapeau, le serveur le télécharge et le renvoie en data:URL.
const flags = new Map();
wss.on('connection', ws => ws.on('message', async raw => {
  try {
    const m = JSON.parse(raw);
    if (m.type !== 'needflag' || !/^[A-Za-z]{2}$/.test(m.iso)) return;
    const iso = m.iso.toLowerCase();
    if (!flags.has(iso)) {
      const r = await fetch(`https://flagcdn.com/w320/${iso}.png`);
      flags.set(iso, `data:image/png;base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`);
    }
    ws.send(JSON.stringify({ type: 'flag', iso: m.iso.toUpperCase(), data: flags.get(iso) }));
  } catch {}
}));

const who = d => { const u = d.user || d; return { id: String(u.userId || u.uniqueId), user: u.nickname || u.uniqueId || 'Anonyme' }; };
const conn = new TikTokLiveConnection(USER, { enableExtendedGiftInfo: true });

conn.on(WebcastEvent.CHAT, d => send({ type: 'chat', ...who(d), text: d.comment }));
conn.on(WebcastEvent.LIKE, d => send({ type: 'like', ...who(d), count: d.likeCount || 1 }));
conn.on(WebcastEvent.GIFT, d => {
  if (d.giftType === 1 && !d.repeatEnd) return; // série en cours : on compte à la fin
  send({ type: 'gift', ...who(d), name: d.giftName || '', count: d.repeatCount || 1, value: (d.diamondCount || 1) * (d.repeatCount || 1) });
});

// Partages (dédoublonnés : plusieurs événements peuvent signaler le même partage)
const lastShare = new Map();
const share = d => {
  const w = who(d), now = Date.now();
  if (now - (lastShare.get(w.id) || 0) < 2000) return;
  lastShare.set(w.id, now);
  send({ type: 'share', ...w });
};
conn.on(WebcastEvent.SOCIAL, d => { if (/share/i.test(d.displayType || '')) share(d); });
if (WebcastEvent.SHARE) conn.on(WebcastEvent.SHARE, share);

async function start() {
  try { await conn.connect(); console.log('✅ Connecté au live de @' + USER); }
  catch (e) { console.log('❌ Échec (' + (e.message || e) + '), nouvel essai dans 10 s'); setTimeout(start, 10000); }
}
server.listen(PORT, () => console.log('Serveur prêt sur le port ' + PORT + ' (page : http://localhost:' + PORT + '/?live)'));
start();
