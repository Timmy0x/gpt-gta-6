import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeFrames} from '../src/core/PerformanceReport';

test('performance summary keeps a real stall in its duration and slowest-one-percent result',()=>{
  const raw=Array.from({length:200},()=>1000/60);raw[12]=500;raw[179]=100;
  const result=summarizeFrames(raw);
  assert.equal(result.frames,200);
  assert.ok(Math.abs(result.medianFps!-60)<1e-9);
  assert.ok(Math.abs(result.onePercentLowFps!-1000/300)<1e-9);
  assert.equal(result.maxFrameMs,500);
  assert.equal(result.framesOver33ms,2);assert.equal(result.framesOver100ms,1);
  assert.ok(Math.abs(result.activeDurationMs-(198*1000/60+600))<1e-6);
  assert.equal(raw[12],500,'report never mutates collected samples');
});
test('no measured frames produces unavailable metrics instead of fictional zero or infinite FPS',()=>{
  const result=summarizeFrames([Number.NaN,0,-5,Infinity]);
  assert.equal(result.frames,0);assert.equal(result.medianFps,null);assert.equal(result.onePercentLowFps,null);
});
