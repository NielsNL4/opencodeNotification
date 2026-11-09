const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

/** @param {string} platform @param {string} file @param {number} [volume] @returns {{command: string, args: string[]}[]} */
function players(platform, file, volume = 10) {
  const gain = Math.min(10, Math.max(1, Math.round(volume))) / 10;
  if (platform === 'linux') return [
    { command: 'paplay', args: [...(gain < 1 ? [`--volume=${Math.round(gain * 65536)}`] : []), file] },
    { command: 'pw-play', args: [...(gain < 1 ? [`--volume=${gain}`] : []), file] },
    { command: 'ffplay', args: ['-nodisp', '-autoexit', '-loglevel', 'error', '-volume', String(gain * 100), '-i', file] },
    ...(path.extname(file).toLowerCase() === '.wav' ? [{ command: 'aplay', args: [file] }] : []),
  ];
  if (platform === 'win32') return [{
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command',
      `$p = New-Object System.Media.SoundPlayer; $p.SoundLocation = '${file.replaceAll("'", "''")}'; $p.PlaySync()`],
  }];
  if (platform === 'darwin') return [{ command: 'afplay', args: ['-v', String(gain), file] }];
  return [];
}

/** @param {string} command @param {string[]} args */
function runPlayer(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { if (stderr.length < 2000) stderr += String(chunk); });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Sound playback timed out (30 seconds).')); }, 30000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => {
      clearTimeout(timeout);
      if (code === 0) resolve(undefined);
      else reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

/** @param {string} file @param {typeof runPlayer} [run] @param {string} [platform] @param {number} [volume] */
async function play(file, run = runPlayer, platform = process.platform, volume = 10) {
  if (!path.isAbsolute(file)) throw new Error('Choose an absolute path to a local sound file.');
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error('The sound path must point to a local file.');
  if (platform === 'win32' && path.extname(file).toLowerCase() !== '.wav') throw new Error('Windows playback requires a WAV file.');
  const errors = [];
  const level = Number.isFinite(volume) ? Math.min(10, Math.max(1, Math.round(volume))) : 10;
  for (const player of players(platform, file, level)) {
    let temporary;
    try {
      // SoundPlayer and aplay have no per-playback gain control.
      if (level < 10 && (platform === 'win32' || player.command === 'aplay')) {
        const wav = scaleWav(await fs.readFile(file), level / 10);
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-volume-'));
        const scaled = path.join(temporary, 'sound.wav');
        await fs.writeFile(scaled, wav);
        const adjusted = players(platform, scaled, level).find(p => p.command === player.command);
        if (!adjusted) throw new Error('No audio player available.');
        await run(adjusted.command, adjusted.args);
      } else {
        await run(player.command, player.args);
      }
      return;
    }
    catch (error) { errors.push(String(error)); }
    finally { if (temporary) await fs.rm(temporary, { recursive: true, force: true }); }
  }
  throw new Error(`Could not play the sound. On Linux Mint, install pulseaudio-utils (paplay) or ffmpeg (ffplay). ${errors.join(' | ')}`);
}

/** Apply gain to PCM/float WAV samples without modifying the source file.
 * @param {Buffer} source @param {number} gain
 */
function scaleWav(source, gain) {
  const wav = Buffer.from(source);
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Volume adjustment requires a PCM or float WAV file for this player.');
  }
  let format = 0;
  let bits = 0;
  const chunks = [];
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > wav.length) throw new Error('Invalid WAV chunk length.');
    const id = wav.toString('ascii', offset, offset + 4);
    if (id === 'fmt ' && size >= 16) {
      format = wav.readUInt16LE(start);
      bits = wav.readUInt16LE(start + 14);
      if (format === 0xfffe && size >= 40) format = wav.readUInt16LE(start + 24);
    }
    if (id === 'data') chunks.push({ start, size });
    offset = start + size + (size % 2);
  }
  if (!chunks.length || !((format === 1 && [8, 16, 24, 32].includes(bits)) || (format === 3 && [32, 64].includes(bits)))) {
    throw new Error('Volume adjustment requires a PCM or float WAV file for this player.');
  }
  const bytes = bits / 8;
  for (const { start, size } of chunks) {
    for (let i = start; i + bytes <= start + size; i += bytes) {
      if (format === 3) {
        if (bits === 32) wav.writeFloatLE(wav.readFloatLE(i) * gain, i);
        else wav.writeDoubleLE(wav.readDoubleLE(i) * gain, i);
      } else if (bits === 8) {
        wav.writeUInt8(Math.round((wav.readUInt8(i) - 128) * gain + 128), i);
      } else {
        wav.writeIntLE(Math.round(wav.readIntLE(i, bytes) * gain), i, bytes);
      }
    }
  }
  return wav;
}

/** @param {number[]} notes */
function chime(notes) {
  const rate = 22050;
  const noteLength = Math.round(rate * 0.17);
  const samples = notes.length * noteLength;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28); wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const position = i % noteLength;
    const envelope = Math.min(position / (rate * 0.01), 1) * Math.pow(1 - position / noteLength, 2);
    wav.writeInt16LE(Math.round(Math.sin(2 * Math.PI * notes[Math.floor(i / noteLength)] * position / rate) * envelope * 6500), 44 + i * 2);
  }
  return wav;
}

module.exports = { play, players, chime, scaleWav };
