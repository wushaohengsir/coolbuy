'use strict';
// 组合鉴权试 ASR：X-Api-Key 分别试 access key / app id，并保留 A 路线那套头
const crypto=require('crypto');
const zlib=require('zlib');
const WebSocket=require('ws');
const fs=require('fs');
require('./agent-env')();
const URL='wss://openspeech.bytedance.com/api/v3/sauc/bigmodel';
function hdr(m,f,s,c){return Buffer.from([(1<<4)|1,(m<<4)|f,(s<<4)|c,0]);}
function frame(h,p){const s=Buffer.alloc(4);s.writeUInt32BE(p.length);return Buffer.concat([h,s,p]);}
(async()=>{
  const pcm=fs.readFileSync('mic_test.pcm');
  const combos=[
    ['apiKey=AccessKey+rid=bigasr.duration',{ 'X-Api-Key':process.env.DOUBAO_ACCESS_KEY,'X-Api-Resource-Id':'volc.bigasr.sauc.duration' }],
    ['apiKey=AccessKey+rid=seedasr',{ 'X-Api-Key':process.env.DOUBAO_ACCESS_KEY,'X-Api-Resource-Id':'volc.seedasr.sauc.duration' }],
    ['A路线头(AppKey/AppID/AccessKey)+rid=bigasr.duration',{
      'X-Api-App-Key':process.env.DOUBAO_APP_ID,'X-Api-Access-Key':process.env.DOUBAO_ACCESS_KEY,
      'X-Api-App-ID':process.env.DOUBAO_APP_ID,'X-Api-Resource-Id':'volc.bigasr.sauc.duration'}],
  ];
  for(const [name,hdrs] of combos){
    await new Promise(res=>{
      const ws=new WebSocket(URL,{headers:{...hdrs,'X-Api-Connect-Id':crypto.randomUUID(),'X-Api-Request-Id':crypto.randomUUID(),'X-Api-Sequence':'-1'},handshakeTimeout:8000});
      let got=false;
      ws.on('open',()=>{
        console.log(name,'=> 握手通过');
        const cfg={user:{uid:'coolbuy'},audio:{format:'pcm',codec:'raw',rate:16000,bits:16,channel:1},request:{model_name:'bigmodel',enable_itn:true,enable_punc:true,result_type:'full',show_utterances:true}};
        ws.send(frame(hdr(1,0,1,1),zlib.gzipSync(Buffer.from(JSON.stringify(cfg)))));
        let i=0;const step=3200;
        const feed=()=>{
          if(i>=pcm.length)return;
          const chunk=pcm.slice(i,i+step);i+=step;
          ws.send(frame(hdr(2,i>=pcm.length?2:0,0,1),zlib.gzipSync(chunk)));
          setTimeout(feed,30);
        };
        setTimeout(feed,200);
      });
      ws.on('message',(raw)=>{
        got=true;
        const mtype=(raw[1]>>4)&0xf,flags=raw[1]&0xf,serial=(raw[2]>>4)&0xf,compress=raw[2]&0xf;
        let off=(raw[0]&0xf)*4;
        if(mtype===0xf){console.log('  错误帧:',raw.slice(off+8,off+60).toString());try{ws.close()}catch{};return;}
        if(flags&1)off+=4;
        const size=raw.readUInt32BE(off);off+=4;
        let p=raw.slice(off,off+size);
        if(compress===1&&p.length)try{p=zlib.gunzipSync(p)}catch{}
        try{const j=JSON.parse(p.toString());const t=j?.result?.text;if(t)console.log('  识别:',t);}catch{}
        if(flags&2){console.log('  （尾包结束）');try{ws.close()}catch{};}
      });
      ws.on('unexpected-response',(q,r)=>{console.log(name,'=> HTTP',r.statusCode);r.resume();res()});
      ws.on('error',e=>{console.log(name,'=> error',e.message);res()});
      ws.on('close',()=>res());
      setTimeout(()=>{try{ws.close()}catch{};res()},10000);
    });
  }
  process.exit(0);
})();
