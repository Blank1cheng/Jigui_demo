const STEP_SIZE = 0.1;
const OSCILLOSCOPE_MAX_SAMPLES = 120;

export const CABINET_DEMO_PORTS = Object.freeze({
  rackA: Object.freeze([
    Object.freeze({ id: 'A-X1', rackId: 'rack-a', label: 'A柜 X1 输出口', role: 'source' })
  ]),
  rackB: Object.freeze([
    Object.freeze({ id: 'B-X1', rackId: 'rack-b', label: 'B柜 X1 主输入口', role: 'target' }),
    Object.freeze({ id: 'B-X2', rackId: 'rack-b', label: 'B柜 X2 备用口', role: 'target' })
  ])
});

export const CABINET_DEMO_CABLES = Object.freeze({
  mainPower: Object.freeze({
    id: 'WIRE-JG-A-B-001',
    label: 'A柜到B柜主链路线',
    variableId: 'jg.mid.power_bus.ready',
    sourceRackId: 'rack-a',
    targetRackId: 'rack-b',
    expectedSourcePortId: 'A-X1',
    expectedTargetPortId: 'B-X1',
    measurements: Object.freeze([
      Object.freeze({
        id: 'mp-console-health',
        label: '显控台健康状态',
        unit: 'bool',
        normalValue: 1,
        abnormalValue: 0,
        normalText: '显控链路闭合',
        abnormalText: '显控台链路异常'
      }),
      Object.freeze({
        id: 'mp-rack-b-input-voltage',
        label: 'B柜输入电压',
        unit: 'V',
        normalValue: 24,
        abnormalValue: 0,
        normalText: 'B柜主输入电压稳定',
        abnormalText: 'B柜主输入未建立'
      }),
      Object.freeze({
        id: 'mp-link-handshake',
        label: '柜间链路握手',
        unit: 'bool',
        normalValue: 1,
        abnormalValue: 0,
        normalText: '握手信号有效',
        abnormalText: '握手信号丢失'
      })
    ])
  })
});

const CABLE_LIST = Object.freeze(Object.values(CABINET_DEMO_CABLES));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getCableDefinition(cableId) {
  const cable = CABLE_LIST.find((item) => item.id === cableId);
  if (!cable) {
    throw new Error(`Unknown cabinet demo cable: ${cableId}`);
  }
  return cable;
}

function normalizeCableUpdate(update = {}) {
  const status = String(update.status ?? '').trim().toLowerCase();
  const connected = update.connected ?? status === 'connected' ?? false;

  return {
    cableId: update.cableId,
    connected: Boolean(connected),
    sourceRackId: update.sourceRackId,
    targetRackId: update.targetRackId,
    sourcePortId: update.sourcePortId,
    targetPortId: update.targetPortId
  };
}

function getConnectionState(cable, connection = {}) {
  if (!connection.connected) {
    return {
      state: 'disconnected',
      value: 0,
      normal: false,
      reason: '线路未接入'
    };
  }

  const sourceMatches = connection.sourcePortId === cable.expectedSourcePortId;
  const targetMatches = connection.targetPortId === cable.expectedTargetPortId;

  if (sourceMatches && targetMatches) {
    return {
      state: 'connected',
      value: 1,
      normal: true,
      reason: '线路已接入正确插口'
    };
  }

  return {
    state: 'misplugged',
    value: 0,
    normal: false,
    reason: '线路已接入错误插口'
  };
}

function createMeasurementRows(cable, signalState) {
  return cable.measurements.map((measurement) => ({
    id: measurement.id,
    label: measurement.label,
    unit: measurement.unit,
    value: signalState.normal ? measurement.normalValue : measurement.abnormalValue,
    normal: signalState.normal,
    reason: signalState.reason,
    message: signalState.normal ? measurement.normalText : measurement.abnormalText
  }));
}

