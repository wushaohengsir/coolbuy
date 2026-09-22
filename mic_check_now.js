'use strict';
const {spawn}=require('child_process');
const fs=require('fs');
const ff=spawn('ffmpeg',['-hide_banner','-loglevel','error','-f','dshow','-i','audio=麦克风阵列 (Realtek(R) Audio)','-ar','16000','-ac','1','-f','s16le','-t','5','-y','mic_final.pcm'],{stdio:['ignore','ignore','inherit']});
ff.on('exit',()=>{
  try{
    const buf=fs.readFileSync('mic_final.pcm');
    let max=0,sum=0,n=0;
    for(let i=0;i<buf.length;i+=2){const a=Math.abs(buf.readInt16LE(i));if(a>max)max=a;sum+=a;n++;}
    console.log('峰值:',max,'平均:',(sum/n).toFixed(0),max>3000?'✔ 有人声了':(max>500?'有弱声':'仍静音'));
  }catch(e){console.log('无文件')}
});
