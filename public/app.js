'use strict';

/* ================= 工具 ================= */
const $ = (id) => document.getElementById(id);
const hide = (el) => el.classList.add('hidden');
const show = (el) => el.classList.remove('hidden');

let toastTimer = null;
function toast(msg, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  show(t);
  t.classList.remove('fade');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('fade'), ms);
}

async function api(route, businessParams) {
  const res = await fetch('/api/' + route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(businessParams),
  });
  const body = await res.json();
  if (body.code !== 200) throw new Error(body.msg || '请求失败');
  return body.data;
}

function fmtFee(n) {
  return '¥' + Number(n).toFixed(2);
}

/* ================= Tab 切换 ================= */
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const panel = $(tab.dataset.tab === 'create' ? 'tab-create' : 'tab-orders');
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p === panel));
    if (tab.dataset.tab === 'orders') renderOrders();
  });
});

/* ================= 健康检查 ================= */
(async () => {
  try {
    const r = await fetch('/api/health').then((x) => x.json());
    const mock = r.data && r.data.mock;
    $('modeTag').textContent = mock ? '演示模式（模拟数据）' : '已连接易达正式接口';
  } catch {
    $('modeTag').textContent = '服务未连接';
  }
})();

/* ================= 表单 ---------------- */
const FIELD_IDS = [
  'senderProvince', 'senderCity', 'senderDistrict', 'senderAddress', 'senderName', 'senderMobile',
  'receiveProvince', 'receiveCity', 'receiveDistrict', 'receiveAddress', 'receiveName', 'receiveMobile',
  'goods', 'packageCount', 'weight', 'vloumLong', 'vloumWidth', 'vloumHeight',
  'guaranteeValueAmount', 'remark',
];

const val = (id) => $(id).value.trim();

function buildPreOrderParams() {
  const params = {
    customerType: 'kd',
    onlinePay: 'Y',
  };
  FIELD_IDS.forEach((id) => {
    const key = id;
    const v = val(id);
    if (v !== '') params[key] = v;
  });
  params.thirdNo = 'H5' + Date.now();
  return params;
}

function validateForm(params) {
  const need = ['senderProvince', 'senderCity', 'senderDistrict', 'senderAddress', 'senderName',
    'receiveProvince', 'receiveCity', 'receiveDistrict', 'receiveAddress', 'receiveName', 'goods'];
  const labels = {
    senderProvince: '寄件省', senderCity: '寄件市', senderDistrict: '寄件区', senderAddress: '寄件详细地址', senderName: '寄件人姓名',
    receiveProvince: '收件省', receiveCity: '收件市', receiveDistrict: '收件区', receiveAddress: '收件详细地址', receiveName: '收件人姓名',
    goods: '托寄物',
  };
  for (const k of need) {
    if (!params[k]) return '请填写' + labels[k];
  }
  if (!params.senderMobile) return '请填写寄件人手机号';
  if (!params.receiveMobile) return '请填写收件人手机号';
  if (!params.weight || Number(params.weight) <= 0) return '请填写正确的重量';
  if (!params.packageCount || Number(params.packageCount) <= 0) return '请填写正确的件数';
  return null;
}

/* ================= 一键粘贴识别收/发货人 ================= */
const RECV_WORDS = ['收货人', '收件人', '收货地址', '收件地址', '收货', '收件'];
const SEND_WORDS = ['寄件人', '发货人', '寄件地址', '发货地址', '寄件方', '寄件', '发货'];
const NAME_BAD_RE = /^(寄件|发货|收件|收货|发件|寄|收|备注|电话|手机|联系|地址|邮编|客户|买家|卖家|商家|默认|麻烦|辛苦|谢谢|顺丰|圆通|中通|韵达|京东|德邦|极兔|邮政)/;

const PARTY_FIELD = {
  sender: {
    name: 'senderName', phone: 'senderMobile',
    province: 'senderProvince', city: 'senderCity', district: 'senderDistrict', detail: 'senderAddress',
  },
  receiver: {
    name: 'receiveName', phone: 'receiveMobile',
    province: 'receiveProvince', city: 'receiveCity', district: 'receiveDistrict', detail: 'receiveAddress',
  },
};

