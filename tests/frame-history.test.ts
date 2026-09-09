import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameHistory } from '../src/core/FrameHistory';

test('long-session frame history retains raw stalls in chronological order across repeated wraps', () => {
  const history = new FrameHistory(1800);
  for (let i = 0; i < 120000; i++) history.push(i === 119500 ? 2000 : 10 + i / 1e6);
  const tail = history.latest();
  assert.equal(tail.length, 1800);
  assert.equal(tail[0], 10 + 118200 / 1e6);
  assert.equal(tail[1300], 2000, 'stalls remain raw rather than being clamped out of performance evidence');
  assert.equal(tail[1799], 10 + 119999 / 1e6);
  assert.deepEqual(history.latest(3), tail.slice(-3));
  history.push(Number.NaN);
  assert.deepEqual(history.latest(3), tail.slice(-3));
});
