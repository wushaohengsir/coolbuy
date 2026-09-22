/**
 * .env 加载已废弃（2026-09-23）：
 * 环境配置只认插件经 native 启动器注入的环境变量，不再读本机 .env 文件。
 * 保留此空实现，避免改动所有 require('./agent-env')() 调用点。
 */
'use strict';
module.exports = function loadEnv() {};
