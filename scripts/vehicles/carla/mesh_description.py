"""Strict reader for observed CARLA UE4.27 dense MeshDescription bulk data.
Independent implementation from serialized data and documented element semantics.
Rejects sparse arrays, polygon holes and unrecognized attribute schemas.
"""
import struct,zlib,math,json,pathlib,sys
class Reader:
 def __init__(self,b):self.b=b;self.p=0
 def ints(self,n=1):
  a=struct.unpack_from('<'+str(n)+'i',self.b,self.p);self.p+=4*n;return a if n!=1 else a[0]
 def string(self):
  n=self.ints();assert 0<n<1024,('string',self.p,n);v=self.b[self.p:self.p+n];assert v[-1]==0;self.p+=n;return v[:-1].decode().strip()
 def dense(self):
  n=self.ints();assert 0<=n<5000000
  words=(n+31)//32;mask=struct.unpack_from('<'+str(words)+'I',self.b,self.p);self.p+=words*4
  assert all(x==0xffffffff for x in mask[:-1]);assert not mask or mask[-1]==(1<<(n%32 or 32))-1
  return n
 def attributes(self):
  n=self.ints();k=self.ints();assert 0<=k<20;result={}
  for _ in range(k):
   name=self.string();kind=self.ints();count=self.ints();channels=self.ints();assert count==n and 0<channels<10
   typ={0:('4f',16),1:('3f',12),2:('2f',8),3:('f',4),4:('i',4),5:('B',1),6:('name',None)}[kind];data=[]
   for ch in range(channels):
    if kind==6:
     length=self.ints();assert length==count;data.append([self.string() for _ in range(length)])
    else:
     stride=self.ints();length=self.ints();assert stride==typ[1] and length==count,(name,kind,stride,length,count)
     data.append(list(struct.iter_unpack('<'+typ[0],self.b[self.p:self.p+stride*length])));self.p+=stride*length
   if kind==6:default=self.string()
   else:self.p+=4 if kind==5 else typ[1]
   flags=self.ints();result[name]=data
  return n,result

def decompress(path):
 b=pathlib.Path(path).read_bytes();tag=struct.pack('<Q',0x9E2A83C1);candidates=[];start=0
 while True:
  p=b.find(tag,start)
  if p<0:break
  start=p+8
  if p+32>len(b):continue
  _,chunk,compressed,total=struct.unpack_from('<4Q',b,p)
  if chunk!=131072 or not 0<total<200000000:continue
  n=math.ceil(total/chunk);sizes=[struct.unpack_from('<QQ',b,p+32+i*16) for i in range(n)];p+=32+n*16;result=[]
  try:
   for c,u in sizes:
    raw=zlib.decompress(b[p:p+c]);assert len(raw)==u;result.append(raw);p+=c
   raw=b''.join(result);assert len(raw)==total;candidates.append(raw)
  except (zlib.error,AssertionError):continue
 assert len(candidates)==1,('bulk candidates',len(candidates));return candidates[0]

def parse(path):
 raw=decompress(path);r=Reader(raw)
 nv=r.dense();ni=r.dense();instances=r.ints(ni);assert min(instances)>=0 and max(instances)<nv
 ne=r.dense();edges=r.ints(ne*2);assert min(edges)>=0 and max(edges)<nv
 np=r.dense();polygons=[r.ints(2) for _ in range(np)];assert all(x[0]==0 for x in polygons),('polygon holes',set(x[0] for x in polygons))
 ng=r.dense();assert all(0<=x[1]<ng for x in polygons)
 n,va=r.attributes();assert n==nv
 n,ia=r.attributes();assert n==ni
 n,ea=r.attributes();assert n==ne
 n,pa=r.attributes();assert n==np
 n,ga=r.attributes();assert n==ng
 nt=r.dense();triangles=[r.ints(4) for _ in range(nt)];assert all(0<=v<ni for t in triangles for v in t[:3]);assert all(0<=t[3]<np for t in triangles)
 n,ta=r.attributes();assert n==nt;assert r.p==len(raw),(r.p,len(raw))
 positions=va['Position'][0];normals=ia['Normal'][0];uv=ia['TextureCoordinate'][0]
 result={'source':str(path),'materials':ga['ImportedMaterialSlotName'][0], 'vertices':[{'p':positions[instances[i]],'n':normals[i],'uv':uv[i]} for i in range(ni)],'triangles':[{'v':t[:3],'material':polygons[t[3]][1]} for t in triangles]}
 print(pathlib.Path(path).name,'vertices',nv,'corners',ni,'triangles',nt,'materials',result['materials'],'bounds',[[min(v[i] for v in positions),max(v[i] for v in positions)] for i in range(3)])
 return result
if __name__=='__main__':
 for p in sys.argv[1:]:
  j=parse(p);pathlib.Path(p).with_suffix('.mesh.json').write_text(json.dumps(j,separators=(',',':')))
