<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import * as THREE from 'three';
import {
  CABINET_DEMO_CABLES,
  CABINET_DEMO_PORTS,
  createCabinetBridgePayload,
  createCabinetDemoState,
  evaluateCableSignal,
  getCabinetConsoleStatus,
  runCabinetDemoStep
} from './services/cabinetSignalRuntime.js';

const mainCable = CABINET_DEMO_CABLES.mainPower;
const rackBPorts = CABINET_DEMO_PORTS.rackB;

const sceneHost = ref(null);
const demoState = ref(createCabinetDemoState());
const selectedCableId = ref('');
const selectedRackId = ref('');
const selectedPortId = ref(mainCable.expectedTargetPortId);
const connectionPanelOpen = ref(false);
const latestOutputs = ref([evaluateCableSignal(demoState.value, mainCable.id)]);
const consoleStatus = ref(getCabinetConsoleStatus(latestOutputs.value));
const externalStatus = ref('connected');
const externalPortId = ref(mainCable.expectedTargetPortId);
const runMode = ref('step');
const isContinuousRunning = ref(false);
const continuousIntervalMs = ref(700);
const eventLog = ref([
  {
    step: 0,
    text: '进入场景，柜间线路处于断开状态',
    level: 'fault'
  }
]);

let continuousTimer = 0;

const activeSignal = computed(() => latestOutputs.value[0]);
const bridgePayload = computed(() => createCabinetBridgePayload(activeSignal.value));
const oscilloscopeSamples = computed(() => demoState.value.oscilloscope?.samples ?? []);
const lastScopeSample = computed(() => oscilloscopeSamples.value.at(-1) ?? null);
const selectedCableLabel = computed(() => {
  if (!selectedCableId.value) {
    return '未选择线路';
  }
  return `${mainCable.label} / ${selectedCableId.value}`;
});
const sceneHint = computed(() => {
  if (!selectedCableId.value) {
    return '点击红色断线，选择需要恢复的线路';
  }
  if (!connectionPanelOpen.value) {
    return '已选择线路，再点击B柜或B柜插口打开接入面板';
  }
  return '选择目标插口后执行插入，下一步立即用新状态计算';
});
const signalWavePoints = computed(() => buildScopePoints('signal'));
const expectedWavePoints = computed(() => buildScopePoints('expected'));

let renderer;
let scene;
let camera;
let raycaster;
let pointer;
let animationFrame = 0;
let resizeObserver;
let cableGroup;
let clock;
const staticPickables = [];
let cablePickables = [];
const portMeshes = new Map();

const portPositions = {
  'A-X1': new THREE.Vector3(-1.35, 1.32, 0.36),
  'B-X1': new THREE.Vector3(1.35, 1.32, 0.36),
  'B-X2': new THREE.Vector3(1.35, 0.82, 0.36)
};

function refreshReadouts(state) {
  latestOutputs.value = [evaluateCableSignal(state, mainCable.id)];
  consoleStatus.value = getCabinetConsoleStatus(latestOutputs.value);
}

function recordStep(result, source) {
  demoState.value = result.state;
  latestOutputs.value = result.outputs;
  consoleStatus.value = result.consoleStatus;
  const output = result.outputs[0];
  eventLog.value = [
    {
      step: result.state.stepIndex,
      text: `${source}：${output.reason}，信号=${output.value}，normal=${output.normal}`,
      level: output.normal ? 'normal' : 'fault'
    },
    ...eventLog.value
  ].slice(0, 8);
  syncSceneState();
}

