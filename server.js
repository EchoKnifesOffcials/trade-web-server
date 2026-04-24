const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

// In-memory storage with file backup (creates file if doesn't exist)
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'trades.json');

// Initialize trades array
let trades = [];

// Load trades from file if exists
function loadTrades() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const data = fs.readFileSync(DATA_FILE, 'utf8');
      trades = JSON.parse(data);
      console.log(`✅ Loaded ${trades.length} trades from storage`);
    } else {
      // Create empty trades file
      fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
      console.log(`📁 Created new trades storage file`);
    }
  } catch (error) {
    console.error('⚠️ Error loading trades:', error.message);
    trades = [];
  }
}

// Save trades to file
function saveTrades() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(trades, null, 2));
    console.log(`💾 Saved ${trades.length} trades to storage`);
  } catch (error) {
    console.error('⚠️ Error saving trades:', error.message);
  }
}

// Load existing trades on startup
loadTrades();

// Middleware
app.use(cors());
app.use(express.json());

// Simple request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// ============= ROBLOX API FUNCTIONS =============

async function getRobloxUser(username) {
  try {
    console.log(`🔍 Fetching Roblox user: ${username}`);
    
    // First, search for the user
    const searchRes = await axios.get(
      `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(username)}&limit=1`,
      { timeout: 10000 }
    );
    
    if (!searchRes.data.data || searchRes.data.data.length === 0) {
      throw new Error(`Roblox user "${username}" not found`);
    }
    
    const user = searchRes.data.data[0];
    const userId = user.id;
    
    // Get user details
    let displayName = user.name;
    try {
      const displayRes = await axios.get(`https://users.roblox.com/v1/users/${userId}`, { timeout: 5000 });
      displayName = displayRes.data.displayName || user.name;
    } catch (e) {
      // Use username as fallback
    }
    
    // Get avatar
    let avatarUrl = null;
    try {
      const avatarRes = await axios.get(
        `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`,
        { timeout: 5000 }
      );
      avatarUrl = avatarRes.data.data[0]?.imageUrl || null;
    } catch (e) {
      // No avatar fallback
    }
    
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

// Root route - API documentation
app.get('/', (req, res) => {
  res.json({
    message: 'ECHOKNIVES Trade Service is running!',
    version: '1.0.0',
    status: 'online',
    endpoints: {
      'GET /': 'This help message',
      'GET /health': 'Check service status',
      'GET /api/trades': 'Get all active trades',
      'GET /api/trades/all': 'Get all trades (including completed)',
      'GET /api/trades/user/:userId': 'Get trades by user ID',
      'GET /api/trades/:id': 'Get specific trade',
      'POST /api/trades': 'Create a new trade request',
      'PUT /api/trades/:id': 'Accept or decline trade',
      'DELETE /api/trades/:id': 'Cancel trade',
      'POST /api/verify-roblox': 'Verify Roblox username'
    },
    active_trades: trades.filter(t => t.status === 'pending').length,
    total_trades: trades.length
  });
});

// Health check route
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'Trade Service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    active_trades: trades.filter(t => t.status === 'pending').length,
    total_trades: trades.length,
    memory_usage: process.memoryUsage().rss / 1024 / 1024 + ' MB'
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

// Get trades by user ID
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
  
  if (typeof username !== 'string' || username.trim().length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  
  try {
    const userInfo = await getRobloxUser(username.trim());
    res.json({
      success: true,
      user: userInfo
    });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// CREATE a trade request
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
    
    // Validation
    if (!requesterId) {
      return res.status(400).json({ error: 'requesterId is required' });
    }
    
    if (!receiverRobloxUsername) {
      return res.status(400).json({ error: 'receiverRobloxUsername is required' });
    }
    
    if (!itemsOffered || !Array.isArray(itemsOffered) || itemsOffered.length === 0) {
      return res.status(400).json({ error: 'itemsOffered is required (at least one item)' });
    }
    
    if (!itemsRequested || !Array.isArray(itemsRequested) || itemsRequested.length === 0) {
      return res.status(400).json({ error: 'itemsRequested is required (at least one item)' });
    }
    
    // Prevent self-trade
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
        console.log(`⚠️ Could not fetch requester info: ${error.message}`);
      }
    }
    
    // Calculate total values
    const offeredTotalValue = itemsOffered.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
    const requestedTotalValue = itemsRequested.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
    const valueDifference = offeredTotalValue - requestedTotalValue;
    const percentDifference = Math.max(offeredTotalValue, requestedTotalValue) > 0 
      ? (Math.abs(valueDifference) / Math.max(offeredTotalValue, requestedTotalValue)) * 100 
      : 0;
    const isFair = percentDifference <= 10;
    
    // Create trade with unique ID
    const trade = {
      id: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 6),
      status: 'pending',
      createdAt: new Date().toISOString(),
      requesterId,
      requesterName: requesterName || 'Anonymous',
      requesterRobloxUsername: requesterRobloxUsername || null,
      requesterInfo,
      receiverRobloxUsername,
      receiverInfo,
      itemsOffered: itemsOffered.map(item => ({
        name: item.name,
        value: Number(item.value) || 0,
        image: item.image || null
      })),
      itemsRequested: itemsRequested.map(item => ({
        name: item.name,
        value: Number(item.value) || 0,
        image: item.image || null
      })),
      offeredTotalValue,
      requestedTotalValue,
      valueDifference,
      percentDifference: Math.round(percentDifference),
      isFair,
      message: message || '',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    };
    
    trades.push(trade);
    saveTrades();
    
    console.log(`✅ Trade created: ${trade.id}`);
    
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
  
  // Check if user is the recipient or requester (for cancelling)
  const isRecipient = trade.receiverInfo?.robloxId?.toString() === userId;
  const isRequester = trade.requesterId === userId;
  
  if (status === 'cancelled') {
    if (!isRequester) {
      return res.status(403).json({ error: 'Only the requester can cancel this trade' });
    }
    trade.status = 'cancelled';
    trade.cancelledAt = new Date().toISOString();
  } else if (status === 'accepted' || status === 'declined') {
    if (!isRecipient) {
      return res.status(403).json({ error: 'Only the recipient can respond to this trade' });
    }
    trade.status = status;
    trade.respondedAt = new Date().toISOString();
    if (notes) trade.responseNotes = notes;
  } else {
    return res.status(400).json({ error: 'Invalid status. Use "accepted", "declined", or "cancelled"' });
  }
  
  trade.updatedAt = new Date().toISOString();
  saveTrades();
  
  console.log(`📝 Trade ${trade.id} ${status} by ${userId}`);
  
  res.json({
    success: true,
    message: `Trade ${status}`,
    trade
  });
});

