// SPDX-License-Identifier: GPL-2.0-or-later
// A read-only ZIP64 STORE overlay. File payloads remain file-backed and are read in bounded slices.
export const DBXV2_MOUNT_PATH = "/home/username/DBXV2";
export const ARCHIVE_CHUNK_BYTES = 1024 * 1024;
const encoder = new TextEncoder();
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  return n >>> 0;
});

/** Standard incremental ZIP CRC32; Bun's native implementation is used on the serving host. */
export function crc32(bytes, previous = 0) {
  if (typeof Bun !== "undefined" && typeof Bun.hash?.crc32 === "function")
    return Bun.hash.crc32(bytes, previous) >>> 0;
  let crc = (previous ^ 0xffffffff) >>> 0;
  for (const byte of bytes) crc = (crc >>> 8) ^ table[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

export function normalizeGamePath(path) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    path.includes("\\") ||
    path.includes("\0")
  )
    throw new Error("Invalid game path");
  const parts = path.split("/");
  if (
    parts.some(
      (part) => !part || part === "." || part === ".." || part.includes(":"),
    )
  )
    throw new Error("Game paths must be relative");
  return parts.join("/");
}

export function validateDbxv2Layout(entries) {
  const names = new Set(
    entries.map((entry) => normalizeGamePath(entry.path).toLowerCase()),
  );
  const missing = ["start.exe", "bin/dbxv2.exe"].filter(
    (path) => !names.has(path),
  );
  if (
    ![...names].some((path) => path.startsWith("cpk/") && path.endsWith(".cpk"))
  )
    missing.push("cpk/*.cpk");
  if (![...names].some((path) => path.endsWith(".dll"))) missing.push("*.dll");
  if (missing.length)
    throw new Error(`Incomplete installation: ${missing.join(", ")}`);
}

function bytes(size) {
  const data = new Uint8Array(size);
  return [data, new DataView(data.buffer)];
}
function u64(view, offset, value) {
  view.setBigUint64(offset, BigInt(value), true);
}
function abort(signal) {
  if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
}

