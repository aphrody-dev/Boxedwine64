// SPDX-License-Identifier: GPL-2.0-or-later
import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { compressArtifacts, compressArtifact } from "./compress-artifacts";

test("web artifacts round-trip with hashes; game archives remain untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "dbxv2-compression-"));
  try {
    const bytes = new TextEncoder().encode(
      "real artifact bytes\n".repeat(10000),
    );
    for (const name of [
      "engine.wasm",
      "launcher.js",
      "page.html",
      "style.css",
      "game.cpk",
      "rootfs.zip",
    ])
      await Bun.write(join(root, name), bytes);
    const results = await compressArtifacts(root);
    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result.sha256).toBe(
        new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
      );
      expect(result.originalBytes).toBe(bytes.length);
      expect(result.brotliBytes).toBeLessThan(bytes.length);
      expect(result.gzipBytes).toBeLessThan(bytes.length);
      expect(
        new Uint8Array(
          brotliDecompressSync(await Bun.file(result.path + ".br").bytes()),
        ),
      ).toEqual(bytes);
      expect(
        Bun.gunzipSync(await Bun.file(result.path + ".gz").bytes()),
      ).toEqual(bytes);
    }
    expect(await Bun.file(join(root, "game.cpk.br")).exists()).toBe(false);
    expect(await Bun.file(join(root, "rootfs.zip.gz")).exists()).toBe(false);
    await expect(compressArtifact(join(root, "game.cpk"))).rejects.toThrow(
      "Unsupported",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
