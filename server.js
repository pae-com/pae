const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const LOG_FILE = path.join(DATA_DIR, 'log.json');
const LOG_MAX = 200;
const PORT = Number(process.env.PORT) || 3000;

const DEFAULT_DB = {
  channels: ["LINE","เพจนนทบุรี","เพจนครปฐม","เพจเซล่าร์","โทรติดต่อ"],
  types: ["ล้างแอร์","เติมน้ำยาแอร์","เปลี่ยนอะไหล่","ตรวจเช็ค","ติดตั้ง","ถอดแอร์","ซ่อมรั่ว"],
  settings: { targetPerDay: 40, monthTotalTarget: 1000 },
  notes: "",
  entries: {},
  history: []
};

function monthKeyOf(dateStr){ return String(dateStr || '').slice(0, 7); }

function loadDb(){
  try{
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  }catch(e){
    const d = JSON.parse(JSON.stringify(DEFAULT_DB));
    saveDb(d);
    return d;
  }
}

function saveDb(db){
  if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ================= usage log =================
function loadLog(){
  try{
    const a = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    return Array.isArray(a) ? a : [];
  }catch(e){
    return [];
  }
}
function saveLog(l){
  if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = LOG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(l, null, 2));
  fs.renameSync(tmp, LOG_FILE);
}
function appendLog(entry){
  try{
    const l = loadLog();
    l.unshift(entry);
    if(l.length > LOG_MAX) l.length = LOG_MAX;
    saveLog(l);
    const t = new Date(entry.ts || Date.now());
    const hh = String(t.getHours()).padStart(2,'0');
    const mi = String(t.getMinutes()).padStart(2,'0');
    const ss = String(t.getSeconds()).padStart(2,'0');
    let msg;
    if(entry.kind === 'add') msg = `เพิ่ม ${entry.channel} · ${entry.type} ${entry.qty} เครื่อง (วันที่ ${entry.date})`;
    else if(entry.kind === 'delete') msg = `ลบ ${entry.channel} · ${entry.type} ${entry.qty} เครื่อง (วันที่ ${entry.date})`;
    else if(entry.kind === 'update') msg = `แก้ไข ${entry.channel} · ${entry.type} ${entry.qty} เครื่อง (วันที่ ${entry.date})`;
    else msg = entry.label || 'บันทึกข้อมูลทั้งหมด';
    console.log(`[LOG ${hh}:${mi}:${ss}] ${msg} | IP: ${entry.ip || '-'}`);
  }catch(e){}
}
function clientInfo(req){
  return {
    ip: String((req.socket && req.socket.remoteAddress) || '').replace('::ffff:', ''),
    ua: String(req.headers['user-agent'] || '').slice(0, 60)
  };
}

function sanitize(o){
  if(!o || typeof o !== 'object' || Array.isArray(o)) o = {};
  o.entries = (o.entries && typeof o.entries === 'object' && !Array.isArray(o.entries)) ? o.entries : {};
  o.history = Array.isArray(o.history) ? o.history : [];
  o.channels = Array.isArray(o.channels) && o.channels.length ? o.channels : DEFAULT_DB.channels;
  o.types = Array.isArray(o.types) && o.types.length ? o.types : DEFAULT_DB.types;
  o.settings = (o.settings && typeof o.settings === 'object' && !Array.isArray(o.settings)) ? o.settings : {};
  o.notes = typeof o.notes === 'string' ? o.notes : '';
  return o;
}

function readBody(req){
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', c => {
      b += c;
      if(b.length > 10 * 1024 * 1024){ req.destroy(); reject(new Error('payload ใหญ่เกินไป')); }
    });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

async function parseJsonBody(req){
  const str = await readBody(req);
  if(!str || !str.trim()) return {};
  return JSON.parse(str);
}

