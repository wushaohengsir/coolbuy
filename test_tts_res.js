'use strict';
const crypto=require('crypto');
const WebSocket=require('ws');
require('./agent-env')();
const candidates=[
  'volc.service_type.10029',
  'volc.megatts.default',
  'volc.tts.seed-2.0',
  'volc.tts.seed2',
  'volc.service_type.10074',
  'volc.seedtts.default',
];
(async()=>{
  const url='wss://openspeech.bytedance.com/api/v3/tts/bidirection';
  for(const rid of candidates){
    await new Promise(res=>{
      const ws=new WebSocket(url,{headers:{
        'X-Api-App-Key':process.env.DOUBAO_APP_ID,
        'X-Api-Access-Key':process.env.DOUBAO_ACCESS_KEY,
        'X-Api-Resource-Id':rid,
        'X-Api-Request-Id':crypto.randomUUID(),
        'X-Api-Connect-Id':crypto.randomUUID(),
      },handshakeTimeout:8000});
      const t=setTimeout(()=>{console.log(rid,'超时');try{ws.close()}catch{};res()},10000);
      ws.on('open',()=>{console.log(rid,'=> 握手通过');clearTimeout(t);ws.close();res()});
      ws.on('unexpected-response',(q,r)=>{console.log(rid,'=> HTTP',r.statusCode);r.resume();clearTimeout(t);res()});
      ws.on('error',e=>{console.log(rid,'=> error',e.message);clearTimeout(t);res()});
    });
  }
  process.exit(0);
})();
