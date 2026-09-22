'use strict';
const crypto=require('crypto');
const WebSocket=require('ws');
require('./agent-env')();
const candidates=['volc.bigasr.sauc.duration','volc.seedasr.sauc.duration','volc.bigasr.sauc.concurrent','volc.megasr.default'];
(async()=>{
  const url='wss://openspeech.bytedance.com/api/v3/sauc/bigmodel';
  for(const rid of candidates){
    await new Promise(res=>{
      const ws=new WebSocket(url,{headers:{
        'X-Api-App-Key':process.env.DOUBAO_APP_ID,
        'X-Api-Access-Key':process.env.DOUBAO_ACCESS_KEY,
        'X-Api-Resource-Id':rid,
        'X-Api-Request-Id':crypto.randomUUID(),
        'X-Api-Connect-Id':crypto.randomUUID(),
      },handshakeTimeout:8000});
      const t=setTimeout(()=>{console.log(rid,'=> 超时');try{ws.close()}catch{};res()},10000);
      ws.on('open',()=>{console.log(rid,'=> 握手通过');clearTimeout(t);ws.close();res()});
      ws.on('unexpected-response',(q,r)=>{console.log(rid,'=> HTTP',r.statusCode);r.resume();clearTimeout(t);res()});
      ws.on('error',e=>{console.log(rid,'=> error',e.message);clearTimeout(t);res()});
    });
  }
  process.exit(0);
})();
