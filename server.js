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
    driverName TEXT,
    loadDetails TEXT,
    status TEXT DEFAULT 'active',
    createdAt TEXT DEFAULT (datetime('now'))
  )
`);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Create a new job and send SMS
app.post('/jobs', async (req, res) => {
  const { customerMobile, pickupAddress, deliveryAddress, driverName, loadDetails } = req.body;
  const id = crypto.randomBytes(4).toString('hex');

  db.prepare(`
    INSERT INTO jobs (id, customerMobile, pickupAddress, deliveryAddress, driverName, loadDetails)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, customerMobile, pickupAddress, deliveryAddress, driverName, loadDetails);

  const trackingUrl = `${req.protocol}://${req.get('host')}/track/${id}`;

  try {
    await twilioClient.messages.create({
      body: `Your Cartage delivery is on its way!\nDriver: ${driverName}\nLoad: ${loadDetails}\nTrack here: ${trackingUrl}`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: customerMobile
    });
    console.log(`SMS sent to ${customerMobile}`);
  } catch (err) {
    console.error('SMS failed:', err.message);
  }

  res.json({ id });
});

// Serve the dispatcher dashboard
app.get('/dispatcher', (req, res) => {
  res.sendFile(__dirname + '/public/dispatcher.html');
});

// List all active jobs
app.get('/jobs', (req, res) => {
  const jobs = db.prepare("SELECT * FROM jobs WHERE status = 'active' ORDER BY createdAt DESC").all();
  res.json(jobs);
});

// Serve the tracking page
app.get('/track/:id', (req, res) => {
  res.sendFile(__dirname + '/public/track.html');
});

// Get a job by id
app.get('/jobs/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Mark a job as complete
app.post('/jobs/:id/complete', (req, res) => {
  db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run('complete', req.params.id);
  res.json({ success: true });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Cartage server running at http://localhost:${PORT}`);
});
