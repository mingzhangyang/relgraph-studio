"""Synthesize the film's background score (stereo 48 kHz WAV) with NumPy alone.

    python3 datasets/riemann-hypothesis/make_score.py <seconds> <out.wav>

A slow 4-chord progression in A minor at 76 BPM: plucked, softly detuned arpeggios
over a quiet pad, with a fade at both ends. Deterministic: same arguments, same file.
"""

import sys
import wave

import numpy as np

SR = 48000
BPM = 76
BEAT = 60 / BPM
# Am  F  C  G  /  Am  F  G  E  (MIDI notes)
PROGRESSION = [
    [57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67],
    [57, 60, 64, 69], [53, 57, 60, 65], [55, 59, 62, 67], [52, 56, 59, 64],
]
PATTERN = [0, 2, 1, 3, 2, 1, 3, 2]  # eighth-note arpeggio over one bar of 4 beats


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def pluck(freq, dur, amp):
    t = np.arange(int(dur * SR)) / SR
    env = np.exp(-t * 3.2) * (1 - np.exp(-t * 400))
    tone = (np.sin(2 * np.pi * freq * t) + 0.35 * np.sin(4 * np.pi * freq * t)
            + 0.12 * np.sin(6 * np.pi * freq * t))
    return amp * env * tone


def pad(freqs, dur, amp):
    t = np.arange(int(dur * SR)) / SR
    env = np.minimum(1, t / 1.2) * np.minimum(1, (dur - t) / 1.2)
    out = np.zeros_like(t)
    for f in freqs:
        for detune in (-0.12, 0.12):
            out += np.sin(2 * np.pi * (f / 2 + detune) * t)
    return amp * env * out / (2 * len(freqs))


def render(seconds):
    n = int(seconds * SR)
    left, right = np.zeros(n + SR * 4), np.zeros(n + SR * 4)
    bar = 4 * BEAT
    i = 0
    while i * bar < seconds:
        chord = PROGRESSION[i % len(PROGRESSION)]
        start = int(i * bar * SR)
        p = pad([hz(m) for m in chord], bar + 0.6, 0.16)
        left[start:start + len(p)] += p
        right[start:start + len(p)] += p
        for k, idx in enumerate(PATTERN):
            note = chord[idx] + 12
            s = start + int(k * BEAT / 2 * SR)
            tone = pluck(hz(note), 2.4, 0.11 if k % 2 else 0.14)
            pan = 0.35 + 0.3 * (idx / 3)
            left[s:s + len(tone)] += tone * (1 - pan)
            right[s:s + len(tone)] += tone * pan
        # a low root on each bar
        root = pluck(hz(chord[0] - 12), 3.0, 0.12)
        left[start:start + len(root)] += root
        right[start:start + len(root)] += root
        i += 1
    stereo = np.stack([left[:n], right[:n]], axis=1)
    fade = np.ones(n)
    k = int(2.5 * SR)
    fade[:k] = np.linspace(0, 1, k)
    fade[-k * 2:] = np.linspace(1, 0, k * 2)
    stereo *= fade[:, None]
    stereo /= np.max(np.abs(stereo)) / 0.6
    return (stereo * 32767).astype(np.int16)


if __name__ == "__main__":
    seconds, out = float(sys.argv[1]), sys.argv[2]
    data = render(seconds)
    with wave.open(out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())
    print(out, seconds, "s")
