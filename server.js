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
const MAX_BOOKINGS = 16;
const TIME_SLOTS = ['09:00 صباحاً','09:30 صباحاً','10:00 صباحاً','10:30 صباحاً','11:00 صباحاً','11:30 صباحاً','12:00 ظهراً','12:30 ظهراً','01:00 مساءً','01:30 مساءً','02:00 مساءً','02:30 مساءً','03:00 مساءً','03:30 مساءً','04:00 مساءً','04:30 مساءً'];

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-please-change-in-env-32chars';
const MAX_PRODUCTS_PER_USER = Number(process.env.MAX_PRODUCTS_PER_USER || 20);
const SHOP_CURRENCIES = ['ل.س', '$'];
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '625809557918-bbffldib8q62tivqosvb2jt3bfha3vbm.apps.googleusercontent.com';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
if (!process.env.ADMIN_INITIAL_PASSWORD || process.env.ADMIN_INITIAL_PASSWORD.length < 12) throw new Error('ADMIN_INITIAL_PASSWORD must be at least 12 characters');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

const publicLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const shopLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false });
const otpLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 6, standardHeaders: true, legacyHeaders: false });
app.use('/api/public/', publicLimiter);
app.use('/api/bookings/lookup', publicLimiter);
app.use('/api/patient/status', publicLimiter);
app.use('/api/urgent', publicLimiter);
app.use('/api/login', loginLimiter);
app.use('/api/shop/', shopLimiter);

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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
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
function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('hex');
  return req.session.csrf;
}
function requireCsrf(req, res, next) {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return next();
  const token = req.get('X-CSRF-Token');
  if (!token || token !== req.session.csrf) return res.status(403).json({ error: 'فشل التحقق الأمني. يرجى تحديث الصفحة والمحاولة مرة أخرى.' });
  next();
}
function requireDoctor(req, res, next) {
  if (!req.session.doctorId) return res.status(401).json({ error: 'غير مصرح. يرجى تسجيل الدخول أولاً.' });
  next();
}
function cleanText(v, max) { return String(v ?? '').trim().slice(0, max); }
function hashOtp(otp) { return crypto.createHash('sha256').update(otp).digest('hex'); }
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }

let mailer = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}
async function notifyDoctor(subject, html, text) {
  if (!mailer) return false;
  try {
    await mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: ADMIN_EMAIL, subject, html, text });
    return true;
  } catch (e) { console.error('SMTP error:', e.message); return false; }
}

/* 🆕 إرسال رموز التحقق عبر البريد الإلكتروني فقط */
async function deliverOtp({ email, code }) {
  const text = `بلحظه ⚡\nرمز التحقق الخاص بك: ${code}\nصالح لمدة 10 دقائق. لا تشاركه مع أحد.`;
  if (mailer && email) {
    try {
      await mailer.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: email,
        subject: 'رمز التحقق - متجر بلحظه ⚡',
        html: `<div style="font-family:sans-serif;direction:rtl;text-align:center"><h2>متجر بلحظه ⚡</h2><p>رمز التحقق الخاص بك:</p><h1 style="letter-spacing:8px;color:#0B3D2E">${code}</h1><p>صالح لمدة 10 دقائق. لا تشاركه مع أحد.</p></div>`,
        text
      });
      return 'email';
    } catch (e) { console.error('SMTP otp error:', e.message); }
  }
  if (String(process.env.OTP_DEV_MODE || '').toLowerCase() === 'true') {
    console.log(`[OTP-DEV] ${email} => ${code}`);
    return 'dev';
  }
  return null;
}

async function initDb() {
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS doctors (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      queue_no INTEGER NOT NULL,
      patient_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL,
      symptoms TEXT NOT NULL,
      time_slot TEXT NOT NULL,
      booking_date DATE NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (booking_date, time_slot)
    );
    CREATE INDEX IF NOT EXISTS idx_bookings_phone ON bookings(phone);
    CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date);
    CREATE TABLE IF NOT EXISTS urgent_cases (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      condition TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
      is_read BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      decision_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_urgent_phone ON urgent_cases(phone);
    CREATE INDEX IF NOT EXISTS idx_urgent_created ON urgent_cases(created_at DESC);
    CREATE TABLE IF NOT EXISTS password_resets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      doctor_id UUID NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
      otp_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      used BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  const existing = await pool.query('SELECT id FROM doctors WHERE email=$1', [ADMIN_EMAIL]);
  if (!existing.rowCount) {
    const hash = await argon2.hash(process.env.ADMIN_INITIAL_PASSWORD, { type: argon2.argon2id });
    await pool.query('INSERT INTO doctors(email,password_hash) VALUES($1,$2)', [ADMIN_EMAIL, hash]);
  }
}

