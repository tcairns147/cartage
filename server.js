require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const twilio = require('twilio');
const cookieParser = require('cookie-parser');

const app = express();
const db = new Database('cartage.db');
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'drova-secret-2025';

db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    passcode TEXT NOT NULL
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    companyId INTEGER,
    customerName TEXT,
    customerMobile TEXT,
    pickupAddress TEXT,
    deliveryAddress TEXT,
    pickupLat REAL,
    pickupLng REAL,
    deliveryLat REAL,
    deliveryLng REAL,
    currentLat REAL,
    currentLng REAL,
    driverName TEXT,
    loadDetails TEXT,
    jobType TEXT DEFAULT 'loaded',
    status TEXT DEFAULT 'active',
    notified15min INTEGER DEFAULT 0,
    createdAt TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    companyId INTEGER,
    name TEXT NOT NULL,
    mobile TEXT,
    licenceClass TEXT,
    status TEXT DEFAULT 'available',
    createdAt TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    companyId INTEGER,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    lat REAL,
    lng REAL,
    type TEXT DEFAULT 'farm',
    createdAt TEXT DEFAULT (datetime('now'))
  )
`);

// Schema migrations for existing installs
for (const col of ['pickupLat','pickupLng','deliveryLat','deliveryLng','currentLat','currentLng']) {
  try { db.exec(`ALTER TABLE jobs ADD COLUMN ${col} REAL`); } catch {}
}
try { db.exec(`ALTER TABLE jobs ADD COLUMN notified15min INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE jobs ADD COLUMN customerName TEXT`); } catch {}
try { db.exec(`ALTER TABLE jobs ADD COLUMN jobType TEXT DEFAULT 'loaded'`); } catch {}
try { db.exec(`ALTER TABLE jobs ADD COLUMN notes TEXT`); } catch {}
try { db.exec(`ALTER TABLE jobs ADD COLUMN companyId INTEGER`); } catch {}
try { db.exec(`ALTER TABLE drivers ADD COLUMN companyId INTEGER`); } catch {}
try { db.exec(`ALTER TABLE locations ADD COLUMN companyId INTEGER`); } catch {}

// Seed companies
const companies = [
  { name: 'PJKL Sturgiss', slug: 'sturgiss', passcode: 'hay2025' },
  { name: 'Charlotte Horan', slug: 'horan', passcode: 'horan2025' },
];
for (const c of companies) {
  try {
    db.prepare('INSERT INTO companies (name, slug, passcode) VALUES (?, ?, ?)').run(c.name, c.slug, c.passcode);
  } catch {}
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(COOKIE_SECRET));
app.use(express.static('public'));

// Auth middleware
function requireAuth(req, res, next) {
  const slug = req.signedCookies.company;
  if (!slug) return res.redirect('/login');
  const company = db.prepare('SELECT * FROM companies WHERE slug = ?').get(slug);
  if (!company) return res.redirect('/login');
  req.company = company;
  next();
}

// Login page
app.get('/login', (req, res) => res.sendFile(__dirname + '/public/login.html'));

app.post('/login', (req, res) => {
  const { slug, passcode } = req.body;
  const company = db.prepare('SELECT * FROM companies WHERE slug = ? AND passcode = ?').get(slug, passcode);
  if (!company) return res.redirect('/login?error=1');
  res.cookie('company', slug, { signed: true, httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
  res.redirect('/dispatcher');
});

app.post('/logout', (req, res) => {
  res.clearCookie('company');
  res.redirect('/login');
});

// Protected pages
app.get('/',           requireAuth, (req, res) => res.sendFile(__dirname + '/public/index.html'));
app.get('/dispatcher', requireAuth, (req, res) => res.sendFile(__dirname + '/public/dispatcher.html'));
app.get('/history',    requireAuth, (req, res) => res.sendFile(__dirname + '/public/history.html'));
app.get('/drivers',    requireAuth, (req, res) => res.sendFile(__dirname + '/public/drivers.html'));
app.get('/clients',    requireAuth, (req, res) => res.sendFile(__dirname + '/public/clients.html'));
app.get('/locations',  requireAuth, (req, res) => res.sendFile(__dirname + '/public/locations.html'));

// Public pages (no auth — customers and drivers use these)
app.get('/track/:id',  (req, res) => res.sendFile(__dirname + '/public/track.html'));
app.get('/drive/:id',  (req, res) => res.sendFile(__dirname + '/public/drive.html'));

// Company info endpoint (for sidebar)
app.get('/api/me', requireAuth, (req, res) => {
  res.json({ name: req.company.name, slug: req.company.slug });
});

// Jobs
app.get('/jobs', requireAuth, (req, res) => {
  res.json(db.prepare("SELECT * FROM jobs WHERE companyId = ? AND status = 'active' ORDER BY createdAt DESC").all(req.company.id));
});

app.get('/jobs/history', requireAuth, (req, res) => {
  res.json(db.prepare("SELECT * FROM jobs WHERE companyId = ? AND status = 'complete' ORDER BY createdAt DESC").all(req.company.id));
});

app.get('/jobs/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.post('/jobs', requireAuth, async (req, res) => {
  let { customerName, customerMobile, pickupAddress, deliveryAddress, driverName, loadDetails, jobType, notes } = req.body;
  const { pickupLat, pickupLng, deliveryLat, deliveryLng } = req.body;
  const id = crypto.randomBytes(4).toString('hex');
  jobType = jobType || 'loaded';

  customerMobile = customerMobile.replace(/\s/g, '');
  if (customerMobile.startsWith('0')) customerMobile = '+61' + customerMobile.slice(1);

  db.prepare(`
    INSERT INTO jobs (id, companyId, customerName, customerMobile, pickupAddress, deliveryAddress, pickupLat, pickupLng, deliveryLat, deliveryLng, driverName, loadDetails, jobType, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.company.id, customerName || null, customerMobile, pickupAddress, deliveryAddress, pickupLat || null, pickupLng || null, deliveryLat || null, deliveryLng || null, driverName, loadDetails, jobType, notes || null);

  db.prepare("UPDATE drivers SET status = 'on-job' WHERE name = ? AND companyId = ?").run(driverName, req.company.id);

  const trackingUrl = `${req.protocol}://${req.get('host')}/track/${id}`;
  const driverUrl = `${req.protocol}://${req.get('host')}/drive/${id}`;

  const greeting = customerName ? `Hi ${customerName.split(' ')[0]}, ` : '';
  const smsBody = jobType === 'empty'
    ? `${greeting}${driverName} is on the way to collect your livestock. Track here: ${trackingUrl}`
    : `${greeting}your delivery of ${loadDetails} is on the way with ${driverName}. Track here: ${trackingUrl}`;

  try {
    await twilioClient.messages.create({ body: smsBody, from: process.env.TWILIO_PHONE_NUMBER, to: customerMobile });
    console.log(`SMS sent to customer ${customerMobile}`);
  } catch (err) {
    console.error('Customer SMS failed:', err.message);
  }

  // Text the driver their link
  const driver = db.prepare('SELECT * FROM drivers WHERE name = ? AND companyId = ?').get(driverName, req.company.id);
  if (driver && driver.mobile) {
    const driverGreeting = `Hi ${driverName.split(' ')[0]}, `;
    const driverSms = jobType === 'empty'
      ? `${driverGreeting}you have a new job. Pickup from: ${pickupAddress}${notes ? `\nNotes: ${notes}` : ''}\nOpen your tracking link here: ${driverUrl}`
      : `${driverGreeting}you have a new job. Delivering ${loadDetails} to: ${deliveryAddress}${notes ? `\nNotes: ${notes}` : ''}\nOpen your tracking link here: ${driverUrl}`;
    try {
      await twilioClient.messages.create({ body: driverSms, from: process.env.TWILIO_PHONE_NUMBER, to: driver.mobile });
      console.log(`SMS sent to driver ${driver.mobile}`);
    } catch (err) {
      console.error('Driver SMS failed:', err.message);
    }
  }

  res.json({ id, driverUrl });
});

