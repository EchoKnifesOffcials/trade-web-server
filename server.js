// server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const WebSocket = require('ws');
const http = require('http');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3001;

// Data persistence with file storage
const DATA_FILE = path.join(__dirname, 'trades.json');

// Initialize or load trades from file
let trades = [];
let connectedClients = new Map();

function loadTrades() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      trades = JSON.parse(data);
      console.log(`📀 Loaded ${trades.length} trades from storage`);
    }
  } catch (error) {
    console.error('Error loading trades:', error.message);
    trades = [];
  }
}

function saveTrades() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(trades, null, 2));
    console.log(`💾 Saved ${trades.length} trades to storage`);
  } catch (error) {
    console.error('Error saving trades:', error.message);
  }
}

// Load existing trades on startup
loadTrades();

// Middleware
app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://echoknives.com'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);

// ============= WEBSOCKET CONNECTION =============
wss.on('connection', (ws, req) => {
  const clientId = uuidv4();
  connectedClients.set(clientId, ws);
  console.log(`🔌 WebSocket client connected: ${clientId} (Total: ${connectedClients.size})`);

  // Send initial connection confirmation
  ws.send(JSON.stringify({
    type: 'connection',
    clientId,
    message: 'Connected to trade service',
    timestamp: new Date().toISOString()
  }));

  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log(`📨 Received message from ${clientId}:`, message.type);

      switch (message.type) {
        case 'subscribe':
          // Subscribe to trade updates for a specific user
          ws.userId = message.userId;
          console.log(`👤 Client ${clientId} subscribed to user ${message.userId}`);
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
          break;

        default:
          console.log(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('WebSocket message error:', error.message);
    }
  });

  ws.on('close', () => {
    connectedClients.delete(clientId);
    console.log(`🔌 WebSocket client disconnected: ${clientId} (Remaining: ${connectedClients.size})`);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for ${clientId}:`, error.message);
  });
});

// Broadcast trade update to relevant clients
function broadcastTradeUpdate(trade, action) {
  const message = JSON.stringify({
    type: 'trade_update',
    action,
    trade,
    timestamp: new Date().toISOString()
  });

  connectedClients.forEach((client, clientId) => {
    if (client.readyState === WebSocket.OPEN) {
      // Send to clients subscribed to either party
      if (!client.userId || 
          client.userId === trade.requesterId || 
          client.userId === trade.receiverInfo?.robloxId?.toString()) {
        client.send(message);
      }
    }
  });
}

// ============= ROBLOX API FUNCTIONS (Enhanced) =============
async function getRobloxUser(username) {
  try {
    console.log(`🔍 Fetching Roblox user: ${username}`);
    
    // Search for user by username
    const searchRes = await axios.get(
      `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(username)}&limit=1`,
      { timeout: 5000 }
    );
    
    if (!searchRes.data.data || searchRes.data.data.length === 0) {
      throw new Error(`Roblox user "${username}" not found. Please check the spelling.`);
    }
    
    const user = searchRes.data.data[0];
    const userId = user.id;
    
    // Get user details
    const displayRes = await axios.get(`https://users.roblox.com/v1/users/${userId}`, { timeout: 5000 });
    
    // Get avatar headshot
    const avatarRes = await axios.get(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`,
      { timeout: 5000 }
    );
    
    // Get user presence (online status)
    let presence = 'offline';
    try {
      const presenceRes = await axios.post('https://presence.roblox.com/v1/presence/users', 
        { userIds: [userId] },
        { timeout: 3000 }
      );
      if (presenceRes.data.userPresences && presenceRes.data.userPresences[0]) {
        const presenceType = presenceRes.data.userPresences[0].userPresenceType;
        presence = presenceType === 1 ? 'online' : presenceType === 2 ? 'in-game' : 'offline';
      }
    } catch (e) {
      // Presence fetch is optional, don't fail the whole request
      console.log(`⚠️ Could not fetch presence for ${username}`);
    }
    
    // Get user's join date
    let joinDate = null;
    try {
      const creationRes = await axios.get(`https://users.roblox.com/v1/users/${userId}`, { timeout: 3000 });
      joinDate = creationRes.data.created;
    } catch (e) {
      console.log(`⚠️ Could not fetch join date for ${username}`);
    }
    
    return {
      robloxId: userId,
      username: user.name,
      displayName: displayRes.data.displayName || user.name,
      avatarUrl: avatarRes.data.data[0]?.imageUrl || `https://www.roblox.com/headshot-thumbnail/image?userId=${userId}&width=150&height=150&format=png`,
      profileUrl: `https://www.roblox.com/users/${userId}/profile`,
      presence,
      joinDate,
      verified: true
    };
  } catch (error) {
    if (error.response?.status === 429) {
      throw new Error('Rate limited. Please try again in a few seconds.');
    }
    throw new Error(`Failed to fetch Roblox user: ${error.message}`);
  }
}

