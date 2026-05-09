# Jigui Demo

机柜线路传播图演示子应用，独立于主平台运行。核心计算模块在 `src/services/cabinetSignalRuntime.js`：

- 在线访问地址：<https://blank1cheng.github.io/Jigui_demo/>

- 原平台输入格式：`calculateMeasurementResponse(scenario)`，其中 `scenario` 是 `{ type, targetKind, targetId, parameters }`
- Demo 输入参数：`targetId` 对应线缆编号，`parameters.connected/sourcePortId/targetPortId/time` 对应外部操作状态
- 原平台输出格式：`{ mode: "snapshot", scenario, summary, points }`
- Demo 额外输出：`bridgePayload`，包含 `cableId`、`status`、`variableId`、`signal`、`normal`

## 本地运行

```bash
cd Jigui_demo
npm install
npm run dev
```

默认访问地址由 Vite 输出，通常是：

```text
http://127.0.0.1:5173/
```

## 演示流程

1. 打开页面后，`WIRE-JG-A-B-001` 初始断开，传播图显示链路截断，显控台异常。
2. 在“操作输入”里选择断开、接入正确插口或接入错误插口。
3. 顶部可选择“步进”或“连续运行”。运行时会先应用当前输入，再计算测点响应。
4. 中间传播图保持主平台信号链路风格，下面展示全测点响应矩阵和示波器波形。
5. 右侧显示当前输入 JSON 和输出 JSON，方便确认对接格式。
