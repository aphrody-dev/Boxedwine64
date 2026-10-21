// SPDX-License-Identifier: GPL-2.0-or-later
import { expect, test } from "bun:test";
import { createVk64Backend, installVk64Backend } from "./vk64-browser.js";
function packet(sequence) {
  const bytes = new Uint8Array(16),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 0x58574756, true);
  view.setUint32(8, sequence, true);
  return bytes;
}
function response(sequence) {
  const bytes = new Uint8Array(12);
  new DataView(bytes.buffer).setUint32(0, sequence, true);
  return bytes;
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test("owns input bytes and dispatches WebX packets in order", async () => {
  const first = deferred(),
    seen = [];
  const backend = createVk64Backend(
    {
      processPacket(bytes) {
        const seq = new DataView(bytes.buffer).getUint32(8, true);
        seen.push(seq);
        return seq === 41 ? first.promise : response(seq);
      },
    },
    () => {},
  );
  try {
    const input = packet(41);
    const a = backend.dispatch("a", input),
      b = backend.dispatch("b", packet(42));
    input.fill(0);
    await Promise.resolve();
    expect(seen).toEqual([41]);
    first.resolve(response(41));
    expect(await a).toEqual(response(41));
    expect(await b).toEqual(response(42));
    expect(seen).toEqual([41, 42]);
  } finally {
    backend.close();
  }
});
test("invalid response fails the backend instead of reporting a Vulkan success", async () => {
  let disposed = 0;
  const backend = createVk64Backend(
    { processPacket: () => response(999) },
    () => disposed++,
  );
  await expect(backend.dispatch("a", packet(1))).rejects.toThrow(
    "response header",
  );
  await expect(backend.dispatch("b", packet(2))).rejects.toThrow("closed");
  expect(disposed).toBe(1);
});
test("queued cancellation removes the packet before GPU dispatch", async () => {
  const first = deferred(),
    seen = [];
  const backend = createVk64Backend(
    {
      processPacket(bytes) {
        seen.push(new DataView(bytes.buffer).getUint32(8, true));
        return first.promise;
      },
    },
    () => {},
  );
  try {
    const a = backend.dispatch("a", packet(1));
    const b = backend.dispatch("b", packet(2));
    backend.cancel("b");
    await expect(b).rejects.toThrow("cancelled");
    first.resolve(response(1));
    await a;
    expect(seen).toEqual([1]);
  } finally {
    backend.close();
  }
});
test("active cancellation closes the device and rejects later work", async () => {
  const first = deferred();
  let disposed = 0;
  let dispatched = 0;
  const backend = createVk64Backend(
    {
      processPacket: () => {
        dispatched++;
        return first.promise;
      },
    },
    () => disposed++,
  );
  const a = backend.dispatch("a", packet(1));
  backend.cancel("a");
  await expect(a).rejects.toThrow("cancelled");
  first.resolve(response(1));
  await expect(backend.dispatch("b", packet(2))).rejects.toThrow("closed");
  expect(disposed).toBe(1);
  expect(dispatched).toBe(0);
});
test("runtime wiring requires the compiled VK64 export to enable successfully", () => {
  let previous = 0;
  const runtime = { onRuntimeInitialized: () => previous++, ccall: () => 0 };
  const backend = {};
  installVk64Backend(runtime, backend);
  expect(runtime.vk64Backend).toBe(backend);
  expect(() => runtime.onRuntimeInitialized()).toThrow("cannot enable");
  expect(previous).toBe(1);
});
