process.env.TZ = process.env.TZ || 'Asia/Damascus';
require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const argon2 = require('argon2');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'hmudealali750@gmail.com').trim().toLowerCase();
const SHOP_ADMIN_EMAIL = (process.env.SHOP_ADMIN_EMAIL || 'abosham750750@gmail.com').trim().toLowerCase();
const MAX_BOOKINGS = 16;
const TIME_SLOTS = ['09:00 صباحاً','09:30 صباحاً','10:00 صباحاً','10:30 صباحاً','11:00 صباحاً','11:30 صباحاً','12:00 ظهراً','12:30 ظهراً','01:00 مساءً','01:30 مساءً','02:00 مساءً','02:30 مساءً','03:00 مساءً','03:30 مساءً','04:00 مساءً','04:30 مساءً'];

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-please-change-in-env-32chars';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '625809557918-bbffldib8q62tivqosvb2jt3bfha3vbm.apps.googleusercontent.com';
const MAX_WORK_IMAGES = 10;
const MAX_IMG_LEN = 400000;

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
if (!process.env.ADMIN_INITIAL_PASSWORD || process.env.ADMIN_INITIAL_PASSWORD.length < 12) throw new Error('ADMIN_INITIAL_PASSWORD must be at least 12 characters');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '16mb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

const publicLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const craftLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
const otpLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 6, standardHeaders: true, legacyHeaders: false });
app.use('/api/public/', publicLimiter);
app.use('/api/bookings/lookup', publicLimiter);
app.use('/api/patient/status', publicLimiter);
app.use('/api/urgent', publicLimiter);
app.use('/api/login', loginLimiter);
app.use('/api/craftsmen', craftLimiter);
app.use('/api/admin/', loginLimiter);

app.use((req, res, next) => {
  if (req.path === '/' || req.path.endsWith('.html')) res.set('Cache-Control', 'no-store');
  next();
});
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
  res.set('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
app.use(session({
  store: new pgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 }
}));

function localDateString(d = new Date()) {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function isValidDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T12:00:00`).getTime()); }
function isFriday(s) { return new Date(`${s}T12:00:00`).getDay() === 5; }
function normalizeSyrianPhone(value) {
  let s = String(value || '').trim().replace(/[\s()-]/g, '');
  if (s.startsWith('+963')) s = '0' + s.slice(4);
  else if (s.startsWith('963')) s = '0' + s.slice(3);
  if (!/^09\d{8}$/.test(s)) return null;
  return s;
}
function csrfToken(req) { if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('hex'); return req.session.csrf; }
function requireCsrf(req, res, next) {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  const token = req.get('X-CSRF-Token');
  if (!token || token !== req.session.csrf) return res.status(403).json({ error: 'فشل التحقق الأمني.' });
  next();
}
function requireDoctor(req, res, next) { if (!req.session.doctorId) return res.status(401).json({ error: 'غير مصرح.' }); next(); }
function cleanText(v, max) { return String(v ?? '').trim().slice(0, max); }
function hashOtp(otp) { return crypto.createHash('sha256').update(otp).digest('hex'); }
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function validDataUrl(v) { return /^data:image\/(png|jpeg|webp|gif);base64,/.test(String(v || '')) && String(v).length <= MAX_IMG_LEN; }

let mailer = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  mailer = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
}
async function notifyDoctor(subject, html, text) {
  if (!mailer) return false;
  try { await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: ADMIN_EMAIL, subject, html, text }); return true; }
  catch (e) { console.error('SMTP error:', e.message); return false; }
}
async function deliverOtp({ email, code }) {
  const text = `بلحظه ⚡\nرمز التحقق: ${code}\nصالح 10 دقائق.`;
  if (mailer && email) {
    try {
      await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: email, subject: 'رمز التحقق - بلحظه ⚡', html: `<div style="font-family:sans-serif;direction:rtl;text-align:center"><h2>بلحظه ⚡</h2><h1 style="letter-spacing:8px;color:#0B3D2E">${code}</h1><p>صالح 10 دقائق.</p></div>`, text });
      return 'email';
    } catch (e) { console.error('SMTP otp error:', e.message); }
  }
  if (String(process.env.OTP_DEV_MODE || '').toLowerCase() === 'true') { console.log(`[OTP-DEV] ${email} => ${code}`); return 'dev'; }
  return null;
}

async function initDb() {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS doctors (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS bookings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), queue_no INTEGER NOT NULL, patient_name TEXT NOT NULL, phone TEXT NOT NULL,
      address TEXT NOT NULL, symptoms TEXT NOT NULL, time_slot TEXT NOT NULL, booking_date DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (booking_date, time_slot));
    CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings(phone);
    CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date);
    CREATE TABLE IF NOT EXISTS urgent_cases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), patient_name TEXT NOT NULL, phone TEXT NOT NULL, condition TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')), is_read BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), decision_at TIMESTAMPTZ);
    CREATE INDEX IF NOT EXISTS idx_urgent_phone ON urgent_cases(phone);
    CREATE TABLE IF NOT EXISTS password_resets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
      otp_hash TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, used BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  `);
  const existing = await pool.query('SELECT id FROM doctors WHERE email=$1', [ADMIN_EMAIL]);
  if (!existing.rowCount) {
    const hash = await argon2.hash(process.env.ADMIN_INITIAL_PASSWORD, { type: argon2.argon2id });
    await pool.query('INSERT INTO doctors(email,password_hash) VALUES($1,$2)', [ADMIN_EMAIL, hash]);
  }
}