export async function createDbxv2Archive(entries, { signal, onProgress } = {}) {
  if (!entries.length) throw new Error("Empty installation");
  const names = new Set();
  const prepared = entries.map((entry) => {
    const path = normalizeGamePath(entry.path);
    if (names.has(path.toLowerCase()))
      throw new Error(`Duplicate Windows path: ${path}`);
    names.add(path.toLowerCase());
    const file = entry.file;
    if (
      !file ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      typeof file.slice !== "function"
    )
      throw new Error(`Invalid file: ${path}`);
    if (
      entry.crc32 !== undefined &&
      (!Number.isInteger(entry.crc32) ||
        entry.crc32 < 0 ||
        entry.crc32 > 0xffffffff)
    )
      throw new Error(`Invalid CRC32: ${path}`);
    const name = encoder.encode(DBXV2_MOUNT_PATH.slice(1) + "/" + path);
    if (name.length > 0xffff) throw new Error("ZIP filename too long");
    return { ...entry, path, name, file };
  });
  const totalBytes = prepared.reduce((sum, entry) => sum + entry.file.size, 0);
  if (!Number.isSafeInteger(totalBytes))
    throw new Error("Installation size exceeds precise integer addressing");
  let scannedBytes = 0;
  for (const entry of prepared) {
    abort(signal);
    if (entry.crc32 !== undefined) continue;
    let checksum = 0;
    for (
      let offset = 0;
      offset < entry.file.size;
      offset += ARCHIVE_CHUNK_BYTES
    ) {
      abort(signal);
      const chunk = new Uint8Array(
        await entry.file
          .slice(
            offset,
            Math.min(offset + ARCHIVE_CHUNK_BYTES, entry.file.size),
          )
          .arrayBuffer(),
      );
      if (
        chunk.length !== Math.min(ARCHIVE_CHUNK_BYTES, entry.file.size - offset)
      )
        throw new Error(`File changed while scanning: ${entry.path}`);
      checksum = crc32(chunk, checksum);
      scannedBytes += chunk.length;
      onProgress?.({ path: entry.path, scannedBytes, totalBytes });
    }
    entry.crc32 = checksum;
  }
  const segments = [];
  let size = 0;
  function append(blob) {
    segments.push({ start: size, end: size + blob.size, blob });
    size += blob.size;
  }
  const central = [];
  for (const entry of prepared) {
    const localOffset = size;
    const [header, local] = bytes(30 + entry.name.length + 20);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 45, true);
    local.setUint16(6, 0x0800, true);
    local.setUint32(14, entry.crc32, true);
    local.setUint32(18, 0xffffffff, true);
    local.setUint32(22, 0xffffffff, true);
    local.setUint16(26, entry.name.length, true);
    local.setUint16(28, 20, true);
    header.set(entry.name, 30);
    const ex = 30 + entry.name.length;
    local.setUint16(ex, 1, true);
    local.setUint16(ex + 2, 16, true);
    u64(local, ex + 4, entry.file.size);
    u64(local, ex + 12, entry.file.size);
    append(new Blob([header]));
    append(entry.file);
    const [record, directory] = bytes(46 + entry.name.length + 28);
    directory.setUint32(0, 0x02014b50, true);
    directory.setUint16(4, 0x032d, true);
    directory.setUint16(6, 45, true);
    directory.setUint16(8, 0x0800, true);
    directory.setUint32(16, entry.crc32, true);
    directory.setUint32(20, 0xffffffff, true);
    directory.setUint32(24, 0xffffffff, true);
    directory.setUint16(28, entry.name.length, true);
    directory.setUint16(30, 28, true);
    directory.setUint32(38, (0o100444 << 16) >>> 0, true);
    directory.setUint32(42, 0xffffffff, true);
    record.set(entry.name, 46);
    const dex = 46 + entry.name.length;
    directory.setUint16(dex, 1, true);
    directory.setUint16(dex + 2, 24, true);
    u64(directory, dex + 4, entry.file.size);
    u64(directory, dex + 12, entry.file.size);
    u64(directory, dex + 20, localOffset);
    central.push(record);
  }
  const centralOffset = size;
  append(new Blob(central));
  const centralSize = size - centralOffset;
  const zip64Offset = size;
  const [end, endView] = bytes(56 + 20 + 22);
  endView.setUint32(0, 0x06064b50, true);
  u64(endView, 4, 44);
  endView.setUint16(12, 0x032d, true);
  endView.setUint16(14, 45, true);
  u64(endView, 24, prepared.length);
  u64(endView, 32, prepared.length);
  u64(endView, 40, centralSize);
  u64(endView, 48, centralOffset);
  endView.setUint32(56, 0x07064b50, true);
  u64(endView, 64, zip64Offset);
  endView.setUint32(72, 1, true);
  endView.setUint32(76, 0x06054b50, true);
  endView.setUint16(84, 0xffff, true);
  endView.setUint16(86, 0xffff, true);
  endView.setUint32(88, 0xffffffff, true);
  endView.setUint32(92, 0xffffffff, true);
  append(new Blob([end]));
  if (!Number.isSafeInteger(size))
    throw new Error("Archive size exceeds precise integer addressing");
  return {
    size,
    entryCount: prepared.length,
    readRange(start, endExclusive) {
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(endExclusive) ||
        start < 0 ||
        endExclusive < start ||
        endExclusive > size
      )
        throw new RangeError("Invalid ZIP range");
      let cursor = start;
      let low = 0,
        high = segments.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (segments[middle].end <= cursor) low = middle + 1;
        else high = middle;
      }
      let index = low;
      return new ReadableStream({
        async pull(controller) {
          try {
            abort(signal);
            if (cursor >= endExclusive) {
              controller.close();
              return;
            }
            while (index < segments.length && segments[index].end <= cursor)
              index++;
            const segment = segments[index];
            const until = Math.min(
              endExclusive,
              segment.end,
              cursor + ARCHIVE_CHUNK_BYTES,
            );
            const data = new Uint8Array(
              await segment.blob
                .slice(cursor - segment.start, until - segment.start)
                .arrayBuffer(),
            );
            if (data.length !== until - cursor)
              throw new Error("File changed while serving ZIP");
            cursor = until;
            controller.enqueue(data);
          } catch (error) {
            controller.error(error);
          }
        },
      });
    },
  };
}
