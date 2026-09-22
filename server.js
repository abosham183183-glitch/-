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

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'hmudealali750@gmail.com').trim().toLowerCase();
const MAX_BOOKINGS = 16;
const TIME_SLOTS = ['09:00 صباحاً','09:30 صباحاً','10:00 صباحاً','10:30 صباحاً','11:00 صباحاً','11:30 صباحاً','12:00 ظهراً','12:30 ظهراً','01:00 مساءً','01:30 مساءً','02:00 مساءً','02:30 مساءً','03:00 مساءً','03:30 مساءً','04:00 مساءً','04:30 مساءً'];

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
if (!process.env.ADMIN_INITIAL_PASSWORD || process.env.ADMIN_INITIAL_PASSWORD.length < 12) throw new Error('ADMIN_INITIAL_PASSWORD must be at least 12 characters');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

const publicLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
app.use('/api/public/', publicLimiter);
app.use('/api/bookings/lookup', publicLimiter);
app.use('/api/patient/status', publicLimiter);
app.use('/api/urgent', publicLimiter);
app.use('/api/login', loginLimiter);

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
    const b = inserted.rows[0];
    res.status(201).json({ booking: b });
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

app.use(express.static(path.join(__dirname)));
app.use((req,res)=>res.sendFile(path.join(__dirname,'clinic.html')));

initDb().then(()=>app.listen(PORT,()=>console.log(`Clinic server listening on ${PORT}`))).catch(err=>{console.error(err);process.exit(1);});
