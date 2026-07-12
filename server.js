require('dotenv').config();
const express = require('express');
const { createClient } = require('@libsql/client');
const crypto = require('crypto');
const twilio = require('twilio');
const cookieParser = require('cookie-parser');
const fs = require('fs');

const app = express();
const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'drova-secret-2025';

async function dbGet(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows[0] || null;
}

async function dbAll(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows;
}

async function dbRun(sql, args = []) {
  return await db.execute({ sql, args });
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function initDb() {
  await dbRun(`CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    passcode TEXT NOT NULL
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS jobs (
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
    notes TEXT,
    truckRego TEXT,
    createdAt TEXT DEFAULT (datetime('now'))
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS drivers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    companyId INTEGER,
    name TEXT NOT NULL,
    mobile TEXT,
    licenceClass TEXT,
    status TEXT DEFAULT 'available',
    createdAt TEXT DEFAULT (datetime('now'))
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS trucks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    companyId INTEGER,
    rego TEXT NOT NULL,
    make TEXT,
    type TEXT,
    status TEXT DEFAULT 'available',
    createdAt TEXT DEFAULT (datetime('now'))
  )`);

  await dbRun(`CREATE TABLE IF NOT EXISTS locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    companyId INTEGER,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    lat REAL,
    lng REAL,
    type TEXT DEFAULT 'farm',
    createdAt TEXT DEFAULT (datetime('now'))
  )`);

  // Existing column migrations
  for (const col of ['pickupLat','pickupLng','deliveryLat','deliveryLng','currentLat','currentLng','notified15min','customerName','jobType','notes','companyId','truckRego']) {
    try { await dbRun(`ALTER TABLE jobs ADD COLUMN ${col} TEXT`); } catch {}
  }
  try { await dbRun(`ALTER TABLE drivers ADD COLUMN companyId INTEGER`); } catch {}
  try { await dbRun(`ALTER TABLE locations ADD COLUMN companyId INTEGER`); } catch {}

  // Trial analytics and lifecycle timestamp columns
  const newCols = [
    'startedAt TEXT',
    'completedAt TEXT',
    'firstLocationAt TEXT',
    'lastLocationAt TEXT',
    'locationUpdateCount INTEGER DEFAULT 0',
    'trackingSmsAttemptedAt TEXT',
    'trackingSmsSentAt TEXT',
    'trackingSmsFailedAt TEXT',
    'firstTrackingViewAt TEXT',
    'lastTrackingViewAt TEXT',
    'trackingViewCount INTEGER DEFAULT 0',
    'driverLinkOpenedAt TEXT',
    'driverLinkOpenCount INTEGER DEFAULT 0',
    'notifyMinsBefore INTEGER DEFAULT 15',
    'distanceTravelledKm REAL DEFAULT 0',
    'lastKnownLat REAL',
    'lastKnownLng REAL',
  ];
  for (const col of newCols) {
    try { await dbRun(`ALTER TABLE jobs ADD COLUMN ${col}`); } catch {}
  }

  // Seed companies
  const companies = [
    { name: 'Sturgiss Pastoral Company Pty Ltd', slug: 'sturgiss', passcode: 'hay2025' },
    { name: 'Charlotte Horan', slug: 'horan', passcode: 'horan2025' },
    { name: 'Muddle Transport', slug: 'muddle', passcode: 'muddle2025' },
  ];
  for (const c of companies) {
    const existing = await dbGet('SELECT id FROM companies WHERE slug = ?', [c.slug]);
    if (existing) {
      await dbRun('UPDATE companies SET name = ?, passcode = ? WHERE slug = ?', [c.name, c.passcode, c.slug]);
    } else {
      await dbRun('INSERT INTO companies (name, slug, passcode) VALUES (?, ?, ?)', [c.name, c.slug, c.passcode]);
    }
  }
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(COOKIE_SECRET));
app.use(express.static('public', { index: false }));

async function requireAuth(req, res, next) {
  const slug = req.signedCookies.company;
  if (!slug) return res.redirect('/login');
  try {
    const company = await dbGet('SELECT * FROM companies WHERE slug = ?', [slug]);
    if (!company) return res.redirect('/login');
    req.company = company;
    next();
  } catch { res.redirect('/login'); }
}

app.get('/login', (req, res) => res.sendFile(__dirname + '/public/login.html'));

app.post('/login', async (req, res) => {
  const { slug, passcode } = req.body;
  const company = await dbGet('SELECT * FROM companies WHERE slug = ? AND passcode = ?', [slug, passcode]);
  if (!company) return res.redirect('/login?error=1');
  res.cookie('company', slug, { signed: true, httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
  res.redirect('/dispatcher');
});

app.post('/logout', (req, res) => {
  res.clearCookie('company');
  res.redirect('/login');
});

// Delete all company data (jobs, drivers, trucks, locations) for trial reset
app.delete('/api/company/all', requireAuth, async (req, res) => {
  const id = req.company.id;
  await dbRun('DELETE FROM jobs WHERE companyId = ?', [id]);
  await dbRun('DELETE FROM drivers WHERE companyId = ?', [id]);
  await dbRun('DELETE FROM trucks WHERE companyId = ?', [id]);
  await dbRun('DELETE FROM locations WHERE companyId = ?', [id]);
  res.json({ ok: true });
});

app.get('/',           requireAuth, (req, res) => res.sendFile(__dirname + '/public/index.html'));
app.get('/dispatcher', requireAuth, (req, res) => res.sendFile(__dirname + '/public/dispatcher.html'));
app.get('/history',    requireAuth, (req, res) => res.sendFile(__dirname + '/public/history.html'));
app.get('/drivers',    requireAuth, (req, res) => res.sendFile(__dirname + '/public/drivers.html'));
app.get('/clients',    requireAuth, (req, res) => res.sendFile(__dirname + '/public/clients.html'));
app.get('/locations',  requireAuth, (req, res) => res.sendFile(__dirname + '/public/locations.html'));
app.get('/trucks',     requireAuth, (req, res) => res.sendFile(__dirname + '/public/trucks.html'));
app.get('/trial',      requireAuth, (req, res) => res.sendFile(__dirname + '/public/trial.html'));
app.get('/track/:id',  (req, res) => res.sendFile(__dirname + '/public/track.html'));
app.get('/drive/:id',  (req, res) => res.sendFile(__dirname + '/public/drive.html'));

app.get('/api/config', (req, res) => {
  res.json({ googleMapsKey: process.env.GOOGLE_PLACES_KEY || '' });
});

app.get('/api/places', async (req, res) => {
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) return res.json({ predictions: [] });
  const q = req.query.q || '';
  if (!q) return res.json({ predictions: [] });
  try {
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(q)}&components=country:au&key=${key}&language=en`;
    const r = await fetch(url);
    const data = await r.json();
    console.log('Places API status:', data.status, 'predictions:', (data.predictions||[]).length);
    res.json(data);
  } catch (e) {
    console.error('Places API error:', e.message);
    res.json({ predictions: [] });
  }
});

app.get('/api/places/detail', async (req, res) => {
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) return res.json({});
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${req.query.place_id}&fields=geometry&key=${key}`;
    const r = await fetch(url);
    const data = await r.json();
    const loc = data.result?.geometry?.location;
    res.json(loc ? { lat: loc.lat, lng: loc.lng } : {});
  } catch (e) {
    res.json({});
  }
});

app.get('/api/me', requireAuth, async (req, res) => {
  const logoPath = `${__dirname}/public/logo-${req.company.slug}.png`;
  const logoUrl = fs.existsSync(logoPath) ? `/logo-${req.company.slug}.png` : null;
  res.json({ name: req.company.name, slug: req.company.slug, logoUrl });
});

app.get('/jobs', requireAuth, async (req, res) => {
  res.json(await dbAll("SELECT * FROM jobs WHERE companyId = ? AND status IN ('active','planned') ORDER BY createdAt DESC", [req.company.id]));
});

app.get('/jobs/history', requireAuth, async (req, res) => {
  res.json(await dbAll("SELECT * FROM jobs WHERE companyId = ? AND status = 'complete' ORDER BY createdAt DESC", [req.company.id]));
});

app.get('/jobs/:id', async (req, res) => {
  const job = await dbGet('SELECT jobs.*, companies.slug as companySlug FROM jobs LEFT JOIN companies ON jobs.companyId = companies.id WHERE jobs.id = ?', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

async function geocodeAddress(address) {
  if (!address || !process.env.GOOGLE_MAPS_KEY) return null;
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=AU&key=${process.env.GOOGLE_MAPS_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    if (data.status === 'OK' && data.results[0]) {
      const loc = data.results[0].geometry.location;
      return { lat: loc.lat, lng: loc.lng };
    }
  } catch (err) {
    console.error('Geocode failed:', err.message);
  }
  return null;
}

app.post('/jobs', requireAuth, async (req, res) => {
  let { customerName, customerMobile, pickupAddress, deliveryAddress, driverName, loadDetails, jobType, notes, dispatchMode, truckRego } = req.body;
  let { pickupLat, pickupLng, deliveryLat, deliveryLng } = req.body;
  const notifyMinsBefore = parseInt(req.body.notifyMinsBefore) || 15;
  const id = crypto.randomBytes(4).toString('hex');
  jobType = jobType || 'loaded';
  const status = dispatchMode === 'plan' ? 'planned' : 'active';

  customerMobile = (customerMobile || '').replace(/[\s\-().]/g, '');
  if (customerMobile.startsWith('0'))        customerMobile = '+61' + customerMobile.slice(1);
  else if (customerMobile.startsWith('61'))  customerMobile = '+' + customerMobile;
  else if (!customerMobile.startsWith('+'))  customerMobile = '+61' + customerMobile;

  // Geocode any addresses that don't already have coordinates
  if ((!pickupLat || !pickupLng) && pickupAddress) {
    const coords = await geocodeAddress(pickupAddress);
    if (coords) { pickupLat = coords.lat; pickupLng = coords.lng; }
  }
  if ((!deliveryLat || !deliveryLng) && deliveryAddress) {
    const coords = await geocodeAddress(deliveryAddress);
    if (coords) { deliveryLat = coords.lat; deliveryLng = coords.lng; }
  }

  await dbRun(
    `INSERT INTO jobs (id, companyId, customerName, customerMobile, pickupAddress, deliveryAddress, pickupLat, pickupLng, deliveryLat, deliveryLng, driverName, loadDetails, jobType, notes, status, truckRego, notifyMinsBefore)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, req.company.id, customerName || null, customerMobile, pickupAddress, deliveryAddress, pickupLat || null, pickupLng || null, deliveryLat || null, deliveryLng || null, driverName, loadDetails, jobType, notes || null, status, truckRego || null, notifyMinsBefore]
  );

  await dbRun("UPDATE drivers SET status = 'on-job' WHERE name = ? AND companyId = ?", [driverName, req.company.id]);
  if (truckRego) await dbRun("UPDATE trucks SET status = 'on-job' WHERE rego = ? AND companyId = ?", [truckRego, req.company.id]);

  const driverUrl = `${req.protocol}://${req.get('host')}/drive/${id}`;
  res.json({ id, driverUrl });
});

// Driver opens the drive link — record first open and open count
app.post('/jobs/:id/driver-open', async (req, res) => {
  const now = new Date().toISOString();
  try {
    await dbRun(
      `UPDATE jobs SET
        driverLinkOpenedAt = COALESCE(driverLinkOpenedAt, ?),
        driverLinkOpenCount = COALESCE(driverLinkOpenCount, 0) + 1
       WHERE id = ?`,
      [now, req.params.id]
    );
  } catch {}
  res.json({ success: true });
});

// Driver taps "Start Trip" — idempotent: only sets startedAt once, SMS sent once
app.post('/jobs/:id/start', async (req, res) => {
  const job = await dbGet('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'Not found' });

  const now = new Date().toISOString();

  // Only record startedAt on the first call
  if (!job.startedAt) {
    await dbRun("UPDATE jobs SET status = 'active', startedAt = ? WHERE id = ?", [now, req.params.id]);
  } else {
    await dbRun("UPDATE jobs SET status = 'active' WHERE id = ?", [req.params.id]);
  }

  res.json({ success: true });

  // Only send tracking SMS once — guard on trackingSmsAttemptedAt
  if (!job.trackingSmsAttemptedAt && job.customerMobile) {
    await dbRun('UPDATE jobs SET trackingSmsAttemptedAt = ? WHERE id = ?', [now, req.params.id]);

    const trackingUrl = `${req.protocol}://${req.get('host')}/track/${job.id}`;
    const greeting = job.customerName ? `Hi ${job.customerName.split(' ')[0]}, ` : '';
    const smsBody = job.jobType === 'empty'
      ? `${greeting}${job.driverName} is on the way to collect your livestock. Track here: ${trackingUrl}`
      : `${greeting}your delivery of ${job.loadDetails} is on the way with ${job.driverName}. Track here: ${trackingUrl}`;

    twilioClient.messages.create({ body: smsBody, from: process.env.TWILIO_PHONE_NUMBER, to: job.customerMobile })
      .then(async () => {
        await dbRun('UPDATE jobs SET trackingSmsSentAt = ? WHERE id = ?', [new Date().toISOString(), job.id]);
        console.log(`Start SMS sent to ${job.customerMobile}`);
      })
      .catch(async (err) => {
        await dbRun('UPDATE jobs SET trackingSmsFailedAt = ? WHERE id = ?', [new Date().toISOString(), job.id]);
        console.error('Start SMS failed:', err.message);
      });
  }
});

// Live GPS update — records first and last location times, increments count
app.post('/jobs/:id/location', async (req, res) => {
  const { lat, lng } = req.body;
  const now = new Date().toISOString();

  const job = await dbGet('SELECT * FROM jobs WHERE id = ?', [req.params.id]);

  let extraKm = 0;
  if (job && job.lastKnownLat && job.lastKnownLng) {
    extraKm = distanceKm(job.lastKnownLat, job.lastKnownLng, lat, lng);
    // Ignore implausible jumps (>5km between updates — likely GPS glitch)
    if (extraKm > 5) extraKm = 0;
  }

  await dbRun(
    `UPDATE jobs SET
      currentLat = ?,
      currentLng = ?,
      lastKnownLat = ?,
      lastKnownLng = ?,
      firstLocationAt = COALESCE(firstLocationAt, ?),
      lastLocationAt = ?,
      locationUpdateCount = COALESCE(locationUpdateCount, 0) + 1,
      distanceTravelledKm = COALESCE(distanceTravelledKm, 0) + ?
     WHERE id = ?`,
    [lat, lng, lat, lng, now, now, extraKm, req.params.id]
  );
  if (job && !job.notified15min && job.deliveryLat && job.deliveryLng && job.customerMobile) {
    const km = distanceKm(lat, lng, job.deliveryLat, job.deliveryLng);
    const notify = job.notifyMinsBefore || 15;
    if (km / 80 * 60 <= notify) {
      await dbRun('UPDATE jobs SET notified15min = 1 WHERE id = ?', [job.id]);
      try {
        await twilioClient.messages.create({
          body: `${job.customerName ? `Hi ${job.customerName.split(' ')[0]}, ` : ''}${job.driverName} is about ${notify} minutes away with your ${job.loadDetails}.`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: job.customerMobile
        });
      } catch (err) {
        console.error('Proximity SMS failed:', err.message);
      }
    }
  }
  res.json({ success: true });
});

// Client opens tracking page — records first view time and view count
// Called as a fire-and-forget beacon from the client tracking page JS
app.post('/jobs/:id/view', async (req, res) => {
  const now = new Date().toISOString();
  try {
    await dbRun(
      `UPDATE jobs SET
        firstTrackingViewAt = COALESCE(firstTrackingViewAt, ?),
        lastTrackingViewAt = ?,
        trackingViewCount = COALESCE(trackingViewCount, 0) + 1
       WHERE id = ?`,
      [now, now, req.params.id]
    );
  } catch {}
  res.json({ success: true });
});

// Complete a job — idempotent, records completedAt once
app.post('/jobs/:id/complete', async (req, res) => {
  const job = await dbGet('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
  if (!job) return res.status(404).json({ error: 'Not found' });

  // Already complete — return success without side effects
  if (job.status === 'complete') {
    return res.json({ success: true, alreadyComplete: true });
  }

  const now = new Date().toISOString();
  await dbRun("UPDATE jobs SET status = 'complete', completedAt = ? WHERE id = ?", [now, req.params.id]);

  if (job.companyId) {
    await dbRun("UPDATE drivers SET status = 'available' WHERE name = ? AND companyId = ?", [job.driverName, job.companyId]);
    if (job.truckRego) await dbRun("UPDATE trucks SET status = 'available' WHERE rego = ? AND companyId = ?", [job.truckRego, job.companyId]);
  }
  res.json({ success: true });
});

// Trial analytics — authenticated, scoped to company
app.get('/api/trial', requireAuth, async (req, res) => {
  const companyId = req.company.id;

  const stats = await dbGet(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN startedAt IS NOT NULL THEN 1 ELSE 0 END) as started,
      SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN firstTrackingViewAt IS NOT NULL THEN 1 ELSE 0 END) as trackingOpened,
      SUM(CASE WHEN firstLocationAt IS NOT NULL THEN 1 ELSE 0 END) as gotGps,
      SUM(CASE WHEN trackingSmsFailedAt IS NOT NULL AND trackingSmsSentAt IS NULL THEN 1 ELSE 0 END) as smsFailed
    FROM jobs WHERE companyId = ?
  `, [companyId]);

  const jobs = await dbAll(`
    SELECT
      id, loadDetails, driverName, customerName, status, jobType,
      createdAt, startedAt, completedAt,
      firstTrackingViewAt, lastTrackingViewAt, trackingViewCount,
      firstLocationAt, lastLocationAt, locationUpdateCount,
      trackingSmsSentAt, trackingSmsFailedAt, trackingSmsAttemptedAt,
      driverLinkOpenedAt, driverLinkOpenCount
    FROM jobs WHERE companyId = ?
    ORDER BY createdAt DESC
    LIMIT 100
  `, [companyId]);

  res.json({ stats, jobs });
});

app.get('/api/drivers', requireAuth, async (req, res) => {
  res.json(await dbAll('SELECT * FROM drivers WHERE companyId = ? ORDER BY name ASC', [req.company.id]));
});

app.post('/api/drivers', requireAuth, async (req, res) => {
  const { name, mobile, licenceClass } = req.body;
  const result = await dbRun('INSERT INTO drivers (companyId, name, mobile, licenceClass) VALUES (?, ?, ?, ?)', [req.company.id, name, mobile || null, licenceClass || null]);
  res.json({ id: Number(result.lastInsertRowid), name, mobile, licenceClass, status: 'available' });
});

app.delete('/api/drivers/:id', requireAuth, async (req, res) => {
  await dbRun('DELETE FROM drivers WHERE id = ? AND companyId = ?', [req.params.id, req.company.id]);
  res.json({ success: true });
});

app.get('/api/trucks', requireAuth, async (req, res) => {
  res.json(await dbAll('SELECT * FROM trucks WHERE companyId = ? ORDER BY rego ASC', [req.company.id]));
});

app.post('/api/trucks', requireAuth, async (req, res) => {
  const { rego, make, type } = req.body;
  const result = await dbRun('INSERT INTO trucks (companyId, rego, make, type) VALUES (?, ?, ?, ?)', [req.company.id, rego, make || null, type || null]);
  res.json({ id: Number(result.lastInsertRowid), rego, make, type, status: 'available' });
});

app.delete('/api/trucks/:id', requireAuth, async (req, res) => {
  await dbRun('DELETE FROM trucks WHERE id = ? AND companyId = ?', [req.params.id, req.company.id]);
  res.json({ success: true });
});

app.get('/api/clients', requireAuth, async (req, res) => {
  res.json(await dbAll(`
    SELECT customerMobile, customerName,
           COUNT(*) as totalJobs,
           SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as activeJobs,
           MAX(createdAt) as lastJob
    FROM jobs WHERE companyId = ?
    GROUP BY customerMobile
    ORDER BY lastJob DESC
  `, [req.company.id]));
});

app.get('/api/locations', requireAuth, async (req, res) => {
  res.json(await dbAll('SELECT * FROM locations WHERE companyId = ? ORDER BY name ASC', [req.company.id]));
});

app.post('/api/locations', requireAuth, async (req, res) => {
  const { name, address, lat, lng, type } = req.body;
  const result = await dbRun('INSERT INTO locations (companyId, name, address, lat, lng, type) VALUES (?, ?, ?, ?, ?, ?)', [req.company.id, name, address, lat || null, lng || null, type || 'farm']);
  res.json({ id: Number(result.lastInsertRowid), name, address, lat, lng, type });
});

app.delete('/api/locations/:id', requireAuth, async (req, res) => {
  await dbRun('DELETE FROM locations WHERE id = ? AND companyId = ?', [req.params.id, req.company.id]);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
initDb().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`Drova running at http://localhost:${PORT}`));
}).catch(err => {
  console.error('Failed to initialise database:', err);
  process.exit(1);
});
