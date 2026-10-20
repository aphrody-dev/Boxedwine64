export {};
// Bounded, read-only sampling. Never emits or persists game asset bytes.
const directory = Bun.argv[2];
const output = Bun.argv[3];
if (!directory || !output)
  throw new Error(
    "Usage: bun benchmark-compression.ts CPK_DIRECTORY REPORT_JSON",
  );
const sampleBytes = 1024 * 1024;
const rows: object[] = [];
const hash = (bytes: Uint8Array) =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
for (const name of ["data.cpk", "movie.cpk", "data_d7_bgm2.cpk", "data2.cpk"]) {
  const file = Bun.file(`${directory}/${name}`);
  const size = file.size;
  if (!Number.isSafeInteger(size) || size < sampleBytes * 3)
    throw new Error(`Invalid sample file ${name}`);
  for (const offset of [0, Math.floor(size / 2), size - sampleBytes]) {
    const bytes = new Uint8Array(
      await file.slice(offset, offset + sampleBytes).arrayBuffer(),
    );
    const expected = hash(bytes);
    for (const level of [3, 9, 19]) {
      const start = performance.now();
      const encoded = Bun.zstdCompressSync(bytes, { level });
      const compressionMs = performance.now() - start;
      const decodeStart = performance.now();
      const decoded = Bun.zstdDecompressSync(encoded);
      const decompressionMs = performance.now() - decodeStart;
      if (hash(decoded) !== expected)
        throw new Error("Zstd round-trip mismatch");
      rows.push({
        name,
        fileBytes: size,
        offset,
        inputBytes: bytes.length,
        codec: "zstd",
        level,
        outputBytes: encoded.length,
        compressionMs,
        decompressionMs,
      });
    }
    const start = performance.now();
    const encoded = await new Response(
      new Blob([bytes])
        .stream()
        .pipeThrough(new CompressionStream("brotli" as CompressionFormat)),
    ).arrayBuffer();
    const compressionMs = performance.now() - start;
    const decodeStart = performance.now();
    const decoded = await new Response(
      new Blob([encoded])
        .stream()
        .pipeThrough(new DecompressionStream("brotli" as CompressionFormat)),
    ).arrayBuffer();
    const decompressionMs = performance.now() - decodeStart;
    if (hash(new Uint8Array(decoded)) !== expected)
      throw new Error("Brotli round-trip mismatch");
    rows.push({
      name,
      fileBytes: size,
      offset,
      inputBytes: bytes.length,
      codec: "brotli",
      level: "CompressionStream default",
      outputBytes: encoded.byteLength,
      compressionMs,
      decompressionMs,
    });
    console.error(`Measured ${name} offset ${offset}`);
  }
}
await Bun.write(
  output,
  JSON.stringify(
    {
      date: new Date().toISOString(),
      bun: Bun.version,
      revision: Bun.revision,
      platform: process.platform,
      sampleBytes,
      repeats: 1,
      workers: 1,
      note: "Cold one-pass samples under concurrent build load; not corpus-wide ratios or peak throughput",
      rows,
    },
    null,
    2,
  ),
);
