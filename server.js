const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const uploadDir = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });
const db = new Database(path.join(dataDir, 'khweza.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff');
CREATE TABLE IF NOT EXISTS rooms(id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', price TEXT DEFAULT 'Contact hotel', image TEXT DEFAULT '', published INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS updates(id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, published INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS menu(id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', price TEXT DEFAULT '', published INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS enquiries(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT DEFAULT '', arrival TEXT DEFAULT '', departure TEXT DEFAULT '', message TEXT DEFAULT '', status TEXT DEFAULT 'New', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);
if (!db.prepare('SELECT id FROM users LIMIT 1').get() && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  db.prepare('INSERT INTO users(email,password_hash,role) VALUES(?,?,?)').run(process.env.ADMIN_EMAIL.toLowerCase(), bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12), 'admin');
}
if (!db.prepare('SELECT id FROM updates LIMIT 1').get()) {
  const add = db.prepare('INSERT INTO updates(title,body,published) VALUES(?,?,0)');
  [
    ['SAMPLE — Welcome to Khweza','This is placeholder content for the hotel team to review and replace with an approved announcement. It is not published to guests.'],
    ['SAMPLE — Hotel information','Add current check-in guidance, facilities information and guest notices here. Replace this text before publishing.']
  ].forEach(x => add.run(...x));
}
if (!db.prepare('SELECT id FROM menu LIMIT 1').get()) {
  const add = db.prepare('INSERT INTO menu(name,description,price,published) VALUES(?,?,?,0)');
  [
    ['SAMPLE — Breakfast','Placeholder menu item. Replace with the hotel-approved breakfast description.','Confirm with hotel'],
    ['SAMPLE — Lunch special','Placeholder menu item. Replace with the current restaurant offering.','Confirm with hotel'],
    ['SAMPLE — Hot beverage','Placeholder menu item. Replace with the actual drinks menu.','Confirm with hotel']
  ].forEach(x => add.run(...x));
}
if (!db.prepare('SELECT id FROM rooms LIMIT 1').get()) {
  const add = db.prepare('INSERT INTO rooms(name,description,price,image,published) VALUES(?,?,?,?,1)');
  [
    ['Single Room','Comfortable accommodation for one guest.','Contact hotel','https://khweza.com/wp-content/uploads/2021/06/gc1.jpeg'],
    ['Double Room','A welcoming room for two guests.','Contact hotel','https://khweza.com/wp-content/uploads/2021/06/c10.jpeg'],
    ['Twin Room','Twin-bed accommodation.','Contact hotel','https://khweza.com/wp-content/uploads/2021/06/gc4.jpeg'],
    ['Family Room','Options for families and groups.','Contact hotel','https://khweza.com/wp-content/uploads/2021/06/c15.jpeg']
  ].forEach(x => add.run(...x));
}
app.use(express.json({limit:'1mb'}));
app.use(express.urlencoded({extended:true}));
app.use(session({
  store: new SQLiteStore({db:'sessions.sqlite', dir:dataDir}),
  secret: process.env.SESSION_SECRET || 'development-only-change-this-secret',
  resave:false, saveUninitialized:false,
  cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:8*60*60*1000}
}));
app.use(express.static(path.join(__dirname,'public')));
const upload = multer({storage:multer.diskStorage({
  destination:(req,file,cb)=>cb(null,uploadDir),
  filename:(req,file,cb)=>cb(null,Date.now()+'-'+Math.random().toString(36).slice(2)+path.extname(file.originalname).toLowerCase())
}), limits:{fileSize:5*1024*1024}, fileFilter:(req,file,cb)=>cb(null,/^image\/(jpeg|png|webp)$/.test(file.mimetype))});
function auth(req,res,next){ if(req.session.user) return next(); res.status(401).json({error:'Please sign in.'}); }
function admin(req,res,next){ if(req.session.user?.role==='admin') return next(); res.status(403).json({error:'Administrator access required.'}); }
const publicRows = (table) => db.prepare(`SELECT * FROM ${table} WHERE published=1 ORDER BY id DESC`).all();
app.get('/api/public',(req,res)=>res.json({rooms:db.prepare('SELECT * FROM rooms WHERE published=1 ORDER BY id').all(),updates:publicRows('updates'),menu:publicRows('menu')}));
app.post('/api/enquiries',(req,res)=>{
  const {name,email,phone,arrival,departure,message}=req.body||{};
  if(!name||!email||!message) return res.status(400).json({error:'Name, email and message are required.'});
  if(String(name).length>120||String(email).length>200||String(message).length>2000) return res.status(400).json({error:'Please shorten your message.'});
  db.prepare('INSERT INTO enquiries(name,email,phone,arrival,departure,message) VALUES(?,?,?,?,?,?)').run(name,email,phone||'',arrival||'',departure||'',message);
  res.json({ok:true,message:'Thank you. Your enquiry has been received; the hotel will need to confirm availability.'});
});
app.post('/api/login', (req,res)=>{
  const email=String(req.body.email||'').toLowerCase();
  const user=db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if(!user||!bcrypt.compareSync(String(req.body.password||''),user.password_hash)) return res.status(401).json({error:'Incorrect email or password.'});
  req.session.regenerate(err=>{ if(err) return res.status(500).json({error:'Could not start session.'}); req.session.user={id:user.id,email:user.email,role:user.role}; res.json({user:req.session.user}); });
});
app.post('/api/logout',auth,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',auth,(req,res)=>res.json({user:req.session.user}));
app.get('/api/manage/:type',auth,(req,res)=>{
  const map={rooms:'rooms',updates:'updates',menu:'menu',enquiries:'enquiries'};
  const table=map[req.params.type]; if(!table) return res.sendStatus(404);
  res.json(db.prepare(`SELECT * FROM ${table} ORDER BY id DESC`).all());
});
app.post('/api/manage/:type',auth,upload.single('image'),(req,res)=>{
  const type=req.params.type;
  if(type==='enquiries') return res.sendStatus(405);
  const allowed={rooms:['name','description','price','image','published'],updates:['title','body','published'],menu:['name','description','price','published']};
  const cols=allowed[type]; if(!cols) return res.sendStatus(404);
  const data={...req.body};
  if(type==='rooms'&&req.file) data.image='/uploads/'+req.file.filename;
  if(type==='rooms'&&!data.name||type==='updates'&&(!data.title||!data.body)||type==='menu'&&!data.name) return res.status(400).json({error:'Please complete the required fields.'});
  const fields=cols.filter(c=>data[c]!==undefined);
  if(!fields.length) return res.status(400).json({error:'No fields supplied.'});
  const values=fields.map(c=>c==='published'?(data[c]==='0'?0:1):data[c]);
  if(data.id){ db.prepare(`UPDATE ${type} SET ${fields.map(c=>c+'=?').join(',')} WHERE id=?`).run(...values,Number(data.id)); }
  else { db.prepare(`INSERT INTO ${type}(${fields.join(',')}) VALUES(${fields.map(()=>'?').join(',')})`).run(...values); }
  res.json({ok:true});
});
app.delete('/api/manage/:type/:id',auth,(req,res)=>{
  if(!['rooms','updates','menu'].includes(req.params.type)) return res.sendStatus(404);
  db.prepare(`DELETE FROM ${req.params.type} WHERE id=?`).run(Number(req.params.id)); res.json({ok:true});
});
app.patch('/api/enquiries/:id',auth,(req,res)=>{
  const status=String(req.body.status||'');
  if(!['New','In progress','Responded','Closed'].includes(status)) return res.status(400).json({error:'Invalid status.'});
  db.prepare('UPDATE enquiries SET status=? WHERE id=?').run(status,Number(req.params.id)); res.json({ok:true});
});
app.post('/api/staff',auth,admin,(req,res)=>{
  const email=String(req.body.email||'').toLowerCase(), password=String(req.body.password||'');
  if(!email.includes('@')||password.length<12) return res.status(400).json({error:'Enter a valid email and a password of at least 12 characters.'});
  try{db.prepare('INSERT INTO users(email,password_hash,role) VALUES(?,?,?)').run(email,bcrypt.hashSync(password,12),'staff');res.json({ok:true});}
  catch(e){res.status(409).json({error:'That email may already have an account.'});}
});
app.get('/staff-control',(req,res)=>res.sendFile(path.join(__dirname,'private','admin.html')));
app.get('/health',(req,res)=>res.json({ok:true}));
app.listen(port,()=>console.log('Khweza platform listening on '+port));