const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const sqlite3 = require('sqlite3').verbose();
const PDFDocument = require('pdfkit');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'data.db');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session middleware for simple server-side sessions
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 } // 8 hours
}));

// Ensure db exists and setup tables
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Failed to open DB', err);
    process.exit(1);
  }
});

const run = (sql, params=[]) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err){ if(err) reject(err); else resolve(this); });
});
const get = (sql, params=[]) => new Promise((resolve, reject) => {
  db.get(sql, params, (err,row)=>{ if(err) reject(err); else resolve(row); });
});
const all = (sql, params=[]) => new Promise((resolve, reject) => {
  db.all(sql, params, (err,rows)=>{ if(err) reject(err); else resolve(rows); });
});

async function init() {
  await run(`CREATE TABLE IF NOT EXISTS menu (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    category TEXT,
    price REAL NOT NULL,
    image TEXT
  )`);

  await run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    items TEXT NOT NULL,
    total REAL NOT NULL,
    user_id INTEGER
  )`);

  await run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT
  )`);

  // Seed menu if empty
  const row = await get('SELECT COUNT(1) as c FROM menu');
  if (row && row.c === 0) {
    const items = [
      {name: 'Puff - Chicken', category: 'Puff', price: 60, image: 'https://images.unsplash.com/photo-1604908177522-1a2d1b3f7c89?auto=format&fit=crop&w=800&q=60'},
      {name: 'Puff - Egg', category: 'Puff', price: 50, image: 'https://images.unsplash.com/photo-1542831371-d531d36971e6?auto=format&fit=crop&w=800&q=60'},
      {name: 'Puff - Mushroom', category: 'Puff', price: 65, image: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=800&q=60'},
      {name: 'Puff - Veg', category: 'Puff', price: 45, image: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?auto=format&fit=crop&w=800&q=60'},

      {name: 'Mixture', category: 'Snacks', price: 30, image: 'https://images.unsplash.com/photo-1543353071-873f17a7a088?auto=format&fit=crop&w=800&q=60'},

      {name: 'Cake - Blackforest', category: 'Cake', price: 900, image: 'https://images.unsplash.com/photo-1544378736-9b6e0b0ef2d2?auto=format&fit=crop&w=800&q=60'},
      {name: 'Cake - Blueberry', category: 'Cake', price: 850, image: 'https://images.unsplash.com/photo-1505250469679-203ad9ced0cb?auto=format&fit=crop&w=800&q=60'},
      {name: 'Cake - Honey', category: 'Cake', price: 800, image: 'https://images.unsplash.com/photo-1532634896-26909d0d2186?auto=format&fit=crop&w=800&q=60'},
      {name: 'Cake - Vanilla', category: 'Cake', price: 750, image: 'https://images.unsplash.com/photo-1542224566-3a4d6baf7d9d?auto=format&fit=crop&w=800&q=60'},
      {name: 'Cake - Chocolate', category: 'Cake', price: 950, image: 'https://images.unsplash.com/photo-1542826438-1c15e7afc1f0?auto=format&fit=crop&w=800&q=60'},

      {name: 'Potato Chips', category: 'Chips', price: 40, image: 'https://images.unsplash.com/photo-1584270354949-4b8f2d2e4f2a?auto=format&fit=crop&w=800&q=60'},
      {name: 'Wheel Chips', category: 'Chips', price: 45, image: 'https://images.unsplash.com/photo-1604908177522-1a2d1b3f7c89?auto=format&fit=crop&w=800&q=60'},

      {name: 'Fried Rice - Chicken', category: 'FriedRice', price: 120, image: 'https://images.unsplash.com/photo-1604908177522-1a2d1b3f7c89?auto=format&fit=crop&w=800&q=60'},
      {name: 'Fried Rice - Egg', category: 'FriedRice', price: 100, image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=800&q=60'},
      {name: 'Fried Rice - Veg', category: 'FriedRice', price: 90, image: 'https://images.unsplash.com/photo-1543353071-873f17a7a088?auto=format&fit=crop&w=800&q=60'}
    ];

    const stmt = db.prepare('INSERT INTO menu (name, category, price, image) VALUES (?,?,?,?)');
    items.forEach(it => stmt.run(it.name, it.category, it.price, it.image));
    stmt.finalize();
    console.log('Seeded menu items');
  }

  // Ensure at least one admin user exists (username: admin / password: password)
  const urow = await get('SELECT COUNT(1) as c FROM users');
  if (urow && urow.c === 0) {
    const hash = await bcrypt.hash('password', 10);
    await run('INSERT INTO users (username, password_hash, display_name) VALUES (?,?,?)', ['admin', hash, 'Administrator']);
    console.log('Seeded default admin user (admin/password)');
  }

  // Ensure legacy DBs have the user_id column on orders table
  try {
    const cols = await all("PRAGMA table_info(orders)");
    const hasUserId = cols.some(c => c && c.name === 'user_id');
    if (!hasUserId) {
      await run('ALTER TABLE orders ADD COLUMN user_id INTEGER');
      console.log('Added user_id column to orders');
    }
  } catch (e) {
    // If orders table doesn't exist yet or pragma fails, ignore - it's fine
  }
}

(async () => {
  try {
    await init();
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();

// API
app.get('/api/menu', async (req,res)=>{
  try{
    const rows = await all('SELECT * FROM menu ORDER BY category, name');
    res.json(rows);
  }catch(err){ res.status(500).json({error: err.message}); }
});

app.post('/api/menu', async (req,res)=>{
  try{
    const {name, category, price, image} = req.body;
    const result = await run('INSERT INTO menu (name, category, price, image) VALUES (?,?,?,?)',[name,category,price,image]);
    const id = result.lastID || result.insertId || null;
    res.json({id, name, category, price, image});
  }catch(err){ res.status(500).json({error: err.message}); }
});

app.put('/api/menu/:id', async (req,res)=>{
  try{
    const {id} = req.params;
    const {name, category, price, image} = req.body;
    await run('UPDATE menu SET name=?, category=?, price=?, image=? WHERE id=?',[name,category,price,image,id]);
    res.json({id, name, category, price, image});
  }catch(err){ res.status(500).json({error: err.message}); }
});

app.delete('/api/menu/:id', async (req,res)=>{
  try{
    const {id} = req.params;
    await run('DELETE FROM menu WHERE id=?',[id]);
    res.json({ok: true});
  }catch(err){ res.status(500).json({error: err.message}); }
});

app.post('/api/order', async (req,res)=>{
  try{
    const {items} = req.body; // items: [{id, qty, weight}] where weight is in kg
    if (!items || !Array.isArray(items)) return res.status(400).json({error: 'items required'});
    // Retrieve prices
    const ids = items.map(i=>i.id);
    const placeholders = ids.map(()=>'?').join(',');
    const rows = await all(`SELECT * FROM menu WHERE id IN (${placeholders})`, ids);
    const priceMap = {};
    rows.forEach(r => priceMap[r.id] = r);
    let total = 0;
    const detailed = items.map(it => {
      const m = priceMap[it.id];
      const qty = Number(it.qty)||1;
      const weight = Number(it.weight) || 1; // default 1 kg when not provided
      const subtotal = (m ? m.price : 0) * qty * weight;
      total += subtotal;
      return {id: it.id, name: m ? m.name : 'Unknown', price: m ? m.price : 0, qty, weight, subtotal};
    });

    const now = new Date().toISOString();
    const userId = req.session && req.session.user ? req.session.user.id : null;
    const result = await run('INSERT INTO orders (created_at, items, total, user_id) VALUES (?,?,?,?)',[now, JSON.stringify(detailed), total, userId]);
    const orderId = result.lastID || null;
    res.json({orderId, total, items: detailed});
  }catch(err){ res.status(500).json({error: err.message}); }
});

app.get('/api/sales', async (req,res)=>{
  try{
    // month=YYYY-MM
    const {month} = req.query;
    if (!month) return res.status(400).json({error: 'month=YYYY-MM required'});
    const from = new Date(month + '-01T00:00:00Z');
    const year = from.getUTCFullYear();
    const mon = from.getUTCMonth();
    const next = new Date(Date.UTC(year, mon+1, 1));
    let rows;
    const fromIso = from.toISOString();
    const nextIso = next.toISOString();
    if (req.session && req.session.user) {
      rows = await all('SELECT total, created_at FROM orders WHERE created_at >= ? AND created_at < ? AND user_id = ?',[fromIso, nextIso, req.session.user.id]);
    } else {
      rows = await all('SELECT total, created_at FROM orders WHERE created_at >= ? AND created_at < ?',[fromIso, nextIso]);
    }
    const sum = rows.reduce((s,r)=>s + Number(r.total||0),0);
    res.json({month, total: sum, orders: rows.length});
  }catch(err){ res.status(500).json({error: err.message}); }
});

app.get('/api/qrcode', async (req,res)=>{
  try{
    const {amount, label} = req.query;
    const text = label ? `${label} - Pay ${amount}` : `Pay ${amount}`;
    const dataUrl = await QRCode.toDataURL(text);
    res.json({dataUrl});
  }catch(err){ res.status(500).json({error: err.message}); }
});

// Authentication endpoints
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, displayName } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    // simple password strength check
    if (password.length < 4) return res.status(400).json({ error: 'password too short' });
    const exists = await get('SELECT id FROM users WHERE username = ?', [username]);
    if (exists) return res.status(409).json({ error: 'username exists' });
    const hash = await bcrypt.hash(password, 10);
    const r = await run('INSERT INTO users (username, password_hash, display_name) VALUES (?,?,?)', [username, hash, displayName || username]);
    res.json({ ok: true, id: r.lastID || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'username and password required' });
    const user = await get('SELECT id, username, password_hash, display_name FROM users WHERE username = ?', [username]);
    if (!user) return res.status(401).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    // set session
    req.session.user = { id: user.id, username: user.username, displayName: user.display_name };
    res.json({ ok: true, user: req.session.user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => { res.json({ ok: true }); });
});

app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.user) return res.json({ user: req.session.user });
  return res.json({ user: null });
});