$('pasteBtn').addEventListener('click', () => {
  if (navigator.clipboard && navigator.clipboard.readText) {
    navigator.clipboard.readText().then((txt) => applyPasteText(txt || '')).catch(() => {
      openPasteModal('');
      $('pasteText').focus();
    });
  } else {
    openPasteModal('');
    $('pasteText').focus();
  }
});

$('pasteCloseBtn').addEventListener('click', () => hide($('pasteModal')));
$('pasteModal').querySelector('.modal-mask').addEventListener('click', () => hide($('pasteModal')));
$('pasteClearBtn').addEventListener('click', () => { $('pasteText').value = ''; $('pasteText').focus(); });
$('pasteFillBtn').addEventListener('click', () => applyPasteText($('pasteText').value));

function openPasteModal(prefill) {
  if (prefill) $('pasteText').value = prefill;
  show($('pasteModal'));
}

function applyPasteText(rawText) {
  const result = parseClipboardParties(String(rawText || ''));
  if (!result.parties.length) {
    openPasteModal(String(rawText || '').trim());
    toast('未能识别出收/发货人信息，可在文本框中调整后重新识别', 3200);
    return false;
  }
  result.parties.forEach(fillParty);
  if (result.parties.length === 2) {
    toast(result.ambiguous
      ? '已识别填入双方信息（未标注方向：上段=寄件人，下段=收货人，请核对）'
      : '已一键识别并填入寄件人与收货人信息', 3800);
  } else {
    toast('仅识别到' + (result.parties[0].type === 'sender' ? '寄件人' : '收货人') + '信息并填入，另一侧请手动填写', 3200);
  }
  window.scrollTo(0, 0);
  return true;
}

function fillParty(party) {
  const map = PARTY_FIELD[party.type || 'receiver'];
  Object.entries(map).forEach(([key, id]) => {
    if (party[key]) $(id).value = party[key];
  });
}

function findEarliest(text, words) {
  let best = null;
  for (const word of words) {
    const i = text.indexOf(word);
    if (i >= 0 && (!best || i < best.index || (i === best.index && word.length > best.word.length))) {
      best = { word, index: i };
    }
  }
  return best;
}

function findPhones(text) {
  return [...text.matchAll(/(?:\+?86[-\s]?)?(1[3-9]\d{9})/g)];
}

function findPartyBoundary(text, secondPhoneIndex) {
  let head = text.slice(0, secondPhoneIndex).replace(/[\s，,。;；、:：]+$/, '');
  const nameRun = head.match(/[\u4e00-\ufaff·]{2,5}$/);
  if (nameRun) return head.length - nameRun[0].length;
  let candidate = -1;
  for (const sep of ['\n', '；', ';', '。', '，', ',', ' ']) {
    const idx = head.lastIndexOf(sep);
    if (idx >= 0) candidate = Math.max(candidate, idx + 1);
  }
  return candidate >= 0 ? candidate : secondPhoneIndex;
}

const OPPOSITE = { sender: 'receiver', receiver: 'sender' };

function parseClipboardParties(rawText) {
  const text = rawText.trim();
  if (!text) return { parties: [], ambiguous: false };
  const send = findEarliest(text, SEND_WORDS);
  const recv = findEarliest(text, RECV_WORDS);
  const parties = [];
  let ambiguous = false;

  if (send && recv) {
    const firstIsSend = send.index < recv.index;
    const firstIdx = firstIsSend ? send.index : recv.index;
    const secondIdx = firstIsSend ? recv.index : send.index;
    const firstType = firstIsSend ? 'sender' : 'receiver';
    const pa = parsePartyBlock(text.slice(firstIdx, secondIdx), firstType);
    const pb = parsePartyBlock(text.slice(secondIdx), OPPOSITE[firstType]);
    if (pa) parties.push(pa);
    if (pb) parties.push(pb);
  } else if (send || recv) {
    const labeledType = send ? 'sender' : 'receiver';
    const labeledIdx = (send || recv).index;
    const phones = findPhones(text);
    if (phones.length >= 2) {
      const boundary = findPartyBoundary(text, phones[1].index);
      const firstIsLabeled = labeledIdx < boundary;
      const pa = parsePartyBlock(text.slice(0, boundary), firstIsLabeled ? labeledType : OPPOSITE[labeledType]);
      const pb = parsePartyBlock(text.slice(boundary), firstIsLabeled ? OPPOSITE[labeledType] : labeledType);
      if (pa) parties.push(pa);
      if (pb) parties.push(pb);
    } else {
      const p = parsePartyBlock(text, labeledType);
      if (p) parties.push(p);
    }
  } else {
    const phones = findPhones(text);
    if (phones.length >= 2) {
      const boundary = findPartyBoundary(text, phones[1].index);
      const pa = parsePartyBlock(text.slice(0, boundary), 'sender');
      const pb = parsePartyBlock(text.slice(boundary), 'receiver');
      if (pa) parties.push(pa);
      if (pb) parties.push(pb);
      ambiguous = parties.length === 2;
    } else {
      const p = parsePartyBlock(text, null);
      if (p) parties.push(p);
    }
  }
  return { parties, ambiguous };
}

