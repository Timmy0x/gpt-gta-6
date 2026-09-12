import type { MiamiDataset, MiamiPolygon } from './types';
export function insideMiamiPolygon(x: number, z: number, polygon: MiamiPolygon): boolean {
  const inside = (ring: MiamiPolygon[number]) => { let result=false; for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])result=!result;
  }return result; };
  return !!polygon.length&&inside(polygon[0])&&!polygon.slice(1).some(inside);
}
export function inMiamiBounds(point: {x:number;z:number},bounds:MiamiDataset['bounds'],margin=0){return Number.isFinite(point.x)&&Number.isFinite(point.z)&&point.x>=bounds.minX+margin&&point.x<=bounds.maxX-margin&&point.z>=bounds.minZ+margin&&point.z<=bounds.maxZ-margin;}
