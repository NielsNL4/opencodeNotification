const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { play, players, chime, scaleWav } = require('../extensions/local/audio');

test('Linux playback falls back and passes a custom filename as a single argument', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-audio-'));
  t.after(() => fs.rm(directory, { recursive: true }));
  const file = path.join(directory, "my custom 'sound';test.wav");
  await fs.writeFile(file, chime([440, 660]));
  const calls = [];
  await play(file, async (command, args) => {
    calls.push({ command, args });
    if (command === 'paplay') throw new Error('decoder failure');
  }, 'linux');
  assert.deepEqual(calls, [{ command: 'paplay', args: [file] }, { command: 'pw-play', args: [file] }]);
  await assert.rejects(play(path.join(directory, 'missing.wav')), /ENOENT/);
});

test('volume uses player gain controls and clamps the supported range', () => {
  const linux = players('linux', '/sounds/ready.mp3', 4);
  assert.deepEqual(linux[0].args, ['--volume=26214', '/sounds/ready.mp3']);
  assert.deepEqual(linux[1].args, ['--volume=0.4', '/sounds/ready.mp3']);
  assert.equal(linux[2].args[linux[2].args.indexOf('-volume') + 1], '40');
  assert.deepEqual(players('darwin', '/sounds/ready.wav', 1)[0].args, ['-v', '0.1', '/sounds/ready.wav']);
  assert.match(players('linux', '/sound.wav', 0)[0].args[0], /6554/);
  assert.deepEqual(players('linux', '/sound.wav', 20)[0].args, ['/sound.wav']);
});

test('WAV gain scales samples and keeps metadata and the source intact', () => {
  const source = chime([440]);
  const original = Buffer.from(source);
  const scaled = scaleWav(source, 0.4);
  assert.deepEqual(source, original);
  assert.deepEqual(scaled.subarray(0, 44), original.subarray(0, 44));
  for (let offset = 44; offset < source.length; offset += 2) {
    assert.equal(scaled.readInt16LE(offset), Math.round(source.readInt16LE(offset) * 0.4) || 0);
  }
  assert.throws(() => scaleWav(Buffer.from('not a wav'), 0.4), /PCM or float WAV/);
});

test('Windows and aplay use a temporary attenuated WAV and remove it after playback', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'opencode-audio-'));
  t.after(() => fs.rm(directory, { recursive: true }));
  const file = path.join(directory, 'original.wav');
  const source = chime([440]);
  await fs.writeFile(file, source);
  for (const platform of ['win32', 'linux']) {
    let temporary;
    await play(file, async (command, args) => {
      if (platform === 'linux' && command !== 'aplay') throw new Error('unavailable');
      temporary = platform === 'win32' ? args.at(-1).match(/SoundLocation = '([^']+)'/)[1] : args[0];
      assert.notEqual(temporary, file);
      assert.deepEqual(await fs.readFile(temporary), scaleWav(source, 0.3));
    }, platform, 3);
    await assert.rejects(fs.stat(temporary), /ENOENT/);
  }
  assert.deepEqual(await fs.readFile(file), source);
});

test('WAV is portable and Windows custom paths escape PowerShell string quotes', () => {
  const wav = chime([440, 880]);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(40), wav.length - 44);
  const windows = players('win32', "C:\\Sounds\\it's ready.wav");
  assert.equal(windows[0].command, 'powershell.exe');
  assert.match(windows[0].args.at(-1), /it''s ready\.wav/);
  assert.equal(players('linux', '/sounds/ready.mp3').some(p => p.command === 'aplay'), false);
});
