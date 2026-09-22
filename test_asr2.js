'use strict';
// 按 HA 集成的格式试 ASR：X-Api-Key 鉴权 + 简化帧（无 sequence/event，尾包 flags=0b0010）
const crypto=require('crypto');
const zlib=require('zlib');
const WebSocket=require('ws');
const fs=require('fs');
require('./agent-env')();
const KEY=process.env.DOUBAO_ACCESS_KEY;
const RES=['volc.bigasr.sauc.duration','volc.seedasr.sauc.duration'];
const URL='wss://openspeech.bytedance.com/api/v3/sauc/bigmodel';
function hdr(mtype,flags,serial,compress){return Buffer.from([(1<<4)|1,(mtype<<4)|flags,(serial<<4)|compress,0]);}
function frame(h,p){const s=Buffer.alloc(4);s.writeUInt32BE(p.length);return Buffer.concat([h,s,p]);}
(async()=>{
  const pcm=fs.readFileSync('mic_test.pcm');
  for(const rid of RES){
    await new Promise(res=>{
      const ws=new WebSocket(URL,{headers:{
        'X-Api-Key':KEY,'X-Api-Resource-Id':rid,
        'X-Api-Connect-Id':crypto.randomUUID(),'X-Api-Request-Id':crypto.randomUUID(),'X-Api-Sequence':'-1',
      },handshakeTimeout:8000});
      ws.on('open',()=>{
        console.log(rid,'=> 握手通过');
        const cfg={user:{uid:'coolbuy'},audio:{format:'pcm',codec:'raw',rate:16000,bits:16,channel:1},request:{model_name:'bigmodel',enable_itn:true,enable_punc:true,result_type:'full',show_utterances:true}};
        ws.send(frame(hdr(1,0,1,1),zlib.gzipSync(Buffer.from(JSON.stringify(cfg)))));
        const step=3200;
        let i=0;
        const feed=()=>{
          if(i>=pcm.length){finish();return;}
          const chunk=pcm.slice(i,i+step);i+=step;
          const last=i>=pcm.length;
          ws.send(frame(hdr(2,last?2:0,0,1),zlib.gzipSync(chunk)));
          setTimeout(feed,30);
        };
        setTimeout(feed,200);
        const finish=()=>{};
        setTimeout(()=>{try{ws.close()}catch{};res()},8000);
      });
      ws.on('message',(raw)=>{
        const h=raw[1];const mtype=(h>>4)&0xf;const flags=h&0xf;const serial=(raw[2]>>4)&0xf;const compress=raw[2]&0xf;
        let off=(raw[0]&0xf)*4;
        if(mtype===0xf){console.log(rid,'=> 错误帧:',raw.slice(off+8,off+40).toString());try{ws.close()}catch{};res();return;}
        if(flags&1)off+=4;
        const size=raw.readUInt32BE(off);off+=4;
        let p=raw.slice(off,off+size);
        if(compress===1&&p.length)try{p=zlib.gunzipSync(p)}catch{}
        try{const j=JSON.parse(p.toString());const t=j?.result?.text;if(t)console.log(rid,'=> 识别:',t);}catch{}
        if(flags&2){console.log(rid,'=> 尾包，结束');try{ws.close()}catch{};res();}
      });
      ws.on('unexpected-response',(q,r)=>{console.log(rid,'=> HTTP',r.statusCode);r.resume();res()});
      ws.on('error',e=>{console.log(rid,'=> error',e.message);res()});
    });
  }
  process.exit(0);
})();
