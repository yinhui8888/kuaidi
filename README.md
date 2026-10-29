# 易达寄件 H5

基于「易达API」的 H5 快递寄件下单页面，支持：**预估价格（渠道比价）→ 正式下单 → 取消订单 → 物流轨迹查询**，以及**收/发货人信息一键识别填入**。

## 一键识别填入

在聊天窗口把「发货人 + 收货人」信息一次性复制，打开页面点「📋 粘贴并一键识别」即可自动分别填入寄件人 / 收件人表单（支持识别：姓名、手机号、省市区、详细地址；带「收货人：」「发货人：」标注最准；无标注时按「上段=寄件人、下段=收货人」解析并提示核对）。剪贴板读取被拒时自动弹出粘贴文本框，可编辑后重新识别。

## 快速启动（零依赖，Node ≥ 14）

```bash
node server.js
# 打开 http://localhost:3200
```

未配置密钥时自动进入 **Mock 演示模式**：内置 4 家快递渠道报价、订单创建、取消规则（仅待取件可取消、德邦3分钟禁取消）、随时间推进的物流轨迹，可完整走通全流程。

## 接入真实易达接口

1. 在易达后台「右上角 → API 接入」获取账户名和 `privateKey`；
2. 编辑项目根目录的 `.env`，填入：

```
YIDA_USERNAME=你的易达账户
YIDA_PRIVATE_KEY=你的privateKey
```

3. 重启服务：

```bash
node server.js
```

填写齐全后自动从 Mock 演示模式切换到真实接口（页面头部副标题会变为「已连接易达正式接口」）。`process.env` 中已有的环境变量优先级高于 `.env` 文件，也可不改文件直接命令行注入：

```bash
YIDA_USERNAME=xxx YIDA_PRIVATE_KEY=xxx node server.js
```

或使用 `YIDA_MOCK=0` 强制关闭演示模式。`.env` 已列入 `.gitignore`，不会被提交到仓库。

## 架构说明

```
public/index.html + app.js + style.css   ← H5 页面（移动端，vanilla JS）
server.js                                ← 零依赖 Node 代理
```

**为什么经过代理：** `privateKey` 只能保存在服务端（签名规则 = MD5(按key排序的JSON{privateKey,timestamp,username}) 后转大写，时间戳须在 6 分钟内），且易达接口不支持浏览器跨域直调。

| 前端请求 | 易达 apiMethod | 说明 |
|---|---|---|
| POST /api/preOrder | `SMART_PRE_ORDER` | 预估价：返回各渠道 `channelId/预付总费用/计费重量/原价` |
| POST /api/submitOrder | `SUBMIT_ORDER_V2` | 正式下单：返回 `orderNo/deliveryId/pickUpCode` |
| POST /api/cancelOrder | `CANCEL_ORDER` | 取消订单：`orderNo` 或 `deliveryId` 二选一，(Boolean) |
| POST /api/trace | `DELIVERY_TRACE` | 轨迹查询：`{deliveryId}` → `[{time, desc}]` |

## 接口注意事项（来自易达文档）

- 仅**待取件**状态订单可接口取消；德邦下单 3 分钟内禁止取消；未生成快递单号的订单不可接口取消。
- 下单接口必填：`thirdNo`（商家订单号，1-30 字符且唯一）、发货/收货地址电话、`goods/packageCount/weight`。
- 预约取件时间不传可能不分配快递员（顺丰侧必传，至少当前时间 1 小时后）。
- 订单真实状态需通过**回调接口**（pushType 1状态/2账单/3揽收/5订单变更）同步；轨迹查询需要已生成运单号。
