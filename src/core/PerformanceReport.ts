/** Summaries use raw active-frame durations, retaining stalls rather than clamping them. */
export function summarizeFrames(raw: readonly number[]) {
  const values=raw.filter(v=>Number.isFinite(v)&&v>0),sorted=[...values].sort((a,b)=>a-b);
  const count=sorted.length;
  if(!count)return {frames:0,activeDurationMs:0,medianFrameMs:null,medianFps:null,onePercentLowFps:null,maxFrameMs:null,framesOver33ms:0,framesOver100ms:0};
  const median=count%2?sorted[(count-1)/2]:(sorted[count/2-1]+sorted[count/2])/2;
  const slowest=sorted.slice(count-Math.max(1,Math.ceil(count*.01)));
  return {
    frames:count,
    activeDurationMs:values.reduce((a,b)=>a+b,0),
    medianFrameMs:median,
    medianFps:1000/median,
    onePercentLowFps:1000/(slowest.reduce((a,b)=>a+b,0)/slowest.length),
    maxFrameMs:sorted[count-1],
    framesOver33ms:values.filter(v=>v>1000/30).length,
    framesOver100ms:values.filter(v=>v>100).length,
  };
}
