/**
 * 易达API 代理服务（零依赖，Node >= 14）
 *
 * 为什么需要代理：
 *  - privateKey 只能在服务端保存，绝不能暴露到 H5 前端；
 *  - 易达接口不支持浏览器跨域直调，由本服务转发并签名。
 *
 * 启动：
 *   node server.js                          # Mock 演示模式（未配置密钥时自动开启）
 *   编辑 .env 填入密钥后 node server.js      # 接真实易达接口（推荐）
 *   YIDA_USERNAME=xxx YIDA_PRIVATE_KEY=xxx node server.js   # 环境变量方式（优先级高于 .env）
 *   PORT=3000 固定端口
 */
'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/* ---------------- .env 加载：文件中的变量不覆盖已存在的真实环境变量，文件缺失时静默跳过 ---------------- */
function loadDotEnv(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  } catch (e) {
    if (e && e.code === 'ENOENT') return;
    throw e;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}
loadDotEnv(path.join(__dirname, '.env'));

const CONFIG = {
  username: process.env.YIDA_USERNAME || '',
  privateKey: process.env.YIDA_PRIVATE_KEY || '',
  port: Number(process.env.PORT || 3200),
  // 未配置密钥时自动进入 Mock 模式；也可用 YIDA_MOCK=1/0 强制
  mock: process.env.YIDA_MOCK === '1' || !(process.env.YIDA_USERNAME && process.env.YIDA_PRIVATE_KEY),
  upstream: 'https://www.yida178.cn/prod-api/thirdApi/execute',
};

/* ---------------- 易达签名：MD5(按key排序JSON{privateKey,timestamp,username}) 后转大写 ---------------- */
function makeSign(username, timestamp) {
  const payload = JSON.stringify({
    privateKey: CONFIG.privateKey,
    timestamp,
    username,
  });
  return crypto.createHash('md5').update(payload, 'utf8').digest('hex').toUpperCase();
}

function callUpstream(apiMethod, businessParams) {
  const timestamp = String(Date.now());
  const body = JSON.stringify({
    username: CONFIG.username,
    timestamp,
    sign: makeSign(CONFIG.username, timestamp),
    apiMethod,
    businessParams,
  });
  return new Promise((resolve, reject) => {
    const url = new URL(CONFIG.upstream);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 15000,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error('上游返回解析失败: ' + raw.slice(0, 200)));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('上游请求超时')));
    req.write(body);
    req.end();
  });
}

/* ================================ Mock 实现（演示模式） ================================ */
// thirdNo -> 订单
const mockOrders = new Map();
const COURIER_NAMES = {
  SF: '顺丰', YTO: '圆通', ZTO: '中通', YUND: '韵达', JT: '极兔',
  'STO-INT': '申通', DOP: '德邦', JD: '京东', CNSD: '菜鸟速递', EMS: '邮政',
};

function money(n) {
  return Math.round(n * 100) / 100;
}

