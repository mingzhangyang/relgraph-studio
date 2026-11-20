// `relgraph render --audio` (ADR 004, D3): FFmpeg arguments and length
// warnings. Muxing real files, and that the decoded video frames are the same
// with and without sound, is checked by `npm run check:export`.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  audioLengthWarning,
  encodeArgs,
  framecrcEndSec,
  muxArgs,
  parseAudioProbe,
} from '../packages/cli/src/ffmpeg.ts';
import { renderFilm, RenderError } from '../packages/cli/src/render.ts';

/** What FFmpeg 6.1 prints for `-i tone.wav -map 0:a:0 -c copy -f null -`. */
const WAV_PROBE = `[aist#0:0/pcm_s16le @ 0x55deba29d300] Guessed Channel Layout: stereo
Input #0, wav, from 'tone.wav':
  Metadata:
    encoder         : Lavf60.16.100
  Duration: 00:00:02.50, bitrate: 1536 kb/s
  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 48000 Hz, 2 channels, s16, 1536 kb/s
Output #0, null, to 'pipe:':
  Metadata:
    encoder         : Lavf60.16.100
  Stream #0:0: Audio: pcm_s16le ([1][0][0][0] / 0x0001), 48000 Hz, stereo, s16, 1536 kb/s
Stream mapping:
  Stream #0:0 -> #0:0 (copy)
`;

test('the audio probe reads the input stream and its duration', () => {
  assert.deepEqual(parseAudioProbe(WAV_PROBE), {
    durationSec: 2.5,
    stream: 'pcm_s16le ([1][0][0][0] / 0x0001), 48000 Hz, 2 channels, s16, 1536 kb/s',
  });
  // A video file's sound is its second stream; an hour-long one keeps its hours.
  const mp4 = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'film.mp4':
  Duration: 01:02:03.04, start: 0.000000, bitrate: 900 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p, 1920x1080, 24 fps
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 192 kb/s (default)
`;
  assert.deepEqual(parseAudioProbe(mp4), {
    durationSec: 3723.04,
    stream: 'aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 192 kb/s (default)',
  });
  assert.equal(
    parseAudioProbe(WAV_PROBE.replace('Duration: 00:00:02.50', 'Duration: N/A')).durationSec,
    null,
  );
  assert.equal(parseAudioProbe(mp4.replace(/^.*Audio.*$/m, '')), null);
  // The output section alone does not count as an input stream.
  assert.equal(
    parseAudioProbe(
      "Input #0, image2, from 'x.png':\n  Stream #0:0: Video: png\n" +
        WAV_PROBE.slice(WAV_PROBE.indexOf('Output #0')),
    ),
    null,
  );
});

test("the sound's length is where its stream ends, not the container's", () => {
  // FFmpeg 6.1 framecrc of `-map 0:a:0 -c copy` for an MP4 with 4 s of video
  // and 1 s of AAC: the header says 4 s, the audio stream ends at 1 s.
  const mixed = [
    '#tb 0: 1/48000',
    '#media_type 0: audio',
    '0,      -1024,      -1024,     1024,      212, 0x1f1766a3, F=0x5, S=1,       10',
    '0,          0,          0,     1024,      196, 0x4cc0516d',
    '0,      47104,      47104,      896,      158, 0x70a653a3',
  ];
  assert.equal(framecrcEndSec(mixed), 1);
  // A WAV ends with a short packet; an MP3's time base is not its sample rate.
  assert.equal(
    framecrcEndSec([
      '#tb 0: 1/44100',
      '0, 0, 0, 2048, 4096, 0x0',
      '0, 108544, 108544, 1706, 3412, 0x0',
    ]),
    2.5,
  );
  assert.equal(
    framecrcEndSec(['#tb 0: 1/14112000', '0, 46463676, 46463676, 368640, 209, 0x0']),
    46832316 / 14112000,
  );
  assert.equal(framecrcEndSec(['#tb 0: 1/48000']), null, 'no packets');
  assert.equal(framecrcEndSec(['0, 0, 0, 1024, 4, 0x0']), null, 'no time base');
});

test('muxing copies the video stream and fits the sound to the video', () => {
  const args = muxArgs({
    video: 'v.mp4',
    audio: 'track.wav',
    out: 'film.mp4',
    offsetSec: 0,
    durationSec: 106,
  });
  assert.deepEqual(args, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    '-i',
    'v.mp4',
    '-i',
    'track.wav',
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'copy',
    '-af',
    'apad',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-t',
    '106.000000',
    '-movflags',
    '+faststart',
    'film.mp4',
  ]);
  // A partial render starts the sound at its first frame's time.
  const partial = muxArgs({
    video: 'v.mp4',
    audio: 'track.wav',
    out: 'f.mp4',
    offsetSec: 100 / 24,
    durationSec: 2,
  });
  assert.deepEqual(partial.slice(partial.indexOf('v.mp4') + 1, partial.indexOf('track.wav') + 1), [
    '-ss',
    '4.166667',
    '-i',
    'track.wav',
  ]);
  // The video is encoded exactly as without sound: no audio input there.
  const video = encodeArgs({ width: 1920, height: 1080, fps: 24, out: 'v.mp4' });
  assert.ok(video.includes('-an'));
});

test('a length mismatch beyond one frame is a warning, never an error', () => {
  const video = { offsetSec: 0, durationSec: 10, fps: 24 };
  const probe = (durationSec) => ({ durationSec, stream: 'pcm' });
  assert.equal(audioLengthWarning(probe(10), video), null);
  assert.equal(audioLengthWarning(probe(10.04), video), null, 'within a frame');
  assert.equal(audioLengthWarning(probe(9.96), video), null, 'within a frame');
  assert.equal(
    audioLengthWarning(probe(12.5), video),
    '警告：音轨比视频长 2.500 秒（12.500 / 10.000 秒），超出部分截掉。\n',
  );
  assert.equal(
    audioLengthWarning(probe(7.25), video),
    '警告：音轨比视频短 2.750 秒（7.250 / 10.000 秒），结尾补静音。\n',
  );
  assert.equal(
    audioLengthWarning(probe(12), { offsetSec: 4, durationSec: 2, fps: 24 }),
    '警告：音轨（从第 4.000 秒起）比视频长 6.000 秒（8.000 / 2.000 秒），超出部分截掉。\n',
  );
  assert.equal(
    audioLengthWarning(probe(2.5), { offsetSec: 100 / 24, durationSec: 2.5, fps: 24 }),
    '警告：音轨（从第 4.167 秒起）比视频短 2.500 秒（0.000 / 2.500 秒），结尾补静音。\n',
    'a sound that ends before the first frame',
  );
  assert.match(audioLengthWarning(probe(null), video), /^警告：无法从 --audio 文件读出时长/);
});

test('--audio needs an MP4 and is checked before anything is rendered', async () => {
  await assert.rejects(
    renderFilm({
      file: 'missing.json',
      frames: 'out/%05d.png',
      audio: 'track.wav',
      frameSpec: 'landscape-720p',
      theme: 'light',
      locale: 'zh-CN',
      jobs: 1,
    }),
    (error) => error instanceof RenderError && /--audio 只能和 --out 一起使用/.test(error.message),
  );
});
