// SPDX-License-Identifier: GPL-2.0-or-later
import { rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { constants, createBrotliCompress, createGzip } from "node:zlib";

export function isCompressibleArtifact(path: string) {
  return /\.(js|wasm|html|css)$/i.test(path);
}

export async function compressArtifact(path: string) {
  if (!isCompressibleArtifact(path))
    throw new Error("Unsupported artifact extension");
  const source = Bun.file(path);
  if (!(await source.exists())) throw new Error("Missing artifact");
  const hash = new Bun.CryptoHasher("sha256");
  let originalBytes = 0;
  for await (const chunk of source.stream()) {
    hash.update(chunk);
    originalBytes += chunk.length;
  }
  const sha256 = hash.digest("hex");
  const sizes: Record<string, number> = {};
  // Process sequentially to bound CPU and memory even for large WASM binaries.
  for (const encoding of ["br", "gz"] as const) {
    const destination = `${path}.${encoding}`;
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    const writer = Bun.file(temporary).writer();
    const verify = new Bun.CryptoHasher("sha256");
    let bytes = 0;
    const compressor =
      encoding === "br"
        ? createBrotliCompress({
            params: { [constants.BROTLI_PARAM_QUALITY]: 6 },
          })
        : createGzip({ level: 9 });
    try {
      async function* input() {
        for await (const chunk of source.stream()) {
          verify.update(chunk);
          yield chunk;
        }
      }
      await pipeline(Readable.from(input()), compressor, async (output) => {
        for await (const chunk of output) {
          writer.write(chunk);
          bytes += chunk.length;
          await writer.flush();
        }
      });
      await writer.end();
      if (verify.digest("hex") !== sha256)
        throw new Error("Artifact changed during compression");
      await rename(temporary, destination);
      sizes[encoding] = bytes;
    } catch (error) {
      await Promise.resolve(writer.end()).catch(() => {});
      await rm(temporary, { force: true });
      throw error;
    }
  }
  return {
    path,
    sha256,
    originalBytes,
    brotliBytes: sizes.br,
    gzipBytes: sizes.gz,
  };
}

export async function compressArtifacts(directory: string) {
  const root = resolve(directory);
  const results = [];
  for await (const path of new Bun.Glob("**/*").scan({
    cwd: root,
    onlyFiles: true,
    followSymlinks: false,
  })) {
    if (isCompressibleArtifact(path))
      results.push(await compressArtifact(join(root, path)));
  }
  return results;
}

if (import.meta.main) {
  if (!Bun.argv[2])
    throw new Error(
      "Usage: bun tools/dbxv2/compress-artifacts.ts <artifact directory>",
    );
  console.log(JSON.stringify(await compressArtifacts(Bun.argv[2]), null, 2));
}
