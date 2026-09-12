import {safeError} from './access';
/** Sanitize framework console arguments without returning original object references. */
export function redactDiagnosticArgs(args:unknown[],secret=''):unknown[]{
 const seen=new WeakSet<object>();
 function clean(value:unknown,depth=0):unknown{
  if(typeof value==='string')return safeError(new Error(value),secret);
  if(value instanceof Error)return {name:value.name,message:safeError(value,secret)};
  if(value instanceof URL)return safeError(new Error(value.href),secret);
  if(!value||typeof value!=='object')return value;
  if(seen.has(value)||depth>4)return '[omitted]';seen.add(value);
  if(Array.isArray(value))return value.slice(0,30).map(v=>clean(v,depth+1));
  const result:Record<string,unknown>={};for(const [key,v]of Object.entries(value).slice(0,30))result[key]=/key|token|session|authorization|credential|password/i.test(key)?'[redacted]':clean(v,depth+1);return result;
 }
 return args.map(value=>clean(value));
}
