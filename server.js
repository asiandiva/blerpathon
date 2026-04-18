const express = require('express');
const crypto = require('crypto');
const WebSocket = require('ws');
const axios = require('axios');
const app = express();

// ── CONFIG ──
const CLIENT_ID     = process.env.CLIENT_ID      || 'dvsitq6ni6kjraglxa9z0kra8exfxe';
const CLIENT_SECRET = process.env.CLIENT_SECRET  || 'nw8mb5d9x2qw30pb002qu1ko276nuj';
const SECRET        = process.env.WEBHOOK_SECRET  || 'asiandiva_blerp_secret_2026';
const PORT          = process.env.PORT            || 10000;
const SCOPES        = 'bits:read channel:read:subscriptions';

let appAccessToken  = null;
let userAccessToken = null;
let broadcasterId   = null;
let broadcasterName = null;

// ── WEBSOCKET SERVER ──
const wss = new WebSocket.Server({ noServer: true });
const clients = new Set();

wss.on('connection', ws => {
  clients.add(ws);
  console.log('Client connected! Total clients:', clients.size);
  ws.send(JSON.stringify({ type: 'connected', message: 'Twitch EventSub connected!' }));

  // Forward cmd and state messages to all other connected clients
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      if (data.type === 'cmd' || data.type === 'state') {
        console.log('Forwarding message type:', data.type, 'action:', data.action || '');
        clients.forEach(client => {
          if (client !== ws && client.readyState === 1) {
            client.send(msg.toString());
          }
        });
      }
    } catch(e) { console.warn('Message parse error:', e.message); }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log('Client disconnected! Total clients:', clients.size);
  });
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

// Explicit widget route
app.get('/widget', (req, res) => {
  res.sendFile('widget.html', { root: 'public' });
});

// Explicit modpanel route
app.get('/modpanel', (req, res) => {
  res.sendFile('modpanel.html', { root: 'public' });
});

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
    <p>Click below to authorize with your Twitch account:</p>
    <a class="btn" href="/auth/twitch">🟣 Login with Twitch</a>
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

// ── TWITCH OAUTH ──
app.get('/auth/twitch', (req, res) => {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: `https://${req.get('host')}/auth/callback`,
    response_type: 'code',
    scope: SCOPES,
    force_verify: 'true'
  });
  res.redirect(`https://id.twitch.tv/oauth2/authorize?${params}`);
});

app.get('/auth/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) return res.redirect('/');
  try {
    const tokenRes = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `https://${req.get('host')}/auth/callback`
      }
    });
    userAccessToken = tokenRes.data.access_token;

    // Get broadcaster info using user token
    const userRes = await axios.get('https://api.twitch.tv/helix/users', {
      headers: { 'Client-ID': CLIENT_ID, 'Authorization': `Bearer ${userAccessToken}` }
    });
    broadcasterId   = userRes.data.data[0].id;
    broadcasterName = userRes.data.data[0].display_name;
    console.log(`✅ OAuth authorized for ${broadcasterName} (ID: ${broadcasterId})`);

    // Get app token for EventSub subscriptions
    await getAppToken();

    // Subscribe to events using app token
    const callbackUrl = `https://${req.get('host')}`;
    await deleteOldSubscriptions();
    await subscribeToEvents(callbackUrl);

    res.redirect('/');
  } catch(e) {
    console.error('OAuth error:', e.response?.data || e.message);
    res.redirect('/');
  }
});

// ── SETUP FORM HANDLER ──
app.post('/setup', async (req, res) => {
  try {
    const username = (req.body.username || '').toLowerCase().trim();
    console.log('Setup request for username:', username);
    if (!username) return res.redirect('/');

    const host = req.get('host');
    const callbackUrl = `https://${host}`;
    console.log('Callback URL:', callbackUrl);

    await getAppToken();
    await getBroadcasterId(username);
    await deleteOldSubscriptions();
    await subscribeToEvents(callbackUrl);

    console.log('Setup complete! Redirecting...');
    res.redirect('/');
  } catch(e) {
    console.error('Setup error:', e.message);
    res.status(500).send(`<html><body style="background:#0d0618;color:#fff;font-family:sans-serif;text-align:center;padding:3rem;">
      <h2 style="color:#FF6EB4">❌ Error connecting</h2>
      <p>${e.message}</p>
      <a href="/" style="color:#C084FC">← Try again</a>
    </body></html>`);
  }
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
const server = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// ── ATTACH WEBSOCKET TO HTTP SERVER ──
server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, ws => {
    wss.emit('connection', ws, req);
  });
});
