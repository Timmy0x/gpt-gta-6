using CUE4Parse.FileProvider;
using CUE4Parse.UE4.Versions;
using CUE4Parse.UE4.Assets.Exports.SkeletalMesh;
using Newtonsoft.Json;
using CUE4Parse.UE4.Assets.Exports.Texture;
using Serilog;
Log.Logger = new LoggerConfiguration().MinimumLevel.Error().WriteTo.Console().CreateLogger();
var source=args.Length>0?args[0]:"/tmp/codex-carla-probe";
var provider = new DefaultFileProvider(source, SearchOption.AllDirectories, true, new VersionContainer(EGame.GAME_UE4_27));
provider.Initialize();
if(args.Contains("--metadata")) {
 foreach(var file in provider.Files.Keys.Where(p=>p.EndsWith(".uasset"))) {
  try {
   var pkg=provider.LoadPackage(file); var exports=pkg.GetExports().ToArray();
   foreach(var obj in exports) {
    if(obj is UTexture texture && texture.SourceArt?.Data is byte[] data) {File.WriteAllBytes(Path.Combine(source,texture.Name+".sourcebin"),data);Console.WriteLine("TEXTURE "+texture.Name+" "+data.Length);}
   }
   File.WriteAllText(Path.Combine(source,Path.GetFileNameWithoutExtension(file)+".metadata.json"),JsonConvert.SerializeObject(exports,Formatting.Indented));
  }catch(Exception e){Console.WriteLine("ERROR "+file+" "+e.Message);}
 }
 return;
}
foreach(var file in provider.Files.Keys.Where(p=>p.EndsWith(".uasset") && !p.Contains("Skeleton") && (Path.GetFileName(p).StartsWith("SK_") || Path.GetFileName(p).StartsWith("SM_")))) {
 var package=provider.LoadPackage(file);var mesh=package.GetExports().OfType<USkeletalMesh>().FirstOrDefault();
 if(mesh==null)continue;
 if(mesh.LODModels==null)throw new Exception("Source LOD data absent: "+file);
 var bones=mesh.ReferenceSkeleton.FinalRefBoneInfo.Select((b,i)=>new {name=b.Name.Text,parent=b.ParentIndex,pose=mesh.ReferenceSkeleton.FinalRefBonePose[i]}).ToArray();
 var materials=mesh.SkeletalMaterials.Select(m=>m.MaterialSlotName.Text).ToArray();
 var materialRefs=mesh.SkeletalMaterials.Select(m=>m.MaterialInterface).ToArray();
 var lods=mesh.LODModels.Select((lod,i)=>new {level=i,indices=lod.Indices.Buffer,vertexCount=lod.NumVertices,sections=lod.Sections.Select(s=>new {material=s.MaterialIndex,baseIndex=s.BaseIndex,triangles=s.NumTriangles,baseVertex=s.BaseVertexIndex,boneMap=s.BoneMap,vertices=s.SoftVertices.Select(v=>new {p=new[]{v.Pos.X,v.Pos.Y,v.Pos.Z},n=new[]{v.Normal[2].X,v.Normal[2].Y,v.Normal[2].Z},uv=new[]{v.UVs[0].U,v.UVs[0].V},bones=v.Infs.BoneIndex,weights=v.Infs.BoneWeight}).ToArray()}).ToArray()}).ToArray();
 var output=Path.Combine(source,mesh.Name+"-geometry.json");File.WriteAllText(output,JsonConvert.SerializeObject(new{name=mesh.Name,bones,materials,materialRefs,lods}));
 Console.WriteLine("EXPORTED "+output+" "+new FileInfo(output).Length+" bytes "+lods.Length+" LODs");
}
