const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 10000);
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) console.warn('JWT_SECRET is not set. Set it in Render Environment before using authentication.');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

function signToken(user) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
}

async function initDb() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      experience_level TEXT DEFAULT 'fresher',
      location TEXT DEFAULT '',
      skills TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS jobs (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      location TEXT NOT NULL,
      experience TEXT NOT NULL DEFAULT 'Fresher',
      skills TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS applications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'Applied',
      applied_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, job_id)
    );
  `);
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM jobs');
  if (rows[0].count === 0) {
    const jobs = [
      ['Junior Software Engineer','TechNova','Bengaluru','Fresher','JavaScript,React,Node.js,Git','Build and maintain web applications with a modern JavaScript stack.'],
      ['Cloud Support Engineer','CloudSphere','Hyderabad','Fresher','AWS,Linux,Python,Docker','Support cloud infrastructure and troubleshoot deployment issues.'],
      ['Frontend Developer','WebCraft','Remote','0-2 years','HTML,CSS,JavaScript,React','Create responsive and accessible user interfaces.'],
      ['Data Analyst','InsightWorks','Pune','0-1 years','SQL,Excel,Python,Power BI','Analyze business data and create actionable reports.'],
      ['Backend Developer','API Labs','Chennai','1-2 years','Node.js,Express,PostgreSQL,REST','Develop reliable REST APIs and database-backed services.']
    ];
    for (const j of jobs) await pool.query('INSERT INTO jobs(title,company,location,experience,skills,description) VALUES($1,$2,$3,$4,$5,$6)', j);
  }
}

app.get('/', (_req, res) => res.json({ ok: true, service: 'Career Stack API' }));
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password } = req.body || {};
    if (!name || !email || !password || password.length < 6) return res.status(400).json({ error: 'Name, email and password (6+ characters) are required' });
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query('INSERT INTO users(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email,experience_level,location,skills', [name.trim(), email.trim().toLowerCase(), hash]);
    const user = result.rows[0];
    res.status(201).json({ token: signToken(user), user });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    console.error(e); res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [String(email || '').trim().toLowerCase()]);
    if (!result.rows[0] || !(await bcrypt.compare(password || '', result.rows[0].password_hash))) return res.status(401).json({ error: 'Invalid email or password' });
    const u = result.rows[0];
    const user = { id:u.id,name:u.name,email:u.email,experience_level:u.experience_level,location:u.location,skills:u.skills };
    res.json({ token: signToken(user), user });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/me', auth, async (req, res) => {
  try { const r = await pool.query('SELECT id,name,email,experience_level,location,skills FROM users WHERE id=$1',[req.user.id]); res.json(r.rows[0]); }
  catch (e) { console.error(e); res.status(500).json({ error:'Server error' }); }
});

app.put('/api/profile', auth, async (req, res) => {
  try {
    const { name, experience_level, location, skills } = req.body || {};
    const r = await pool.query('UPDATE users SET name=$1,experience_level=$2,location=$3,skills=$4 WHERE id=$5 RETURNING id,name,email,experience_level,location,skills', [name || '', experience_level || 'fresher', location || '', skills || '', req.user.id]);
    res.json(r.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error:'Server error' }); }
});

app.get('/api/jobs', auth, async (req, res) => {
  try {
    const q = `%${String(req.query.q || '').trim()}%`, loc = `%${String(req.query.location || '').trim()}%`;
    const r = await pool.query(`SELECT * FROM jobs WHERE ($1='%%' OR title ILIKE $1 OR company ILIKE $1 OR skills ILIKE $1) AND ($2='%%' OR location ILIKE $2) ORDER BY created_at DESC`, [q, loc]);
    const user = (await pool.query('SELECT skills FROM users WHERE id=$1',[req.user.id])).rows[0];
    const have = new Set(String(user?.skills || '').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean));
    res.json(r.rows.map(j => { const required=String(j.skills).split(',').map(s=>s.trim()).filter(Boolean); const matched=required.filter(s=>have.has(s.toLowerCase())).length; return {...j,match_percentage: required.length ? Math.round(matched/required.length*100) : 0}; }));
  } catch (e) { console.error(e); res.status(500).json({ error:'Server error' }); }
});

app.post('/api/jobs/:id/apply', auth, async (req,res)=>{
  try { await pool.query('INSERT INTO applications(user_id,job_id) VALUES($1,$2) ON CONFLICT(user_id,job_id) DO NOTHING',[req.user.id,req.params.id]); res.json({message:'Application submitted'}); }
  catch(e){ console.error(e); res.status(500).json({error:'Server error'}); }
});

app.get('/api/applications', auth, async (req,res)=>{
  try { const r=await pool.query(`SELECT a.id,a.status,a.applied_at,j.id AS job_id,j.title,j.company,j.location FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.user_id=$1 ORDER BY a.applied_at DESC`,[req.user.id]); res.json(r.rows); }
  catch(e){ console.error(e); res.status(500).json({error:'Server error'}); }
});

app.get('/api/interview', auth, (_req,res)=>res.json([
  {question:'Tell me about yourself.',tip:'Keep it concise: education, relevant skills, project experience and career goal.'},
  {question:'Explain one project you built.',tip:'Describe the problem, your role, technologies used and measurable result.'},
  {question:'Why should we hire you as a fresher?',tip:'Connect your skills, learning ability and projects to the role.'},
  {question:'What is REST API?',tip:'Explain resources, HTTP methods, status codes and stateless requests.'}
]));

initDb().then(()=>app.listen(PORT,'0.0.0.0',()=>console.log(`Career Stack server running on ${PORT}`))).catch(e=>{ console.error('Database initialization failed:',e); process.exit(1); });
