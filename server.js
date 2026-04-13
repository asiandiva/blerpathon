const express = require('express');
const crypto = require('crypto');
const WebSocket = require('ws');
const axios = require('axios');
const app = express();

// ── CONFIG (set these in Glitch .env) ──
const CLIENT_ID     = process.env.CLIENT_ID     || 'dvsitq6ni6kjraglxa9z0kra8exfxe';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'nw8mb5d9x2qw30pb002qu1ko276nuj';
const SECRET        = process.env.WEBHOOK_SECRET || 'asiandiva_blerp_secret_2026';
const PORT          = process.env.PORT           || 3000;

let appAccessToken  = null;
let broadcasterId   = null;
let broadcasterName = null;

// ── WEBSOCKET SERVER ──
const wss = new WebSocket.Server({ noServer: true });
const clients = new Set();

wss.on('connection', ws => {
  clients.add(ws);
  console.log('Widget connected! Total clients:', clients.size);
  ws.send(JSON.stringify({ type: 'connected', message: 'Twitch EventSub connected!' }));
  ws.on('close', () => { clients.delete(ws); });
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

// ── GET APP ACCESS TOKEN ──
async function getAppToken() {
  try {
    const res = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'client_credentials'
      }
    });
    appAccessToken = res.data.access_token;
    console.log('✅ Got app access token');
    return appAccessToken;
  } catch (e) {
    console.error('❌ Failed to get token:', e.message);
  }
}

// ── GET BROADCASTER ID ──
async function getBroadcasterId(username) {
  try {
    const res = await axios.get('https://api.twitch.tv/helix/users', {
      params: { login: username },
      headers: {
        'Client-ID': CLIENT_ID,
        'Authorization': `Bearer ${appAccessToken}`
      }
    });
    if (res.data.data.length > 0) {
      broadcasterId = res.data.data[0].id;
      broadcasterName = res.data.data[0].display_name;
      console.log(`✅ Found broadcaster: ${broadcasterName} (${broadcasterId})`);
      return broadcasterId;
    }
  } catch (e) {
    console.error('❌ Failed to get broadcaster:', e.message);
  }
}

// ── DELETE OLD EVENTSUB SUBSCRIPTIONS ──
async function deleteOldSubscriptions() {
  try {
    const res = await axios.get('https://api.twitch.tv/helix/eventsub/subscriptions', {
      headers: {
        'Client-ID': CLIENT_ID,
        'Authorization': `Bearer ${appAccessToken}`
      }
    });
    for (const sub of res.data.data) {
      await axios.delete(`https://api.twitch.tv/helix/eventsub/subscriptions?id=${sub.id}`, {
        headers: {
          'Client-ID': CLIENT_ID,
          'Authorization': `Bearer ${appAccessToken}`
        }
      });
    }
    console.log('🧹 Cleared old subscriptions');
  } catch (e) {
    console.error('❌ Failed to clear subs:', e.message);
  }
}

// ── SUBSCRIBE TO EVENTSUB EVENTS ──
async function subscribeToEvents(callbackUrl) {
  const events = [
    { type: 'channel.subscribe',           version: '1', condition: { broadcaster_user_id: broadcasterId } },
    { type: 'channel.subscription.gift',   version: '1', condition: { broadcaster_user_id: broadcasterId } },
    { type: 'channel.subscription.message',version: '1', condition: { broadcaster_user_id: broadcasterId } },
    { type: 'channel.cheer',               version: '1', condition: { broadcaster_user_id: broadcasterId } },
  ];

  for (const event of events) {
    try {
      await axios.post('https://api.twitch.tv/helix/eventsub/subscriptions', {
        type: event.type,
        version: event.version,
        condition: event.condition,
        transport: {
          method: 'webhook',
          callback: `${callbackUrl}/webhook`,
          secret: SECRET
        }
      }, {
        headers: {
          'Client-ID': CLIENT_ID,
          'Authorization': `Bearer ${appAccessToken}`,
          'Content-Type': 'application/json'
        }
      });
      console.log(`✅ Subscribed to ${event.type}`);
    } catch (e) {
      console.error(`❌ Failed to subscribe to ${event.type}:`, e.response?.data || e.message);
    }
  }
}

// ── VERIFY TWITCH SIGNATURE ──
function verifySignature(req, rawBody) {
  const msgId        = req.headers['twitch-eventsub-message-id'];
  const timestamp    = req.headers['twitch-eventsub-message-timestamp'];
  const signature    = req.headers['twitch-eventsub-message-signature'];
  const hmac = 'sha256=' + crypto
    .createHmac('sha256', SECRET)
    .update(msgId + timestamp + rawBody)
    .digest('hex');
  return hmac === signature;
}

