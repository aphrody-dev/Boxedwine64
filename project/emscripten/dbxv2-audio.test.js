// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { observeSdlAudio } from "./dbxv2-audio.js";

test("measures the original callback output without modifying playback or its receiver", () => {
  const values = new Float32Array(4);
  const node = {
    context: { state: "running", sampleRate: 48000 },
    onaudioprocess() {
      expect(this).toBe(node);
      values.set([0, 0.5, -0.5, 0]);
      return 42;
    },
  };
  const original = node.onaudioprocess;
  const observer = observeSdlAudio(
    () => ({ SDL2: { audio: { scriptProcessorNode: node } } }),
    () => {},
  );
  try {
    expect(
      node.onaudioprocess({
        outputBuffer: {
          numberOfChannels: 1,
          getChannelData: () => values,
        },
      }),
    ).toBe(42);
    expect(Array.from(values)).toEqual([0, 0.5, -0.5, 0]);
    expect(observer.snapshot()).toMatchObject({
      state: "running",
      callbacks: 1,
      samples: 4,
      nonzero: 2,
      peak: 0.5,
    });
    expect(observer.snapshot().rms).toBeCloseTo(Math.sqrt(0.125));
  } finally {
    observer.stop();
  }
  expect(node.onaudioprocess).toBe(original);
});

test("silent SDL frames and a suspended context do not count as audible output", () => {
  const node = {
    context: { state: "suspended", sampleRate: 48000 },
    onaudioprocess() {},
  };
  const observer = observeSdlAudio(
    () => ({ SDL2: { audio: { scriptProcessorNode: node } } }),
    () => {},
  );
  try {
    node.onaudioprocess({
      outputBuffer: {
        numberOfChannels: 2,
        getChannelData: () => new Float32Array(128),
      },
    });
    expect(observer.snapshot()).toMatchObject({
      state: "suspended",
      callbacks: 1,
      samples: 256,
      nonzero: 0,
      peak: 0,
      rms: 0,
    });
  } finally {
    observer.stop();
  }
});
