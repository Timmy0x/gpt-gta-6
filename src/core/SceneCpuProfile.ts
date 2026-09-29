import type {Scene} from '@babylonjs/core/scene';
import {SceneInstrumentation} from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import {FrameHistory} from './FrameHistory';

const STAGES = ['collisionStreaming','cameraAndPose','visualTraversal','sceneCpu','physicsCpu','activeMeshEvaluation'] as const;
export type CpuStage = typeof STAGES[number];
function timingSummary(values: number[]) {
  const sorted = values.sort((a,b)=>a-b), n=sorted.length;
  return {samples:n,meanMs:n?sorted.reduce((a,b)=>a+b,0)/n:null,
    medianMs:n?(n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2):null,
    p95Ms:n?sorted[Math.ceil(n*.95)-1]:null,maxMs:n?sorted[n-1]:null};
}
/** Babylon CPU counters plus application stages; never represents GPU or wall-frame time. */
export class SceneCpuProfile {
  private readonly native:SceneInstrumentation;
  private readonly history = Object.fromEntries(STAGES.map(stage=>[stage,new FrameHistory()])) as Record<CpuStage,FrameHistory>;
  private readonly values = Object.fromEntries(STAGES.map(stage=>[stage,0])) as Record<CpuStage,number>;
  private readonly physicsObserver;
  constructor(private scene:Scene) {
    this.native=new SceneInstrumentation(scene);
    this.native.captureFrameTime=true;
    this.native.capturePhysicsTime=true;
    this.native.captureActiveMeshesEvaluationTime=true;
    // Native physics counters measure one substep. Sum every observed substep
    // once, including frames with several fixed steps; held frames stay zero.
    this.physicsObserver=scene.onAfterPhysicsObservable.add(()=>{
      this.values.physicsCpu+=this.native.physicsTimeCounter.current;
    });
  }
  beginFrame():void { for(const stage of STAGES)this.values[stage]=0; }
  record(stage:CpuStage,milliseconds:number):void {
    if(Number.isFinite(milliseconds)&&milliseconds>=0)this.values[stage]+=milliseconds;
  }
  endFrame(active:boolean):void {
    if(!active)return;
    this.values.sceneCpu=this.native.frameTimeCounter.current;
    this.values.activeMeshEvaluation=this.native.activeMeshesEvaluationTimeCounter.current;
    for(const stage of STAGES)this.history[stage].push(this.values[stage]);
  }
  clear():void { for(const stage of STAGES)this.history[stage].clear(); }
  snapshot() {
    return {scope:'Most recent 108000 unpaused rendered frames. Zero-cost held physics frames are retained. CPU stages overlap: sceneCpu includes physics, camera, traversal and active mesh evaluation. Do not sum stages. Asynchronous loader callbacks, idle time, GPU work and inter-frame stalls are outside these stage timings; rawFrameMs retains their effect.',
      stages:Object.fromEntries(STAGES.map(stage=>[stage,timingSummary(this.history[stage].latest())]))};
  }
  dispose():void { this.scene.onAfterPhysicsObservable.remove(this.physicsObserver);this.native.dispose(); }
}