async function initShopDb() {
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_otps (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phone TEXT NOT NULL,
      purpose TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      email TEXT,
      name TEXT,
      password_hash TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      used BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_shop_otps_phone ON shop_otps(phone, purpose);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS shop_products (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      seller_id UUID NOT NULL REFERENCES shop_users(id) ON DELETE CASCADE,
      seller_name TEXT NOT NULL,
      title TEXT NOT NULL,
      cat TEXT NOT NULL,
      sub TEXT,
      cond TEXT NOT NULL,
      price NUMERIC(12,2) NOT NULL,
      cur TEXT NOT NULL DEFAULT 'ل.س',
      loc TEXT NOT NULL,
      phone TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT,
      images JSONB DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_shop_products_cat ON shop_products(cat);
    CREATE INDEX IF NOT EXISTS idx_shop_products_seller ON shop_products(seller_id);
    CREATE INDEX IF NOT EXISTS idx_shop_products_created ON shop_products(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_shop_products_active ON shop_products(is_active);
  `);
}

/* ═══════════ العيادة: routes الأصلية ═══════════ */

app.get('/api/csrf', (req, res) => { res.set('Cache-Control','no-store'); res.json({ token: csrfToken(req) }); });
app.get('/api/session', (req, res) => { res.set('Cache-Control','no-store'); res.json({ authenticated: !!req.session.doctorId }); });

app.post('/api/login', requireCsrf, async (req, res) => {
  const email = cleanText(req.body.email, 200).toLowerCase();
  const password = String(req.body.password || '');
  if (email !== ADMIN_EMAIL) return res.status(401).json({ error: 'خطأ: يجب استخدام بريد الدكتور المسجل حصراً.' });
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
  const name = cleanText(req.body.name, 120);
  const phone = normalizeSyrianPhone(req.body.phone);
  const address = cleanText(req.body.address, 250);
  const symptoms = cleanText(req.body.symptoms, 2000);
  const timeSlot = cleanText(req.body.timeSlot, 30);
  const date = cleanText(req.body.date, 10);
  if (!name || !phone || !address || !symptoms || !date || !TIME_SLOTS.includes(timeSlot)) return res.status(400).json({ error: 'يرجى إدخال بيانات صحيحة، ورقم هاتف سوري صحيح (09XXXXXXXX).' });
  if (!isValidDate(date)) return res.status(400).json({ error: 'تاريخ الحجز غير صحيح.' });
  const today = localDateString();
  if (date < today) return res.status(400).json({ error: 'لا يمكن الحجز بتاريخ سابق.' });
  if (isFriday(date)) return res.status(400).json({ error: 'العيادة مغلقة يوم الجمعة، يرجى اختيار يوم آخر.' });
  if (date === today && new Date().getHours() >= 16) return res.status(400).json({ error: 'انتهى الحجز لليوم بعد الساعة 4:00 مساءً. يمكنك الحجز للأيام القادمة.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('clinic-booking-' || $1))", [date]);
    const count = await client.query('SELECT COUNT(*)::int AS n FROM bookings WHERE booking_date=$1', [date]);
    if (count.rows[0].n >= MAX_BOOKINGS) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'اكتمل العدد المخصص لهذا التاريخ (16 مريضاً).' }); }
    const duplicate = await client.query('SELECT id FROM bookings WHERE booking_date=$1 AND phone=$2 LIMIT 1', [date, phone]);
    if (duplicate.rowCount) { await client.query('ROLLBACK'); return res.status(409).json({ error: 'يوجد حجز سابق مسجل بنفس رقم الهاتف لهذا اليوم.' }); }
    const nextQueue = count.rows[0].n + 1;
    const inserted = await client.query(`INSERT INTO bookings(queue_no,patient_name,phone,address,symptoms,time_slot,booking_date) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [nextQueue,name,phone,address,symptoms,timeSlot,date]);
    await client.query('COMMIT');
    res.status(201).json({ booking: inserted.rows[0] });
  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    if (e.code === '23505') return res.status(409).json({ error: 'هذا التوقيت محجوز بالفعل. يرجى اختيار وقت آخر.' });
    console.error(e); res.status(500).json({ error: 'تعذر حفظ الحجز حالياً.' });
  } finally { client.release(); }
});

app.get('/api/bookings/lookup', async (req, res) => {
  res.set('Cache-Control','no-store');
  const phone = normalizeSyrianPhone(req.query.phone);
  if (!phone) return res.status(400).json({ error: 'يرجى إدخال رقم هاتف سوري صحيح.' });
  const q = await pool.query('SELECT * FROM bookings WHERE phone=$1 ORDER BY booking_date DESC, created_at DESC LIMIT 1', [phone]);
  if (!q.rowCount) return res.status(404).json({ error: 'لم يتم العثور على حجز بهذا الرقم.' });
  const b=q.rows[0];
  res.json({ booking: { id:b.id, queue_no:b.queue_no, patient_name:b.patient_name, phone:b.phone, time_slot:b.time_slot, booking_date:b.booking_date, status:b.status, created_at:b.created_at } });
});

