/** Three bounded primary metadata queries; retains publication/source dates, no DEM/imagery download. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../../../data/world/miami/expansions/downtown-edge-r5/metadata/',import.meta.url);
const hash=b=>createHash('sha256').update(b).digest('hex');
async function metadata(url,name,json=true,requestName=name){
 try{
  const request=JSON.parse(await readFile(new URL(requestName+'-request.json',root),'utf8')),bytes=await readFile(new URL(name+(json?'.json':'.xml'),root));
  if(request.url!==url||hash(bytes)!==request.sha256)throw new Error('Retained metadata cohort mismatch');return json?JSON.parse(bytes.toString()):bytes;
 }catch(error){if(error.code!=='ENOENT')throw error;}
 const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`Metadata HTTP${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>2*1024*1024)throw new Error('Metadata exceeds bounded2MiB budget');
 await writeFile(new URL(name+(json?'.json':'.xml'),root),bytes);await writeFile(new URL(requestName+'-request.json',root),JSON.stringify({url,retrieved:new Date().toISOString(),sha256:hash(bytes),bytes:bytes.length},null,2)+'\n');return json?JSON.parse(bytes.toString()):bytes;
}
const products=await metadata('https://tnmaccess.nationalmap.gov/api/v1/products?'+new URLSearchParams({datasets:'Digital Elevation Model (DEM) 1 meter',bbox:'-80.199,25.7704,-80.193,25.7758',max:'5',outputFormat:'JSON'}),'usgs-tnm-products',true,'usgs-tnm');
const product=products.items.find(item=>item.title==='USGS 1 Meter 17 x58y286 FL_MiamiDade_D23');if(!product)throw new Error('Expected bounded D23 product missing');
const item=await metadata(product.metaUrl+'?format=json','usgs-sciencebase-item',true,'usgs-sciencebase');
const link=item.webLinks.find(link=>link.title==='Product Metadata');if(!link?.uri.startsWith('https://thor-f5.er.usgs.gov/'))throw new Error('Unexpected primary metadata URL');
await metadata(link.uri,'usgs-dem-product',false);
console.log(JSON.stringify({publication:product.publicationDate,dates:item.dates,policy:'Dates retained by original labels; publication/catalog fields are not silently treated as per-point acquisition epochs'}));
