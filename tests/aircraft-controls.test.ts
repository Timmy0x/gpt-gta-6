import test from 'node:test';
import assert from 'node:assert/strict';
import { aircraftInput, aircraftPrompt } from '../src/vehicles/aircraft';
import { DEFAULT_BINDINGS, type Action, type Input } from '../src/core/Input';

const controls=(held: Action[])=>({down:(action: Action)=>held.includes(action),axis:(axis:'x'|'y')=>axis==='y'?(held.includes('forward')?1:held.includes('back')?-1:0):0});

test('Space / gamepad A is collective or elevator in aircraft, without applying the wheel handbrake',()=>{
  for(const kind of ['helicopter','plane'] as const){
    const value=aircraftInput(controls(['jump','forward']),kind,30);
    assert.equal(value.lift,1);assert.equal(value.handbrake,false);assert.equal(value.throttle,1);
    assert.equal(aircraftInput(controls(['sprint']),kind,0).lift,1,'Shift / L3 remains an alternative');
    assert.equal(aircraftInput(controls(['crouch']),kind,0).lift,-1,'C / B commands descent');
    assert.equal(aircraftInput(controls(['jump','crouch']),kind,0).lift,0,'opposing commands cancel');
  }
  assert.equal(aircraftInput(controls(['jump']),'coupe',12).handbrake,true,'ground vehicle handbrake remains available');
  assert.equal(aircraftInput(controls(['jump']),'coupe',12).lift,0);
  assert.equal(aircraftInput(controls(['back']),'plane',30).brake,1,'landing wheel brakes are still S');
});

test('aircraft instructions expose required lift, change after runway acceleration, and follow remapped keys or gamepad',()=>{
  const input={bindings:{...DEFAULT_BINDINGS},gamepad:null};
  const v={kind:'plane' as const,speed:0,grounded:3,health:100,engineRunning:true};
  assert.match(aircraftPrompt(v,input),/Accelerate to 90 km\/h.*SPACE \/ SHIFT/);
  assert.match(aircraftPrompt({...v,speed:30,grounded:0},input),/Nose up.*Nose down/);
  input.bindings.jump='KeyQ';input.bindings.sprint='ControlLeft';
  assert.match(aircraftPrompt({...v,kind:'helicopter'},input),/Q \/ CONTROL.*Rise/);
  assert.match(aircraftPrompt({...v,kind:'helicopter'},{...input,gamepad:{} as Input['gamepad']}),/A \/ L3.*B.*Descend/);
});