async function initCraftDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT UNIQUE,
      password_hash TEXT,
      google_id TEXT UNIQUE,
      picture TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query('ALTER TABLE shop_users ALTER COLUMN phone DROP NOT NULL').catch(()=>{});
  await pool.query('ALTER TABLE shop_users ALTER COLUMN password_hash DROP NOT NULL').catch(()=>{});
  await pool.query('ALTER TABLE shop_users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE').catch(()=>{});
  await pool.query('ALTER TABLE shop_users ADD COLUMN IF NOT EXISTS picture TEXT').catch(()=>{});

  /* 🆕 جدول الصنايعية والأسطوات */
  await pool.query(`
    CREATE TABLE IF NOT EXISTS craftsmen (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      profession TEXT NOT NULL,
      avatar TEXT,
      images JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_craftsmen_active ON craftsmen(is_active);
    CREATE INDEX IF NOT EXISTS idx_craftsmen_prof ON craftsmen(profession);
    CREATE INDEX IF NOT EXISTS idx_craftsmen_created ON craftsmen(created_at DESC);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_otps (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), phone TEXT NOT NULL, purpose TEXT NOT NULL, code_hash TEXT NOT NULL,
      email TEXT, name TEXT, password_hash TEXT, expires_at TIMESTAMPTZ NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      used BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE INDEX IF NOT EXISTS idx_shop_otps_phone ON shop_otps(phone, purpose);
  `);
}