// Enhanced function to get multiple items values
async function getItemValues(items) {
  // You can integrate with MM2 value APIs here
  // For now, returns mock values
  const mockValues = {
    'Batwing': 140,
    'Harvester': 500,
    'Icewing': 80,
    'Luger': 165,
    'Candy': 249,
    'Shark': 110,
    'Darkbringer': 140,
    'Lightbringer': 140
  };
  
  return items.map(item => ({
    name: item,
    value: mockValues[item] || 50,
    source: 'echoknives-db'
  }));
}

// ============= ROUTES =============

// Root route - API Documentation
app.get('/', (req, res) => {
  res.json({
    message: 'ECHOKNIVES Trade Service is running!',
    version: '1.0.0',
    status: 'operational',
    endpoints: {
      'GET /': 'This help message',
      'GET /health': 'Check service status',
      'GET /api/stats': 'Get service statistics',
      'GET /api/trades': 'Get all active trades',
      'GET /api/trades/all': 'Get all trades (including completed)',
      'POST /api/trades': 'Create a new trade request',
      'GET /api/trades/user/:userId': 'Get trades by user ID',
      'GET /api/trades/:id': 'Get specific trade',
      'PUT /api/trades/:id': 'Accept or decline trade',
      'DELETE /api/trades/:id': 'Cancel trade',
      'POST /api/verify-roblox': 'Verify Roblox username',
      'GET /api/item-values': 'Get item values database',
      'GET /api/trades/history/:userId': 'Get trade history for user'
    },
    active_trades: trades.filter(t => t.status === 'pending').length,
    total_trades: trades.length,
    websocket: `ws://localhost:${PORT}`
  });
});

// Health check route
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'ECHOKNIVES Trade Service',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    active_trades: trades.filter(t => t.status === 'pending').length,
    total_trades: trades.length,
    websocket_clients: connectedClients.size
  });
});

// Service statistics
app.get('/api/stats', (req, res) => {
  const pendingTrades = trades.filter(t => t.status === 'pending');
  const acceptedTrades = trades.filter(t => t.status === 'accepted');
  const declinedTrades = trades.filter(t => t.status === 'declined');
  
  // Calculate total trade value
  let totalValue = 0;
  trades.forEach(trade => {
    if (trade.itemsOffered) {
      trade.itemsOffered.forEach(item => {
        totalValue += item.value || 0;
      });
    }
  });
  
  res.json({
    success: true,
    stats: {
      total_trades: trades.length,
      pending_trades: pendingTrades.length,
      accepted_trades: acceptedTrades.length,
      declined_trades: declinedTrades.length,
      total_trade_value: totalValue,
      unique_traders: new Set(trades.map(t => t.requesterId)).size,
      websocket_connections: connectedClients.size,
      last_updated: new Date().toISOString()
    }
  });
});

// Get all active trades (pending only)
app.get('/api/trades', (req, res) => {
  const activeTrades = trades.filter(t => t.status === 'pending');
  activeTrades.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  res.json({
    success: true,
    count: activeTrades.length,
    trades: activeTrades
  });
});

// Get ALL trades (including completed)
app.get('/api/trades/all', (req, res) => {
  const allTrades = [...trades];
  allTrades.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  res.json({
    success: true,
    count: allTrades.length,
    trades: allTrades
  });
});

// Get trades by user ID (both as requester and receiver)
app.get('/api/trades/user/:userId', (req, res) => {
  const { userId } = req.params;
  const userTrades = trades.filter(t => 
    t.requesterId === userId || 
    (t.receiverInfo?.robloxId?.toString() === userId)
  );
  
  userTrades.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  res.json({
    success: true,
    count: userTrades.length,
    trades: userTrades
  });
});

