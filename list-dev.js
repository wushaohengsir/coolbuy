'use strict';
const { listAudioDevices } = require('./audio');

listAudioDevices().then((devices) => {
  console.log('音频输入设备:');
  if (!devices.length) {
    console.log('  （未发现设备，将使用系统默认麦克风）');
    return;
  }
  for (const device of devices) {
    console.log(`  ${device.label}  [${device.value}]`);
  }
}).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
