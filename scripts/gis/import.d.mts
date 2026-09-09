export interface Origin { longitude:number; latitude:number; elevation:number; }
export function project(lon:number,lat:number,origin:Origin):[number,number];
export function haversine(p:number[],q:number[]):number;
export function signedArea(ring:number[][]):number;
export function contains(ring:number[][],point:number[]):boolean;
export function stitch(ways:number[][]):number[][];
