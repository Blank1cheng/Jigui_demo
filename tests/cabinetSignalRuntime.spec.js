import { describe, expect, it } from 'vitest';
import {
  CABINET_DEMO_CABLES,
  createCabinetDemoState,
  evaluateCableSignal,
  runCabinetDemoStep
} from '../src/services/cabinetSignalRuntime.js';

describe('cabinetSignalRuntime', () => {
  it('reports the initial cabinet cable as disconnected', () => {
    const state = createCabinetDemoState();
    const signal = evaluateCableSignal(state, CABINET_DEMO_CABLES.mainPower.id);

    expect(signal).toMatchObject({
      cableId: 'WIRE-JG-A-B-001',
      state: 'disconnected',
      value: 0,
      normal: false
    });
  });

  it('uses a same-step operator update before calculating outputs', () => {
    const result = runCabinetDemoStep(createCabinetDemoState(), [
      {
        cableId: 'WIRE-JG-A-B-001',
        connected: true,
        sourcePortId: 'A-X1',
        targetPortId: 'B-X1'
      }
    ]);

    expect(result.outputs[0]).toMatchObject({
      variableId: 'jg.mid.power_bus.ready',
      state: 'connected',
      value: 1,
      normal: true
    });
    expect(result.bridgePayload).toMatchObject({
      cableId: 'WIRE-JG-A-B-001',
      signal: 1,
      normal: true
    });
  });

  it('records oscilloscope samples across manual and continuous steps', () => {
    const first = runCabinetDemoStep(createCabinetDemoState());
    const second = runCabinetDemoStep(first.state, [
      {
        cableId: 'WIRE-JG-A-B-001',
        connected: true,
        sourcePortId: 'A-X1',
        targetPortId: 'B-X1'
      }
    ]);

    expect(first.oscilloscope.samples).toEqual([
      expect.objectContaining({
        stepIndex: 1,
        signal: 0,
        normal: false
      })
    ]);
    expect(second.oscilloscope.samples).toHaveLength(2);
    expect(second.oscilloscope.samples[1]).toMatchObject({
      stepIndex: 2,
      signal: 1,
      normal: true
    });
  });
});
