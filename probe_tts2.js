'use strict';
const crypto=require('crypto');
const WebSocket=require('ws');
const P=require('./protocol');
require('./agent-env')();
const variant=parseInt(process.argv[2]||'1');
(async()=>{
  const ws=new WebSocket('wss://openspeech.bytedance.com/api/v3/tts/bidirection',{headers:{
    Authorization:'Bearer; '+process.env.DOUBAO_ACCESS_KEY,
    'X-Api-App-Key':process.env.DOUBAO_APP_ID,
    'X-Api-Access-Key':process.env.DOUBAO_ACCESS_KEY,
    'X-Api-Resource-Id':'seed-tts-2.0',
    'X-Api-Connect-Id':crypto.randomUUID(),
  },handshakeTimeout:10000});
  const send=(ev,obj,sid)=>ws.send(P.buildFrame({messageType:P.MSG_FULL_CLIENT,flags:P.FLAG_WITH_EVENT,serialization:P.SERIAL_JSON,compression:P.COMPRESS_NONE,event:ev,sessionId:sid||null,payload:Buffer.from(JSON.stringify({event:ev,...obj}),'utf8')}));
  let audioBytes=0,t0=0;
  ws.on('open',()=>{ console.log('variant',variant,'握手通过'); send(P.EV.START_CONNECTION,{}); });
  ws.on('message',(raw)=>{
    const f=P.parseFrame(raw);
    if(f.messageType===P.MSG_AUDIO_SERVER){if(!t0)t0=Date.now();audioBytes+=f.payload.length;return;}
    console.log('event=',f.event, f.payload.toString().slice(0,100));
    if(f.event===P.EV.CONNECTION_STARTED){
      const sid=crypto.randomUUID();
      send(P.EV.START_SESSION,{session_id:sid,req_params:{speaker:'zh_female_vv_uranus_bigtts',audio_params:{format:'pcm',sample_rate:24000,speech_rate:0}}},sid);
    } else if(f.event===P.EV.SESSION_STARTED){
      const sid=f.sessionId;
      if(variant===1){
        // 参考实现风格：text 放 req_params，TaskRequest 后立刻 FinishSession
        send(P.EV.TASK_REQUEST,{session_id:sid,req_params:{speaker:'zh_female_vv_uranus_bigtts',audio_params:{format:'pcm',sample_rate:24000},text:'老板，测试一句话，看看能不能出声。'}},sid);
        send(P.EV.FINISH_SESSION,{session_id:sid},sid);
      } else {
        // 文档风格：text 顶层
        send(P.EV.TASK_REQUEST,{session_id:sid,text:'老板，测试一句话，看看能不能出声。'},sid);
        send(P.EV.FINISH_SESSION,{session_id:sid},sid);
      }
    } else if(f.event===P.EV.TTS_SENTENCE_END||f.event===P.EV.SESSION_FINISHED){
      console.log('完成，音频',audioBytes,'字节');
      process.exit(0);
    }
  });
  ws.on('error',e=>{console.log('error',e.message);process.exit(1)});
  setTimeout(()=>{console.log('超时, 音频',audioBytes,'字节');process.exit(audioBytes>0?0:1)},20000);
})();
