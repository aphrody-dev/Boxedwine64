// SPDX-License-Identifier: GPL-2.0-or-later
const LIMIT = 16 * 1024 * 1024;

/** Use the upstream WebX bridge, serially, preserving its existing binary protocol. */
export function createVk64Backend(bridge, dispose, { timeoutMs = 25000 } = {}) {
  const pending = new Map(),
    queue = [];
  let active = null,
    closed = false;
  function close(reason) {
    if (closed) return;
    closed = true;
    for (const job of pending.values()) {
      clearTimeout(job.timer);
      job.packet = null;
      job.reject(reason);
    }
    pending.clear();
    queue.length = 0;
    dispose();
  }
  function pump() {
    if (closed || active || !queue.length) return;
    const job = (active = queue.shift());
    const packet = job.packet;
    job.packet = null;
    Promise.resolve()
      .then(() => {
        if (closed) throw Error("VK64 backend closed");
        return bridge.processPacket(packet);
      })
      .then((response) => {
        if (closed) return;
        if (
          !(response instanceof Uint8Array) ||
          response.byteLength < 12 ||
          response.byteLength > LIMIT
        )
          throw Error("Invalid WebX response size");
        const view = new DataView(
          response.buffer,
          response.byteOffset,
          response.byteLength,
        );
        if (
          view.getUint32(0, true) !== job.sequence ||
          view.getUint32(8, true) !== response.byteLength - 12
        )
          throw Error("Invalid WebX response header");
        clearTimeout(job.timer);
        pending.delete(job.key);
        active = null;
        job.resolve(response.slice());
        pump();
      })
      .catch(close);
  }
  function cancel(key) {
    const job = pending.get(key);
    if (!job) return;
    const reason = Error("VK64 request cancelled");
    if (active === job) {
      close(reason);
      return;
    }
    queue.splice(queue.indexOf(job), 1);
    pending.delete(key);
    clearTimeout(job.timer);
    job.packet = null;
    job.reject(reason);
  }
  return {
    dispatch(key, packet) {
      if (closed) return Promise.reject(Error("VK64 backend closed"));
      if (pending.has(key) || pending.size >= 4)
        return Promise.reject(Error("VK64 queue full"));
      if (
        !(packet instanceof Uint8Array) ||
        packet.byteLength < 16 ||
        packet.byteLength > LIMIT
      )
        return Promise.reject(Error("Invalid WebX request size"));
      const view = new DataView(
        packet.buffer,
        packet.byteOffset,
        packet.byteLength,
      );
      if (
        view.getUint32(0, true) !== 0x58574756 ||
        view.getUint32(12, true) !== packet.byteLength - 16
      )
        return Promise.reject(Error("Invalid WebX request header"));
      return new Promise((resolve, reject) => {
        const job = {
          key,
          sequence: view.getUint32(8, true),
          packet: packet.slice(),
          resolve,
          reject,
        };
        job.timer = setTimeout(() => cancel(key), timeoutMs);
        pending.set(key, job);
        queue.push(job);
        pump();
      });
    },
    cancel,
    close: () => close(Error("VK64 backend closed")),
  };
}

export function installVk64Backend(runtime, backend) {
  runtime.vk64Backend = backend;
  const previous = runtime.onRuntimeInitialized;
  runtime.onRuntimeInitialized = function (...args) {
    previous?.apply(this, args);
    if (runtime.ccall("bw64_vk64_enable", "number", [], []) !== 1)
      throw Error("The WASM runtime cannot enable the VK64 backend");
  };
}
