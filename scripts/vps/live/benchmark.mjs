// Root-only offline capacity comparison using a private captured TS sample.
// Never run alongside a production encoder. No network sources or published endpoints.
import { readdir, writeFile, mkdir, rm } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { ffmpegArguments, renditionsFor } from './server.mjs';
const root = process.argv[2];
if (!root || !path.isAbsolute(root)) throw new Error('A private absolute sample directory is required');
const files = (await readdir(root)).filter(f => /^seg_\d+\.ts$/.test(f)).sort();
if (!files.length) throw new Error('No captured TS segments');
await writeFile(path.join(root,'list.txt'), files.map(f=>`file '${f}'`).join('\n'));
const sample = path.join(root,'sample.ts');
const merge = spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',path.join(root,'list.txt'),'-t','24','-map','0:v:0','-map','0:a:0?','-c','copy',sample],{timeout:30000});
if (merge.status !== 0) throw new Error('Cannot build the private sample');
const probe = spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate,profile,level','-of','json',sample]);
const v=JSON.parse(probe.stdout).streams[0];const [n,d]=v.r_frame_rate.split('/').map(Number);
const profile={width:v.width,height:v.height,fps:n/(d||1),profile:/high/i.test(v.profile)?'high':/main/i.test(v.profile)?'main':'baseline',level:(v.level||40)/10,codecs:'avc1.640028',bandwidth:5000000};
const renditions=renditionsFor(profile);
function cascade(){const descending=renditions.filter(r=>r.name!=='original').slice().reverse();let previous='0:v:0';return descending.map((r,i)=>{const index=renditions.indexOf(r);const scale=`[${previous}]scale=${r.width}:${r.height}:force_original_aspect_ratio=decrease:flags=fast_bilinear,pad=${r.width}:${r.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;previous=`scale${i}`;return scale+(i<descending.length-1?`,split=2[out${index}][${previous}]`:`[out${index}]`)}).join(';')}
for(const mode of ['baseline','parallel720','cascade720']){
 const directory=path.join(root,'output-'+mode);await Promise.all(renditions.map(r=>mkdir(path.join(directory,r.name),{recursive:true,mode:0o700})));
 let args=ffmpegArguments(sample,directory,profile,renditions);const httpFlags=new Set(['-rw_timeout','-reconnect','-reconnect_streamed','-reconnect_delay_max','-user_agent','-live_start_index']);
 args=args.filter((value,i)=>!httpFlags.has(value)&&!httpFlags.has(args[i-1]));
 const at=args.indexOf('-i');args.splice(at,0,'-stream_loop','-1');
 if(mode!=='baseline'){
  const threads=args.map((x,i)=>x==='-threads'?i:-1).filter(i=>i>=0);args[threads.at(-1)+1]='2';
 }
 if(mode==='cascade720')args[args.indexOf('-filter_complex')+1]=cascade();
 args=args.flatMap(x=>x==='-output_ts_offset'?['-t','30',x]:[x]);
 const start=Date.now();let child;let latest={};let text='';
 try{
  child=spawn('nice',['-n','10','ffmpeg',...args],{stdio:['ignore','ignore','ignore','pipe']});
  child.stdio[3].on('data',data=>{text+=data.toString();const lines=text.split('\n');text=lines.pop()||'';for(const line of lines){const at=line.indexOf('=');if(at>0)latest[line.slice(0,at)]=line.slice(at+1)}});
  const timer=setTimeout(()=>child.kill('SIGKILL'),90000);
  const code=await new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject)});clearTimeout(timer);
  console.log(JSON.stringify({mode,exit:code,wallSeconds:+((Date.now()-start)/1000).toFixed(2),reportedSpeed:latest.speed,mediaSeconds:Number(latest.out_time_us)/1e6}));
 }finally{child?.kill('SIGTERM');await rm(directory,{recursive:true,force:true})}
}