function buildScopePoints(channelId) {
  const width = 520;
  const top = 34;
  const bottom = 126;
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

function stepWithoutChange() {
  recordStep(runCabinetDemoStep(demoState.value), '手动步进');
}

function stopContinuousRun() {
  if (continuousTimer) {
    window.clearInterval(continuousTimer);
    continuousTimer = 0;
  }
  isContinuousRunning.value = false;
}

function runContinuousTick() {
  recordStep(runCabinetDemoStep(demoState.value), '连续运行');
}

function startContinuousRun() {
  if (continuousTimer) {
    return;
  }
  runMode.value = 'continuous';
  isContinuousRunning.value = true;
  runContinuousTick();
  continuousTimer = window.setInterval(runContinuousTick, continuousIntervalMs.value);
}

function setRunMode(mode) {
  runMode.value = mode;
  if (mode === 'step') {
    stopContinuousRun();
  }
}

function handlePrimaryRunAction() {
  if (runMode.value === 'step') {
    stepWithoutChange();
    return;
  }

  if (isContinuousRunning.value) {
    stopContinuousRun();
  } else {
    startContinuousRun();
  }
}

function insertSelectedCable() {
  const cableId = selectedCableId.value || mainCable.id;
  recordStep(
    runCabinetDemoStep(demoState.value, [
      {
        cableId,
        connected: true,
        sourceRackId: mainCable.sourceRackId,
        targetRackId: mainCable.targetRackId,
        sourcePortId: mainCable.expectedSourcePortId,
        targetPortId: selectedPortId.value
      }
    ]),
    '接线操作'
  );
  selectedCableId.value = cableId;
  connectionPanelOpen.value = false;
}

function disconnectCable() {
  recordStep(
    runCabinetDemoStep(demoState.value, [
      {
        cableId: mainCable.id,
        connected: false,
        sourcePortId: mainCable.expectedSourcePortId
      }
    ]),
    '断开线路'
  );
  selectedCableId.value = mainCable.id;
  connectionPanelOpen.value = false;
}

function applyExternalInput() {
  const connected = externalStatus.value !== 'disconnected';
  const targetPortId = externalStatus.value === 'misplugged' ? 'B-X2' : externalPortId.value;

  selectedCableId.value = mainCable.id;
  recordStep(
    runCabinetDemoStep(demoState.value, [
      {
        cableId: mainCable.id,
        connected,
        sourceRackId: mainCable.sourceRackId,
        targetRackId: mainCable.targetRackId,
        sourcePortId: mainCable.expectedSourcePortId,
        targetPortId
      }
    ]),
    '外部状态输入'
  );
}

function selectCable(cableId) {
  selectedCableId.value = cableId;
  connectionPanelOpen.value = false;
  syncSceneState();
}

function selectRack(rackId) {
  selectedRackId.value = rackId;
  if (selectedCableId.value && rackId === mainCable.targetRackId) {
    connectionPanelOpen.value = true;
  }
  syncSceneState();
}

function selectPort(portId) {
  selectedPortId.value = portId;
  selectedRackId.value = 'rack-b';
  if (selectedCableId.value) {
    connectionPanelOpen.value = true;
  }
  syncSceneState();
}

function createRack(rackId, x, name, color) {
  const group = new THREE.Group();
  group.position.set(x, 0.95, 0);
  group.userData = { type: 'rack', rackId };

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 1.9, 0.72),
    new THREE.MeshStandardMaterial({
      color,
      metalness: 0.28,
      roughness: 0.5
    })
  );
  body.userData = { type: 'rack', rackId };
  group.add(body);
  staticPickables.push(body);

  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(body.geometry),
    new THREE.LineBasicMaterial({ color: 0xc7d7e8, transparent: true, opacity: 0.72 })
  );
  body.add(edge);

  for (let i = 0; i < 4; i += 1) {
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.035, 0.03),
      new THREE.MeshStandardMaterial({ color: 0x2c3a48, roughness: 0.7 })
    );
    panel.position.set(0, 0.54 - i * 0.35, 0.375);
    group.add(panel);
  }

  const labelCanvas = document.createElement('canvas');
  labelCanvas.width = 256;
  labelCanvas.height = 64;
  const context = labelCanvas.getContext('2d');
  context.fillStyle = '#e7f0f9';
  context.font = 'bold 30px Microsoft YaHei, sans-serif';
  context.textAlign = 'center';
  context.fillText(name, 128, 42);
  const texture = new THREE.CanvasTexture(labelCanvas);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  label.scale.set(0.8, 0.2, 1);
  label.position.set(0, 1.1, 0.42);
  group.add(label);

  scene.add(group);
  return group;
}