export function createCabinetDemoState() {
  return {
    stepIndex: 0,
    time: 0,
    stepSize: STEP_SIZE,
    oscilloscope: {
      maxSamples: OSCILLOSCOPE_MAX_SAMPLES,
      samples: []
    },
    connections: CABLE_LIST.reduce((accumulator, cable) => {
      accumulator[cable.id] = {
        cableId: cable.id,
        connected: false,
        sourceRackId: cable.sourceRackId,
        targetRackId: cable.targetRackId,
        sourcePortId: cable.expectedSourcePortId,
        targetPortId: ''
      };
      return accumulator;
    }, {})
  };
}

function appendOscilloscopeSample(state, outputs) {
  const output = outputs[0];
  const previousScope = state.oscilloscope ?? {};
  const maxSamples = previousScope.maxSamples ?? OSCILLOSCOPE_MAX_SAMPLES;
  const samples = [
    ...(previousScope.samples ?? []),
    {
      stepIndex: state.stepIndex,
      time: state.time,
      cableId: output.cableId,
      variableId: output.variableId,
      signal: output.value,
      expected: 1,
      normal: output.normal,
      state: output.state
    }
  ].slice(-maxSamples);

  return {
    maxSamples,
    channels: [
      { id: 'signal', label: '实际信号', color: '#55d48b' },
      { id: 'expected', label: '期望信号', color: '#6aa7ff' }
    ],
    samples
  };
}

export function applyCabinetCableUpdate(state, update) {
  const normalized = normalizeCableUpdate(update);
  const cable = getCableDefinition(normalized.cableId);
  const nextState = clone(state);
  const previous = nextState.connections[cable.id] ?? {};

  nextState.connections[cable.id] = {
    cableId: cable.id,
    connected: normalized.connected,
    sourceRackId: normalized.sourceRackId || previous.sourceRackId || cable.sourceRackId,
    targetRackId: normalized.targetRackId || previous.targetRackId || cable.targetRackId,
    sourcePortId: normalized.sourcePortId || previous.sourcePortId || cable.expectedSourcePortId,
    targetPortId: normalized.targetPortId || previous.targetPortId || ''
  };

  if (!normalized.connected) {
    nextState.connections[cable.id].targetPortId = '';
  }

  return nextState;
}

export function evaluateCableSignal(state, cableId) {
  const cable = getCableDefinition(cableId);
  const connection = state.connections[cable.id];
  const signalState = getConnectionState(cable, connection);

  return {
    cableId: cable.id,
    label: cable.label,
    variableId: cable.variableId,
    state: signalState.state,
    value: signalState.value,
    normal: signalState.normal,
    reason: signalState.reason,
    sourcePortId: connection?.sourcePortId ?? '',
    targetPortId: connection?.targetPortId ?? '',
    measurements: createMeasurementRows(cable, signalState)
  };
}

export function getCabinetConsoleStatus(outputs) {
  const allNormal = outputs.every((output) => output.normal);

  if (allNormal) {
    return {
      level: 'normal',
      text: '显控台状态正常'
    };
  }

  return {
    level: 'fault',
    text: '显控台链路异常'
  };
}

export function createCabinetBridgePayload(output) {
  return {
    cableId: output.cableId,
    status: output.state,
    variableId: output.variableId,
    signal: output.value,
    normal: output.normal
  };
}

export function runCabinetDemoStep(state, updates = []) {
  const nextState = updates.reduce(
    (currentState, update) => applyCabinetCableUpdate(currentState, update),
    clone(state)
  );

  nextState.stepIndex += 1;
  nextState.time = Number((nextState.time + nextState.stepSize).toFixed(6));

  const outputs = CABLE_LIST.map((cable) => evaluateCableSignal(nextState, cable.id));
  const oscilloscope = appendOscilloscopeSample(nextState, outputs);
  nextState.oscilloscope = oscilloscope;
  const measurements = outputs.flatMap((output) => output.measurements);
  const bridgePayloads = outputs.map(createCabinetBridgePayload);

  return {
    state: nextState,
    outputs,
    measurements,
    oscilloscope,
    consoleStatus: getCabinetConsoleStatus(outputs),
    bridgePayload: bridgePayloads[0],
    bridgePayloads
  };
}