/** 按重量给一组模拟渠道报价 */
function mockQuoteChannels(p) {
  const w = Number(p.weight) || 1;
  const hasBaojia = Number(p.guaranteeValueAmount) > 0;
  const bjFee = hasBaojia ? money(Math.min(Number(p.guaranteeValueAmount), 300000) * 0.005) : 0;
  const remoteAdd = /(新疆|西藏|青海|内蒙古)/.test(String(p.receiveProvince || '')) ? 8 : 0;

  const channels = [
    { dt: 'SF', db: 'SF_GZ_BK', name: '顺丰标快', first: 18, add: 5, limit: 30, best: true },
    { dt: 'YTO', db: 'YTO_BK', name: '圆通标快', first: 12, add: 4, limit: 20, best: false },
    { dt: 'ZTO', db: 'ZTO_KY', name: '中通快运', first: 11, add: 3.5, limit: 50, best: false },
    { dt: 'YUND', db: 'YUND_BK', name: '韵达标快', first: 12, add: 4.5, limit: 20, best: false },
  ];
  return channels.map((c, i) => {
    // 大件加收，模拟限重差异
    const extra = w > 10 ? Math.floor((w - 10) / 10) * 10 : 0;
    const deliveryFee = money(c.first + Math.max(0, w - 1) * c.add + remoteAdd + extra);
    return {
      channelId: 9000000 + c.dt.length * 1000 + i,
      channelName: c.name,
      calcFeeWeight: money(w),
      preOrderFee: money(deliveryFee + bjFee), // 预付总费用 = 运费 + 保价费
      preDeliveryFee: deliveryFee,
      preBjFee: bjFee,
      originalFee: money((c.first + Math.max(0, w - 1) * c.add) * 1.35 + remoteAdd),
      deliveryType: c.dt,
      deliveryBusiness: c.db,
      limitWeight: c.limit,
      lightGoods: 6000,
      calcFeeType: 'profit',
      price: JSON.stringify([{ start: 1, end: 0, first: c.first, add: c.add }]),
      originalPrice: JSON.stringify([{ start: 1, end: 0, first: money(c.first * 1.35), add: money(c.add * 1.35) }]),
      bjRuleStr: '保额0至500，保费1元;保额1001至0，费率0.005;',
      isBest: c.best ? 'Y' : 'N',
      onlinePay: 'Y',
      payMethod: 30,
      payConfirm: 'N',
    };
  });
}

function ok(data, msg = '操作成功') {
  return { code: 200, data, msg };
}
function fail(msg, code = 500, data = null) {
  return { code, data, msg };
}

function mockApi(apiMethod, p) {
  switch (apiMethod) {
    case 'SMART_PRE_ORDER': {
      for (const k of ['senderProvince', 'senderCity', 'senderDistrict', 'senderAddress', 'senderName', 'goods', 'packageCount', 'weight']) {
        if (!p[k]) return fail('缺少必填参数: ' + k);
      }
      if (!p.senderMobile && !p.senderTel) return fail('发件人电话/手机至少填一个');
      if (!p.receiveMobile && !p.receiveTel) return fail('收件人电话/手机至少填一个');
      const grouped = {};
      for (const ch of mockQuoteChannels(p)) {
        (grouped[ch.deliveryType] = grouped[ch.deliveryType] || []).push(ch);
      }
      return ok(grouped);
    }

    case 'SUBMIT_ORDER_V2': {
      for (const k of ['thirdNo', 'deliveryType', 'deliveryBusiness', 'senderName', 'goods', 'packageCount', 'weight']) {
        if (!p[k]) return fail('缺少必填参数: ' + k);
      }
      if (mockOrders.has(p.thirdNo)) return fail('商家订单号已存在: ' + p.thirdNo);
      const quoteCharts = mockQuoteChannels(p);
      const matched = quoteCharts.find((c) => c.deliveryType === p.deliveryType) || quoteCharts[0];
      const deliveryId =
        (COURIER_NAMES[p.deliveryType] ? p.deliveryType.replace('-', '') : p.deliveryType) +
        String(Date.now()).slice(-12) +
        Math.floor(Math.random() * 10);
      const order = {
        thirdNo: p.thirdNo,
        orderNo: 'YD' + String(Date.now()) + Math.floor(Math.random() * 90 + 10),
        deliveryId,
        deliveryType: p.deliveryType,
        deliveryBusiness: p.deliveryBusiness,
        channelId: p.channelId || matched.channelId,
        channelName: matched.channelName,
        senderName: p.senderName,
        senderMobile: p.senderMobile || '',
        receiveName: p.receiveName || '',
        receiveMobile: p.receiveMobile || '',
        goods: p.goods,
        weight: Number(p.weight),
        packageCount: Number(p.packageCount),
        preOrderFee: matched.preOrderFee,
        preDeliveryFee: matched.preDeliveryFee,
        preBjFee: matched.preBjFee,
        status: '1', // 1-待取件
        pickUpCode: String(Math.floor(1000 + Math.random() * 9000)),
        createdAt: Date.now(),
        cancelledAt: null,
      };
      mockOrders.set(p.thirdNo, order);
      return ok(order, '下单成功');
    }

    case 'CANCEL_ORDER': {
      const order = findMockOrder(p);
      if (!order) return fail('订单不存在');
      if (order.status === '10') return fail('订单已取消，请勿重复操作');
      if (order.deliveryType === 'DOP' && Date.now() - order.createdAt < 3 * 60 * 1000) {
        return fail('德邦订单下单3分钟内禁止取消');
      }
      if (order.status !== '1') return fail('仅待取件状态的订单支持取消，当前状态：' + statusText(order.status));
      // 与轨迹推进同轴：逻辑5分钟（真实1分钟）后视为已揽收，不可再取消
      const logicalMin = ((Date.now() - order.createdAt) / (60 * 1000)) / TRACE_SCALE;
      if (logicalMin >= 5) return fail('包裹已被揽收，无法在线取消');
      order.status = '10';
      order.cancelledAt = Date.now();
      return ok(true, '运单取消成功');
    }

    case 'DELIVERY_TRACE': {
      const order = findMockOrder({ deliveryId: p.deliveryId });
      if (!order) return fail('运单不存在或不在当前账户下');
      if (!order.deliveryId) return fail('订单尚未生成运单号，暂不能查询轨迹');
      return ok(buildMockTrace(order));
    }

    default:
      return fail('Mock 未实现该 apiMethod: ' + apiMethod);
  }
}