function createPort(port) {
  const position = portPositions[port.id];
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.075, 0.075, 0.06, 28),
    new THREE.MeshStandardMaterial({
      color: port.id === mainCable.expectedTargetPortId || port.id === mainCable.expectedSourcePortId ? 0x55d48b : 0xf2b84b,
      emissive: 0x102018,
      emissiveIntensity: 0.18,
      metalness: 0.35,
      roughness: 0.28
    })
  );
  mesh.rotation.x = Math.PI / 2;
  mesh.position.copy(position);
  mesh.userData = { type: 'port', rackId: port.rackId, portId: port.id };
  portMeshes.set(port.id, mesh);
  staticPickables.push(mesh);
  scene.add(mesh);
}

function createCableTube(points, color, radius = 0.035) {
  const curve = new THREE.CatmullRomCurve3(points);
  const geometry = new THREE.TubeGeometry(curve, 40, radius, 12, false);
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.18,
    metalness: 0.05,
    roughness: 0.38
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData = { type: 'cable', cableId: mainCable.id };
  return mesh;
}

function createPlug(position, color) {
  const plug = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.1, 0.12),
    new THREE.MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.32 })
  );
  plug.position.copy(position);
  plug.userData = { type: 'cable', cableId: mainCable.id };
  return plug;
}

function drawCable() {
  if (cableGroup) {
    scene.remove(cableGroup);
  }
  cableGroup = new THREE.Group();
  cablePickables = [];

  const output = evaluateCableSignal(demoState.value, mainCable.id);
  const start = portPositions['A-X1'];
  const targetPort = output.targetPortId || mainCable.expectedTargetPortId;
  const end = portPositions[targetPort] || portPositions[mainCable.expectedTargetPortId];
  const color = output.normal ? 0x38d878 : output.state === 'misplugged' ? 0xf2b84b : 0xff4d4f;

  if (output.state === 'disconnected') {
    const leftEnd = new THREE.Vector3(-0.35, 1.06, 0.78);
    const rightLoose = new THREE.Vector3(0.62, 0.78, 0.74);
    const first = createCableTube([start, new THREE.Vector3(-0.95, 1.45, 0.82), leftEnd], color);
    const second = createCableTube([rightLoose, new THREE.Vector3(0.95, 1.1, 0.82), end], color);
    const plugA = createPlug(leftEnd, 0x242f3a);
    const plugB = createPlug(rightLoose, 0x242f3a);
    cableGroup.add(first, second, plugA, plugB);
    cablePickables.push(first, second, plugA, plugB);
  } else {
    const midA = new THREE.Vector3(-0.72, 1.58, 0.86);
    const midB = new THREE.Vector3(0.72, 1.58, 0.86);
    const tube = createCableTube([start, midA, midB, end], color);
    const plug = createPlug(end, output.normal ? 0x163b27 : 0x5d4218);
    cableGroup.add(tube, plug);
    cablePickables.push(tube, plug);
  }

  scene.add(cableGroup);
}

function syncSceneState() {
  if (!scene) {
    return;
  }
  drawCable();

  const output = evaluateCableSignal(demoState.value, mainCable.id);
  portMeshes.forEach((mesh, portId) => {
    const isTarget = output.targetPortId === portId && output.state !== 'disconnected';
    const isSelected = selectedPortId.value === portId;
    const material = mesh.material;
    material.color.setHex(isTarget ? (output.normal ? 0x42e681 : 0xf2b84b) : isSelected ? 0x6aa7ff : 0x7e92a6);
    material.emissive.setHex(isTarget ? material.color.getHex() : 0x0b1118);
    material.emissiveIntensity = isTarget ? 0.32 : 0.08;
  });
}