// Get trade history for user
app.get('/api/trades/history/:userId', (req, res) => {
  const { userId } = req.params;
  const completedTrades = trades.filter(t => 
    (t.requesterId === userId || (t.receiverInfo?.robloxId?.toString() === userId)) &&
    t.status !== 'pending'
  );
  
  completedTrades.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  
  res.json({
    success: true,
    count: completedTrades.length,
    trades: completedTrades
  });
});

// Get single trade by ID
app.get('/api/trades/:id', (req, res) => {
  const trade = trades.find(t => t.id === req.params.id);
  
  if (!trade) {
    return res.status(404).json({ error: 'Trade not found' });
  }
  
  res.json({ success: true, trade });
});

// Verify Roblox username (without creating trade)
app.post('/api/verify-roblox', async (req, res) => {
  const { username } = req.body;
  
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }
  
  try {
    const userInfo = await getRobloxUser(username);
    res.json({
      success: true,
      user: userInfo
    });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// Get item values database
app.get('/api/item-values', async (req, res) => {
  const itemNames = [
    'Batwing', 'Harvester', 'Icewing', 'Luger', 'Candy', 'Shark',
    'Darkbringer', 'Lightbringer', 'Icebreaker', 'Ice Piercer', 'Sunset', 'Sunrise'
  ];
  
  try {
    const values = await getItemValues(itemNames);
    res.json({
      success: true,
      items: values,
      source: 'echoknives-database'
    });
  } catch (error) {
    // Fallback values
    const fallbackValues = {
      'Batwing': 140, 'Harvester': 500, 'Icewing': 80, 'Luger': 165,
      'Candy': 249, 'Shark': 110, 'Darkbringer': 140, 'Lightbringer': 140,
      'Icebreaker': 255, 'Ice Piercer': 365, 'Sunset': 430, 'Sunrise': 799
    };
    
    res.json({
      success: true,
      items: itemNames.map(name => ({ name, value: fallbackValues[name] || 50, source: 'fallback' })),
      note: 'Using fallback values'
    });
  }
});

// CREATE a trade request (Enhanced)
app.post('/api/trades', async (req, res) => {
  try {
    const {
      requesterId,
      requesterName,
      requesterRobloxUsername,
      receiverRobloxUsername,
      itemsOffered,
      itemsRequested,
      message
    } = req.body;
    
    // Enhanced validation
    if (!requesterId) {
      return res.status(400).json({ error: 'requesterId is required' });
    }
    if (!receiverRobloxUsername) {
      return res.status(400).json({ error: 'receiverRobloxUsername is required' });
    }
    if (!itemsOffered || itemsOffered.length === 0) {
      return res.status(400).json({ error: 'itemsOffered is required (at least one item)' });
    }
    if (!itemsRequested || itemsRequested.length === 0) {
      return res.status(400).json({ error: 'itemsRequested is required (at least one item)' });
    }
    
    // Check if requester is trying to trade with themselves
    if (requesterRobloxUsername && requesterRobloxUsername.toLowerCase() === receiverRobloxUsername.toLowerCase()) {
      return res.status(400).json({ error: 'You cannot trade with yourself' });
    }
    
    // Fetch receiver's Roblox info
    let receiverInfo;
    try {
      receiverInfo = await getRobloxUser(receiverRobloxUsername);
    } catch (error) {
      return res.status(404).json({ error: error.message });
    }
    
    // Fetch requester's Roblox info if provided
    let requesterInfo = null;
    if (requesterRobloxUsername) {
      try {
        requesterInfo = await getRobloxUser(requesterRobloxUsername);
      } catch (error) {
        console.log(`⚠️ Could not fetch requester Roblox info: ${error.message}`);
      }
    }
    
    // Calculate total values
    const offeredTotalValue = itemsOffered.reduce((sum, item) => sum + (item.value || 0), 0);
    const requestedTotalValue = itemsRequested.reduce((sum, item) => sum + (item.value || 0), 0);
    const valueDifference = offeredTotalValue - requestedTotalValue;
    const isFair = Math.abs(valueDifference) / Math.max(offeredTotalValue, requestedTotalValue) <= 0.1;
    
    // Create trade with unique ID
    const trade = {
      id: uuidv4(),
      status: 'pending',
      createdAt: new Date().toISOString(),
      requesterId,
      requesterName: requesterName || 'Anonymous',
      requesterRobloxUsername: requesterRobloxUsername || null,
      requesterInfo,
      receiverRobloxUsername,
      receiverInfo,
      itemsOffered: itemsOffered.map(item => ({
        ...item,
        addedAt: new Date().toISOString()
      })),
      itemsRequested: itemsRequested.map(item => ({
        ...item,
        addedAt: new Date().toISOString()
      })),
      offeredTotalValue,
      requestedTotalValue,
      valueDifference,
      isFair,
      message: message || '',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days expiry
    };
    
    trades.push(trade);
    saveTrades(); // Persist to disk
    
    // Broadcast to connected clients
    broadcastTradeUpdate(trade, 'created');
    
    console.log(`✅ Trade created: ${trade.id} (${itemsOffered.length} items → ${itemsRequested.length} items)`);
    
    res.status(201).json({
      success: true,
      message: 'Trade request created successfully',
      trade
    });
    
  } catch (error) {
    console.error('Error creating trade:', error);
    res.status(500).json({ error: error.message });
  }
});

// UPDATE trade status (accept/decline)
app.put('/api/trades/:id', (req, res) => {
  const { status, userId, notes } = req.body;
  const trade = trades.find(t => t.id === req.params.id);
  
  if (!trade) {
    return res.status(404).json({ error: 'Trade not found' });
  }
  
  if (trade.status !== 'pending') {
    return res.status(400).json({ error: `Trade already ${trade.status}` });
  }
  
  // Check if user is the recipient
  if (trade.receiverInfo?.robloxId?.toString() !== userId) {
    return res.status(403).json({ error: 'Only the recipient can respond to this trade' });
  }
  
  if (!['accepted', 'declined'].includes(status)) {
    return res.status(400).json({ error: 'Status must be "accepted" or "declined"' });
  }
  
  trade.status = status;
  trade.updatedAt = new Date().toISOString();
  trade.respondedBy = userId;
  if (notes) trade.responseNotes = notes;
  
  saveTrades(); // Persist to disk
  
  // Broadcast update
  broadcastTradeUpdate(trade, status);
  
  console.log(`📝 Trade ${trade.id} ${status} by ${userId}`);
  
  res.json({
    success: true,
    message: `Trade ${status}`,
    trade
  });
});

// DELETE/cancel trade
app.delete('/api/trades/:id', (req, res) => {
  const { userId } = req.body;
  const index = trades.findIndex(t => t.id === req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Trade not found' });
  }
  
  const trade = trades[index];
  
  // Allow requester or admin to cancel
  if (trade.requesterId !== userId && !req.headers['x-admin-key']) {
    return res.status(403).json({ error: 'Only the requester can cancel this trade' });
  }
  
  if (trade.status !== 'pending') {
    return res.status(400).json({ error: `Cannot cancel trade that is already ${trade.status}` });
  }
  
  trades.splice(index, 1);
  saveTrades(); // Persist to disk
  
  // Broadcast removal
  broadcastTradeUpdate(trade, 'cancelled');
  
  console.log(`🗑️ Trade ${trade.id} cancelled by ${userId}`);
  
  res.json({
    success: true,
    message: 'Trade cancelled successfully'
  });
});

// Bulk cleanup - Remove expired trades (can be called via cron job)
app.post('/api/admin/cleanup', (req, res) => {
  const now = new Date();
  const beforeCount = trades.length;
  
  const remainingTrades = trades.filter(trade => {
    if (trade.status === 'pending' && new Date(trade.expiresAt) < now) {
      return false; // Remove expired pending trades
    }
    return true;
  });
  
  const removedCount = beforeCount - remainingTrades.length;
  trades.length = 0;
  trades.push(...remainingTrades);
  saveTrades();
  
  res.json({
    success: true,
    removed: removedCount,
    remaining: trades.length
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`\n=================================`);
  console.log(`🚀 ECHOKNIVES Trade Service is running!`);
  console.log(`=================================`);
  console.log(`📡 HTTP URL: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket URL: ws://localhost:${PORT}`);
  console.log(`✅ Test: http://localhost:${PORT}/health`);
  console.log(`📋 API Docs: http://localhost:${PORT}/`);
  console.log(`💾 Data file: ${DATA_FILE}`);
  console.log(`=================================\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Saving trades before shutdown...');
  saveTrades();
  console.log('👋 Trade service shutting down');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Saving trades before shutdown...');
  saveTrades();
  console.log('👋 Trade service shutting down');
  process.exit(0);
});
