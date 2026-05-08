# Jigui Demo

三维机柜接线演示子应用，独立于主平台运行。核心计算模块在 `src/services/cabinetSignalRuntime.js`：

- 在线访问地址：<https://blank1cheng.github.io/Jigui_demo/>

- 外部输入：`cableId`、`connected/status`、`sourcePortId`、`targetPortId`
- 中间变量：`jg.mid.power_bus.ready`
- 输出：`signal` 数值、`normal` 布尔值、显控台状态和测点列表

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

1. 进入场景后，`WIRE-JG-A-B-001` 初始断开，显控台异常。
2. 点击红色断线，再点击 B 柜或 B 柜插口，弹出接入面板。
3. 选择 `B-X1` 并插入，步进结果立刻变为正常。
4. 顶部可选择“步进”或“连续运行”。连续运行会周期性调用同一个步进接口。
5. 右侧“示波器波形”展示实际信号和期望信号，断线为 0，正确接入为 1。
6. 右侧“外部操作输入”可模拟对接方直接传入某根线的状态，点击后会先写入状态再执行下一步计算。