function parsePartyBlock(block, type) {
  const cleaned = block
    .replace(/(寄件人|发货人|收件人|收货人|寄件方|收货方|发件人|寄件地址|发货地址|收件地址|收货地址|寄件|发货|收件|收货|姓名|名字|联系人|电话|手机号|手机|地址|邮编)[：:　\s]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  const phoneMatch = cleaned.match(/(?:\+?86[-\s]?)?(1[3-9]\d{9})/);
  const phone = phoneMatch ? phoneMatch[1] : '';
  const pre = phoneMatch ? cleaned.slice(0, phoneMatch.index) : cleaned;
  const post = phoneMatch ? cleaned.slice(phoneMatch.index + phoneMatch[0].length) : '';
  let name = '';
  for (const token of pre.split(/[\s，,。:：;；、()（）\[\]]+/)) {
    const t = token.trim();
    if (/^[\u4e00-\ufaff·]{2,5}$/.test(t) && !NAME_BAD_RE.test(t)) name = t;
  }
  if (!name) {
    const m = post.match(/(?:联系人|寄件人|收件人|收货人)[:：]?([\u4e00-\ufaff]{2,4})/);
    if (m) name = m[1];
  }
  const region = splitRegion(post);
  if (!phone && !region.province && !region.city && !region.district) return null;
  return { type, name, phone, ...region };
}

function splitRegion(addr) {
  let rest = addr.trim().replace(/^[，,。;；、:\s]+/, '').replace(/[，,。;；、\s]+$/, '');
  let province = '', city = '', district = '';
  let isMunicipality = false;

  const muni = rest.match(/^(北京|上海|天津|重庆)市?/);
  if (muni) {
    isMunicipality = true;
    province = muni[1] + '市';
    rest = rest.slice(muni[0].length);
  } else {
    const mp = rest.match(/^([\u4e00-\ufaff]{1,7}?省)/);
    if (mp) {
      province = mp[1];
      rest = rest.slice(mp[1].length);
    } else {
      const mr = rest.match(/^([\u4e00-\ufaff]{1,5}(?:壮族自治区|回族自治区|维吾尔自治区|自治区))/);
      if (mr) {
        province = mr[1];
        rest = rest.slice(mr[1].length);
      }
    }
  }

  const mc = rest.match(/^([\u4e00-\ufaff]{1,10}?(?:市|自治州|地区|盟))/);
  if (mc) {
    city = mc[1];
    rest = rest.slice(mc[1].length);
  }
  if (isMunicipality && !city) city = province;

  const md = rest.match(/^([\u4e00-\ufaff]{1,10}?(?:区|县|市|旗))/);
  if (md) {
    district = md[1];
    rest = rest.slice(md[1].length);
  }

  const detail = rest.replace(/^[0-9]{6}(?=[\s，,]|$)/, '').trim();
  return { province, city, district, detail };
}

/* ================= 第一步 -> 估价 ================= */
let quotes = [];
let selectedChannel = null;
let lastParams = null;

$('quoteBtn').addEventListener('click', async () => {
  const params = buildPreOrderParams();
  const err = validateForm(params);
  if (err) return toast(err);

  const btn = $('quoteBtn');
  btn.disabled = true;
  btn.textContent = '估价中…';
  try {
    const data = await api('preOrder', params);
    quotes = flattenQuotes(data);
    if (!quotes.length) {
      toast('暂无可用渠道，请检查地址');
      return;
    }
    lastParams = params;
    renderQuotes();
    show($('step-quote'));
    hide($('step-form'));
    hide($('step-done'));
    window.scrollTo(0, 0);
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '估价并选择渠道';
  }
});

function flattenQuotes(grouped) {
  const list = [];
  for (const dt of Object.keys(grouped || {})) {
    for (const ch of grouped[dt]) list.push(ch);
  }
  return list.sort((a, b) => Number(a.preOrderFee) - Number(b.preOrderFee));
}

function renderQuotes() {
  const list = $('quoteList');
  selectedChannel = null;
  $('orderBtn').disabled = true;
  $('selFee').textContent = '--';
  $('selSub').textContent = '请选择一个渠道';
  list.innerHTML = quotes.map((ch, i) => {
    const courier = quoteCourierName(ch);
    return `
    <div class="quote-item" data-i="${i}">
      <div class="qi-top">
        <div>
          <div class="qi-name">${esc(ch.channelName)}</div>
          <div class="qi-meta">
            <span class="qi-co">${esc(courier)}${esc(ch.deliveryBusiness || '')}</span>
            <span>计费重量 ${esc(ch.calcFeeWeight)}kg</span>
            ${ch.limitWeight ? `<span>限重 ${esc(ch.limitWeight)}kg</span>` : ''}
          </div>
        </div>
        <div class="qi-fee"><small>预估</small>${fmtFee(ch.preOrderFee)}</div>
      </div>
      <div class="qi-meta">
        ${(ch.isBest === 'Y') ? '<span class="tag best">推荐</span>' : ''}
        <span class="tag">原价 ${fmtFee(ch.originalFee)}</span>
        ${Number(ch.preBjFee) > 0 ? `<span class="tag">含保价 ${fmtFee(ch.preBjFee)}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.quote-item').forEach((el) => {
    el.addEventListener('click', () => selectQuote(Number(el.dataset.i)));
  });
}

const COURIER_MAP = {
  SF: '顺丰', YTO: '圆通', ZTO: '中通', YUND: '韵达', JT: '极兔',
  'STO-INT': '申通', DOP: '德邦', JD: '京东', CAINIAO: '菜鸟裹裹', CNSD: '菜鸟速递',
  BEST: '百世', KY: '跨越', EMS: '邮政', YMDD: '壹米滴答', SXJD: '顺心捷达', AN: '安能',
};
function quoteCourierName(ch) {
  return COURIER_MAP[ch.deliveryType] || ch.deliveryType || '';
}

function selectQuote(i) {
  const item = $('quoteList').children[i];
  if (!item) return;
  $('quoteList').querySelectorAll('.quote-item').forEach((el) => el.classList.remove('selected'));
  item.classList.add('selected');
  selectedChannel = quotes[i];
  $('selFee').textContent = fmtFee(selectedChannel.preOrderFee);
  $('selSub').textContent =
    `${quoteCourierName(selectedChannel)} ${selectedChannel.channelName} · 计费重量 ${selectedChannel.calcFeeWeight}kg`;
  $('orderBtn').disabled = false;
}

$('backToForm').addEventListener('click', () => {
  hide($('step-quote'));
  show($('step-form'));
});

$('swapBtn').addEventListener('click', () => {
  const senderKeys = ['senderProvince', 'senderCity', 'senderDistrict', 'senderAddress', 'senderName', 'senderMobile'];
  const recvKeys = ['receiveProvince', 'receiveCity', 'receiveDistrict', 'receiveAddress', 'receiveName', 'receiveMobile'];
  const senderVals = senderKeys.map((k) => $(k).value);
  senderKeys.forEach((k, idx) => { $(k).value = $(recvKeys[idx]).value; });
  recvKeys.forEach((k, idx) => { $(k).value = senderVals[idx]; });
});

/* ================= 正式下单 ================= */
let currentOrder = null;

$('orderBtn').addEventListener('click', async () => {
  if (!selectedChannel) return;
  const btn = $('orderBtn');
  btn.disabled = true;
  btn.textContent = '下单中…';
  try {
    const params = {
      ...lastParams,
      deliveryType: selectedChannel.deliveryType,
      deliveryBusiness: selectedChannel.deliveryBusiness,
      channelId: selectedChannel.channelId,
      payMethod: $('payMethodSel').value || 30,
      onlinePay: selectedChannel.onlinePay || 'Y',
    };
    if (params.payMethod !== '30') params.onlinePay = 'N';
    const data = await api('submitOrder', params);
    const order = {
      thirdNo: params.thirdNo,
      orderNo: data.orderNo,
      deliveryId: data.deliveryId || '',
      channelId: selectedChannel.channelId,
      channelName: selectedChannel.channelName,
      deliveryType: selectedChannel.deliveryType,
      deliveryBusiness: selectedChannel.deliveryBusiness,
      fee: selectedChannel.preOrderFee,
      goods: params.goods,
      senderName: params.senderName,
      receiveName: params.receiveName,
      pickUpCode: data.pickUpCode || '',
      weight: params.weight,
      packageCount: params.packageCount,
      status: '1',
      createdAt: Date.now(),
    };
    currentOrder = order;
    saveOrder(order);
    renderDone(order);
    show($('step-done'));
    hide($('step-quote'));
    window.scrollTo(0, 0);
  } catch (e) {
    toast('下单失败：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '确认下单';
  }
});

/* ================= 下单完成 ================= */
function renderDone(order, failed = false) {
  const icon = $('doneIcon');
  if (failed) {
    icon.className = 'done-icon bad';
    icon.textContent = '✕';
    $('doneTitle').textContent = '操作失败';
    $('doneInfo').innerHTML = `<div><dt>说明</dt><dd>${esc(order)}</dd></div>`;
    hide($('traceBtn'));
    hide($('cancelBtn'));
    return;
  }
  icon.className = 'done-icon ok';
  icon.textContent = '✓';
  $('doneTitle').textContent = '下单成功';
  const rows = [
    ['易达订单号', order.orderNo],
    ['快递单号', order.deliveryId || '待揽收后生成'],
    ['渠道', order.channelName],
    ['预估费用', fmtFee(order.fee)],
  ];
  if (order.pickUpCode) rows.push(['取件码', order.pickUpCode]);
  $('doneInfo').innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  show($('traceBtn'));
  $('cancelBtn').classList.toggle('hidden', order.status !== '1');
}

$('newOrderBtn').addEventListener('click', () => {
  lastParams = null;
  selectedChannel = null;
  $('goods').value = '';
  show($('step-form'));
  hide($('step-done'));
  hide($('step-quote'));
  window.scrollTo(0, 0);
});

/* ================= 取消订单 ================= */
$('cancelBtn').addEventListener('click', () => doCancel(currentOrder));

async function doCancel(order) {
  if (!order) return;
  if (!confirm('确定要取消该订单吗？\n' + (order.orderNo || order.thirdNo))) return;
  const p = order.orderNo ? { orderNo: order.orderNo } : { thirdNo: order.thirdNo };
  try {
    const data = await api('cancelOrder', p);
    if (data === true) {
      order.status = '10';
      updateOrder(order);
      toast('订单已取消');
      renderDone(order);
      if ($('tab-orders').classList.contains('active')) renderOrders();
    } else {
      renderDone('取消未成功，接口返回：' + JSON.stringify(data), true);
    }
  } catch (e) {
    toast('取消失败：' + e.message);
  }
}

/* ================= 轨迹查询 ================= */
let traceTarget = null;

$('traceBtn').addEventListener('click', () => openTrace(currentOrder));
$('traceClose').addEventListener('click', () => hide($('traceModal')));
$('traceModal').querySelector('.modal-mask').addEventListener('click', () => hide($('traceModal')));
$('traceRefresh').addEventListener('click', () => loadTrace(traceTarget));

function openTrace(order) {
  if (!order) return;
  traceTarget = order;
  show($('traceModal'));
  $('traceList').innerHTML = '<div class="empty">查询中…</div>';
  $('traceStatus').textContent = order.deliveryId ? '运单号 ' + order.deliveryId : '';
  loadTrace(order);
}

async function loadTrace(order) {
  if (!order || !order.deliveryId) {
    $('traceStatus').textContent = '尚未生成运单号，快递揽收后才能查询轨迹';
    $('traceList').innerHTML = `
      <div class="trace-item current"><span class="node"></span>
        <div class="t-desc">订单已创建，等待快递小哥上门取件</div>
        <div class="t-time">下单号：${esc(order ? order.orderNo : '')}</div>
      </div>`;
    $('traceRefresh').classList.add('hidden');
    return;
  }
  $('traceRefresh').classList.remove('hidden');
  try {
    const list = await api('trace', { deliveryId: order.deliveryId });
    renderTrace(list || []);
  } catch (e) {
    $('traceList').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

function renderTrace(traces) {
  if (!traces.length) {
    $('traceList').innerHTML = '<div class="empty">暂无轨迹，揽收后即可查看到快递到了哪里</div>';
    return;
  }
  // 最新一条置顶显示
  const list = [...traces].reverse();
  $('traceList').innerHTML = list
    .map((t, i) => `
      <div class="trace-item ${i === 0 ? 'current' : ''}">
        <span class="node"></span>
        <div class="t-desc">${esc(t.desc)}</div>
        <div class="t-time">${esc(t.time)}</div>
      </div>`)
    .join('');
}

/* ================= 订单列表 ================= */
const LS_KEY = 'yida_orders_v1';

function loadOrders() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch {
    return [];
  }
}
function saveOrder(order) {
  const all = loadOrders().filter((o) => o.thirdNo !== order.thirdNo);
  all.unshift(order);
  localStorage.setItem(LS_KEY, JSON.stringify(all.slice(0, 50)));
}
function updateOrder(order) {
  saveOrder(order);
}

function renderOrders() {
  const orders = loadOrders();
  const box = $('orderList');
  $('orderListEmpty').classList.toggle('hidden', orders.length > 0);
  box.innerHTML = orders.map((o, i) => {
    const st = ORDER_STATUS_TEXT[o.status] || o.status;
    const canCancel = o.status === '1';
    return `
    <div class="order-card" data-i="${i}">
      <div class="oc-top">
        <div class="oc-name">${esc(o.channelName)}</div>
        <span class="status s${o.status}">${esc(st)}</span>
      </div>
      <div class="oc-meta">
        ${esc(o.senderName || '')} ➜ ${esc(o.receiveName || '')} · ${esc(o.goods)} · ${esc(o.weight)}kg<br>
        快递单号：${esc(o.deliveryId || '待揽收生成')}　预估 ${fmtFee(o.fee)}<br>
        下单时间：${esc(fmtDate(o.createdAt))}
      </div>
      <div class="oc-actions">
        <button data-act="trace" ${o.deliveryId ? '' : 'disabled style="opacity:.4"'}>查物流</button>
        <button data-act="cancel" class="danger" ${canCancel ? '' : 'disabled style="opacity:.4"'}>取消订单</button>
      </div>
    </div>`;
  }).join('');

  box.querySelectorAll('.order-card').forEach((card) => {
    const order = orders[Number(card.dataset.i)];
    card.querySelector('[data-act="trace"]').addEventListener('click', () => openTrace(order));
    card.querySelector('[data-act="cancel"]').addEventListener('click', async () => {
      const p = order.orderNo ? { orderNo: order.orderNo } : { thirdNo: order.thirdNo };
      if (!confirm('确定取消该订单吗？')) return;
      try {
        const ok = await api('cancelOrder', p);
        if (ok === true) {
          order.status = '10';
          updateOrder(order);
          toast('订单已取消');
          renderOrders();
        }
      } catch (e) {
        toast('取消失败：' + e.message);
      }
    });
  });
}

const ORDER_STATUS_TEXT = { '1': '待取件', '11': '已取件', '2': '运输中', '3': '已签收', '6': '异常', '10': '已取消' };

function fmtDate(ts) {
  const d = new Date(Number(ts));
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
