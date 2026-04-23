const TradeModel = require('../models/Trade');

const tradeController = {
  // Create a new trade record
  async recordTrade(req, res) {
    try {
      const {
        userId,
        userEmail,
        itemId,
        itemName,
        quantity,
        price,
        totalAmount,
        paymentMethod,
        transactionId
      } = req.body;

      // Validation
      if (!userId || !itemId || !quantity || !totalAmount) {
        return res.status(400).json({
          error: 'Missing required fields',
          required: ['userId', 'itemId', 'quantity', 'totalAmount']
        });
      }

      const tradeData = {
        userId,
        userEmail: userEmail || null,
        itemId,
        itemName: itemName || 'Unknown Item',
        quantity,
        price: price || totalAmount / quantity,
        totalAmount,
        paymentMethod: paymentMethod || 'unknown',
        transactionId: transactionId || `TXN_${Date.now()}`,
        source: 'echoknives.shop'
      };

      const newTrade = TradeModel.createTrade(tradeData);
      
      res.status(201).json({
        success: true,
        message: 'Trade recorded successfully',
        trade: newTrade
      });
    } catch (error) {
      console.error('Error recording trade:', error);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  },

  // Get all trades
  async getAllTrades(req, res) {
    try {
      const trades = TradeModel.getAllTrades();
      res.status(200).json({
        success: true,
        count: trades.length,
        trades
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Get trade by ID
  async getTradeById(req, res) {
    try {
      const { id } = req.params;
      const trade = TradeModel.getTradeById(id);
      
      if (!trade) {
        return res.status(404).json({ error: 'Trade not found' });
      }
      
      res.status(200).json({ success: true, trade });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Get trades by user
  async getTradesByUser(req, res) {
    try {
      const { userId } = req.params;
      const trades = TradeModel.getTradesByUser(userId);
      
      res.status(200).json({
        success: true,
        count: trades.length,
        trades
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  },

  // Update trade status
  async updateTradeStatus(req, res) {
    try {
      const { id } = req.params;
      const { status } = req.body;
      
      const updatedTrade = TradeModel.updateTradeStatus(id, status);
      
      if (!updatedTrade) {
        return res.status(404).json({ error: 'Trade not found' });
      }
      
      res.status(200).json({
        success: true,
        message: 'Trade status updated',
        trade: updatedTrade
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
};

module.exports = tradeController;