function resizeRenderer() {
  const host = sceneHost.value;
  if (!host || !renderer || !camera) {
    return;
  }
  const width = Math.max(host.clientWidth, 320);
  const height = Math.max(host.clientHeight, 320);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate() {
  animationFrame = window.requestAnimationFrame(animate);
  const elapsed = clock.getElapsedTime();
  if (cableGroup) {
    cableGroup.children.forEach((child) => {
      if (child.material?.emissiveIntensity !== undefined) {
        child.material.emissiveIntensity = 0.16 + Math.sin(elapsed * 3) * 0.05;
      }
    });
  }
  renderer.render(scene, camera);
}

function handleScenePointer(event) {
  if (!renderer || !camera || !raycaster || !pointer) {
    return;
  }
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects([...staticPickables, ...cablePickables], true);
  const target = intersects.find((item) => item.object.userData?.type)?.object;

  if (!target) {
    return;
  }

  const { type, cableId, rackId, portId } = target.userData;
  if (type === 'cable') {
    selectCable(cableId);
  } else if (type === 'rack') {
    selectRack(rackId);
  } else if (type === 'port') {
    selectPort(portId);
  }
}

function initScene() {
  const host = sceneHost.value;
  if (!host) {
    return;
  }

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101820);
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 2.1, 5.1);
  camera.lookAt(0, 0.9, 0);
  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  clock = new THREE.Clock();

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.className = 'scene-canvas';
  host.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.58));
  const keyLight = new THREE.DirectionalLight(0xffffff, 1.55);
  keyLight.position.set(2.4, 4.5, 3);
  scene.add(keyLight);
  const rimLight = new THREE.PointLight(0x67e8f9, 1.4, 8);
  rimLight.position.set(-2.2, 2.8, 2.8);
  scene.add(rimLight);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(7.4, 4.4),
    new THREE.MeshStandardMaterial({ color: 0x152231, roughness: 0.78, metalness: 0.12 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);

  const grid = new THREE.GridHelper(7.4, 20, 0x335066, 0x263847);
  grid.position.y = 0.005;
  scene.add(grid);

  createRack('rack-a', -1.8, 'A柜', 0x3b5266);
  createRack('rack-b', 1.8, 'B柜', 0x34485a);
  CABINET_DEMO_PORTS.rackA.forEach(createPort);
  CABINET_DEMO_PORTS.rackB.forEach(createPort);

  refreshReadouts(demoState.value);
  syncSceneState();
  resizeRenderer();
  renderer.domElement.addEventListener('pointerdown', handleScenePointer);
  resizeObserver = new ResizeObserver(resizeRenderer);
  resizeObserver.observe(host);
  animate();
}

onMounted(initScene);

onBeforeUnmount(() => {
  stopContinuousRun();
  window.cancelAnimationFrame(animationFrame);
  resizeObserver?.disconnect();
  renderer?.domElement.removeEventListener('pointerdown', handleScenePointer);
  renderer?.dispose();
});
</script>