app.get('/api/patient/status', async (req, res) => {
  res.set('Cache-Control','no-store');
  const phone = normalizeSyrianPhone(req.query.phone);
  if (!phone) return res.status(400).json({ error: 'يرجى إدخال رقم هاتف سوري صحيح.' });
  const bookings = await pool.query('SELECT * FROM bookings WHERE phone=$1 ORDER BY booking_date DESC, created_at DESC', [phone]);
  const urgent = await pool.query('SELECT id,patient_name,phone,condition,status,created_at,decision_at FROM urgent_cases WHERE phone=$1 ORDER BY created_at DESC', [phone]);
  res.json({ booking: bookings.rows[0] ? {id:bookings.rows[0].id,queue_no:bookings.rows[0].queue_no,patient_name:bookings.rows[0].patient_name,phone:bookings.rows[0].phone,time_slot:bookings.rows[0].time_slot,booking_date:bookings.rows[0].booking_date,status:bookings.rows[0].status,created_at:bookings.rows[0].created_at} : null, bookings: bookings.rows.map(b=>({id:b.id,queue_no:b.queue_no,patient_name:b.patient_name,phone:b.phone,time_slot:b.time_slot,booking_date:b.booking_date,status:b.status,created_at:b.created_at})), urgentCases: urgent.rows.map(c=>({id:c.id,status:c.status,created_at:c.created_at,decision_at:c.decision_at})) });
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
  const today = localDateString();
  const q = await pool.query('DELETE FROM bookings WHERE booking_date=$1 RETURNING id',[today]);
  res.json({ok:true,deleted:q.rowCount,date:today});
});

app.post('/api/urgent', requireCsrf, async (req,res) => {
  const name=cleanText(req.body.name,120), phone=normalizeSyrianPhone(req.body.phone), condition=cleanText(req.body.condition,5000);
  if(!name||!phone||!condition) return res.status(400).json({error:'يرجى تعبئة جميع حقول الحالة العاجلة وإدخال رقم سوري صحيح.'});
  const q=await pool.query('INSERT INTO urgent_cases(patient_name,phone,condition) VALUES($1,$2,$3) RETURNING id,patient_name,phone,condition,status,created_at',[name,phone,condition]);
  const c=q.rows[0];
  await notifyDoctor('🚨 حالة عاجلة - عيادة الدكتور السيد علي محمد الخطيب', `<p><b>حالة عاجلة جديدة</b></p><p>المريض: ${name}</p><p>الهاتف: ${phone}</p><p>الحالة: ${condition.replace(/</g,'&lt;')}</p>`, `حالة عاجلة جديدة\nالمريض: ${name}\nالهاتف: ${phone}\nالحالة: ${condition}`);
  res.status(201).json({message:'تم إرسال الطلب بنجاح، يرجى انتظار رد الدكتور.',case:c});
});
app.get('/api/urgent', requireDoctor, async (req,res) => {
  const q=await pool.query('SELECT * FROM urgent_cases ORDER BY CASE WHEN status=\'pending\' THEN 0 ELSE 1 END, created_at DESC');
  res.json({cases:q.rows});
});
app.patch('/api/urgent/:id/read', requireCsrf, requireDoctor, async (req,res) => {
  const q=await pool.query('UPDATE urgent_cases SET is_read=true WHERE id=$1 RETURNING *',[req.params.id]);
  if(!q.rowCount)return res.status(404).json({error:'الحالة غير موجودة.'});
  res.json({case:q.rows[0]});
});
app.patch('/api/urgent/:id/decision', requireCsrf, requireDoctor, async (req,res) => {
  const status = req.body.status;
  if(!['accepted','rejected'].includes(status)) return res.status(400).json({error:'قرار غير صالح.'});
  const q=await pool.query('UPDATE urgent_cases SET status=$1,is_read=true,decision_at=now() WHERE id=$2 RETURNING *',[status,req.params.id]);
  if(!q.rowCount)return res.status(404).json({error:'الحالة غير موجودة.'});
  res.json({case:q.rows[0]});
});
app.delete('/api/urgent/:id', requireCsrf, requireDoctor, async (req,res) => {
  const q=await pool.query('DELETE FROM urgent_cases WHERE id=$1 RETURNING id',[req.params.id]);
  if(!q.rowCount)return res.status(404).json({error:'الحالة غير موجودة.'});
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
    await notifyDoctor('رمز استعادة كلمة السر - عيادة الدكتور السيد علي محمد الخطيب', `<p>رمز التحقق: <b>${otp}</b></p><p>صالح لمدة 10 دقائق.</p>`, `رمز التحقق: ${otp}\nصالح لمدة 10 دقائق.`);
  }
  res.json({ok:true});
});
app.post('/api/password-reset/confirm', requireCsrf, async (req,res) => {
  const email=cleanText(req.body.email,200).toLowerCase(), otp=cleanText(req.body.otp,20), newPassword=String(req.body.newPassword||'');
  if(email!==ADMIN_EMAIL||!/^[0-9]{6}$/.test(otp)||newPassword.length<12) return res.status(400).json({error:'بيانات الاستعادة غير صحيحة.'});
  const d=await pool.query('SELECT id FROM doctors WHERE email=$1',[email]);
  if(!d.rowCount)return res.status(400).json({error:'بيانات الاستعادة غير صحيحة.'});
  const r=await pool.query('SELECT * FROM password_resets WHERE doctor_id=$1 AND used=false AND expires_at>now() ORDER BY created_at DESC LIMIT 1',[d.rows[0].id]);
  if(!r.rowCount)return res.status(400).json({error:'انتهت صلاحية الرمز أو لم يتم طلب رمز جديد.'});
  if(r.rows[0].attempts>=5)return res.status(429).json({error:'تم تجاوز عدد محاولات الرمز.'});
  if(hashOtp(otp)!==r.rows[0].otp_hash){await pool.query('UPDATE password_resets SET attempts=attempts+1 WHERE id=$1',[r.rows[0].id]);return res.status(400).json({error:'رمز التحقق غير صحيح.'});}
  const hash=await argon2.hash(newPassword,{type:argon2.argon2id});
  const client=await pool.connect();
  try { await client.query('BEGIN'); await client.query('UPDATE doctors SET password_hash=$1 WHERE id=$2',[hash,d.rows[0].id]); await client.query('UPDATE password_resets SET used=true WHERE id=$1',[r.rows[0].id]); await client.query('COMMIT'); }
  catch(e){await client.query('ROLLBACK');throw e;} finally {client.release();}
  res.json({ok:true});
});