function findMockOrder(p) {
  const key = p.thirdNo || p.orderNo || p.deliveryId;
  if (!key) return null;
  const byThird = mockOrders.get(key);
  if (byThird && (p.thirdNo || (p.orderNo && byThird.orderNo === key) || (p.deliveryId && byThird.deliveryId === key))) {
    return byThird;
  }
  for (const o of mockOrders.values()) {
    if (o.orderNo === key || o.deliveryId === key || o.thirdNo === key) return o;
  }
  return null;
}

function statusText(s) {
  return { '1': '待取件', '11': '已取件', '2': '运输中', '3': '已签收', '6': '异常', '10': '已取消' }[String(s)] || String(s);
}

/** 依据下单后经过的时间生成逐步推进的物流轨迹，模拟"快递到了哪里"
 *  演示加速：1 逻辑分钟 = 0.2 真实分钟（下单 12 真实分钟后走完全程） */
const TRACE_SCALE = 0.2;

function buildMockTrace(order) {
  if (order.status === '10') {
    return [{ time: fmt(new Date(order.cancelledAt)), desc: '订单已取消' }];
  }
  const destination = order.receiveCity || '北京市';
  const steps = [
    [0, '下单成功，等待快递小哥取件'],
    [2, '快递小哥已接单，正在赶往取件地址'],
    [5, '揽收成功，包裹已交接至' + (COURIER_NAMES[order.deliveryType] || order.deliveryType) + '网点'],
    [10, '包裹已到达【上海市】转运中心'],
    [20, '包裹已从【上海市】发出，下一站【杭州市】'],
    [30, '包裹已到达【杭州市】转运中心，正在转运'],
    [40, '包裹抵达目的城市【' + destination + '】，等待派送'],
    [50, '【派件中】快递小哥正在为您派送，请保持电话畅通'],
    [60, '包裹已签收'],
  ];
  // 真实经过时间换算为逻辑分钟；TRACE_SCALE 定义见 buildMockTrace
  const logicalMin = ((Date.now() - order.createdAt) / (60 * 1000)) / TRACE_SCALE;
  const trace = [];
  for (const [min, desc] of steps) {
    if (logicalMin >= min) {
      trace.push({ time: fmt(new Date(order.createdAt + min * TRACE_SCALE * 60 * 1000)), desc });
    }
  }
  return trace;
}

function fmt(d) {
  const z = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) +
    ' ' + z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds())
  );
}