app.post('/jobs/:id/location', async (req, res) => {
  const { lat, lng } = req.body;
  db.prepare('UPDATE jobs SET currentLat = ?, currentLng = ? WHERE id = ?').run(lat, lng, req.params.id);
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);

  if (job && !job.notified15min && job.deliveryLat && job.deliveryLng) {
    const km = distanceKm(lat, lng, job.deliveryLat, job.deliveryLng);
    if (km / 80 * 60 <= 15) {
      db.prepare('UPDATE jobs SET notified15min = 1 WHERE id = ?').run(job.id);
      try {
        await twilioClient.messages.create({
          body: `${job.customerName ? `Hi ${job.customerName.split(' ')[0]}, ` : ''}${job.driverName} is about 15 minutes away with your ${job.loadDetails}.`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: job.customerMobile
        });
      } catch (err) {
        console.error('15-min SMS failed:', err.message);
      }
    }
  }
  res.json({ success: true });
});

app.post('/jobs/:id/complete', requireAuth, (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ? AND companyId = ?').get(req.params.id, req.company.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  db.prepare("UPDATE jobs SET status = 'complete' WHERE id = ?").run(req.params.id);
  db.prepare("UPDATE drivers SET status = 'available' WHERE name = ? AND companyId = ?").run(job.driverName, req.company.id);
  res.json({ success: true });
});

// Drivers
app.get('/api/drivers', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM drivers WHERE companyId = ? ORDER BY name ASC').all(req.company.id));
});

app.post('/api/drivers', requireAuth, (req, res) => {
  const { name, mobile, licenceClass } = req.body;
  const result = db.prepare('INSERT INTO drivers (companyId, name, mobile, licenceClass) VALUES (?, ?, ?, ?)').run(req.company.id, name, mobile || null, licenceClass || null);
  res.json({ id: result.lastInsertRowid, name, mobile, licenceClass, status: 'available' });
});

app.delete('/api/drivers/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM drivers WHERE id = ? AND companyId = ?').run(req.params.id, req.company.id);
  res.json({ success: true });
});

// Clients
app.get('/api/clients', requireAuth, (req, res) => {
  const clients = db.prepare(`
    SELECT customerMobile, customerName,
           COUNT(*) as totalJobs,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as activeJobs,
           MAX(createdAt) as lastJob
    FROM jobs WHERE companyId = ?
    GROUP BY customerMobile
    ORDER BY lastJob DESC
  `).all(req.company.id);
  res.json(clients);
});

// Locations
app.get('/api/locations', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM locations WHERE companyId = ? ORDER BY name ASC').all(req.company.id));
});

app.post('/api/locations', requireAuth, (req, res) => {
  const { name, address, lat, lng, type } = req.body;
  const result = db.prepare('INSERT INTO locations (companyId, name, address, lat, lng, type) VALUES (?, ?, ?, ?, ?, ?)').run(req.company.id, name, address, lat || null, lng || null, type || 'farm');
  res.json({ id: result.lastInsertRowid, name, address, lat, lng, type });
});

app.delete('/api/locations/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM locations WHERE id = ? AND companyId = ?').run(req.params.id, req.company.id);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Drova running at http://localhost:${PORT}`));