/* ═══════════ متجر بلحظه - Shop API ═══════════ */

function verifyShopToken(req, res, next) {
  const auth = req.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'يجب تسجيل الدخول أولاً.' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch (e) { return res.status(401).json({ error: 'انتهت صلاحية الجلسة، سجل الدخول مجدداً.' }); }
}
function signShopToken(user) {
  return jwt.sign({ id: user.id, email: user.email, name: user.name, phone: user.phone }, JWT_SECRET, { expiresIn: '30d' });
}
function toWhatsApp(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (/^09\d{8}$/.test(d)) d = '963' + d.slice(1);
  return d;
}

/* 🆕 تسجيل حساب جديد — التحقق عبر البريد فقط */
app.post('/api/shop/register', otpLimiter, async (req, res) => {
  try {
    const name = cleanText(req.body.name, 80);
    const email = cleanText(req.body.email, 200).toLowerCase();
    const phone = normalizeShopPhone(req.body.phone) || null;
    const password = String(req.body.password || '');

    if (!name || name.length < 2) return res.status(400).json({ error: 'الاسم يجب أن يكون على الأقل حرفين.' });
    if (!email || !isValidEmail(email)) return res.status(400).json({ error: 'البريد الإلكتروني غير صحيح.' });
    if (password.length < 6) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل.' });

    const exists = await pool.query('SELECT id FROM shop_users WHERE email=$1', [email]);
    if (exists.rowCount) return res.status(409).json({ error: 'هذا البريد مسجل مسبقاً.' });

    const code = String(crypto.randomInt(100000, 1000000));
    const passHash = await argon2.hash(password, { type: argon2.argon2id });
    const key = 'mail:' + email;
    await pool.query('UPDATE shop_otps SET used=true WHERE phone=$1 AND purpose=\'register\' AND used=false', [key]);
    await pool.query(
      'INSERT INTO shop_otps(phone,purpose,code_hash,email,name,password_hash,expires_at) VALUES($1,\'register\',$2,$3,$4,$5,now()+interval \'10 minutes\')',
      [key, hashOtp(code), email, name, passHash]
    );
    const channel = await deliverOtp({ email, code });
    if (!channel) return res.status(503).json({ error: 'خدمة إرسال الرموز غير مفعلة على السيرفر. تواصل مع الإدارة.' });
    res.status(201).json({ ok: true, channel, devCode: channel === 'dev' ? code : undefined });
  } catch (e) {
    console.error('Shop register error:', e);
    res.status(500).json({ error: 'تعذر إنشاء الحساب.' });
  }
});

