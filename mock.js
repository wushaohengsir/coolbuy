/**
 * Mock 自测（无需 API Key）：
 *   1. 协议帧 round-trip 单测
 *   2. 打印注入的协商剧本（system_role）
 *   3. 展示剧本预期对话走向（人工审剧本用）
 *
 * 运行：node mock.js
 */

'use strict';

const assert = require('assert');
const P = require('./protocol');
const { systemRole, purchaseContext, userProfile } = require('./scenario');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✔ ${name}`); pass++; }
  catch (e) { console.error(`  ✘ ${name}\n    ${e.message}`); fail++; }
}

console.log('== 1. 协议帧 round-trip ==');
test('StartConnection 帧（连接级事件，无 session_id）', () => {
  const f = P.jsonFrame(P.EV.START_CONNECTION, {});
  const p = P.parseFrame(f);
  assert.strictEqual(p.event, P.EV.START_CONNECTION);
  assert.strictEqual(p.messageType, P.MSG_FULL_CLIENT);
  assert.deepStrictEqual(JSON.parse(p.payload.toString()), {});
});
test('StartSession 帧（带 session_id，JSON+gzip）', () => {
  const sid = 'test-session-1234';
  const f = P.jsonFrame(P.EV.START_SESSION, { dialog: { bot_name: '小冷' } }, sid);
  const p = P.parseFrame(f);
  assert.strictEqual(p.event, P.EV.START_SESSION);
  assert.strictEqual(p.sessionId, sid);
  assert.deepStrictEqual(JSON.parse(p.payload.toString()).dialog.bot_name, '小冷');
});
test('音频帧（RAW+gzip，round-trip 数据一致）', () => {
  const pcm = Buffer.from(Array.from({ length: 1600 }, (_, i) => i % 256));
  const f = P.audioFrame(pcm, 'sess');
  const p = P.parseFrame(f);
  assert.strictEqual(p.event, P.EV.TASK_REQUEST);
  assert.strictEqual(p.messageType, P.MSG_AUDIO_CLIENT);
  assert.strictEqual(p.serialization, P.SERIAL_RAW);
  assert.ok(p.payload.equals(pcm));
});
test('错误帧解析（MSG_ERROR + code）', () => {
  const f = P.buildFrame({
    messageType: P.MSG_ERROR,
    flags: 0,
    serialization: P.SERIAL_JSON,
    compression: P.COMPRESS_NONE,
    errorCode: 45000003,
    payload: Buffer.from('{"error":"timeout"}'),
  });
  const p = P.parseFrame(f);
  assert.strictEqual(p.messageType, P.MSG_ERROR);
  assert.strictEqual(p.errorCode, 45000003);
  assert.deepStrictEqual(JSON.parse(p.payload.toString()), { error: 'timeout' });
});
test('header 位定义（参考文档示例 [17,20,16,0,...]）', () => {
  const f = P.jsonFrame(P.EV.START_CONNECTION, {});
  assert.strictEqual(f[0], 17); // version 1 | header_size 1
  assert.strictEqual(f[1] >> 4, P.MSG_FULL_CLIENT);
  assert.strictEqual(f[2] >> 4, P.SERIAL_JSON);
  assert.strictEqual(f[2] & 0x0f, P.COMPRESS_GZIP);
});

console.log('\n== 2. 注入的协商剧本 ==');
console.log(systemRole);

console.log('\n== 3. 预期对话走向（人工审阅剧本逻辑） ==');
const script = [
  ['小冷', `老板，${purchaseContext.商品} ¥${purchaseContext.价格}，手已经放付款按钮上了吧？那页面上是不是还写着「${purchaseContext.促销话术}」？`],
  ['你', '对啊，再不买就没了'],
  ['小冷', '先别急。我问你一句啊——是耳机真不行了，还是今天就是有点烦，想买点啥高兴高兴？'],
  ['你', '…昨天加班有点烦'],
  ['小冷', '懂的。不过你上个月那台 ${299} 的音箱，这周用过几次？'],
  ['你', '…好像就开过一次'],
  ['小冷', '要不这样，放愿望单晾 48 小时。周四这个时候你还惦记，我亲自提醒你买，一分不亏。省下的 399，${userProfile.储蓄目标.名称}就到 63% 了。'],
  ['你', '行吧，那就先放放'],
  ['小冷', '爽快！周四见，老板。'],
];
for (const [who, text] of script) {
  console.log(who === '小冷' ? `\x1b[36m  小冷: ${text}\x1b[0m` : `\x1b[33m  你: ${text}\x1b[0m`);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
