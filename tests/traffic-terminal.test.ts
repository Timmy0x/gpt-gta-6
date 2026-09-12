import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from '@babylonjs/core';
import type { RoadNode } from '../src/core/contracts';
import { Population } from '../src/gameplay/Population';
import { terminalApproachDistance, terminalSpeedLimit } from '../src/gameplay/TrafficRoute';

const node = (id: number, x: number, z: number, next: number[]): RoadNode => ({id,x,z,next});
const map = (roads: RoadNode[]) => new Map(roads.map(n => [n.id,n]));

test('terminal lookahead follows curved road length, respects 60 m and reserves six metres', () => {
  const roads = [node(0,0,10,[1]),node(1,30,10,[2]),node(2,30,30,[])];
  assert.equal(terminalApproachDistance(map(roads),roads[0],{x:0,z:0}),60);
  assert.equal(terminalApproachDistance(map(roads),roads[0],{x:0,z:-1}),null);
  assert.equal(terminalSpeedLimit(6),0);
  assert.equal(terminalSpeedLimit(2),0);
  assert.equal(terminalSpeedLimit(26),10);
});

test('branches, cycles and zero-length cycles do not invent terminal routes', () => {
  for (const roads of [
    [node(0,0,0,[1,2]),node(1,0,10,[]),node(2,10,0,[])],
    [node(0,0,0,[1]),node(1,0,10,[0])],
    [node(0,0,0,[0])],
  ]) assert.equal(terminalApproachDistance(map(roads),roads[0],{x:0,z:0}),null);
  const broken = node(3,0,25,[999]);
  assert.equal(terminalApproachDistance(map([broken]),broken,{x:0,z:0}),25);
});

function population(roads: RoadNode[], target: number, z: number, speed = 0) {
  const inputs: Array<{throttle:number;steer:number;brake:number;handbrake:boolean}> = [];
  const vehicle = {root:{position:new Vector3(0,0,z),forward:Vector3.Forward(),right:Vector3.Right()},speed,occupied:false,tuning:{width:2}};
  const driver = {v:vehicle,target,previous:-1,police:false,stuck:7};
  const p = Object.create(Population.prototype) as Population;
  Object.assign(p, {
    ticks:0, rng:()=>0, world:{roads}, drivers:[driver], pedestrians:[],
    player:{position:new Vector3(100,0,100),vehicle:{},deadTimer:0},
    police:{officers:[],update(){}}, facility:{guards:[],update(){}},
    occupancy:{update(){},canDrive:()=>true,get:()=>({panic:20})},
    vehicles:{list:[vehicle],control:(_v:unknown,input:typeof inputs[number])=>inputs.push(input)},
    density:1,trafficDensity:1,policeEnabled:false,
  });
  return {p,driver,vehicle,inputs};
}

test('actual Population holds the terminal target and brakes indefinitely without reversing', () => {
  const roads = [node(4,0,30,[])];
  const {p,driver,inputs} = population(roads,4,24,.2);
  for (let i=0;i<120;i++) p.update(.1);
  assert.equal(driver.target,4);
  assert.equal(driver.previous,-1);
  assert.equal(driver.stuck,0);
  assert.ok(inputs.every(input=>input.throttle===0&&input.brake===1&&input.handbrake));
  assert.deepEqual(roads[0].next,[]);
});

test('actual Population brakes before a chained terminal even for a frightened driver', () => {
  const {p,driver,inputs} = population([node(0,0,10,[1]),node(1,0,20,[])],0,0,12);
  p.update(.1);
  assert.equal(driver.target,0);
  assert.equal(driver.stuck,0);
  assert.equal(inputs.at(-1)?.throttle,0);
  assert.equal(inputs.at(-1)?.brake,.75);
});

test('actual Population actively clears stale throttle on missing targets and broken links', () => {
  for (const [roads,target,z] of [
    [[],999,0], [[node(0,0,10,[999])],0,5],
  ] as Array<[RoadNode[],number,number]>) {
    const {p,inputs,driver} = population(roads,target,z,10);
    p.update(.1);
    assert.deepEqual(inputs.at(-1),{throttle:0,steer:0,brake:1,handbrake:true,lift:0});
    assert.equal(driver.stuck,0);
  }
});

test('actual Population advances to a real successor and then retains that terminal', () => {
  const {p,driver,vehicle,inputs} = population([node(0,0,10,[1]),node(1,0,30,[])],0,5,4);
  p.update(.1);
  assert.equal(driver.target,1);
  assert.equal(driver.previous,0);
  vehicle.root.position.z=24;
  p.update(.1);
  assert.equal(driver.target,1);
  assert.equal(inputs.at(-1)?.brake,1);
  assert.equal(inputs.at(-1)?.throttle,0);
});
