const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage
const trades = [];

// Roblox API functions
async function getRobloxUser(username) {
  try {
    // Search for user
    const searchRes = await axios.get(`https://users.roblox.com/v1/users/search?keyword=${encodeURIComponent(username)}&limit=1`);
    
    if (!searchRes.data.data || searchRes.data.data.length === 0) {
      throw new Error('Roblox user not found');
    }
    
    const user = searchRes.data.data[0];
    const userId = user.id;
    
    // Get display name
    const displayRes = await axios.get(`https://users.roblox.com/v1/users/${userId}`);
    
    // Get avatar
    const avatarRes = await axios.get(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=150x150&format=Png`);
    
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

// API Routes

// Create a trade request
app.post('/api/trades', async (req, res) => {
  try {
    const { requesterId, requesterName, receiverRobloxUsername, itemsOffered, itemsRequested, message } = req.body;
    
    // Validate
    if (!requesterId || !receiverRobloxUsername || !itemsOffered || !itemsRequested) {
      return res.status(400).json({ error: 'Missing required fields' });
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
    res.status(201).json({ success: true, trade });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all active trades (for global display)
app.get('/api/trades', (req, res) => {
  const activeTrades = trades.filter(t => t.status === 'pending');
  activeTrades.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ success: true, trades: activeTrades });
});

// Get user's trades
app.get('/api/trades/user/:userId', (req, res) => {
  const userTrades = trades.filter(t => 
    t.requesterId === req.params.userId || 
    t.receiverInfo?.robloxId?.toString() === req.params.userId
  );
  res.json({ success: true, trades: userTrades });
});

// Update trade status (accept/decline)
app.put('/api/trades/:id', (req, res) => {
  const { status, userId } = req.body;
  const trade = trades.find(t => t.id === req.params.id);
  
  if (!trade) return res.status(404).json({ error: 'Trade not found' });
  if (trade.status !== 'pending') return res.status(400).json({ error: 'Trade already processed' });
  
  trade.status = status;
  trade.updatedAt = new Date().toISOString();
  res.json({ success: true, trade });
});

// Delete trade
app.delete('/api/trades/:id', (req, res) => {
  const { userId } = req.body;
  const index = trades.findIndex(t => t.id === req.params.id);
  
  if (index === -1) return res.status(404).json({ error: 'Trade not found' });
  if (trades[index].requesterId !== userId) return res.status(403).json({ error: 'Not authorized' });
  
  trades.splice(index, 1);
  res.json({ success: true });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', tradesCount: trades.length });
});

app.listen(PORT, () => {
  console.log(`Trade service running on port ${PORT}`);
});
