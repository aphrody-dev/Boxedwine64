// SPDX-License-Identifier: GPL-2.0-or-later
/** Observe the existing SDL output after its callback; never generate or change audio. */
export function observeSdlAudio(
  getModule,
  report,
  { durationMs = 10000 } = {},
) {
  let node, original, wrapper, startedAt;
  let callbacks = 0,
    samples = 0,
    nonzero = 0,
    squares = 0,
    peak = 0;
  let stopped = false;
  function snapshot() {
    const context = node?.context;
    return {
      state: context?.state ?? "unavailable",
      sampleRate: context?.sampleRate ?? null,
      callbacks,
      samples,
      nonzero,
      peak,
      rms: samples ? Math.sqrt(squares / samples) : 0,
      elapsedMs: startedAt === undefined ? 0 : performance.now() - startedAt,
      complete: stopped,
    };
  }
  function stop() {
    stopped = true;
    clearInterval(timer);
    if (node && node.onaudioprocess === wrapper) node.onaudioprocess = original;
    report(snapshot());
  }
  function tick() {
    if (stopped) return;
    const next = getModule()?.SDL2?.audio?.scriptProcessorNode;
    if (next && next !== node && typeof next.onaudioprocess === "function") {
      if (node && node.onaudioprocess === wrapper)
        node.onaudioprocess = original;
      node = next;
      original = node.onaudioprocess;
      const handler = original;
      wrapper = function (event) {
        const result = handler.call(this, event);
        startedAt ??= performance.now();
        callbacks++;
        for (
          let channel = 0;
          channel < event.outputBuffer.numberOfChannels;
          channel++
        ) {
          const values = event.outputBuffer.getChannelData(channel);
          for (const value of values) {
            if (!Number.isFinite(value)) continue;
            samples++;
            squares += value * value;
            peak = Math.max(peak, Math.abs(value));
            if (Math.abs(value) > 0.000001) nonzero++;
          }
        }
        return result;
      };
      node.onaudioprocess = wrapper;
    }
    if (startedAt !== undefined && performance.now() - startedAt >= durationMs)
      stop();
    else report(snapshot());
  }
  const timer = setInterval(tick, 500);
  tick();
  return { stop, snapshot, resume: () => node?.context?.resume() };
}