function json(res, code, obj){
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

const MIME = {
  html: 'text/html', css: 'text/css', js: 'text/javascript',
  json: 'application/json', svg: 'image/svg+xml', png: 'image/png', ico: 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  let url;
  try{ url = new URL(req.url, 'http://x'); }catch(e){ res.writeHead(400); res.end(); return; }
  const p = url.pathname;

  try{
    // ---------- API ----------
    if(p === '/api/db' && req.method === 'GET'){
      json(res, 200, { ok: true, db: loadDb() });
      return;
    }
    if(p === '/api/db' && req.method === 'POST'){
      const raw = await parseJsonBody(req);
      const db = sanitize(raw.db ? raw.db : raw);
      saveDb(db);
      appendLog(Object.assign({ ts: Date.now(), kind: 'save', label: String(raw.logLabel || 'บันทึกข้อมูลทั้งหมด').slice(0, 80) }, clientInfo(req)));
      json(res, 200, { ok: true, db });
      return;
    }
    if(p === '/api/add' && req.method === 'POST'){
      const b = await parseJsonBody(req);
      const db = loadDb();
      const date = String(b.date || '');
      const entry = {
        id: 'e' + Date.now() + Math.random().toString(36).slice(2, 7),
        channel: String(b.channel || 'ไม่ระบุ'),
        type: String(b.type || ''),
        qty: Math.max(0, Math.floor(Number(b.qty) || 0)),
        ts: Date.now()
      };
      if(!db.entries[date]) db.entries[date] = [];
      db.entries[date].push(entry);
      db.history.unshift({ ts: Date.now(), kind: 'add', date, channel: entry.channel, type: entry.type, qty: entry.qty });
      const trimmed = db.history.length > 10;
      if(trimmed) db.history.length = 10;
      saveDb(db);
      appendLog(Object.assign({ ts: Date.now(), kind: 'add', date, channel: entry.channel, type: entry.type, qty: entry.qty }, clientInfo(req)));
      json(res, 200, { ok: true, db, entry, trimmed });
      return;
    }
    if(p === '/api/delete' && req.method === 'POST'){
      const b = await parseJsonBody(req);
      const db = loadDb();
      const list = db.entries[b.date] || [];
      const idx = list.findIndex(e => e.id === b.id);
      if(idx >= 0){
        const ent = list.splice(idx, 1)[0];
        db.history.unshift({ ts: Date.now(), kind: 'delete', date: b.date, channel: ent.channel, type: ent.type, qty: ent.qty });
        const trimmed = db.history.length > 10;
      if(trimmed) db.history.length = 10;
        saveDb(db);
        appendLog(Object.assign({ ts: Date.now(), kind: 'delete', date: b.date, channel: ent.channel, type: ent.type, qty: ent.qty }, clientInfo(req)));
        json(res, 200, { ok: true, db, trimmed });
        return;
      }
      json(res, 400, { ok: false, error: 'ไม่พบรายการ' });
      return;
    }
    if(p === '/api/update' && req.method === 'POST'){
      const b = await parseJsonBody(req);
      const db = loadDb();
      const list = db.entries[b.date] || [];
      const ent = list.find(e => e.id === b.id);
      if(!ent){
        json(res, 400, { ok: false, error: 'ไม่พบรายการ' });
        return;
      }
      const changed = {};
      if(typeof b.channel === 'string' && b.channel !== ent.channel){ changed.oldChannel = ent.channel; ent.channel = b.channel; }
      if(typeof b.type === 'string' && b.type !== ent.type){ changed.oldType = ent.type; ent.type = b.type; }
      if(typeof b.qty === 'number' && b.qty !== ent.qty){ changed.oldQty = ent.qty; ent.qty = Math.max(0, Math.floor(b.qty)); }
      db.history.unshift({
        ts: Date.now(),
        kind: 'update',
        date: b.date,
        channel: ent.channel,
        type: ent.type,
        qty: ent.qty,
        oldChannel: changed.oldChannel,
        oldType: changed.oldType,
        oldQty: changed.oldQty
      });
      const trimmed = db.history.length > 10;
      if(trimmed) db.history.length = 10;
      saveDb(db);
      appendLog(Object.assign({ ts: Date.now(), kind: 'update', date: b.date, channel: ent.channel, type: ent.type, qty: ent.qty }, clientInfo(req)));
      json(res, 200, { ok: true, db, entry: ent, trimmed });
      return;
    }

    // ---------- usage log ----------
    if(p === '/api/log' && req.method === 'GET'){
      json(res, 200, { ok: true, log: loadLog(), now: Date.now() });
      return;
    }
    if(p === '/api/log/since' && req.method === 'GET'){
      const since = Number(url.searchParams.get('ts')) || 0;
      json(res, 200, { ok: true, log: loadLog().filter(e => (Number(e.ts) || 0) > since), now: Date.now() });
      return;
    }
    if(p === '/api/log/clear' && req.method === 'POST'){
      saveLog([]);
      appendLog(Object.assign({ ts: Date.now(), kind: 'clear', label: 'ล้างประวัติการใช้งาน' }, clientInfo(req)));
      json(res, 200, { ok: true });
      return;
    }
  }catch(e){
    json(res, 400, { ok: false, error: String(e.message || e) });
    return;
  }

  // ---------- static ----------
  if(req.method !== 'GET'){ res.writeHead(405); res.end(); return; }
  let f;
  try{ f = path.normalize(path.join(ROOT, p === '/' ? 'index.html' : decodeURIComponent(p))); }
  catch(e){ res.writeHead(400); res.end(); return; }
  if(!f.startsWith(ROOT)){ res.writeHead(403); res.end(); return; }
  if(fs.existsSync(f) && fs.statSync(f).isFile()){
    const ext = path.extname(f).slice(1).toLowerCase();
    res.writeHead(200, {
      'Content-Type': (MIME[ext] || 'application/octet-stream') + '; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(f).pipe(res);
    return;
  }
  res.writeHead(404); res.end('Not found');
});

function printBanner(){
  const cyan = '\x1b[36m';
  const reset = '\x1b[0m';
  const banner = [
    '   _____                          _______              ',
    '  / ___/____  ____ _________     /_  __(_)___ ___  ___ ',
    '  \\__ \\/ __ \\/ __ `/ ___/ _ \\     / / / / __ `__ \\/ _ \\',
    ' ___/ / /_/ / /_/ / /  /  __/    / / / / / / / / /  __/',
    '/____/ .___/\\__,_/_/   \\___/    /_/ /_/_/ /_/ /_/\\___/ ',
    '    /_/                                                '
  ];
  console.log('');
  banner.forEach(line => console.log(cyan + line + reset));
  console.log('');
}

server.listen(PORT, '0.0.0.0', () => {
  printBanner();
  console.log('บันทึกงานล้างแอร์ - server รันแล้ว');
  console.log('   เปิดได้ที่:  http://localhost:' + PORT);
  const ifaces = os.networkInterfaces();
  Object.values(ifaces).forEach(list => {
    (list || []).forEach(i => {
      if(i.family === 'IPv4' && !i.internal) console.log('   มือถือ/เครื่องอื่น: http://' + i.address + ':' + PORT);
    });
  });
});