require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const twilio = require('twilio');

const app = express();
const db = new Database('cartage.db');
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
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
    status TEXT DEFAULT 'active',
    createdAt TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    lat REAL,
    lng REAL,
    type TEXT DEFAULT 'farm',
    createdAt TEXT DEFAULT (datetime('now'))
  )
`);

// Schema migrations
for (const col of ['pickupLat','pickupLng','deliveryLat','deliveryLng','currentLat','currentLng']) {
  try { db.exec(`ALTER TABLE jobs ADD COLUMN ${col} REAL`); } catch {}
}
try { db.exec(`ALTER TABLE jobs ADD COLUMN notified15min INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE jobs ADD COLUMN customerName TEXT`); } catch {}
try { db.exec(`ALTER TABLE jobs ADD COLUMN jobType TEXT DEFAULT 'loaded'`); } catch {}

function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Pages
app.get('/dispatcher', (req, res) => res.sendFile(__dirname + '/public/dispatcher.html'));
app.get('/history',    (req, res) => res.sendFile(__dirname + '/public/history.html'));
app.get('/drivers',    (req, res) => res.sendFile(__dirname + '/public/drivers.html'));
app.get('/clients',    (req, res) => res.sendFile(__dirname + '/public/clients.html'));
app.get('/locations',  (req, res) => res.sendFile(__dirname + '/public/locations.html'));
app.get('/track/:id',  (req, res) => res.sendFile(__dirname + '/public/track.html'));
app.get('/drive/:id',  (req, res) => res.sendFile(__dirname + '/public/drive.html'));

// Jobs
app.get('/jobs', (req, res) => {
  res.json(db.prepare("SELECT * FROM jobs WHERE status = 'active' ORDER BY createdAt DESC").all());
});

app.get('/jobs/history', (req, res) => {
  res.json(db.prepare("SELECT * FROM jobs WHERE status = 'complete' ORDER BY createdAt DESC").all());
});

app.get('/jobs/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.post('/jobs', async (req, res) => {
  let { customerName, customerMobile, pickupAddress, deliveryAddress, driverName, loadDetails, jobType } = req.body;
  const { pickupLat, pickupLng, deliveryLat, deliveryLng } = req.body;
  const id = crypto.randomBytes(4).toString('hex');
  jobType = jobType || 'loaded';

  customerMobile = customerMobile.replace(/\s/g, '');
  if (customerMobile.startsWith('0')) customerMobile = '+61' + customerMobile.slice(1);

  db.prepare(`
    INSERT INTO jobs (id, customerName, customerMobile, pickupAddress, deliveryAddress, pickupLat, pickupLng, deliveryLat, deliveryLng, driverName, loadDetails, jobType)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, customerName || null, customerMobile, pickupAddress, deliveryAddress, pickupLat || null, pickupLng || null, deliveryLat || null, deliveryLng || null, driverName, loadDetails, jobType);

  // Update driver status to on-job
  db.prepare("UPDATE drivers SET status = 'on-job' WHERE name = ?").run(driverName);

  const trackingUrl = `${req.protocol}://${req.get('host')}/track/${id}`;
  const driverUrl = `${req.protocol}://${req.get('host')}/drive/${id}`;

  const smsBody = jobType === 'empty'
    ? `Your Drova driver is on the way to collect!\nDriver: ${driverName}\nPickup: ${pickupAddress}\nTrack here: ${trackingUrl}`
    : `Your Drova delivery is on its way!\nDriver: ${driverName}\nLoad: ${loadDetails}\nTrack here: ${trackingUrl}`;

  try {
    await twilioClient.messages.create({
      body: smsBody,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: customerMobile
    });
    console.log(`SMS sent to ${customerMobile}`);
  } catch (err) {
    console.error('SMS failed:', err.message);
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
          body: `Your Drova delivery is almost there! 🚛\n${job.driverName} is about 15 minutes away with your ${job.loadDetails}.`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: job.customerMobile
        });
        console.log(`15-min SMS sent to ${job.customerMobile}`);
      } catch (err) {
        console.error('15-min SMS failed:', err.message);
      }
    }
  }
  res.json({ success: true });
});

app.post('/jobs/:id/complete', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  db.prepare("UPDATE jobs SET status = 'complete' WHERE id = ?").run(req.params.id);
  if (job) db.prepare("UPDATE drivers SET status = 'available' WHERE name = ?").run(job.driverName);
  res.json({ success: true });
});

// Drivers
app.get('/api/drivers', (req, res) => {
  res.json(db.prepare('SELECT * FROM drivers ORDER BY name ASC').all());
});

app.post('/api/drivers', (req, res) => {
  const { name, mobile, licenceClass } = req.body;
  const result = db.prepare('INSERT INTO drivers (name, mobile, licenceClass) VALUES (?, ?, ?)').run(name, mobile || null, licenceClass || null);
  res.json({ id: result.lastInsertRowid, name, mobile, licenceClass, status: 'available' });
});

app.delete('/api/drivers/:id', (req, res) => {
  db.prepare('DELETE FROM drivers WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Clients — derived from jobs
app.get('/api/clients', (req, res) => {
  const clients = db.prepare(`
    SELECT customerMobile, customerName,
           COUNT(*) as totalJobs,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as activeJobs,
           MAX(createdAt) as lastJob
    FROM jobs
    GROUP BY customerMobile
    ORDER BY lastJob DESC
  `).all();
  res.json(clients);
});

// Locations
app.get('/api/locations', (req, res) => {
  res.json(db.prepare('SELECT * FROM locations ORDER BY name ASC').all());
});

app.post('/api/locations', (req, res) => {
  const { name, address, lat, lng, type } = req.body;
  const result = db.prepare('INSERT INTO locations (name, address, lat, lng, type) VALUES (?, ?, ?, ?, ?)').run(name, address, lat || null, lng || null, type || 'farm');
  res.json({ id: result.lastInsertRowid, name, address, lat, lng, type });
});

app.delete('/api/locations/:id', (req, res) => {
  db.prepare('DELETE FROM locations WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Drova running at http://localhost:${PORT}`));