/* ================================ HTTP 服务 ================================ */
const ROUTE_TOKENS = ['preOrder', 'submitOrder', 'cancelOrder', 'trace'];
const METHOD_BY_ROUTE = {
  preOrder: 'SMART_PRE_ORDER',
  submitOrder: 'SUBMIT_ORDER_V2',
  cancelOrder: 'CANCEL_ORDER',
  trace: 'DELIVERY_TRACE',
};

/** 转发到易达前剔除前端字段，businessParams 做类型规整 */
function normalizeBusinessParams(raw) {
  const p = {};
  const STRING_KEYS = [
    'thirdNo', 'orderNo', 'deliveryId', 'deliveryType', 'deliveryBusiness', 'customerType',
    'senderProvince', 'senderCity', 'senderDistrict', 'senderAddress', 'senderName', 'senderTel', 'senderMobile',
    'receiveProvince', 'receiveCity', 'receiveDistrict', 'receiveAddress', 'receiveName', 'receiveTel', 'receiveMobile',
    'goods', 'remark', 'onlinePay', 'calcFeeType', 'payConfirm',
  ];
  const NUMBER_KEYS = [
    'packageCount', 'weight', 'guaranteeValueAmount', 'vloumLong', 'vloumWidth', 'vloumHeight', 'payMethod',
  ];
  for (const k of STRING_KEYS) {
    const v = raw[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') p[k] = String(v).trim();
  }
  for (const k of NUMBER_KEYS) {
    const v = raw[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) p[k] = n;
    }
  }
  if (raw.pickUpStartTime && raw.pickUpEndTime) {
    p.pickUpStartTime = String(raw.pickUpStartTime);
    p.pickUpEndTime = String(raw.pickUpEndTime);
  }
  if (Array.isArray(raw.orderIncrements)) p.orderIncrements = raw.orderIncrements;
  return p;
}

function serveFile(res, file, type) {
  const full = path.join(__dirname, 'public', file);
  fs.readFile(full, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
    res.end(buf);
  });
}

function handleApi(req, res, route) {
  let raw = '';
  req.on('data', (c) => {
    raw += c;
    if (raw.length > 200000) req.destroy();
  });
  req.on('end', async () => {
    let input;
    try {
      input = raw ? JSON.parse(raw) : {};
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: 400, data: null, msg: '请求体必须是 JSON' }));
      return;
    }
    const apiMethod = METHOD_BY_ROUTE[route];
    const businessParams = normalizeBusinessParams(input || {});
    try {
      if (!ROUTE_TOKENS.includes(route)) throw new Error('unknown route');

      let result;
      if (CONFIG.mock) {
        // 演示延迟，模拟真实网络
        await new Promise((r) => setTimeout(r, 300 + Math.random() * 400));
        result = mockApi(apiMethod, businessParams);
      } else {
        result = await callUpstream(apiMethod, businessParams);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
      console.log('[%s] %s -> code=%s msg=%s', new Date().toISOString(), route, result.code, result.msg);
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: 500, data: null, msg: '服务异常: ' + e.message }));
    }
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const route = urlPath.replace(/^\/api\//, '').replace(/\/$/, '');

  if (urlPath === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 200, data: { mock: CONFIG.mock }, msg: 'ok' }));
    return;
  }
  if (ROUTE_TOKENS.includes(route) && req.method === 'POST') {
    handleApi(req, res, route);
    return;
  }
  if (req.method === 'GET') {
    if (urlPath === '/' || urlPath === '/index.html') return serveFile(res, 'index.html', 'text/html');
    if (urlPath === '/app.js') return serveFile(res, 'app.js', 'application/javascript');
    if (urlPath === '/style.css') return serveFile(res, 'style.css', 'text/css');
  }
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ code: 404, msg: 'Not Found: ' + urlPath }));
});

server.listen(CONFIG.port, () => {
  console.log('易达 H5 快递下单服务已启动: http://localhost:%s', CONFIG.port);
  console.log('模式: %s', CONFIG.mock ? 'Mock 演示（未配置 YIDA_USERNAME / YIDA_PRIVATE_KEY）' : '真实易达接口');
});
