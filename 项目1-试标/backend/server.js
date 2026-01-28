const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// 数据存储路径
const DATA_DIR = path.join(__dirname, '../data');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const LOGS_FILE = path.join(DATA_DIR, 'logs.json');

// 初始化数据文件
function initDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // 初始化产品数据
  if (!fs.existsSync(PRODUCTS_FILE)) {
    const initialProducts = [
      {
        id: '1',
        name: 'iPhone 14 Pro',
        totalStock: 100,
        availableStock: 100,
        lockedStock: 0,
        deductedStock: 0
      },
      {
        id: '2',
        name: 'AirPods Pro 2',
        totalStock: 200,
        availableStock: 200,
        lockedStock: 0,
        deductedStock: 0
      },
      {
        id: '3',
        name: 'MacBook Pro 14"',
        totalStock: 50,
        availableStock: 50,
        lockedStock: 0,
        deductedStock: 0
      }
    ];
    fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(initialProducts, null, 2));
  }

  // 初始化订单数据
  if (!fs.existsSync(ORDERS_FILE)) {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify([], null, 2));
  }

  // 初始化日志数据
  if (!fs.existsSync(LOGS_FILE)) {
    fs.writeFileSync(LOGS_FILE, JSON.stringify([], null, 2));
  }
}

// 读取数据文件
function readData(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`读取文件失败: ${filePath}`, error);
    return [];
  }
}

// 写入数据文件
function writeData(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.error(`写入文件失败: ${filePath}`, error);
    return false;
  }
}

// 生成唯一订单号
function generateOrderId() {
  return 'ORD' + Date.now() + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
}

// 记录操作日志
function logOperation(type, details) {
  const logs = readData(LOGS_FILE);
  const logEntry = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    type,
    details
  };
  logs.push(logEntry);
  writeData(LOGS_FILE, logs);
}

