// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, test } from "bun:test";
import {
  ARCHIVE_CHUNK_BYTES,
  createDbxv2Archive,
  crc32,
  normalizeGamePath,
  validateDbxv2Layout,
} from "./dbxv2-archive.js";
import { loadDbxv2Profile } from "./dbxv2-profile.js";
const encode = (text) => new TextEncoder().encode(text);

describe("DBXV2 file-backed ZIP64", () => {
  test("CRC is ZIP CRC32 and can continue across chunks", () => {
    expect(crc32(encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(encode("56789"), crc32(encode("1234")))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
  test("an independent native ZIP reader extracts every original file", async () => {
    const entries = [
      { path: "START.exe", file: new Blob(["original exe"]) },
      { path: "bin/a.dll", file: new Blob([new Uint8Array([0, 1, 2, 255])]) },
      { path: "cpk/日本語.cpk", file: new Blob(["payload"]) },
      { path: "empty.txt", file: new Blob([]) },
    ];
    const archive = await createDbxv2Archive(entries);
    const full = await new Response(archive.readRange(0, archive.size)).bytes();
    const files = await new Bun.Archive(full).files();
    expect(files.size).toBe(entries.length);
    for (const entry of entries)
      expect(
        await files.get(`home/username/DBXV2/${entry.path}`).bytes(),
      ).toEqual(new Uint8Array(await entry.file.arrayBuffer()));
    expect(await new Response(archive.readRange(29, 77)).bytes()).toEqual(
      full.slice(29, 77),
    );
    expect(() => archive.readRange(-1, 3)).toThrow();
  });
  test("supports offsets beyond 4 GiB without reading or allocating the complete file", async () => {
    const size = 5 * 1024 ** 3 + 17;
    let reads = [];
    const file = {
      size,
      slice(start, end) {
        reads.push([start, end]);
        if (end - start > ARCHIVE_CHUNK_BYTES) throw Error("Unbounded read");
        return new Blob([new Uint8Array(end - start).fill(0x5a)]);
      },
    };
    const archive = await createDbxv2Archive([
      { path: "cpk/large.cpk", file, crc32: 0 },
    ]);
    expect(reads).toEqual([]);
    const tail = await new Response(
      archive.readRange(archive.size - 98, archive.size),
    ).bytes();
    const view = new DataView(tail.buffer);
    expect(view.getUint32(0, true)).toBe(0x06064b50);
    expect(Number(view.getBigUint64(48, true))).toBeGreaterThan(5 * 1024 ** 3);
    expect(reads).toEqual([]);
    const block = await new Response(
      archive.readRange(4 * 1024 ** 3, 4 * 1024 ** 3 + 16),
    ).bytes();
    expect(block).toEqual(new Uint8Array(16).fill(0x5a));
    expect(reads).toHaveLength(1);
    expect(reads[0][0]).toBeGreaterThan(0xffffffff - 1000);
  });
  test("bounds CRC scans and rejects incomplete/unsafe layouts", async () => {
    const file = new Blob([new Uint8Array(ARCHIVE_CHUNK_BYTES + 20)]);
    const sizes = [];
    const source = {
      size: file.size,
      slice(a, b) {
        sizes.push(b - a);
        return file.slice(a, b);
      },
    };
    await createDbxv2Archive([{ path: "safe.bin", file: source }]);
    expect(sizes).toEqual([ARCHIVE_CHUNK_BYTES, 20]);
    expect(() => normalizeGamePath("../secret")).toThrow();
    expect(() => normalizeGamePath("C:/secret")).toThrow();
    await expect(
      createDbxv2Archive([
        { path: "A", file },
        { path: "a", file },
      ]),
    ).rejects.toThrow("Duplicate");
    expect(() => validateDbxv2Layout([{ path: "START.exe" }])).toThrow(
      "Incomplete",
    );
    expect(() =>
      validateDbxv2Layout(
        ["START.exe", "bin/DBXV2.exe", "bin/game.dll", "cpk/data.cpk"].map(
          (path) => ({ path }),
        ),
      ),
    ).not.toThrow();
  });
});

describe("DBXV2 boot profile", () => {
  const origin = "http://127.0.0.1:8765";
  const manifest = {
    archiveUrl: "/dbxv2/archive.zip",
    archiveBytes: 40000000000,
    entryCount: 100,
    executable: "START.exe",
  };
  const mockFetch = async (url) =>
    String(url).endsWith("manifest.json")
      ? Response.json(manifest)
      : new Response(new Uint8Array([80, 75, 3, 4]), {
          status: 206,
          headers: { "content-range": `bytes 0-3/${manifest.archiveBytes}` },
        });
  test("official launcher receives all files through a range-backed guest overlay", async () => {
    const profile = await loadDbxv2Profile({ origin, fetcher: mockFetch });
    expect(profile.program).toBe("/home/username/DBXV2/START.exe");
    expect(profile.programArgv).toEqual([profile.program]);
    expect(profile.zipSpecs).toEqual([
      `bw64url:40000000000;${origin}/dbxv2/archive.zip|40000000000`,
    ]);
  });
  test("rejects servers returning a whole archive instead of the requested four bytes", async () => {
    const fetcher = async (url) =>
      String(url).endsWith("manifest.json")
        ? Response.json(manifest)
        : new Response("whole archive");
    await expect(loadDbxv2Profile({ origin, fetcher })).rejects.toThrow(
      "precise HTTP byte ranges",
    );
    await expect(
      loadDbxv2Profile({
        origin,
        manifestUrl: "https://foreign.invalid/manifest.json",
        fetcher: mockFetch,
      }),
    ).rejects.toThrow("same-origin");
  });
});
