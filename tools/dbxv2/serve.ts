// SPDX-License-Identifier: GPL-2.0-or-later
import { realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import {
  createDbxv2Archive,
  validateDbxv2Layout,
} from "../../project/emscripten/dbxv2-archive.js";

export function parseRange(
  value: string | null,
  size: number,
): [number, number] | null {
  if (!value) return [0, size];
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  let start: number, end: number;
  if (!match[1]) {
    const count = Number(match[2]);
    if (!Number.isSafeInteger(count) || count <= 0) return null;
    start = Math.max(0, size - count);
    end = size;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) + 1 : size;
  }
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end <= start
  )
    return null;
  return [start, Math.min(end, size)];
}

const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
};

export function rangeResponse(
  request: Request,
  size: number,
  read: (start: number, end: number) => BodyInit,
  type: string,
) {
  const range = parseRange(request.headers.get("range"), size);
  if (!range)
    return new Response(null, {
      status: 416,
      headers: { ...isolation, "Content-Range": `bytes */${size}` },
    });
  const [start, end] = range;
  const partial = request.headers.has("range");
  return new Response(request.method === "HEAD" ? null : read(start, end), {
    status: partial ? 206 : 200,
    headers: {
      ...isolation,
      "Content-Type": type,
      "Accept-Ranges": "bytes",
      "Content-Length": String(end - start),
      ...(partial
        ? { "Content-Range": `bytes ${start}-${end - 1}/${size}` }
        : {}),
    },
  });
}

async function contained(root: string, path: string) {
  const result = await realpath(resolve(root, path));
  const rel = relative(root, result);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Outside root");
  return result;
}

export function acceptedEncodings(header: string | null): string[] {
  const values = new Map<string, number>();
  for (const token of (header ?? "").split(",")) {
    const [name, ...parameters] = token.trim().toLowerCase().split(";");
    const q = parameters.find((value) => value.trim().startsWith("q="));
    const weight = q ? Number(q.trim().slice(2)) : 1;
    values.set(
      name,
      Number.isFinite(weight) && weight >= 0 && weight <= 1 ? weight : 0,
    );
  }
  return ["br", "gzip"]
    .map((name) => ({ name, q: values.get(name) ?? values.get("*") ?? 0 }))
    .filter((item) => item.q > 0)
    .sort((a, b) => b.q - a.q)
    .map((item) => item.name);
}

export async function staticResponse(
  request: Request,
  root: string,
  path: string,
) {
  const file = Bun.file(await contained(root, path));
  if (!request.headers.has("range") && /\.(?:wasm|js|html|css)$/.test(path)) {
    for (const encoding of acceptedEncodings(
      request.headers.get("accept-encoding"),
    )) {
      try {
        const compressed = Bun.file(
          await contained(root, `${path}.${encoding === "br" ? "br" : "gz"}`),
        );
        if (
          compressed.lastModified < file.lastModified ||
          compressed.size >= file.size
        )
          continue;
        return new Response(request.method === "HEAD" ? null : compressed, {
          headers: {
            ...isolation,
            "Content-Type": file.type || "application/octet-stream",
            "Content-Encoding": encoding,
            "Content-Length": String(compressed.size),
            Vary: "Accept-Encoding",
          },
        });
      } catch {
        /* Missing sidecars use the original artifact. */
      }
    }
  }
  const response = rangeResponse(
    request,
    file.size,
    (a, b) => file.slice(a, b),
    file.type || "application/octet-stream",
  );
  response.headers.set("Vary", "Accept-Encoding");
  return response;
}

async function main() {
  const args = Bun.argv.slice(2);
  function option(name: string, fallback?: string) {
    const index = args.indexOf(name);
    return index < 0 ? fallback : args[index + 1];
  }
  const gameDir = option("--game-dir");
  if (!gameDir)
    throw new Error(
      "Usage: bun tools/dbxv2/serve.ts --game-dir <complete installation> [--artifacts <directory>] [--port 4538]",
    );
  const gameRoot = await realpath(gameDir);
  const artifacts = await realpath(
    option("--artifacts", "project/emscripten/Build/Wasm64Mt")!,
  );
  const source = await realpath(
    resolve(import.meta.dir, "../../project/emscripten"),
  );
  const entries = [];
  for await (const path of new Bun.Glob("**/*").scan({
    cwd: gameRoot,
    onlyFiles: true,
    followSymlinks: false,
  })) {
    const normalized = path.replaceAll("\\", "/");
    // The input must be the game's installation, never a Steam profile or account directory.
    if (
      /(^|\/)(config|userdata|loginusers\.vdf|ssfn\d+)(\/|$)/i.test(normalized)
    )
      throw new Error("Account data is not a game asset");
    entries.push({
      path: normalized,
      file: Bun.file(await contained(gameRoot, path)),
    });
  }
  validateDbxv2Layout(entries);
  let reported = 0;
  const archive = await createDbxv2Archive(entries, {
    onProgress(progress: { scannedBytes: number; totalBytes: number }) {
      if (progress.scannedBytes - reported >= 1024 ** 3) {
        reported = progress.scannedBytes;
        console.log(`CRC ${reported}/${progress.totalBytes}`);
      }
    },
  });
  const overlay = new Set([
    "wine64-launcher.js",
    "dbxv2-archive.js",
    "dbxv2-profile.js",
    "dbxv2-start.js",
    "dbxv2.html",
    "boxedwine.css",
  ]);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: Number(option("--port", "4538")),
    idleTimeout: 120,
    async fetch(request) {
      if (!["GET", "HEAD"].includes(request.method))
        return new Response(null, {
          status: 405,
          headers: { ...isolation, Allow: "GET, HEAD" },
        });
      const url = new URL(request.url);
      if (url.pathname === "/dbxv2/manifest.json")
        return new Response(
          request.method === "HEAD"
            ? null
            : JSON.stringify({
                archiveUrl: "/dbxv2/archive.zip",
                archiveBytes: archive.size,
                entryCount: archive.entryCount,
                executable: "START.exe",
              }),
          { headers: { ...isolation, "Content-Type": "application/json" } },
        );
      if (url.pathname === "/dbxv2/archive.zip")
        return rangeResponse(
          request,
          archive.size,
          (a, b) => archive.readRange(a, b),
          "application/zip",
        );
      try {
        const path = decodeURIComponent(
          url.pathname === "/" ? "/wine64.html" : url.pathname,
        ).slice(1);
        return await staticResponse(
          request,
          overlay.has(path) ? source : artifacts,
          path,
        );
      } catch {
        return new Response("Not found", { status: 404, headers: isolation });
      }
    },
  });
  console.log(
    JSON.stringify({
      url: `${server.url}dbxv2.html`,
      archiveBytes: archive.size,
      entries: archive.entryCount,
    }),
  );
}

if (import.meta.main) await main();