/* 🆕 تفعيل الحساب بالرمز (عبر البريد) */
app.post('/api/shop/register/verify', otpLimiter, async (req, res) => {
  try {
    const email = cleanText(req.body.email, 200).toLowerCase();
    const code = cleanText(req.body.code, 10);
    if (!email || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'أدخل الرمز المكوّن من 6 أرقام.' });
    const key = 'mail:' + email;

    const r = await pool.query('SELECT * FROM shop_otps WHERE phone=$1 AND purpose=\'register\' AND used=false AND expires_at>now() ORDER BY created_at DESC LIMIT 1', [key]);
    if (!r.rowCount) return res.status(400).json({ error: 'انتهت صلاحية الرمز أو لم يُطلب رمز. اطلب رمزاً جديداً.' });
    if (r.rows[0].attempts >= 5) return res.status(429).json({ error: 'تم تجاوز عدد المحاولات. اطلب رمزاً جديداً.' });
    if (hashOtp(code) !== r.rows[0].code_hash) {
      await pool.query('UPDATE shop_otps SET attempts=attempts+1 WHERE id=$1', [r.rows[0].id]);
      return res.status(400).json({ error: 'رمز التحقق غير صحيح.' });
    }
    const o = r.rows[0];
    const dup = await pool.query('SELECT id FROM shop_users WHERE email=$1', [email]);
    if (dup.rowCount) return res.status(409).json({ error: 'هذا البريد مسجل مسبقاً.' });

    const phone = normalizeShopPhone(req.body.phone) || null;
    const q = await pool.query('INSERT INTO shop_users(name,email,phone,password_hash) VALUES($1,$2,$3,$4) RETURNING id,name,email,phone,created_at', [o.name, email, phone, o.password_hash]);
    await pool.query('UPDATE shop_otps SET used=true WHERE id=$1', [o.id]);
    const user = q.rows[0];
    res.json({ token: signShopToken(user), user });
  } catch (e) {
    console.error('Shop verify error:', e);
    res.status(500).json({ error: 'تعذر التحقق من الرمز.' });
  }
});

/* ─── تسجيل الدخول ─── */
app.post('/api/shop/login', async (req, res) => {
  try {
    const email = cleanText(req.body.email, 200).toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) return res.status(400).json({ error: 'البريد وكلمة المرور مطلوبان.' });
    const q = await pool.query('SELECT * FROM shop_users WHERE email=$1', [email]);
    if (!q.rowCount) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' });
    const user = q.rows[0];
    if (!user.password_hash) return res.status(400).json({ error: 'هذا الحساب مسجل عبر Google — استخدم زر "المتابعة عبر Google".' });
    if (!(await argon2.verify(user.password_hash, password))) return res.status(401).json({ error: 'بيانات الدخول غير صحيحة.' });
    const token = signShopToken({ id: user.id, email: user.email, name: user.name, phone: user.phone });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone } });
  } catch (e) {
    console.error('Shop login error:', e);
    res.status(500).json({ error: 'تعذر تسجيل الدخول.' });
  }
});

/* ─── Google Sign-In ─── */
app.post('/api/shop/auth/google', async (req, res) => {
  try {
    const credential = String(req.body.credential || '');
    if (!credential) return res.status(400).json({ error: 'لم نستلم بيانات Google.' });
    if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'تسجيل الدخول عبر Google غير مهيأ على السيرفر بعد.' });
    const client = new OAuth2Client(GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const p = ticket.getPayload();
    if (!p || !p.email) return res.status(400).json({ error: 'تعذر التحقق من حساب Google.' });
    const email = String(p.email).toLowerCase();
    let q = await pool.query('SELECT * FROM shop_users WHERE google_id=$1 OR email=$2', [p.sub, email]);
    let user;
    if (q.rowCount) {
      user = q.rows[0];
      if (!user.google_id) {
        await pool.query('UPDATE shop_users SET google_id=$1, picture=COALESCE(picture,$2) WHERE id=$3', [p.sub, p.picture || null, user.id]);
        user.google_id = p.sub;
      }
    } else {
      const name = p.name || email.split('@')[0];
      const ins = await pool.query('INSERT INTO shop_users(name,email,google_id,picture) VALUES($1,$2,$3,$4) RETURNING *', [name, email, p.sub, p.picture || null]);
      user = ins.rows[0];
    }
    const token = signShopToken({ id: user.id, email: user.email, name: user.name, phone: user.phone });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone }, via: 'google' });
  } catch (e) {
    console.error('Google auth error:', e.message);
    res.status(401).json({ error: 'فشل تسجيل الدخول عبر Google.' });
  }
});