// Generate invoice PDF for order
app.get('/api/order/:id/invoice', async (req, res) => {
  try {
    const { id } = req.params;
    const row = await get('SELECT * FROM orders WHERE id = ?', [id]);
    if (!row) return res.status(404).json({ error: 'order not found' });
    const items = JSON.parse(row.items);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${id}.pdf`);

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    doc.fontSize(20).text('Bakery Invoice', { align: 'center' });
    doc.moveDown();
    doc.fontSize(10).text(`Order ID: ${id}`);
    doc.text(`Date: ${new Date(row.created_at).toLocaleString()}`);
    doc.moveDown();

    // Improved table layout with fixed columns and right-aligned numeric columns
    const startX = 40;
    const itemX = startX;
    const qtyX = 320;
    const weightX = 380;
    const priceX = 460;
    const subtotalX = 540;
    const tableWidth = 520;
    const lineHeight = 18;

    // Header
    doc.fontSize(12).font('Helvetica-Bold');
    doc.text('Item', itemX, doc.y);
    doc.text('Qty', qtyX, doc.y, { width: 40, align: 'right' });
    doc.text('Weight', weightX, doc.y, { width: 60, align: 'right' });
    doc.text('Price', priceX, doc.y, { width: 70, align: 'right' });
    doc.text('Subtotal', subtotalX, doc.y, { width: 80, align: 'right' });
    doc.moveDown(0.5);
    doc.font('Helvetica');

    // helper to check for page break
    function maybeAddPage(requiredHeight = lineHeight) {
      if (doc.y + requiredHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        doc.y = doc.page.margins.top;
      }
    }

    items.forEach(it => {
      maybeAddPage(lineHeight);
      const name = it.name || '';
      const qty = it.qty || 0;
      const weight = it.weight || '';
      const price = it.price != null ? Number(it.price).toFixed(2) : '0.00';
      const subtotal = it.subtotal != null ? Number(it.subtotal).toFixed(2) : '0.00';

      // Item name may wrap; give it a width up to qtyX - itemX - 8
      const itemWidth = qtyX - itemX - 8;
      doc.fontSize(10).text(name, itemX, doc.y, { width: itemWidth });

      // compute y position for numeric columns on the same line
      const currentY = doc.y;
      // Qty
      doc.text(qty.toString(), qtyX, currentY, { width: 40, align: 'right' });
      // Weight
      doc.text(String(weight), weightX, currentY, { width: 60, align: 'right' });
      // Price
      doc.text(price, priceX, currentY, { width: 70, align: 'right' });
      // Subtotal
      doc.text(subtotal, subtotalX, currentY, { width: 80, align: 'right' });

      // move down by lineHeight if the item name wrapped to multiple lines
      doc.moveDown( Math.max(0.8, Math.ceil(doc.currentLineHeight() / lineHeight)) );
    });

    doc.moveDown();
    doc.fontSize(12).font('Helvetica-Bold').text(`Total: ₹${Number(row.total).toFixed(2)}`, { align: 'right' });
    doc.font('Helvetica');
    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Generate monthly sales PDF
app.get('/api/sales/pdf', async (req, res) => {
  try {
    const { month } = req.query;
    if (!month) return res.status(400).json({ error: 'month=YYYY-MM required' });
    const from = new Date(month + '-01T00:00:00Z');
    const year = from.getUTCFullYear();
    const mon = from.getUTCMonth();
    const next = new Date(Date.UTC(year, mon+1, 1));
    const fromIso = from.toISOString();
    const nextIso = next.toISOString();
    let rows;
    if (req.session && req.session.user) {
      rows = await all('SELECT total, created_at, id FROM orders WHERE created_at >= ? AND created_at < ? AND user_id = ?',[fromIso, nextIso, req.session.user.id]);
    } else {
      rows = await all('SELECT total, created_at, id FROM orders WHERE created_at >= ? AND created_at < ?',[fromIso, nextIso]);
    }
    const sum = rows.reduce((s,r)=>s + Number(r.total||0),0);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=sales-${month}.pdf`);

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);
    doc.fontSize(18).text('Monthly Sales Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(`Month: ${month}`);
    doc.text(`Total Sales: ₹${sum.toFixed(2)}`);
    doc.text(`Orders: ${rows.length}`);
    doc.moveDown();

    rows.forEach(r => {
      doc.fontSize(10).text(`Order ${r.id} - ₹${Number(r.total).toFixed(2)} - ${new Date(r.created_at).toLocaleString()}`);
    });

    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('*', (req,res)=>{
  res.sendFile(path.join(__dirname, 'public','index.html'));
});

app.listen(PORT, '0.0.0.0', ()=>{
  console.log('Server listening on port', PORT);
});