// 1. 订单提交模块
app.post('/api/orders/submit', (req, res) => {
  try {
    const { productId, quantity, userId, userName } = req.body;

    // 验证参数
    if (!productId || !quantity || !userId || !userName) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }

    if (quantity <= 0) {
      return res.status(400).json({ success: false, message: '购买数量必须大于0' });
    }

    // 读取产品数据
    const products = readData(PRODUCTS_FILE);
    const product = products.find(p => p.id === productId);

    if (!product) {
      return res.status(404).json({ success: false, message: '商品不存在' });
    }

    // 库存预校验
    if (quantity > product.availableStock) {
      return res.status(400).json({ 
        success: false, 
        message: '库存不足',
        availableStock: product.availableStock
      });
    }

    // 锁定库存
    product.availableStock -= quantity;
    product.lockedStock += quantity;
    writeData(PRODUCTS_FILE, products);

    // 生成订单
    const order = {
      id: generateOrderId(),
      productId,
      productName: product.name,
      quantity,
      userId,
      userName,
      status: 'pending', // 待支付
      createTime: new Date().toISOString(),
      payTime: null,
      fulfillTime: null,
      lockStock: true,
      lockedQuantity: quantity
    };

    // 保存订单
    const orders = readData(ORDERS_FILE);
    orders.push(order);
    writeData(ORDERS_FILE, orders);

    // 记录日志
    logOperation('订单提交', {
      orderId: order.id,
      productId,
      quantity,
      userId
    });

    res.json({ 
      success: true, 
      message: '订单提交成功',
      order 
    });
  } catch (error) {
    console.error('订单提交失败:', error);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 2. 库存管理模块
app.get('/api/inventory', (req, res) => {
  try {
    const products = readData(PRODUCTS_FILE);
    res.json({ success: true, data: products });
  } catch (error) {
    console.error('获取库存失败:', error);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 3. 订单支付模块
app.post('/api/orders/pay', (req, res) => {
  try {
    const { orderId, payStatus } = req.body;

    if (!orderId || !payStatus) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }

    // 读取订单数据
    const orders = readData(ORDERS_FILE);
    const orderIndex = orders.findIndex(o => o.id === orderId);

    if (orderIndex === -1) {
      return res.status(404).json({ success: false, message: '订单不存在' });
    }

    const order = orders[orderIndex];

    if (order.status !== 'pending') {
      return res.status(400).json({ success: false, message: '订单状态错误' });
    }

    if (payStatus === 'success') {
      // 支付成功，实际扣减库存
      const products = readData(PRODUCTS_FILE);
      const productIndex = products.findIndex(p => p.id === order.productId);

      if (productIndex !== -1) {
        const product = products[productIndex];
        product.lockedStock -= order.quantity;
        product.deductedStock += order.quantity;
        product.totalStock -= order.quantity;
        writeData(PRODUCTS_FILE, products);
      }

      // 更新订单状态
      order.status = 'paid'; // 已支付
      order.payTime = new Date().toISOString();
      order.lockStock = false;

      // 记录日志
      logOperation('订单支付', {
        orderId,
        status: 'success'
      });

    } else if (payStatus === 'failed' || payStatus === 'timeout') {
      // 支付失败或超时，释放库存
      const products = readData(PRODUCTS_FILE);
      const productIndex = products.findIndex(p => p.id === order.productId);

      if (productIndex !== -1) {
        const product = products[productIndex];
        product.availableStock += order.quantity;
        product.lockedStock -= order.quantity;
        writeData(PRODUCTS_FILE, products);
      }

      // 更新订单状态
      order.status = 'cancelled'; // 已取消
      order.lockStock = false;

      // 记录日志
      logOperation('订单支付', {
        orderId,
        status: payStatus
      });
    }

    // 保存订单
    orders[orderIndex] = order;
    writeData(ORDERS_FILE, orders);

    res.json({ 
      success: true, 
      message: `订单${payStatus === 'success' ? '支付成功' : '支付失败'}`,
      order 
    });
  } catch (error) {
    console.error('订单支付失败:', error);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 4. 订单履约模块
app.post('/api/orders/fulfill', (req, res) => {
  try {
    const { orderId, fulfillStatus } = req.body;

    if (!orderId || !fulfillStatus) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }

    // 读取订单数据
    const orders = readData(ORDERS_FILE);
    const orderIndex = orders.findIndex(o => o.id === orderId);

    if (orderIndex === -1) {
      return res.status(404).json({ success: false, message: '订单不存在' });
    }

    const order = orders[orderIndex];

    if (order.status !== 'paid') {
      return res.status(400).json({ success: false, message: '订单状态错误' });
    }

    // 更新订单状态
    if (fulfillStatus === 'success') {
      order.status = 'fulfilled'; // 已履约
      order.fulfillTime = new Date().toISOString();
    } else if (fulfillStatus === 'failed') {
      order.status = 'fulfill_failed'; // 履约失败
    }

    // 保存订单
    orders[orderIndex] = order;
    writeData(ORDERS_FILE, orders);

    // 记录日志
    logOperation('订单履约', {
      orderId,
      status: fulfillStatus
    });

    res.json({ 
      success: true, 
      message: `订单${fulfillStatus === 'success' ? '履约成功' : '履约失败'}`,
      order 
    });
  } catch (error) {
    console.error('订单履约失败:', error);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 5. 获取订单列表
app.get('/api/orders', (req, res) => {
  try {
    const orders = readData(ORDERS_FILE);
    res.json({ success: true, data: orders });
  } catch (error) {
    console.error('获取订单失败:', error);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 6. 获取操作日志
app.get('/api/logs', (req, res) => {
  try {
    const logs = readData(LOGS_FILE);
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('获取日志失败:', error);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 7. 重置库存
app.post('/api/inventory/reset', (req, res) => {
  try {
    const initialProducts = [
      {
        id: '1',
        name: 'iPhone 14 Pro',
        totalStock: 100,
        availableStock: 100,
        lockedStock: 0,
        deductedStock: 0
      },
      {
        id: '2',
        name: 'AirPods Pro 2',
        totalStock: 200,
        availableStock: 200,
        lockedStock: 0,
        deductedStock: 0
      },
      {
        id: '3',
        name: 'MacBook Pro 14"',
        totalStock: 50,
        availableStock: 50,
        lockedStock: 0,
        deductedStock: 0
      }
    ];
    writeData(PRODUCTS_FILE, initialProducts);

    // 清空订单
    writeData(ORDERS_FILE, []);

    // 记录日志
    logOperation('库存重置', {});

    res.json({ success: true, message: '库存重置成功' });
  } catch (error) {
    console.error('重置库存失败:', error);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// 初始化数据
initDataFiles();

// 启动服务器
app.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});