// DELETE/cancel trade (alternative endpoint)
app.delete('/api/trades/:id', (req, res) => {
  const { userId } = req.body;
  const index = trades.findIndex(t => t.id === req.params.id);
  
  if (index === -1) {
    return res.status(404).json({ error: 'Trade not found' });
  }
  
  const trade = trades[index];
  
  if (trade.requesterId !== userId) {
    return res.status(403).json({ error: 'Only the requester can cancel this trade' });
  }
  
  if (trade.status !== 'pending') {
    return res.status(400).json({ error: `Cannot cancel trade that is already ${trade.status}` });
  }
  
  trades.splice(index, 1);
  saveTrades();
  
  console.log(`🗑️ Trade ${trade.id} deleted by ${userId}`);
  
  res.json({
    success: true,
    message: 'Trade cancelled successfully'
  });
});

// 404 handler for undefined routes
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: err.message 
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`\n=================================`);
  console.log(`🚀 ECHOKNIVES Trade Service is running!`);
  console.log(`=================================`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`✅ Test: http://localhost:${PORT}/health`);
  console.log(`📋 API Docs: http://localhost:${PORT}/`);
  console.log(`💾 Data file: ${DATA_FILE}`);
  console.log(`=================================\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Saving trades before shutdown...');
  saveTrades();
  server.close(() => {
    console.log('👋 Trade service shut down gracefully');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Saving trades before shutdown...');
  saveTrades();
  server.close(() => {
    console.log('👋 Trade service shut down gracefully');
    process.exit(0);
  });
});
