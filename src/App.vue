<script setup>
import { computed, onBeforeUnmount, ref } from 'vue';
import {
  CABINET_DEMO_CABLES,
  CABINET_DEMO_PORTS,
  calculateCabinetMeasurementResponse,
  createCabinetDemoState,
  createCabinetMeasurementScenario,
  evaluateCableSignal,
  getCabinetConsoleStatus,
  runCabinetDemoStep
} from './services/cabinetSignalRuntime.js';

const mainCable = CABINET_DEMO_CABLES.mainPower;
const targetPorts = CABINET_DEMO_PORTS.rackB;

const demoState = ref(createCabinetDemoState());
const operationState = ref('disconnected');
const selectedPortId = ref(mainCable.expectedTargetPortId);
const runMode = ref('step');
const isContinuousRunning = ref(false);
const continuousIntervalMs = 800;
const eventLog = ref([
  { step: 0, text: '初始状态：柜间线路断开，显控台异常。', level: 'fault' }
]);

let continuousTimer = 0;

const currentScenario = computed(() => {
  const connected = operationState.value !== 'disconnected';
  const targetPortId = operationState.value === 'misplugged'
    ? 'B-X2'
    : (connected ? selectedPortId.value : '');

  return createCabinetMeasurementScenario({
    type: 'wire_state',
    targetKind: 'edge',
    targetId: mainCable.id,
    parameters: {
      connected,
      sourcePortId: mainCable.expectedSourcePortId,
      targetPortId,
      time: demoState.value.time
    }
  });
});

const lastResponse = ref(calculateCabinetMeasurementResponse(demoState.value, currentScenario.value));
const activeSignal = computed(() => evaluateCableSignal(demoState.value, mainCable.id));
const consoleStatus = computed(() => getCabinetConsoleStatus([activeSignal.value]));
const oscilloscopeSamples = computed(() => demoState.value.oscilloscope?.samples ?? []);
const lastScopeSample = computed(() => oscilloscopeSamples.value.at(-1) ?? null);
const inputJson = computed(() => JSON.stringify(currentScenario.value, null, 2));
const outputJson = computed(() => JSON.stringify(lastResponse.value, null, 2));
const signalWavePoints = computed(() => buildScopePoints('signal'));
const expectedWavePoints = computed(() => buildScopePoints('expected'));

const propagationNodes = computed(() => {
  const signal = activeSignal.value;
  const status = signal.normal ? 'normal' : signal.state === 'misplugged' ? 'warning' : 'fault';

  return [
    {
      id: 'input',
      stage: '输入',
      title: '操作输入',
      subtitle: currentScenario.value.type,
      meta: currentScenario.value.parameters.connected ? 'connected=true' : 'connected=false',
      status: 'info'
    },
    {
      id: 'rack-a',
      stage: '源端',
      title: 'A柜输出口',
      subtitle: mainCable.expectedSourcePortId,
      meta: 'sourcePortId',
      status: 'normal'
    },
    {
      id: 'wire',
      stage: '链路',
      title: mainCable.id,
      subtitle: mainCable.variableId,
      meta: signal.reason,
      status
    },
    {
      id: 'rack-b',
      stage: '目标端',
      title: 'B柜输入口',
      subtitle: signal.targetPortId || '未接入',
      meta: 'targetPortId',
      status
    },
    {
      id: 'console',
      stage: '显控',
      title: consoleStatus.value.text,
      subtitle: `signal=${signal.value}`,
      meta: `normal=${signal.normal}`,
      status
    },
    {
      id: 'points',
      stage: '输出',
      title: '测点响应',
      subtitle: `${lastResponse.value.summary.normal}/${lastResponse.value.summary.total} 正常`,
      meta: `affected=${lastResponse.value.summary.affected}`,
      status
    }
  ];
});

