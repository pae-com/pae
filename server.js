const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const ATTEND_FILE = path.join(DATA_DIR, 'attendance.json');
const PORT = Number(process.env.PORT) || 3000;

const DEFAULT_DB = {
  channels: ["LINE","เพจนนทบุรี","เพจนครปฐม","เพจเซล่าร์","โทรติดต่อ"],
  types: ["ล้างแอร์","เติมน้ำยาแอร์","เปลี่ยนอะไหล่","ตรวจเช็ค","ติดตั้ง","ซ่อมรั่ว"],
  settings: { targetPerDay: 40, monthTotalTarget: 1000 },
  notes: "",
  entries: {},
  history: []
};

function monthKeyOf(dateStr){ return String(dateStr || '').slice(0, 7); }

const DEFAULT_ATTEND = {
  days: {},
  holidays: {}
};

function loadAttend(){
  try{
    return JSON.parse(fs.readFileSync(ATTEND_FILE, 'utf8'));
  }catch(e){
    const d = JSON.parse(JSON.stringify(DEFAULT_ATTEND));
    saveAttend(d);
    return d;
  }
}

function saveAttend(att){
  if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = ATTEND_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(att, null, 2));
  fs.renameSync(tmp, ATTEND_FILE);
}

function sanitizeAttend(o){
  if(!o || typeof o !== 'object' || Array.isArray(o)) o = {};
  o.days = (o.days && typeof o.days === 'object' && !Array.isArray(o.days)) ? o.days : {};
  o.holidays = (o.holidays && typeof o.holidays === 'object' && !Array.isArray(o.holidays)) ? o.holidays : {};
  return o;
}

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
      json(res, 200, { ok: true, db, entry: ent, trimmed });
      return;
    }

    // ---------- attendance ----------
    if(p === '/api/attendance' && req.method === 'GET'){
      json(res, 200, { ok: true, db: loadAttend() });
      return;
    }
    if(p === '/api/attendance' && req.method === 'POST'){
      const raw = await parseJsonBody(req);
      const att = sanitizeAttend(raw.db ? raw.db : raw);
      saveAttend(att);
      json(res, 200, { ok: true, db: att });
      return;
    }
    if(p === '/api/attendance/set' && req.method === 'POST'){
      const b = await parseJsonBody(req);
      const att = loadAttend();
      const date = String(b.date || '');
      const name = String(b.name || '');
      if(!date || !name){ json(res, 400, { ok: false, error: 'ไม่พบข้อมูลวันที่/ชื่อ' }); return; }
      const status = ['มา','ลา','ขาด','หยุด'].includes(b.status) ? b.status : null;
      if(!att.days[date]) att.days[date] = {};
      if(status === null) delete att.days[date][name];
      else att.days[date][name] = status;
      if(att.days[date] && !Object.keys(att.days[date]).length) delete att.days[date];
      saveAttend(att);
      json(res, 200, { ok: true, db: att });
      return;
    }
    if(p === '/api/attendance/holiday' && req.method === 'POST'){
      const b = await parseJsonBody(req);
      const att = loadAttend();
      const name = String(b.name || '');
      if(!name){ json(res, 400, { ok: false, error: 'ไม่พบชื่อ' }); return; }
      if(String(b.holiday || '').trim()) att.holidays[name] = String(b.holiday).trim();
      else delete att.holidays[name];
      saveAttend(att);
      json(res, 200, { ok: true, db: att });
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

server.listen(PORT, '0.0.0.0', () => {
  console.log('บันทึกงานล้างแอร์ - server รันแล้ว');
  console.log('   เปิดได้ที่:  http://localhost:' + PORT);
  const ifaces = os.networkInterfaces();
  Object.values(ifaces).forEach(list => {
    (list || []).forEach(i => {
      if(i.family === 'IPv4' && !i.internal) console.log('   มือถือ/เครื่องอื่น: http://' + i.address + ':' + PORT);
    });
  });
});