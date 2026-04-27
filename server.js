const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, 'trades.json');

let trades = [];

// Load trades
function loadTrades() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      trades = JSON.parse(data);
      console.log(`✅ Loaded ${trades.length} trades`);
    } else {
      fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
      console.log(`📁 Created trades file`);
    }
  } catch (error) {
    console.error('⚠️ Error loading trades:', error.message);
    trades = [];
  }
}

function saveTrades() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(trades, null, 2));
    console.log(`💾 Saved ${trades.length} trades`);
  } catch (error) {
    console.error('⚠️ Error saving trades:', error.message);
  }
}

// CORS - FIXED
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5500', 'https://echoknives.com'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.options('*', cors());

app.use(express.json({ limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ============= ROBLOX API =============
async function getRobloxUser(username) {
  try {
    console.log(`🔍 Fetching Roblox user: ${username}`);
    
    const searchRes = await axios.get(
      `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(username)}&limit=1`,
      { timeout: 15000 }
    );
    
    if (!searchRes.data.data || searchRes.data.data.length === 0) {
      throw new Error(`Roblox user "${username}" not found`);
    }
    
    const user = searchRes.data.data[0];
    const userId = user.id;
    
    let displayName = user.name;
    try {
      const displayRes = await axios.get(`https://users.roblox.com/v1/users/${userId}`, { timeout: 8000 });
      displayName = displayRes.data.displayName || user.name;
    } catch (e) {}
    
    let avatarUrl = null;
    try {
      const avatarRes = await axios.get(
        `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`,
        { timeout: 8000 }
      );
      avatarUrl = avatarRes.data.data[0]?.imageUrl || null;
    } catch (e) {}
    
    return {
      robloxId: userId,
      username: user.name,
      displayName: displayName,
      avatarUrl: avatarUrl,
      profileUrl: `https://www.roblox.com/users/${userId}/profile`
    };
  } catch (error) {
    throw new Error(`Failed to fetch Roblox user: ${error.message}`);
  }
}

// ============= ROUTES =============
app.get('/', (req, res) => {
  res.json({
    message: 'ECHOKNIVES Trade Service is running!',
    version: '1.0.0',
    status: 'online',
    active_trades: trades.filter(t => t.status === 'pending').length,
    total_trades: trades.length
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    active_trades: trades.filter(t => t.status === 'pending').length,
    total_trades: trades.length
  });
});

app.get('/api/trades', (req, res) => {
  const activeTrades = trades.filter(t => t.status === 'pending');
  activeTrades.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, count: activeTrades.length, trades: activeTrades });
});

app.get('/api/trades/all', (req, res) => {
  const allTrades = [...trades];
  allTrades.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, count: allTrades.length, trades: allTrades });
});

app.get('/api/trades/:id', (req, res) => {
  const trade = trades.find(t => t.id === req.params.id);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });
  res.json({ success: true, trade });
});

// CREATE TRADE - FIXED
app.post('/api/trades', async (req, res) => {
  try {
    const { requesterId, requesterName, requesterRobloxUsername, receiverRobloxUsername, itemsOffered, itemsRequested, message } = req.body;
    
    if (!requesterId) return res.status(400).json({ error: 'requesterId is required' });
    if (!receiverRobloxUsername) return res.status(400).json({ error: 'receiverRobloxUsername is required' });
    if (!itemsOffered || !Array.isArray(itemsOffered) || itemsOffered.length === 0) {
      return res.status(400).json({ error: 'itemsOffered is required' });
    }
    if (!itemsRequested || !Array.isArray(itemsRequested) || itemsRequested.length === 0) {
      return res.status(400).json({ error: 'itemsRequested is required' });
    }
    
    // Handle "any" receiver
    let receiverInfo = null;
    if (receiverRobloxUsername !== "any") {
      try {
        receiverInfo = await getRobloxUser(receiverRobloxUsername);
      } catch (error) {
        return res.status(404).json({ error: error.message });
      }
    } else {
      receiverInfo = { username: "any", displayName: "Any User", robloxId: "any" };
    }
    
    let requesterInfo = null;
    if (requesterRobloxUsername) {
      try {
        requesterInfo = await getRobloxUser(requesterRobloxUsername);
      } catch (error) {
        console.log(`⚠️ Could not fetch requester info: ${error.message}`);
      }
    }
    
    const trade = {
      id: Date.now().toString() + '-' + Math.random().toString(36).substring(2, 8),
      status: 'pending',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour expiry
      requesterId,
      requesterName: requesterName || 'Anonymous',
      requesterRobloxUsername: requesterRobloxUsername || null,
      requesterInfo,
      receiverRobloxUsername,
      receiverInfo,
      itemsOffered: itemsOffered.map(item => ({ name: item.name, value: Number(item.value) || 0, image: item.image })),
      itemsRequested: itemsRequested.map(item => ({ name: item.name, value: Number(item.value) || 0, image: item.image })),
      message: message || ''
    };
    
    trades.push(trade);
    saveTrades();
    console.log(`✅ Trade created: ${trade.id}`);
    
    res.status(201).json({ success: true, message: 'Trade created', trade });
  } catch (error) {
    console.error('Error creating trade:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE TRADE - FIXED
app.delete('/api/trades/:id', (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId is required' });
  
  const index = trades.findIndex(t => t.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Trade not found' });
  
  const trade = trades[index];
  if (trade.requesterId !== userId) {
    return res.status(403).json({ error: 'Only the requester can delete this trade' });
  }
  if (trade.status !== 'pending') {
    return res.status(400).json({ error: `Cannot delete trade that is ${trade.status}` });
  }
  
  trades.splice(index, 1);
  saveTrades();
  res.json({ success: true, message: 'Trade deleted' });
});

// Auto-cleanup expired trades
setInterval(() => {
  const now = new Date();
  const before = trades.length;
  trades = trades.filter(t => {
    if (t.status === 'pending' && new Date(t.expiresAt) < now) return false;
    return true;
  });
  if (before !== trades.length) {
    saveTrades();
    console.log(`🧹 Cleaned up ${before - trades.length} expired trades`);
  }
}, 60000); // Check every minute

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.path });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

loadTrades();

const server = app.listen(PORT, () => {
  console.log(`\n=================================`);
  console.log(`🚀 Trade Service running on port ${PORT}`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`✅ Health: http://localhost:${PORT}/health`);
  console.log(`=================================\n`);
});

process.on('SIGINT', () => { saveTrades(); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { saveTrades(); server.close(() => process.exit(0)); });
