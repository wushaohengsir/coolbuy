/**
 * Cross-platform audio helpers for the local voice agent.
 *
 * Windows uses DirectShow, macOS uses AVFoundation and Linux uses PulseAudio
 * by default. ALSA can be selected with AUDIO_BACKEND=alsa.
 */

'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

function bundledTool(name, platform = process.platform) {
  const exe = platform === 'win32' ? `${name}.exe` : name;
  const candidates = [
    path.join(__dirname, '..', 'ffmpeg', exe),
    path.join(__dirname, 'ffmpeg', exe),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function getFfmpegPath(platform = process.platform) {
  return process.env.FFMPEG_PATH || bundledTool('ffmpeg', platform) || 'ffmpeg';
}

function getFfplayPath(platform = process.platform) {
  return process.env.FFPLAY_PATH || bundledTool('ffplay', platform) || 'ffplay';
}

function captureArgs(device, platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    return ['-f', 'dshow', '-i', device || 'audio=default'];
  }
  if (platform === 'darwin') {
    return ['-f', 'avfoundation', '-i', device || ':0'];
  }
  const backend = (env.AUDIO_BACKEND || 'pulse').toLowerCase();
  if (backend === 'alsa') {
    return ['-f', 'alsa', '-i', device || 'default'];
  }
  return ['-f', 'pulse', '-i', device || 'default'];
}

function spawnAudioCapture(device, options = {}) {
  return spawn(getFfmpegPath(), [
    '-hide_banner',
    '-loglevel', 'error',
    ...captureArgs(device),
    '-ar', '16000',
    '-ac', '1',
    '-f', 's16le',
    '-',
  ], {
    stdio: ['ignore', 'pipe', 'inherit'],
    windowsHide: process.platform === 'win32',
    ...options,
  });
}

function run(command, args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: process.platform === 'win32',
    });
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ ok: false, stdout, stderr });
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ ok: false, stdout, stderr, error });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      finish({ ok: code === 0, stdout, stderr });
    });
  });
}

function parseDshow(stderr) {
  const devices = [];
  const lines = stderr.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/"([^"]+)"\s+\(audio\)/);
    if (!match) continue;
    const label = match[1];
    const alternative = (lines[i + 1] || '').match(/Alternative name "([^"]+)"/);
    devices.push({
      label,
      value: alternative ? `audio=${alternative[1]}` : `audio=${label}`,
    });
  }
  return devices;
}

function parseAvfoundation(stderr) {
  const devices = [];
  let inAudio = false;
  for (const line of stderr.split(/\r?\n/)) {
    if (/AVFoundation audio devices:/i.test(line)) {
      inAudio = true;
      continue;
    }
    if (/AVFoundation video devices:/i.test(line)) {
      inAudio = false;
      continue;
    }
    if (!inAudio) continue;
    const match = line.match(/\[(\d+)\]\s+(.+)$/);
    if (match) devices.push({ label: match[2].trim(), value: `:${match[1]}` });
  }
  return devices;
}

function parsePulse(text) {
  const devices = [];
  for (const line of text.split(/\r?\n/)) {
    const compact = line.trim();
    if (!compact) continue;
    const short = compact.match(/^(\d+)\s+(\S+)\s+/);
    if (short) {
      const name = short[2];
      if (!name.endsWith('.monitor')) devices.push({ label: name, value: name });
      continue;
    }
    const source = compact.match(/^\*?\s*(\S+)\s+\[([^\]]+)\]/);
    if (source) devices.push({ label: source[2], value: source[1] });
  }
  return devices;
}

async function listAudioDevices(platform = process.platform) {
  const ffmpeg = getFfmpegPath(platform);
  if (platform === 'win32') {
    const result = await run(ffmpeg, [
      '-hide_banner', '-list_devices', 'true', '-f', 'dshow', '-i', 'dummy',
    ]);
    return parseDshow(result.stderr);
  }
  if (platform === 'darwin') {
    const result = await run(ffmpeg, [
      '-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', '',
    ]);
    return parseAvfoundation(result.stderr);
  }
  const pactl = spawnSync('pactl', ['list', 'short', 'sources'], {
    encoding: 'utf8',
    windowsHide: false,
  });
  if (pactl.status === 0) return parsePulse(pactl.stdout || '');
  const result = await run(ffmpeg, ['-hide_banner', '-sources', 'pulse']);
  return parsePulse(`${result.stdout}\n${result.stderr}`);
}

module.exports = {
  bundledTool,
  captureArgs,
  getFfmpegPath,
  getFfplayPath,
  listAudioDevices,
  spawnAudioCapture,
};
