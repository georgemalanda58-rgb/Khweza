const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
const PORT = process.env.PORT || 10000;
const SECRET = process.env.SESSION_SECRET;
if (!process.env.DATABASE_URL || !SECRET) throw new Error('DATABASE_URL and SESSION_SECRET must be configured.');

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, limit: 120 }));
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8 });
const clean = v => String(v ?? '').trim();
const issue = user => jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '8h' });
function requireStaff(req, res, next) {
  try {
    const token = req.cookies.mache_staff;
    if (!token) return res.status(401).json({ error: 'Please sign in.' });
    const decoded = jwt.verify(token, SECRET);
    if (decoded.role !== 'staff') return res.status(403).json({ error: 'Staff access required.' });
    req.staffId = decoded.id;
    next();
  } catch { return res.status(401).json({ error: 'Your session expired. Please sign in again.' }); }
}
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS staff_users (
      id BIGSERIAL PRIMARY KEY,
      email VARCHAR(254) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS inventory_items (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(140) NOT NULL,
      category VARCHAR(80) NOT NULL,
      sku VARCHAR(80),
      description VARCHAR(500) NOT NULL DEFAULT '',
      availability VARCHAR(20) NOT NULL DEFAULT 'available' CHECK (availability IN ('available','low_stock','out_of_stock','coming_soon')),
      quantity INTEGER CHECK (quantity IS NULL OR quantity >= 0),
      unit VARCHAR(30) NOT NULL DEFAULT 'units',
      expected_date DATE,
      public_note VARCHAR(240) NOT NULL DEFAULT '',
      updated_by BIGINT REFERENCES staff_users(id),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      active BOOLEAN NOT NULL DEFAULT TRUE
    );
    CREATE INDEX IF NOT EXISTS inventory_public_idx ON inventory_items(active, category, name);
  `);
  // Optional one-time bootstrap: provide both variables securely in the service environment.
  if (process.env.STAFF_BOOTSTRAP_EMAIL && process.env.STAFF_BOOTSTRAP_PASSWORD) {
    const email = clean(process.env.STAFF_BOOTSTRAP_EMAIL).toLowerCase();
    const password = String(process.env.STAFF_BOOTSTRAP_PASSWORD);
    if (password.length >= 14 && password.length <= 72) {
      const hash = await bcrypt.hash(password, 12);
      await pool.query('INSERT INTO staff_users(email,password_hash) VALUES($1,$2) ON CONFLICT(email) DO NOTHING', [email, hash]);
    } else {
      console.warn('Staff bootstrap password must be 14–72 characters; bootstrap skipped.');
    }
  }
}
app.get('/health', async (req,res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, service: 'Mache inventory API' }); }
  catch { res.status(503).json({ ok: false }); }
});
app.post('/api/staff/login', loginLimit, async (req,res) => {
  try {
    const email = clean(req.body.email).toLowerCase();
    const password = String(req.body.password || '');
    const q = await pool.query('SELECT id,email,password_hash FROM staff_users WHERE email=$1 AND active=TRUE', [email]);
    if (!q.rowCount || !(await bcrypt.compare(password, q.rows[0].password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
    res.cookie('mache_staff', issue({ id: q.rows[0].id, role: 'staff' }), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', maxAge: 8 * 60 * 60 * 1000, path: '/' });
    res.json({ ok: true, email: q.rows[0].email });
  } catch { res.status(500).json({ error: 'Sign-in failed.' }); }
});
app.post('/api/staff/logout', (req,res) => { res.clearCookie('mache_staff', { path: '/' }); res.json({ ok: true }); });
app.get('/api/staff/me', requireStaff, async (req,res) => {
  const q = await pool.query('SELECT email FROM staff_users WHERE id=$1 AND active=TRUE', [req.staffId]);
  if (!q.rowCount) return res.status(401).json({ error: 'Staff account unavailable.' });
  res.json({ email: q.rows[0].email });
});
app.get('/api/inventory', async (req,res) => {
  try {
    const q = await pool.query(`SELECT id,name,category,sku,description,availability,unit,expected_date,public_note,updated_at
      FROM inventory_items WHERE active=TRUE ORDER BY category,name`);
    res.json({ items: q.rows });
  } catch { res.status(500).json({ error: 'Could not load availability.' }); }
});
app.get('/api/staff/inventory', requireStaff, async (req,res) => {
  const q = await pool.query('SELECT * FROM inventory_items ORDER BY active DESC,category,name');
  res.json({ items: q.rows });
});
app.post('/api/staff/inventory', requireStaff, async (req,res) => {
  const b = req.body || {};
  const name = clean(b.name), category = clean(b.category), availability = clean(b.availability || 'available');
  const quantity = b.quantity === '' || b.quantity == null ? null : Number(b.quantity);
  if (name.length < 2 || name.length > 140 || !category || category.length > 80) return res.status(400).json({ error: 'Enter a valid product name and category.' });
  if (!['available','low_stock','out_of_stock','coming_soon'].includes(availability)) return res.status(400).json({ error: 'Choose a valid availability status.' });
  if (quantity !== null && (!Number.isInteger(quantity) || quantity < 0)) return res.status(400).json({ error: 'Quantity must be a whole number of zero or more.' });
  const q = await pool.query(`INSERT INTO inventory_items(name,category,sku,description,availability,quantity,unit,expected_date,public_note,updated_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [name,category,clean(b.sku).slice(0,80),clean(b.description).slice(0,500),availability,quantity,clean(b.unit || 'units').slice(0,30),b.expected_date || null,clean(b.public_note).slice(0,240),req.staffId]);
  res.status(201).json({ item: q.rows[0] });
});
app.patch('/api/staff/inventory/:id', requireStaff, async (req,res) => {
  const b = req.body || {};
  const allowed = ['name','category','sku','description','availability','quantity','unit','expected_date','public_note','active'];
  const fields = allowed.filter(k => Object.hasOwn(b,k));
  if (!fields.length) return res.status(400).json({ error: 'No changes supplied.' });
  if (b.availability !== undefined && !['available','low_stock','out_of_stock','coming_soon'].includes(b.availability)) return res.status(400).json({ error: 'Invalid availability status.' });
  if (b.quantity !== undefined && b.quantity !== null && (!Number.isInteger(Number(b.quantity)) || Number(b.quantity) < 0)) return res.status(400).json({ error: 'Quantity must be zero or more.' });
  const values = fields.map(k => k === 'quantity' && b[k] === '' ? null : b[k]);
  const sets = fields.map((k,i) => k + '=$' + (i+1));
  sets.push('updated_by=$' + (fields.length+1), 'updated_at=NOW()');
  values.push(req.staffId, req.params.id);
  const q = await pool.query('UPDATE inventory_items SET ' + sets.join(',') + ' WHERE id=$' + (fields.length+2) + ' RETURNING *', values);
  if (!q.rowCount) return res.status(404).json({ error: 'Product not found.' });
  res.json({ item: q.rows[0] });
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req,res) => res.sendFile(path.join(__dirname, 'public', 'staff.html')));
init().then(() => app.listen(PORT, '0.0.0.0', () => console.log('Mache inventory API listening on ' + PORT))).catch(err => { console.error(err); process.exit(1); });
