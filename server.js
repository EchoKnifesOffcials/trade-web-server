const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

// In-memory storage
const trades = [];

// Middleware
app.use(cors());
app.use(express.json());

// ============= ROUTES =============

// Root route - THIS FIXES THE "Cannot GET /" ERROR
app.get('/', (req, res) => {
  res.json({
    message: 'Trade Service is running!',
    version: '1.0.0',
    endpoints: {
      'GET /': 'This help message',
      'GET /health': 'Check service status',
      'GET /api/trades': 'Get all active trades',
      'POST /api/trades': 'Create a new trade request',
      'GET /api/trades/user/:userId': 'Get trades by user ID',
      'GET /api/trades/:id': 'Get specific trade',
      'PUT /api/trades/:id': 'Accept or decline trade',
      'DELETE /api/trades/:id': 'Cancel trade'
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
    active_trades: trades.filter(t => t.status === 'pending').length,
    total_trades: trades.length
  });
});

// Roblox API function
async function getRobloxUser(username) {
  try {
    console.log(`Fetching Roblox user: ${username}`);
    
    const searchRes = await axios.get(
      `https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(username)}&limit=1`
    );
    
    if (!searchRes.data.data || searchRes.data.data.length === 0) {
      throw new Error(`Roblox user "${username}" not found`);
    }
    
    const user = searchRes.data.data[0];
    const userId = user.id;
    
    const displayRes = await axios.get(`https://users.roblox.com/v1/users/${userId}`);
    
    const avatarRes = await axios.get(
      `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`
    );
    
    return {
      robloxId: userId,
      username: user.name,
      displayName: displayRes.data.displayName || user.name,
      avatarUrl: avatarRes.data.data[0]?.imageUrl || null,
      profileUrl: `https://www.roblox.com/users/${userId}/profile`
    };
  } catch (error) {
    throw new Error(`Failed to fetch Roblox user: ${error.message}`);
  }
}

// CREATE a trade request
app.post('/api/trades', async (req, res) => {
  try {
    const {
      requesterId,
      requesterName,
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
    if (!itemsOffered || itemsOffered.length === 0) {
      return res.status(400).json({ error: 'itemsOffered is required' });
    }
    if (!itemsRequested || itemsRequested.length === 0) {
      return res.status(400).json({ error: 'itemsRequested is required' });
    }
    
    // Fetch Roblox info
    let receiverInfo;
    try {
      receiverInfo = await getRobloxUser(receiverRobloxUsername);
    } catch (error) {
      return res.status(404).json({ error: error.message });
    }
    
    // Create trade
    const trade = {
      id: Date.now().toString(),
      status: 'pending',
      createdAt: new Date().toISOString(),
      requesterId,
      requesterName: requesterName || 'Anonymous',
      receiverRobloxUsername,
      receiverInfo,
      itemsOffered,
      itemsRequested,
      message: message || ''
    };
    
    trades.push(trade);
    console.log(`✅ Trade created: ${trade.id}`);
    
    res.status(201).json({
      success: true,
      message: 'Trade request created successfully',
      trade
    });
    
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET all active trades (pending only)
app.get('/api/trades', (req, res) => {
  const activeTrades = trades.filter(t => t.status === 'pending');
  activeTrades.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  res.json({
    success: true,
    count: activeTrades.length,
    trades: activeTrades
  });
});

// GET trades by user ID
app.get('/api/trades/user/:userId', (req, res) => {
  const { userId } = req.params;
  const userTrades = trades.filter(t => 
    t.requesterId === userId || 
    (t.receiverInfo?.robloxId?.toString() === userId)
  );
  
  res.json({
    success: true,
    count: userTrades.length,
    trades: userTrades
  });
});

// GET single trade by ID
app.get('/api/trades/:id', (req, res) => {
  const trade = trades.find(t => t.id === req.params.id);
  
  if (!trade) {
    return res.status(404).json({ error: 'Trade not found' });
  }
  
  res.json({ success: true, trade });
});

// UPDATE trade status (accept/decline)
app.put('/api/trades/:id', (req, res) => {
  const { status, userId } = req.body;
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
  
  if (trade.requesterId !== userId) {
    return res.status(403).json({ error: 'Only the requester can cancel this trade' });
  }
  
  if (trade.status !== 'pending') {
    return res.status(400).json({ error: `Cannot cancel trade that is already ${trade.status}` });
  }
  
  trades.splice(index, 1);
  
  res.json({
    success: true,
    message: 'Trade cancelled successfully'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n=================================`);
  console.log(`🚀 Trade Service is running!`);
  console.log(`=================================`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`✅ Test: http://localhost:${PORT}/health`);
  console.log(`📋 API Docs: http://localhost:${PORT}/`);
  console.log(`=================================\n`);
});