/* ═══════════ العيادة ═══════════ */
app.get('/api/csrf', (req, res) => { res.set('Cache-Control','no-store'); res.json({ token: csrfToken(req) }); });
app.get('/api/session', (req, res) => { res.set('Cache-Control','no-store'); res.json({ authenticated: !!req.session.doctorId }); });
app.post('/api/login', requireCsrf, async (req, res) => {
  const email = cleanText(req.body.email, 200).toLowerCase();
  const password = String(req.body.password || '');
  if (email !== ADMIN_EMAIL) return res.status(401).json({ error: 'يجب استخدام بريد الدكتور المسجل حصراً.' });
  const q = await pool.query('SELECT id,password_hash FROM doctors WHERE email=$1', [ADMIN_EMAIL]);
  if (!q.rowCount || !(await argon2.verify(q.rows[0].password_hash, password))) return res.status(401).json({ error: 'خطأ في البريد أو كلمة السر.' });
  await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
  req.session.doctorId = q.rows[0].id;
  req.session.csrf = crypto.randomBytes(32).toString('hex');
  res.json({ ok: true });
});
app.post('/api/logout', requireCsrf, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/public/bookings', async (req, res) => {
  const date = cleanText(req.query.date, 10) || localDateString();
  if (!isValidDate(date)) return res.status(400).json({ error: 'التاريخ غير صحيح.' });
  const q = await pool.query('SELECT queue_no,time_slot,booking_date FROM bookings WHERE booking_date=$1 ORDER BY queue_no', [date]);
  res.json({ bookings: q.rows });
});
app.post('/api/bookings', requireCsrf, async (req, res) => {
  const name = cleanText(req.body.name, 120); const phone = normalizeSyrianPhone(req.body.phone);
  const address = cleanText(req.body.address, 250); const symptoms = cleanText(req.body.symptoms, 2000);
  const timeSlot = cleanText(req.body.timeSlot, 30); const date = cleanText(req.body.date, 10);
  if (!name || !phone || !address || !symptoms || !date || !TIME_SLOTS.includes(timeSlot)) return res.status(400).json({ error: 'بيانات غير صحيحة.' });
  if (!isValidDate(date)) return res.status(400).json({ error: 'تاريخ غير صحيح.' });
  const today = localDateString();
  if (date < today) return res.status(400).json({ error: 'لا يمكن الحجز بتاريخ سابق.' });
  if (isFriday(date)) return res.status(400).json({ error: 'العيادة مغلقة يوم الجمعة.' });
  if (date === today && new Date().getHours() >= 16) return res.status(400).json({ error: 'انتهى الحجز لليوم.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('clinic-booking-' || $1))", [date]);
    const count = await client.query('SELECT COUNT(*)::int AS n FROM bookings WHERE booking_date=$1', [date]);
    if (count.rows[0].n >= MAX_BOOKINGS) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'اكتمل العدد لهذا التاريخ.' }); }
    const duplicate = await client.query('SELECT id FROM bookings WHERE booking_date=$1 AND phone=$2 LIMIT 1', [date, phone]);
    if (duplicate.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'حجز مكرر بنفس الرقم لهذا اليوم.' }); }
    const inserted = await client.query(`INSERT INTO bookings(queue_no,patient_name,phone,address,symptoms,time_slot,booking_date) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [count.rows[0].n + 1,name,phone,address,symptoms,timeSlot,date]);
    await client.query('COMMIT');
    res.status(201).json({ booking: inserted.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    if (e.code === '23505') return res.status(409).json({ error: 'التوقيت محجوز.' });
    console.error(e); res.status(500).json({ error: 'تعذر حفظ الحجز.' });
  } finally { client.release(); }
});
app.get('/api/bookings/lookup', async (req, res) => {
  res.set('Cache-Control','no-store');
  const phone = normalizeSyrianPhone(req.query.phone);
  if (!phone) return res.status(400).json({ error: 'رقم غير صحيح.' });
  const q = await pool.query('SELECT * FROM bookings WHERE phone=$1 ORDER BY booking_date DESC, created_at DESC LIMIT 1', [phone]);
  if (!q.rowCount) return res.status(404).json({ error: 'لا يوجد حجز.' });
  const b=q.rows[0];
  res.json({ booking: { id:b.id, queue_no:b.queue_no, patient_name:b.patient_name, phone:b.phone, time_slot:b.time_slot, booking_date:b.booking_date, status:b.status, created_at:b.created_at } });
});
app.get('/api/patient/status', async (req, res) => {
  res.set('Cache-Control','no-store');
  const phone = normalizeSyrianPhone(req.query.phone);
  if (!phone) return res.status(400).json({ error: 'رقم غير صحيح.' });
  const bookings = await pool.query('SELECT * FROM bookings WHERE phone=$1 ORDER BY booking_date DESC, created_at DESC', [phone]);
  const urgent = await pool.query('SELECT id,patient_name,phone,condition,status,created_at,decision_at FROM urgent_cases WHERE phone=$1 ORDER BY created_at DESC', [phone]);
  res.json({ booking: bookings.rows[0] || null, bookings: bookings.rows, urgentCases: urgent.rows });
});
app.get('/api/bookings', requireDoctor, async (req,res) => {
  const date = req.query.date ? cleanText(req.query.date,10) : null;
  const q = date ? await pool.query('SELECT * FROM bookings WHERE booking_date=$1 ORDER BY queue_no',[date]) : await pool.query('SELECT * FROM bookings ORDER BY booking_date DESC, queue_no');
  res.json({ bookings:q.rows });
});
app.patch('/api/bookings/:id/status', requireCsrf, requireDoctor, async (req,res) => {
  const q = await pool.query("UPDATE bookings SET status=CASE WHEN status='completed' THEN 'pending' ELSE 'completed' END WHERE id=$1 RETURNING *",[req.params.id]);
  if (!q.rowCount) return res.status(404).json({error:'الحجز غير موجود.'});
  res.json({booking:q.rows[0]});
});
app.delete('/api/bookings/:id', requireCsrf, requireDoctor, async (req,res) => {
  const q = await pool.query('DELETE FROM bookings WHERE id=$1 RETURNING id',[req.params.id]);
  if (!q.rowCount) return res.status(404).json({error:'الحجز غير موجود.'});
  res.json({ok:true});
});
app.delete('/api/bookings/today', requireCsrf, requireDoctor, async (req,res) => {
  const q = await pool.query('DELETE FROM bookings WHERE booking_date=$1 RETURNING id',[localDateString()]);
  res.json({ok:true,deleted:q.rowCount});
});
app.post('/api/urgent', requireCsrf, async (req,res) => {
  const name=cleanText(req.body.name,120), phone=normalizeSyrianPhone(req.body.phone), condition=cleanText(req.body.condition,5000);
  if(!name||!phone||!condition) return res.status(400).json({error:'عبّي كل الحقول برقم سوري صحيح.'});
  const q=await pool.query('INSERT INTO urgent_cases(patient_name,phone,condition) VALUES($1,$2,$3) RETURNING *',[name,phone,condition]);
  await notifyDoctor('🚨 حالة عاجلة', `<p>${name}</p><p>${phone}</p><p>${condition.replace(/</g,'&lt;')}</p>`, `${name}\n${phone}\n${condition}`);
  res.status(201).json({message:'تم الإرسال.',case:q.rows[0]});
});
app.get('/api/urgent', requireDoctor, async (req,res) => {
  const q=await pool.query('SELECT * FROM urgent_cases ORDER BY CASE WHEN status=\'pending\' THEN 0 ELSE 1 END, created_at DESC');
  res.json({cases:q.rows});
});
app.patch('/api/urgent/:id/read', requireCsrf, requireDoctor, async (req,res) => {
  const q=await pool.query('UPDATE urgent_cases SET is_read=true WHERE id=$1 RETURNING *',[req.params.id]);
  if(!q.rowCount)return res.status(404).json({error:'غير موجودة.'});
  res.json({case:q.rows[0]});
});
app.patch('/api/urgent/:id/decision', requireCsrf, requireDoctor, async (req,res) => {
  const status = req.body.status;
  if(!['accepted','rejected'].includes(status)) return res.status(400).json({error:'قرار غير صالح.'});
  const q=await pool.query('UPDATE urgent_cases SET status=$1,is_read=true,decision_at=now() WHERE id=$2 RETURNING *',[status,req.params.id]);
  if(!q.rowCount)return res.status(404).json({error:'غير موجودة.'});
  res.json({case:q.rows[0]});
});
app.delete('/api/urgent/:id', requireCsrf, requireDoctor, async (req,res) => {
  const q=await pool.query('DELETE FROM urgent_cases WHERE id=$1 RETURNING id',[req.params.id]);
  if(!q.rowCount)return res.status(404).json({error:'غير موجودة.'});
  res.json({ok:true});
});
app.post('/api/password-reset/request', requireCsrf, async (req,res) => {
  const email=cleanText(req.body.email,200).toLowerCase();
  if(email!==ADMIN_EMAIL) return res.json({ok:true});
  const q=await pool.query('SELECT id FROM doctors WHERE email=$1',[ADMIN_EMAIL]);
  if(q.rowCount){
    const otp=String(crypto.randomInt(100000,1000000));
    await pool.query('UPDATE password_resets SET used=true WHERE doctor_id=$1 AND used=false',[q.rows[0].id]);
    await pool.query('INSERT INTO password_resets(doctor_id,otp_hash,expires_at) VALUES($1,$2,now()+interval \'10 minutes\')',[q.rows[0].id,hashOtp(otp)]);
    await notifyDoctor('رمز الاستعادة', `الرمز: <b>${otp}</b>`, `الرمز: ${otp}`);
  }
  res.json({ok:true});
});
app.post('/api/password-reset/confirm', requireCsrf, async (req,res) => {
  const email=cleanText(req.body.email,200).toLowerCase(), otp=cleanText(req.body.otp,20), newPassword=String(req.body.newPassword||'');
  if(email!==ADMIN_EMAIL||!/^[0-9]{6}$/.test(otp)||newPassword.length<12) return res.status(400).json({error:'بيانات غير صحيحة.'});
  const d=await pool.query('SELECT id FROM doctors WHERE email=$1',[email]);
  if(!d.rowCount)return res.status(400).json({error:'بيانات غير صحيحة.'});
  const r=await pool.query('SELECT * FROM password_resets WHERE doctor_id=$1 AND used=false AND expires_at>now() ORDER BY created_at DESC LIMIT 1',[d.rows[0].id]);
  if(!r.rowCount)return res.status(400).json({error:'انتهت صلاحية الرمز.'});
  if(r.rows[0].attempts>=5)return res.status(429).json({error:'تجاوزت المحاولات.'});
  if(hashOtp(otp)!==r.rows[0].otp_hash){await pool.query('UPDATE password_resets SET attempts=attempts+1 WHERE id=$1',[r.rows[0].id]);return res.status(400).json({error:'رمز غير صحيح.'});}
  const hash=await argon2.hash(newPassword,{type:argon2.argon2id});
  await pool.query('UPDATE doctors SET password_hash=$1 WHERE id=$2',[hash,d.rows[0].id]);
  await pool.query('UPDATE password_resets SET used=true WHERE id=$1',[r.rows[0].id]);
  res.json({ok:true});
});

/* ═══════════ دليل الصنايعية ═══════════ */

function verifyShopToken(req, res, next) {
  const auth = req.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً.' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch (e) { return res.status(401).json({ error: 'انتهت صلاحية الجلسة.' }); }
}
function requireShopAdmin(req, res, next) {
  if (!req.user || String(req.user.email || '').toLowerCase() !== SHOP_ADMIN_EMAIL) return res.status(403).json({ error: 'متاح لمدير المنصة فقط.' });
  next();
}
function signShopToken(user) { return jwt.sign({ id: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' }); }
function adminPayload(u) { return { id: u.id, name: u.name, email: u.email, phone: u.phone, isAdmin: String(u.email).toLowerCase() === SHOP_ADMIN_EMAIL }; }

/* قائمة الصنايعية (عام) */
app.get('/api/craftsmen', async (req, res) => {
  try {
    const q = cleanText(req.query.q, 60);
    const prof = cleanText(req.query.profession, 60);
    let where = 'WHERE is_active = true';
    const params = [];
    if (prof) { params.push(prof); where += ` AND profession = $${params.length}`; }
    if (q) { params.push('%' + q + '%'); where += ` AND (name ILIKE $${params.length} OR phone LIKE $${params.length} OR profession ILIKE $${params.length})`; }
    const r = await pool.query(`SELECT id,name,phone,profession,avatar,images,created_at FROM craftsmen ${where} ORDER BY created_at DESC`, params);
    res.json({ craftsmen: r.rows.map(c => ({ id:c.id, name:c.name, phone:c.phone, profession:c.profession, avatar:c.avatar, images:c.images||[], t:new Date(c.created_at).getTime() })) });
  } catch (e) { console.error('List craftsmen error:', e); res.status(500).json({ error: 'تعذر جلب الصنايعية.' }); }
});

/* تسجيل صانع/أسطى جديد (عام) */
app.post('/api/craftsmen', async (req, res) => {
  try {
    const name = cleanText(req.body.name, 120);
    const phone = normalizeSyrianPhone(req.body.phone);
    const profession = cleanText(req.body.profession, 60);
    const avatar = req.body.avatar ? String(req.body.avatar) : null;
    const images = Array.isArray(req.body.images) ? req.body.images.slice(0, MAX_WORK_IMAGES) : [];

    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length < 3) return res.status(400).json({ error: 'اكتب اسمك الثلاثي كاملاً (الاسم + اسم الأب + الكنية).' });
    if (!phone) return res.status(400).json({ error: 'رقم الهاتف غير صحيح — مثال: 09XXXXXXXX.' });
    if (!profession) return res.status(400).json({ error: 'اختر مهنتك.' });
    if (images.length < 1) return res.status(400).json({ error: 'أضف صورة واحدة على الأقل من أعمالك (حتى 10 صور).' });
    if (avatar && !validDataUrl(avatar)) return res.status(400).json({ error: 'الصورة الشخصية غير صالحة.' });
    for (const im of images) if (!validDataUrl(im)) return res.status(400).json({ error: 'إحدى صور الأعمال غير صالحة أو كبيرة جداً.' });

    const dup = await pool.query('SELECT id FROM craftsmen WHERE phone=$1 AND is_active=true', [phone]);
    if (dup.rowCount) return res.status(409).json({ error: 'يوجد ملف مسجل بهذا الرقم — تواصل مع الإدارة للتعديل.' });

    const r = await pool.query(
      'INSERT INTO craftsmen(name,phone,profession,avatar,images) VALUES($1,$2,$3,$4,$5) RETURNING id,name,phone,profession,avatar,images,created_at',
      [name, phone, profession, avatar, JSON.stringify(images)]);
    const c = r.rows[0];
    res.status(201).json({ craftsman: { id:c.id, name:c.name, phone:c.phone, profession:c.profession, avatar:c.avatar, images:c.images||[], t:new Date(c.created_at).getTime() } });
  } catch (e) { console.error('Create craftsman error:', e); res.status(500).json({ error: 'تعذر تسجيل الملف.' }); }
});

/* إحصائيات عامة */
app.get('/api/craftsmen/stats', async (req, res) => {
  try {
    const r = await pool.query('SELECT COUNT(*)::int AS c, COUNT(DISTINCT profession)::int AS p FROM craftsmen WHERE is_active=true');
    res.json({ craftsmen: r.rows[0].c, professions: r.rows[0].p });
  } catch (e) { res.status(500).json({ error: 'تعذر جلب الإحصائيات.' }); }
});

/* ═══════════ دخول المدير ═══════════ */
app.post('/api/login-shop', async (req, res) => {
  try {
    const email = cleanText(req.body.email, 200).toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) return res.status(400).json({ error: 'البريد وكلمة السر مطلوبان.' });
    const q = await pool.query('SELECT * FROM shop_users WHERE email=$1', [email]);
    if (!q.rowCount) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' });
    const user = q.rows[0];
    if (!user.password_hash) return res.status(400).json({ error: 'هذا الحساب عبر Google — استخدم زر Google.' });
    if (!(await argon2.verify(user.password_hash, password))) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' });
    res.json({ token: signShopToken(user), user: adminPayload(user) });
  } catch (e) { console.error('Login error:', e); res.status(500).json({ error: 'تعذر الدخول.' }); }
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const credential = String(req.body.credential || '');
    if (!credential) return res.status(400).json({ error: 'لم نستلم بيانات Google.' });
    const client = new OAuth2Client(GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p || !p.email) return res.status(400).json({ error: 'تعذر التحقق.' });
    const email = String(p.email).toLowerCase();
    let q = await pool.query('SELECT * FROM shop_users WHERE google_id=$1 OR email=$2', [p.sub, email]);
    let user;
    if (q.rowCount) { user = q.rows[0]; }
    else {
      const name = p.name || email.split('@')[0];
      const ins = await pool.query('INSERT INTO shop_users(name,email,google_id,picture) VALUES($1,$2,$3,$4) RETURNING *', [name, email, p.sub, p.picture || null]);
      user = ins.rows[0];
    }
    res.json({ token: signShopToken(user), user: adminPayload(user), via: 'google' });
  } catch (e) { console.error('Google auth error:', e.message); res.status(401).json({ error: 'فشل الدخول عبر Google.' }); }
});

app.get('/api/me', verifyShopToken, async (req, res) => {
  try {
    const q = await pool.query('SELECT id,name,email,phone,created_at FROM shop_users WHERE id=$1', [req.user.id]);
    if (!q.rowCount) return res.status(404).json({ error: 'غير موجود.' });
    res.json({ user: Object.assign(adminPayload(q.rows[0]), { created_at: q.rows[0].created_at }) });
  } catch (e) { res.status(500).json({ error: 'تعذر جلب البيانات.' }); }
});

app.post('/api/forgot', otpLimiter, async (req, res) => {
  try {
    const email = cleanText(req.body.email, 200).toLowerCase();
    if (!email || !isValidEmail(email)) return res.status(400).json({ error: 'بريد غير صحيح.' });
    const u = await pool.query('SELECT id,email FROM shop_users WHERE email=$1', [email]);
    if (!u.rowCount) return res.status(404).json({ error: 'لا يوجد حساب بهذا البريد.' });
    const code = String(crypto.randomInt(100000, 1000000));
    const key = 'mail:' + email;
    await pool.query('UPDATE shop_otps SET used=true WHERE phone=$1 AND purpose=\'reset\' AND used=false', [key]);
    await pool.query('INSERT INTO shop_otps(phone,purpose,code_hash,email,expires_at) VALUES($1,\'reset\',$2,$3,now()+interval \'10 minutes\')', [key, hashOtp(code), email]);
    const channel = await deliverOtp({ email, code });
    if (!channel) return res.status(503).json({ error: 'خدمة الرموز غير مفعلة.' });
    res.json({ ok: true, channel, devCode: channel === 'dev' ? code : undefined });
  } catch (e) { console.error('Forgot error:', e); res.status(500).json({ error: 'تعذر الإرسال.' }); }
});

app.post('/api/forgot/reset', otpLimiter, async (req, res) => {
  try {
    const email = cleanText(req.body.email, 200).toLowerCase();
    const key = email ? 'mail:' + email : null;
    const code = cleanText(req.body.code, 10);
    const nw = String(req.body.newPassword || '');
    if (!key || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'رمز غير صحيح.' });
    if (nw.length < 6) return res.status(400).json({ error: 'كلمة السر قصيرة.' });
    const r = await pool.query('SELECT * FROM shop_otps WHERE phone=$1 AND purpose=\'reset\' AND used=false AND expires_at>now() ORDER BY created_at DESC LIMIT 1', [key]);
    if (!r.rowCount) return res.status(400).json({ error: 'انتهت صلاحية الرمز.' });
    if (r.rows[0].attempts >= 5) return res.status(429).json({ error: 'تجاوزت المحاولات.' });
    if (hashOtp(code) !== r.rows[0].code_hash) { await pool.query('UPDATE shop_otps SET attempts=attempts+1 WHERE id=$1', [r.rows[0].id]); return res.status(400).json({ error: 'رمز غير صحيح.' }); }
    const hash = await argon2.hash(nw, { type: argon2.argon2id });
    await pool.query('UPDATE shop_users SET password_hash=$1 WHERE email=$2', [hash, r.rows[0].email]);
    await pool.query('UPDATE shop_otps SET used=true WHERE id=$1', [r.rows[0].id]);
    res.json({ ok: true });
  } catch (e) { console.error('Reset error:', e); res.status(500).json({ error: 'تعذر التغيير.' }); }
});

/* ═══════════ إدارة الصنايعية ═══════════ */
app.get('/api/admin/craftsmen', verifyShopToken, requireShopAdmin, async (req, res) => {
  try {
    const q = cleanText(req.query.q, 60);
    let where = ''; const params = [];
    if (q) { where = `WHERE name ILIKE $1 OR phone LIKE $1 OR profession ILIKE $1`; params.push('%' + q + '%'); }
    const r = await pool.query(`SELECT id,name,phone,profession,avatar,images,is_active,created_at FROM craftsmen ${where} ORDER BY created_at DESC`, params);
    res.json({ craftsmen: r.rows.map(c => ({ id:c.id, name:c.name, phone:c.phone, profession:c.profession, avatar:c.avatar, imagesCount:(c.images||[]).length, active:c.is_active, t:new Date(c.created_at).getTime() })) });
  } catch (e) { console.error('Admin list error:', e); res.status(500).json({ error: 'تعذر الجلب.' }); }
});

app.post('/api/admin/craftsmen/:id/active', verifyShopToken, requireShopAdmin, async (req, res) => {
  try {
    const active = !!req.body.active;
    const r = await pool.query('UPDATE craftsmen SET is_active=$1 WHERE id=$2 RETURNING id,is_active', [active, req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'غير موجود.' });
    res.json({ ok: true, active });
  } catch (e) { res.status(500).json({ error: 'تعذر التنفيذ.' }); }
});

app.delete('/api/admin/craftsmen/:id', verifyShopToken, requireShopAdmin, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM craftsmen WHERE id=$1 RETURNING id', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'غير موجود.' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'تعذر الحذف.' }); }
});

app.get('/api/admin/stats', verifyShopToken, requireShopAdmin, async (req, res) => {
  try {
    const r = await pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active, COUNT(DISTINCT profession)::int AS profs FROM craftsmen`);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: 'تعذر الجلب.' }); }
});

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'bal7aza-craft', time: new Date().toISOString() }));

app.use(express.static(path.join(__dirname)));
app.use((req,res)=>res.sendFile(path.join(__dirname,'clinic.html')));

initDb()
  .then(initCraftDb)
  .then(() => app.listen(PORT, () => console.log(`✅ Server listening on ${PORT} (clinic + craftsmen + admin)`)))
  .catch(err => { console.error('❌ Startup error:', err); process.exit(1); });
