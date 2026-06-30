require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const twilio = require('twilio');

const app = express();
const db = new Database('cartage.db');
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Set up the jobs table if it doesn't exist yet
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
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

// Add columns if upgrading from older schema
for (const col of ['pickupLat', 'pickupLng', 'deliveryLat', 'deliveryLng', 'currentLat', 'currentLng']) {
  try { db.exec(`ALTER TABLE jobs ADD COLUMN ${col} REAL`); } catch {}
}
try { db.exec(`ALTER TABLE jobs ADD COLUMN notified15min INTEGER DEFAULT 0`); } catch {}

// Haversine distance in km between two lat/lng points
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

// Create a new job and send SMS
app.post('/jobs', async (req, res) => {
  let { customerMobile, pickupAddress, deliveryAddress, driverName, loadDetails } = req.body;
  const id = crypto.randomBytes(4).toString('hex');

  // Convert Australian local numbers (04xx) to international format (+61)
  customerMobile = customerMobile.replace(/\s/g, '');
  if (customerMobile.startsWith('0')) customerMobile = '+61' + customerMobile.slice(1);

  const { pickupLat, pickupLng, deliveryLat, deliveryLng } = req.body;

  db.prepare(`
    INSERT INTO jobs (id, customerMobile, pickupAddress, deliveryAddress, pickupLat, pickupLng, deliveryLat, deliveryLng, driverName, loadDetails)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, customerMobile, pickupAddress, deliveryAddress, pickupLat || null, pickupLng || null, deliveryLat || null, deliveryLng || null, driverName, loadDetails);

  const trackingUrl = `${req.protocol}://${req.get('host')}/track/${id}`;
  const driverUrl = `${req.protocol}://${req.get('host')}/drive/${id}`;

  try {
    await twilioClient.messages.create({
      body: `Your Drova delivery is on its way!\nDriver: ${driverName}\nLoad: ${loadDetails}\nTrack here: ${trackingUrl}`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: customerMobile
    });
    console.log(`SMS sent to ${customerMobile}`);
  } catch (err) {
    console.error('SMS failed:', err.message);
  }

  res.json({ id, driverUrl });
});

// Serve the dispatcher dashboard
app.get('/dispatcher', (req, res) => {
  res.sendFile(__dirname + '/public/dispatcher.html');
});

// Serve the customer tracking page
app.get('/track/:id', (req, res) => {
  res.sendFile(__dirname + '/public/track.html');
});

// Serve the driver GPS page
app.get('/drive/:id', (req, res) => {
  res.sendFile(__dirname + '/public/drive.html');
});

// List all active jobs
app.get('/jobs', (req, res) => {
  const jobs = db.prepare("SELECT * FROM jobs WHERE status = 'active' ORDER BY createdAt DESC").all();
  res.json(jobs);
});

// Get a job by id
app.get('/jobs/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Driver updates their GPS location
app.post('/jobs/:id/location', async (req, res) => {
  const { lat, lng } = req.body;
  db.prepare('UPDATE jobs SET currentLat = ?, currentLng = ? WHERE id = ?').run(lat, lng, req.params.id);

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);

  // Send 15-minute warning SMS if delivery coords are known and not yet sent
  if (job && !job.notified15min && job.deliveryLat && job.deliveryLng) {
    const km = distanceKm(lat, lng, job.deliveryLat, job.deliveryLng);
    const etaMins = km / 80 * 60; // estimate at 80km/h

    if (etaMins <= 15) {
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

// Mark a job as complete
app.post('/jobs/:id/complete', (req, res) => {
  db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run('complete', req.params.id);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Drova server running at http://localhost:${PORT}`);
});