app.get('/api/shop/me', verifyShopToken, async (req, res) => {
  try {
    const q = await pool.query('SELECT id,name,email,phone,created_at FROM shop_users WHERE id=$1', [req.user.id]);
    if (!q.rowCount) return res.status(404).json({ error: 'المستخدم غير موجود.' });
    res.json({ user: q.rows[0] });
  } catch (e) { res.status(500).json({ error: 'تعذر جلب بيانات المستخدم.' }); }
});

/* 🆕 نسيان كلمة السر — عبر البريد فقط */
app.post('/api/shop/forgot', otpLimiter, async (req, res) => {
  try {
    const email = cleanText(req.body.email, 200).toLowerCase();
    if (!email || !isValidEmail(email)) return res.status(400).json({ error: 'أدخل بريدك الإلكتروني المسجل به حسابك.' });
    const u = await pool.query('SELECT id,email FROM shop_users WHERE email=$1', [email]);
    if (!u.rowCount) return res.status(404).json({ error: 'لا يوجد حساب مسجل بهذا البريد.' });

    const code = String(crypto.randomInt(100000, 1000000));
    const key = 'mail:' + email;
    await pool.query('UPDATE shop_otps SET used=true WHERE phone=$1 AND purpose=\'reset\' AND used=false', [key]);
    await pool.query('INSERT INTO shop_otps(phone,purpose,code_hash,email,expires_at) VALUES($1,\'reset\',$2,$3,now()+interval \'10 minutes\')', [key, hashOtp(code), email]);
    const channel = await deliverOtp({ email, code });
    if (!channel) return res.status(503).json({ error: 'خدمة إرسال الرموز غير مفعلة على السيرفر. تواصل مع الإدارة.' });
    res.json({ ok: true, channel, devCode: channel === 'dev' ? code : undefined });
  } catch (e) {
    console.error('Shop forgot error:', e);
    res.status(500).json({ error: 'تعذر إرسال الرمز.' });
  }
});