<template>
  <main class="jigui-demo">
    <header class="demo-topbar">
      <div>
        <h1>机柜线路接入三维演示</h1>
        <p>线路编号、插口状态和中间变量分离，步进时先应用外部操作，再计算测点响应。</p>
      </div>
      <div class="step-box">
        <span>Step {{ demoState.stepIndex }}</span>
        <span>{{ demoState.time.toFixed(1) }}s</span>
        <div class="run-mode-toggle" role="group" aria-label="运行模式">
          <button type="button" :class="{ active: runMode === 'step' }" @click="setRunMode('step')">步进</button>
          <button type="button" :class="{ active: runMode === 'continuous' }" @click="setRunMode('continuous')">连续运行</button>
        </div>
        <button type="button" class="primary-run" :data-running="isContinuousRunning" @click="handlePrimaryRunAction">
          {{ runMode === 'step' ? '单步执行' : (isContinuousRunning ? '暂停连续' : '开始连续') }}
        </button>
      </div>
    </header>

    <section class="demo-workspace">
      <div class="scene-panel">
        <div ref="sceneHost" class="scene-host" aria-label="机柜线路三维场景"></div>
        <div class="scene-overlay scene-overlay--top">
          <strong>{{ sceneHint }}</strong>
          <span>{{ selectedCableLabel }}</span>
        </div>
        <div class="scene-overlay scene-overlay--bottom">
          <span>1 点击线路</span>
          <span>2 点击B柜</span>
          <span>3 选择插口并插入</span>
        </div>
        <form v-if="connectionPanelOpen" class="port-popover" @submit.prevent="insertSelectedCable">
          <div class="popover-title">线路接入面板</div>
          <div class="field-readonly">
            <span>线路编号</span>
            <strong>{{ mainCable.id }}</strong>
          </div>
          <label v-for="port in rackBPorts" :key="port.id" class="port-option">
            <input v-model="selectedPortId" type="radio" name="target-port" :value="port.id" />
            <span>{{ port.label }}</span>
          </label>
          <div class="popover-actions">
            <button type="submit">插入线路并步进</button>
            <button type="button" class="ghost" @click="connectionPanelOpen = false">关闭</button>
          </div>
        </form>
      </div>

      <aside class="console-panel" :data-level="consoleStatus.level">
        <section class="status-strip">
          <span class="status-light"></span>
          <div>
            <h2>{{ consoleStatus.text }}</h2>
            <p>{{ activeSignal.reason }}</p>
          </div>
        </section>

        <section class="signal-section">
          <div class="section-title">
            <h3>线缆与中间变量</h3>
            <button type="button" class="ghost" @click="disconnectCable">断开</button>
          </div>
          <dl class="signal-grid">
            <div>
              <dt>cableId</dt>
              <dd>{{ activeSignal.cableId }}</dd>
            </div>
            <div>
              <dt>variableId</dt>
              <dd>{{ activeSignal.variableId }}</dd>
            </div>
            <div>
              <dt>status</dt>
              <dd>{{ activeSignal.state }}</dd>
            </div>
            <div>
              <dt>signal</dt>
              <dd>{{ activeSignal.value }} / {{ activeSignal.normal }}</dd>
            </div>
          </dl>
        </section>

        <section class="signal-section">
          <h3>测点反馈</h3>
          <div class="measurement-list">
            <article v-for="item in activeSignal.measurements" :key="item.id" class="measurement-row" :data-normal="item.normal">
              <div>
                <strong>{{ item.label }}</strong>
                <span>{{ item.id }}</span>
              </div>
              <b>{{ item.value }}{{ item.unit === 'bool' ? '' : item.unit }}</b>
            </article>
          </div>
        </section>

        <section class="signal-section scope-section">
          <div class="section-title">
            <h3>示波器波形</h3>
            <span class="scope-meta">{{ oscilloscopeSamples.length }} samples</span>
          </div>
          <div class="scope-frame">
            <svg class="scope-svg" viewBox="0 0 560 170" role="img" aria-label="实际信号与期望信号波形">
              <line x1="20" y1="34" x2="540" y2="34" class="scope-guide scope-guide--high" />
              <line x1="20" y1="126" x2="540" y2="126" class="scope-guide" />
              <polyline :points="`20,34 540,34`" class="scope-wave scope-wave--expected" />
              <polyline :points="expectedWavePoints" class="scope-wave scope-wave--expected scope-wave--data" transform="translate(20 0)" />
              <polyline :points="signalWavePoints" class="scope-wave scope-wave--signal" transform="translate(20 0)" />
            </svg>
            <div class="scope-legend">
              <span><i class="legend-dot legend-dot--signal"></i>实际信号 {{ lastScopeSample?.signal ?? 0 }}</span>
              <span><i class="legend-dot legend-dot--expected"></i>期望信号 1</span>
              <span>{{ lastScopeSample?.normal ? '正常' : '异常' }}</span>
            </div>
          </div>
        </section>

        <section class="signal-section">
          <h3>外部操作输入</h3>
          <div class="external-form">
            <label>
              状态
              <select v-model="externalStatus">
                <option value="connected">接上</option>
                <option value="disconnected">断开</option>
                <option value="misplugged">插错口</option>
              </select>
            </label>
            <label>
              插口
              <select v-model="externalPortId" :disabled="externalStatus === 'disconnected'">
                <option v-for="port in rackBPorts" :key="port.id" :value="port.id">{{ port.id }}</option>
              </select>
            </label>
            <button type="button" @click="applyExternalInput">写入状态并步进</button>
          </div>
          <pre class="payload-preview">{{ JSON.stringify(bridgePayload, null, 2) }}</pre>
        </section>
      </aside>
    </section>

    <section class="event-panel">
      <h3>步进记录</h3>
      <div class="event-list">
        <div v-for="event in eventLog" :key="`${event.step}-${event.text}`" class="event-row" :data-level="event.level">
          <span>#{{ event.step }}</span>
          <p>{{ event.text }}</p>
        </div>
      </div>
    </section>
  </main>
</template>
