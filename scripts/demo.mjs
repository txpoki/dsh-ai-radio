import { randomUUID } from 'node:crypto';
export function wav(seconds = 5, frequency = 220) {
  const rate = 16000; const length = Math.floor(rate * seconds); const bytes = Buffer.alloc(44 + length * 2);
  bytes.write('RIFF',0); bytes.writeUInt32LE(36 + length * 2,4); bytes.write('WAVEfmt ',8); bytes.writeUInt32LE(16,16); bytes.writeUInt16LE(1,20); bytes.writeUInt16LE(1,22); bytes.writeUInt32LE(rate,24); bytes.writeUInt32LE(rate*2,28); bytes.writeUInt16LE(2,32); bytes.writeUInt16LE(16,34); bytes.write('data',36); bytes.writeUInt32LE(length*2,40);
  for(let i=0;i<length;i++){ const t=i/rate; const envelope=Math.min(1,t*4,(seconds-t)*4); const sound=Math.sin(t*frequency*Math.PI*2)*0.055+Math.sin(t*frequency*1.5*Math.PI*2)*0.025;bytes.writeInt16LE(Math.round(32767*sound*Math.max(0,envelope)),44+i*2); }
  return bytes;
}
export function attachDemo(service, { seconds = 35 } = {}) {
  const now = Date.now();
  const titles=['晨雾来信','沿海公路','晚风有回音','星期天的云','雨后森林','微光与潮汐','慢慢出发','街角咖啡','日落之前','山谷里的风','人间漫游','给明天的信'];
  const songs=titles.map((title,i)=>({id:String(1001+i),title,artists:[['回声旅人','海岸线计划','森林信号'][i%3]+'（演示）'],album:'合成测试音乐 · 不使用真实歌曲',interval:seconds,playlistNames:[['清晨散步','深夜留白','城市漫游'][i%3]]}));
  Object.assign(service.store.state,{cookie:'DEMO_ONLY',account:{userId:'demo',nickname:'你的音乐空间 · 演示'},library:songs,playlists:[0,1,2].map((x)=>({id:String(x+1),name:['清晨散步','深夜留白','城市漫游'][x],creator:'演示歌单',trackCount:4})),librarySyncedAt:now});
  service.store.state.settings.selectedPlaylistIds=['1','2','3'];
  service.store.state.settings.crossfadeSeconds=Math.min(6,seconds/4);
  service.context.assemble=async()=>({now:Date.now(),localTime:new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}),weather:{city:'上海',temperature:21,description:'多云（演示）',low:17,high:24,rain:10,source:'演示数据'},news:[{id:'demo-news',title:'这是一条本地演示资讯，不是真实新闻',summary:'本预览用于验证界面、声音与歌曲过渡。连接真实账号后，会读取当天的实际新闻来源。',url:'https://github.com/txpoki/dsh-ai-radio',publishedAt:Date.now(),source:'演示数据',category:'演示'}],interests:'音乐、生活',extraContext:'演示',newsFailures:[]});
  service.planner.generate=async(_cfg,_llm,_prompt,payload)=>JSON.stringify({songs:payload.candidates.slice(0,4).map((x,i)=>({id:x.id,intro:['沿着这段旋律，给忙碌的今天留一点空白。','换一首轻快的歌，继续向前。','这段音乐适合慢下来，听听自己的节奏。','让下一段旋律，陪我们走远一点。'][i]})),opening:'这里是 Aurora FM 的本地演示，所有音乐都是合成测试音频。',joke:'音乐播放器最擅长的一件事，就是遇到难题的时候先暂停一下。'});
  service.speech.prepare=async()=>{const id=randomUUID();service.speech.audio.set(id,{bytes:wav(.45,440),type:'audio/wav'});return{provider:'demo',url:'/dsh-ai-radio/speech/audio/'+id};};
  service.music.loadLibrary=async(ids)=>{service.store.state.settings.selectedPlaylistIds=ids;return{count:songs.length,failures:[]};};
  service.music.syncPlaylists=async()=>service.store.state.playlists;
  service.music.logout=()=>{};
  const audio=new Map(songs.map((s,i)=>[s.id,wav(seconds,174+i*11)]));
  service.streamTrack=async(id,req,res)=>{
    const bytes=audio.get(id);if(!bytes){res.writeHead(404);return res.end();}
    let start=0,end=bytes.length-1;const match=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');
    if(match){start=Number(match[1]);end=match[2]?Math.min(end,Number(match[2])):end;}
    if(start> end){res.writeHead(416,{'Content-Range':`bytes */${bytes.length}`});return res.end();}
    res.writeHead(match?206:200,{'Content-Type':'audio/wav','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(match?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})});res.end(req.method==='HEAD'?undefined:bytes.subarray(start,end+1));
  };
  return service;
}