app.post('/api/shop/forgot/reset', otpLimiter, async (req, res) => {
  try {
    const email = cleanText(req.body.email, 200).toLowerCase();
    const key = email ? 'mail:' + email : null;
    const code = cleanText(req.body.code, 10);
    const nw = String(req.body.newPassword || '');
    if (!key || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'أدخل الرمز المكوّن من 6 أرقام.' });
    if (nw.length < 6) return res.status(400).json({ error: 'كلمة السر الجديدة يجب أن تكون 6 أحرف على الأقل.' });

    const r = await pool.query('SELECT * FROM shop_otps WHERE phone=$1 AND purpose=\'reset\' AND used=false AND expires_at>now() ORDER BY created_at DESC LIMIT 1', [key]);
    if (!r.rowCount) return res.status(400).json({ error: 'انتهت صلاحية الرمز أو لم يُطلب رمز. اطلب رمزاً جديداً.' });
    if (r.rows[0].attempts >= 5) return res.status(429).json({ error: 'تم تجاوز عدد المحاولات. اطلب رمزاً جديداً.' });
    if (hashOtp(code) !== r.rows[0].code_hash) {
      await pool.query('UPDATE shop_otps SET attempts=attempts+1 WHERE id=$1', [r.rows[0].id]);
      return res.status(400).json({ error: 'رمز التحقق غير صحيح.' });
    }
    const hash = await argon2.hash(nw, { type: argon2.argon2id });
    await pool.query('UPDATE shop_users SET password_hash=$1 WHERE email=$2', [hash, r.rows[0].email]);
    await pool.query('UPDATE shop_otps SET used=true WHERE id=$1', [r.rows[0].id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('Shop forgot reset error:', e);
    res.status(500).json({ error: 'تعذر تغيير كلمة السر.' });
  }
});

/* ─── تغيير كلمة السر من داخل الحساب ─── */
app.post('/api/shop/password', verifyShopToken, async (req, res) => {
  try {
    const current = String(req.body.current || '');
    const nw = String(req.body.new || '');
    const confirm = String(req.body.confirm || '');
    if (!current) return res.status(400).json({ error: 'أدخل كلمة السر الحالية.' });
    if (nw.length < 6) return res.status(400).json({ error: 'كلمة السر الجديدة يجب أن تكون 6 أحرف على الأقل.' });
    if (nw === current) return res.status(400).json({ error: 'كلمة السر الجديدة يجب أن تختلف عن الحالية.' });
    if (nw !== confirm) return res.status(400).json({ error: 'تأكيد كلمة السر غير مطابق.' });
    const q = await pool.query('SELECT password_hash FROM shop_users WHERE id=$1', [req.user.id]);
    if (!q.rowCount) return res.status(404).json({ error: 'المستخدم غير موجود.' });
    if (q.rows[0].password_hash) {
      if (!(await argon2.verify(q.rows[0].password_hash, current))) return res.status(401).json({ error: 'كلمة السر الحالية غير صحيحة.' });
    }
    const hash = await argon2.hash(nw, { type: argon2.argon2id });
    await pool.query('UPDATE shop_users SET password_hash=$1 WHERE id=$2', [hash, req.user.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('Shop password change error:', e);
    res.status(500).json({ error: 'تعذر تغيير كلمة السر.' });
  }
});

/* ─── المنتجات ─── */
app.get('/api/shop/products', async (req, res) => {
  try {
    const { cat, sub, q: search, sort = 'new', limit = 200, offset = 0 } = req.query;
    let where = 'WHERE is_active = true';
    const params = [];
    if (cat && cat !== 'all') { params.push(cat); where += ` AND cat = $${params.length}`; }
    if (sub) { params.push(sub); where += ` AND sub = $${params.length}`; }
    if (search && String(search).length > 1) { params.push(`%${search}%`); where += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length} OR loc ILIKE $${params.length})`; }
    let orderBy = 'created_at DESC';
    if (sort === 'cheap') orderBy = 'price ASC';
    else if (sort === 'exp') orderBy = 'price DESC';
    const limitN = Math.min(200, Math.max(1, parseInt(limit) || 200));
    const offsetN = Math.max(0, parseInt(offset) || 0);
    params.push(limitN); const lp = params.length;
    params.push(offsetN); const op = params.length;
    const result = await pool.query(
      `SELECT id, seller_id, seller_name, title, cat, sub, cond, price, cur, loc, phone, description, icon, images, created_at
       FROM shop_products ${where} ORDER BY ${orderBy} LIMIT $${lp} OFFSET $${op}`, params);
    res.json({ products: result.rows.map(p => ({ id:p.id, sellerId:p.seller_id, seller:p.seller_name, title:p.title, cat:p.cat, sub:p.sub, cond:p.cond, price:parseFloat(p.price), cur:p.cur, loc:p.loc, phone:p.phone, desc:p.description, icon:p.icon, img:p.images||[], t:new Date(p.created_at).getTime() })) });
  } catch (e) { console.error('Shop list products error:', e); res.status(500).json({ error: 'تعذر جلب المنتجات.' }); }
});

app.get('/api/shop/products/:id', async (req, res) => {
  try {
    const q = await pool.query('SELECT * FROM shop_products WHERE id=$1 AND is_active=true', [req.params.id]);
    if (!q.rowCount) return res.status(404).json({ error: 'المنتج غير موجود.' });
    const p = q.rows[0];
    res.json({ product: { id:p.id, sellerId:p.seller_id, seller:p.seller_name, title:p.title, cat:p.cat, sub:p.sub, cond:p.cond, price:parseFloat(p.price), cur:p.cur, loc:p.loc, phone:p.phone, desc:p.description, icon:p.icon, img:p.images||[], t:new Date(p.created_at).getTime() } });
  } catch (e) { res.status(500).json({ error: 'تعذر جلب المنتج.' }); }
});

app.post('/api/shop/products', verifyShopToken, async (req, res) => {
  try {
    const { title, cat, sub, cond, price, cur, loc, phone, desc, icon, img } = req.body;
    if (!title || title.length < 3) return res.status(400).json({ error: 'عنوان الإعلان قصير جداً.' });
    if (!cat) return res.status(400).json({ error: 'القسم مطلوب.' });
    if (!cond || !['جديد','مستعمل'].includes(cond)) return res.status(400).json({ error: 'الحالة غير صحيحة.' });
    if (isNaN(price) || price < 0) return res.status(400).json({ error: 'السعر غير صحيح.' });
    if (!loc || loc.length < 2) return res.status(400).json({ error: 'مكان التواجد مطلوب.' });
    const nPhone = normalizeShopPhone(phone);
    if (!nPhone) return res.status(400).json({ error: 'رقم الواتساب غير صحيح.' });
    if (!desc || desc.length < 10) return res.status(400).json({ error: 'الوصف قصير جداً.' });
    const countQ = await pool.query('SELECT COUNT(*)::int AS c FROM shop_products WHERE seller_id=$1 AND is_active=true', [req.user.id]);
    if (countQ.rows[0].c >= MAX_PRODUCTS_PER_USER) return res.status(409).json({ error: `وصلت إلى الحد الأقصى (${MAX_PRODUCTS_PER_USER}) من الإعلانات النشطة. احذف إعلاناً قديماً لإضافة جديد.` });
    const images = Array.isArray(img) ? img.slice(0, 5) : [];
    const nCur = SHOP_CURRENCIES.includes(cur) ? cur : 'ل.س';
    const q = await pool.query(
      `INSERT INTO shop_products(seller_id, seller_name, title, cat, sub, cond, price, cur, loc, phone, description, icon, images)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [req.user.id, req.user.name, title.slice(0,120), cat, sub||'', cond, price, nCur, loc.slice(0,200), nPhone, desc.slice(0,2000), icon||null, JSON.stringify(images)]);
    const p = q.rows[0];
    res.status(201).json({ id:p.id, sellerId:p.seller_id, seller:p.seller_name, title:p.title, cat:p.cat, sub:p.sub, cond:p.cond, price:parseFloat(p.price), cur:p.cur, loc:p.loc, phone:p.phone, desc:p.description, icon:p.icon, img:p.images||[], t:new Date(p.created_at).getTime() });
  } catch (e) { console.error('Shop create product error:', e); res.status(500).json({ error: 'تعذر نشر الإعلان.' }); }
});

app.put('/api/shop/products/:id', verifyShopToken, async (req, res) => {
  try {
    const existing = await pool.query('SELECT seller_id FROM shop_products WHERE id=$1 AND is_active=true', [req.params.id]);
    if (!existing.rowCount) return res.status(404).json({ error: 'المنتج غير موجود.' });
    if (existing.rows[0].seller_id !== req.user.id) return res.status(403).json({ error: 'غير مصرح لك بتعديل هذا الإعلان.' });
    const { title, cat, sub, cond, price, cur, loc, phone, desc, icon, img } = req.body;
    if (!title || !cat || !cond || isNaN(price) || !loc || !desc) return res.status(400).json({ error: 'بيانات ناقصة.' });
    const nPhone = normalizeShopPhone(phone) || '';
    const images = Array.isArray(img) ? img.slice(0, 5) : [];
    const nCur = SHOP_CURRENCIES.includes(cur) ? cur : 'ل.س';
    const q = await pool.query(
      `UPDATE shop_products SET title=$1, cat=$2, sub=$3, cond=$4, price=$5, cur=$6, loc=$7, phone=$8, description=$9, icon=$10, images=$11, updated_at=now() WHERE id=$12 RETURNING *`,
      [title.slice(0,120), cat, sub||'', cond, price, nCur, loc.slice(0,200), nPhone, desc.slice(0,2000), icon||null, JSON.stringify(images), req.params.id]);
    const p = q.rows[0];
    res.json({ id:p.id, sellerId:p.seller_id, seller:p.seller_name, title:p.title, cat:p.cat, sub:p.sub, cond:p.cond, price:parseFloat(p.price), cur:p.cur, loc:p.loc, phone:p.phone, desc:p.description, icon:p.icon, img:p.images||[], t:new Date(p.created_at).getTime() });
  } catch (e) { console.error('Shop update product error:', e); res.status(500).json({ error: 'تعذر تعديل الإعلان.' }); }
});

app.delete('/api/shop/products/:id', verifyShopToken, async (req, res) => {
  try {
    const existing = await pool.query('SELECT seller_id FROM shop_products WHERE id=$1 AND is_active=true', [req.params.id]);
    if (!existing.rowCount) return res.status(404).json({ error: 'المنتج غير موجود.' });
    if (existing.rows[0].seller_id !== req.user.id) return res.status(403).json({ error: 'غير مصرح لك بحذف هذا الإعلان.' });
    await pool.query('UPDATE shop_products SET is_active=false, updated_at=now() WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error('Shop delete product error:', e); res.status(500).json({ error: 'تعذر حذف الإعلان.' }); }
});

app.get('/api/shop/stats', async (req, res) => {
  try {
    const products = await pool.query('SELECT COUNT(*)::int AS c FROM shop_products WHERE is_active=true');
    const users = await pool.query('SELECT COUNT(*)::int AS c FROM shop_users');
    res.json({ products: products.rows[0].c, users: users.rows[0].c, maxPerUser: MAX_PRODUCTS_PER_USER });
  } catch (e) { res.status(500).json({ error: 'تعذر جلب الإحصائيات.' }); }
});

app.get('/api/shop/health', (req, res) => {
  res.json({ ok: true, service: 'bal7aza-shop', time: new Date().toISOString() });
});

app.use(express.static(path.join(__dirname)));
app.use((req,res)=>res.sendFile(path.join(__dirname,'clinic.html')));

initDb()
  .then(initShopDb)
  .then(() => app.listen(PORT, () => console.log(`✅ Server listening on ${PORT} (clinic + shop)`)))
  .catch(err => { console.error('❌ Startup error:', err); process.exit(1); });