function buildScopePoints(channelId) {
  const width = 520;
  const top = 30;
  const bottom = 118;
  const samples = oscilloscopeSamples.value;
  const values = samples.length
    ? samples.map((sample) => Number(sample[channelId] ?? 0))
    : [0, 0];
  const renderValues = values.length === 1 ? [values[0], values[0]] : values;
  const lastIndex = Math.max(renderValues.length - 1, 1);

  return renderValues
    .map((value, index) => {
      const x = (index / lastIndex) * width;
      const y = bottom - Math.max(0, Math.min(value, 1)) * (bottom - top);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function appendEvent(result, source) {
  const output = result.outputs[0];
  eventLog.value = [
    {
      step: result.state.stepIndex,
      text: `${source}：${output.reason}，signal=${output.value}，normal=${output.normal}`,
      level: output.normal ? 'normal' : 'fault'
    },
    ...eventLog.value
  ].slice(0, 8);
}

function runStep(source = '步进') {
  const scenario = currentScenario.value;
  const result = runCabinetDemoStep(demoState.value, [
    {
      cableId: scenario.targetId,
      connected: scenario.parameters.connected,
      sourcePortId: scenario.parameters.sourcePortId,
      targetPortId: scenario.parameters.targetPortId
    }
  ]);

  demoState.value = result.state;
  lastResponse.value = calculateCabinetMeasurementResponse(result.state, scenario);
  appendEvent(result, source);
}

function stopContinuousRun() {
  if (continuousTimer) {
    window.clearInterval(continuousTimer);
    continuousTimer = 0;
  }
  isContinuousRunning.value = false;
}

function startContinuousRun() {
  if (continuousTimer) {
    return;
  }
  runMode.value = 'continuous';
  isContinuousRunning.value = true;
  runStep('连续运行');
  continuousTimer = window.setInterval(() => runStep('连续运行'), continuousIntervalMs);
}

function setRunMode(mode) {
  runMode.value = mode;
  if (mode === 'step') {
    stopContinuousRun();
  }
}

function handleRunAction() {
  if (runMode.value === 'step') {
    runStep('单步执行');
    return;
  }

  if (isContinuousRunning.value) {
    stopContinuousRun();
  } else {
    startContinuousRun();
  }
}

function resetDemo() {
  stopContinuousRun();
  demoState.value = createCabinetDemoState();
  operationState.value = 'disconnected';
  selectedPortId.value = mainCable.expectedTargetPortId;
  lastResponse.value = calculateCabinetMeasurementResponse(demoState.value, currentScenario.value);
  eventLog.value = [
    { step: 0, text: '初始状态：柜间线路断开，显控台异常。', level: 'fault' }
  ];
}

onBeforeUnmount(stopContinuousRun);
</script>

<template>
  <main class="jigui-demo">
    <header class="demo-topbar">
      <div>
        <h1>机柜线路传播图演示</h1>
        <p>保持主平台传播图风格，使用同一类 scenario 输入和 snapshot 输出确认对接格式。</p>
      </div>
      <div class="run-controls">
        <span>Step {{ demoState.stepIndex }}</span>
        <span>{{ demoState.time.toFixed(1) }}s</span>
        <div class="run-mode-toggle" role="group" aria-label="运行模式">
          <button type="button" :class="{ active: runMode === 'step' }" @click="setRunMode('step')">步进</button>
          <button type="button" :class="{ active: runMode === 'continuous' }" @click="setRunMode('continuous')">连续运行</button>
        </div>
        <button type="button" class="primary-run" :data-running="isContinuousRunning" @click="handleRunAction">
          {{ runMode === 'step' ? '单步执行' : (isContinuousRunning ? '暂停连续' : '开始连续') }}
        </button>
        <button type="button" class="ghost" @click="resetDemo">复位</button>
      </div>
    </header>

    <section class="demo-grid">
      <div class="propagation-panel">
        <section class="scenario-controls">
          <div>
            <h2>操作输入</h2>
            <p>外部只需要给出线缆编号、连接状态和插口，下一步按该输入计算。</p>
          </div>
          <label>
            线路状态
            <select v-model="operationState">
              <option value="disconnected">断开</option>
              <option value="connected">接入正确插口</option>
              <option value="misplugged">接入错误插口</option>
            </select>
          </label>
          <label>
            目标插口
            <select v-model="selectedPortId" :disabled="operationState === 'disconnected' || operationState === 'misplugged'">
              <option v-for="port in targetPorts" :key="port.id" :value="port.id">{{ port.id }} · {{ port.label }}</option>
            </select>
          </label>
        </section>

        <section class="flow-map" aria-label="柜间信号传播图">
          <div class="flow-map__lanes">
            <span>输入层</span>
            <span>物理链路</span>
            <span>中间变量</span>
            <span>显控台</span>
            <span>测点输出</span>
          </div>
          <div class="flow-map__nodes">
            <template v-for="(node, index) in propagationNodes" :key="node.id">
              <article class="flow-node" :data-status="node.status">
                <span>{{ node.stage }}</span>
                <strong>{{ node.title }}</strong>
                <code>{{ node.subtitle }}</code>
                <em>{{ node.meta }}</em>
              </article>
              <div v-if="index < propagationNodes.length - 1" class="flow-edge" :data-status="activeSignal.normal ? 'normal' : 'fault'">
                <span></span>
              </div>
            </template>
          </div>
        </section>

        <section class="measurement-response-panel">
          <div class="measurement-response-head">
            <div>
              <div class="measurement-response-eyebrow">操作快照 · 全测点对照</div>
              <h2>测点响应</h2>
            </div>
            <div class="response-summary">
              <span><em>测点</em><strong>{{ lastResponse.summary.total }}</strong></span>
              <span><em>受影响</em><strong>{{ lastResponse.summary.affected }}</strong></span>
              <span><em>截断</em><strong>{{ lastResponse.summary.cut }}</strong></span>
              <span><em>异常</em><strong>{{ lastResponse.summary.abnormal }}</strong></span>
              <span><em>正常</em><strong>{{ lastResponse.summary.normal }}</strong></span>
            </div>
          </div>
          <div class="measurement-response-matrix">
            <article
              v-for="point in lastResponse.points"
              :key="point.pointId"
              class="measurement-response-row"
              :data-status="point.status"
            >
              <span class="measurement-response-row__point">
                <strong>{{ point.labelZh }}</strong>
                <code>{{ point.edgeId }}</code>
              </span>
              <span><em>基线值</em><b>{{ point.baselineValue }}{{ point.unit === 'bool' ? '' : point.unit }}</b></span>
              <span><em>操作后</em><b>{{ point.operatedValue }}{{ point.unit === 'bool' ? '' : point.unit }}</b></span>
              <span><em>判定</em><b>{{ point.statusLabelZh }}</b></span>
              <span class="measurement-response-row__reason"><em>原因</em><b>{{ point.reasonZh }}</b></span>
            </article>
          </div>
        </section>

        <section class="scope-section">
          <div class="section-title">
            <h2>示波器波形</h2>
            <span>{{ oscilloscopeSamples.length }} samples</span>
          </div>
          <div class="scope-frame">
            <svg class="scope-svg" viewBox="0 0 560 154" role="img" aria-label="实际信号与期望信号波形">
              <line x1="20" y1="30" x2="540" y2="30" class="scope-guide scope-guide--high" />
              <line x1="20" y1="118" x2="540" y2="118" class="scope-guide" />
              <polyline :points="expectedWavePoints" class="scope-wave scope-wave--expected" transform="translate(20 0)" />
              <polyline :points="signalWavePoints" class="scope-wave scope-wave--signal" transform="translate(20 0)" />
            </svg>
            <div class="scope-legend">
              <span><i class="legend-dot legend-dot--signal"></i>实际信号 {{ lastScopeSample?.signal ?? 0 }}</span>
              <span><i class="legend-dot legend-dot--expected"></i>期望信号 1</span>
              <span>{{ lastScopeSample?.normal ? '正常' : '异常' }}</span>
            </div>
          </div>
        </section>
      </div>

      <aside class="format-panel">
        <section class="status-card" :data-status="consoleStatus.level">
          <span class="status-light"></span>
          <div>
            <h2>{{ consoleStatus.text }}</h2>
            <p>{{ activeSignal.reason }}</p>
          </div>
        </section>

        <section class="format-card">
          <h2>原平台输入格式</h2>
          <p><code>calculateMeasurementResponse(scenario)</code> 的输入是 scenario 对象。</p>
          <pre>{{ inputJson }}</pre>
        </section>

        <section class="format-card">
          <h2>原平台输出格式</h2>
          <p>输出是 snapshot，对外主要读 <code>summary</code>、<code>points</code> 和 <code>bridgePayload</code>。</p>
          <pre>{{ outputJson }}</pre>
        </section>

        <section class="event-panel">
          <h2>步进记录</h2>
          <div class="event-list">
            <div v-for="event in eventLog" :key="`${event.step}-${event.text}`" class="event-row" :data-level="event.level">
              <span>#{{ event.step }}</span>
              <p>{{ event.text }}</p>
            </div>
          </div>
        </section>
      </aside>
    </section>
  </main>
</template>