// ── PARSE RAW BODY FOR WEBHOOK ──
app.use('/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── SERVE WIDGET ──
app.use(express.static('public'));

// ── SETUP PAGE ──
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>asiandiva__ Blerp-A-thon Server</title>
  <style>
    body { font-family: sans-serif; background: #0d0618; color: #fff; padding: 2rem; text-align: center; }
    h1 { color: #FF6EB4; font-size: 2rem; }
    p { color: rgba(255,255,255,0.7); }
    .btn {
      display: inline-block; margin: 1rem; padding: 12px 28px;
      background: linear-gradient(135deg, #E0438A, #C084FC);
      color: #fff; border-radius: 999px; text-decoration: none;
      font-weight: 800; font-size: 14px; letter-spacing: 0.05em;
    }
    .card {
      background: rgba(255,255,255,0.06); border: 1px solid rgba(255,110,180,0.2);
      border-radius: 16px; padding: 1.5rem; max-width: 500px; margin: 2rem auto;
      text-align: left;
    }
    .status { color: ${broadcasterId ? '#4ade80' : '#FB923C'}; font-weight: 800; }
    code { background: rgba(255,255,255,0.1); padding: 3px 8px; border-radius: 6px; font-size: 13px; }
  </style>
</head>
<body>
  <h1>✦ asiandiva__ Blerp-A-thon Server ✦</h1>
  <div class="card">
    <p><strong>Status:</strong> <span class="status">${broadcasterId ? '✅ Connected to Twitch' : '⚠️ Not connected yet'}</span></p>
    ${broadcasterId ? `<p><strong>Channel:</strong> ${broadcasterName}</p>` : ''}
    <p><strong>Widget URL:</strong><br><code>${req.protocol}://${req.get('host')}/widget</code></p>
    <p><strong>WebSocket URL:</strong><br><code>wss://${req.get('host')}</code></p>
  </div>
  ${!broadcasterId ? `
  <div class="card">
    <h2 style="color:#FF6EB4">Connect to Twitch</h2>
    <form action="/setup" method="POST" style="display:flex;gap:8px;flex-direction:column;">
      <label>Your Twitch username:</label>
      <input name="username" placeholder="asiandiva__" style="padding:8px;border-radius:8px;border:none;font-size:14px;" />
      <button type="submit" style="padding:10px;background:linear-gradient(135deg,#E0438A,#C084FC);color:#fff;border:none;border-radius:8px;font-weight:800;cursor:pointer;">Connect ✦</button>
    </form>
  </div>` : `
  <div class="card">
    <h2 style="color:#4ade80">✅ All Set!</h2>
    <p>Add this URL to OBS as a Browser Source:</p>
    <code>${req.protocol}://${req.get('host')}/widget</code>
    <br/><br/>
    <p>Size: <strong>460 x 700</strong></p>
  </div>`}
</body>
</html>
  `);
});

// ── SETUP FORM HANDLER ──
app.post('/setup', async (req, res) => {
  const username = req.body.username?.toLowerCase().trim();
  if (!username) return res.redirect('/');

  // Force HTTPS — Render serves http internally but external is always https
  const host = req.get('host');
  const callbackUrl = `https://${host}`;

  // Show loading page immediately
  res.setHeader('Content-Type', 'text/html');
  res.write(`<!DOCTYPE html><html><head><title>Connecting...</title>
    <style>
      body{font-family:sans-serif;background:#0d0618;color:#fff;text-align:center;padding:3rem;}
      h2{color:#FF6EB4;font-size:1.8rem;}
      p{color:rgba(255,255,255,0.7);}
      .spinner{width:40px;height:40px;border:4px solid rgba(255,110,180,0.3);border-top-color:#FF6EB4;border-radius:50%;animation:spin 0.8s linear infinite;margin:1rem auto;}
      @keyframes spin{to{transform:rotate(360deg)}}
    </style></head><body>
    <h2>✦ Connecting to Twitch... ✦</h2>
    <div class="spinner"></div>
    <p>Registering events, please wait!</p>
    </body></html>`);

  await getAppToken();
  await getBroadcasterId(username);
  await deleteOldSubscriptions();
  await subscribeToEvents(callbackUrl);

  res.end(`<script>window.location='/'</script>`);
});

// ── EVENTSUB WEBHOOK ──
app.post('/webhook', (req, res) => {
  const rawBody = req.body.toString('utf8');
  
  if (!verifySignature(req, rawBody)) {
    console.log('❌ Invalid signature');
    return res.status(403).send('Forbidden');
  }

  const body = JSON.parse(rawBody);
  const msgType = req.headers['twitch-eventsub-message-type'];

  // Handle webhook verification challenge
  if (msgType === 'webhook_callback_verification') {
    console.log('✅ Webhook verified!');
    return res.status(200).send(body.challenge);
  }

  // Handle revocation
  if (msgType === 'revocation') {
    console.log('⚠️ Subscription revoked:', body.subscription.type);
    return res.status(204).send();
  }

  // Handle events
  if (msgType === 'notification') {
    const type = body.subscription.type;
    const event = body.event;
    console.log(`📣 Event: ${type}`, event);

    // ── SUBSCRIBER ──
    if (type === 'channel.subscribe') {
      broadcast({
        type: 'sub',
        tier: event.tier,
        name: event.user_name,
        gifted: event.is_gift
      });
    }

    // ── SUBSCRIPTION MESSAGE (resubs) ──
    if (type === 'channel.subscription.message') {
      broadcast({
        type: 'sub',
        tier: event.tier,
        name: event.user_name,
        gifted: false
      });
    }

    // ── GIFT SUBS ──
    if (type === 'channel.subscription.gift') {
      broadcast({
        type: 'giftsub',
        tier: event.tier,
        name: event.user_name,
        amount: event.total
      });
    }

    // ── BITS / CHEER ──
    if (type === 'channel.cheer') {
      broadcast({
        type: 'cheer',
        name: event.user_name,
        bits: event.bits
      });
    }
  }

  res.status(204).send();
});

// ── START SERVER ──
const server = app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// ── ATTACH WEBSOCKET TO HTTP SERVER ──
server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => {
    wss.emit('connection', ws, req);
  });
});
