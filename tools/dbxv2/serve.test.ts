import { test, expect } from "bun:test";
import {
  parseRange,
  rangeResponse,
  acceptedEncodings,
  staticResponse,
} from "./serve";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("compression negotiation respects exclusions and preference", () => {
  expect(acceptedEncodings("gzip;q=1,br;q=0.5")).toEqual(["gzip", "br"]);
  expect(acceptedEncodings("br;q=0,*;q=1")).toEqual(["gzip"]);
  expect(acceptedEncodings(null)).toEqual([]);
});

test("compressed artifacts retain original MIME; ranges remain original bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "boxedwine-http-"));
  try {
    await Bun.write(join(root, "engine.wasm"), "0123456789".repeat(100));
    await Bun.write(join(root, "engine.wasm.br"), "compressed");
    const encoded = await staticResponse(
      new Request("http://localhost/engine.wasm", {
        headers: { "Accept-Encoding": "br" },
      }),
      root,
      "engine.wasm",
    );
    expect(encoded.headers.get("content-encoding")).toBe("br");
    expect(encoded.headers.get("content-type")).toBe("application/wasm");
    expect(encoded.headers.get("vary")).toBe("Accept-Encoding");
    expect(await encoded.text()).toBe("compressed");
    const partial = await staticResponse(
      new Request("http://localhost/engine.wasm", {
        headers: { "Accept-Encoding": "br", Range: "bytes=2-5" },
      }),
      root,
      "engine.wasm",
    );
    expect(partial.status).toBe(206);
    expect(partial.headers.has("content-encoding")).toBe(false);
    expect(await partial.text()).toBe("2345");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ranges preserve offsets beyond 4 GiB", () => {
  expect(parseRange("bytes=4294967296-4294967395", 40_000_000_000)).toEqual([
    4294967296, 4294967396,
  ]);
  expect(parseRange("bytes=-512", 40_000_000_000)).toEqual([
    39_999_999_488, 40_000_000_000,
  ]);
  for (const value of [
    "bytes=0-1,3-4",
    "bytes=-0",
    "bytes=10-9",
    "bytes=40-",
    "bytes=9007199254740993-",
  ])
    expect(parseRange(value, 40)).toBeNull();
});

test("HEAD never reads payload; partial response exposes exact range and isolation", async () => {
  let read = false;
  const response = rangeResponse(
    new Request("http://localhost/archive", {
      method: "HEAD",
      headers: { Range: "bytes=5-9" },
    }),
    20,
    () => {
      read = true;
      return "unused";
    },
    "application/zip",
  );
  expect(read).toBe(false);
  expect(response.status).toBe(206);
  expect(response.headers.get("Content-Range")).toBe("bytes 5-9/20");
  expect(response.headers.get("Content-Length")).toBe("5");
  expect(response.headers.get("Cross-Origin-Embedder-Policy")).toBe(
    "require-corp",
  );
  expect(await response.text()).toBe("");
});

test("unsatisfiable requests do not access backing files", () => {
  const response = rangeResponse(
    new Request("http://localhost/archive", {
      headers: { Range: "bytes=20-" },
    }),
    20,
    () => {
      throw new Error("must not read");
    },
    "application/zip",
  );
  expect(response.status).toBe(416);
  expect(response.headers.get("Content-Range")).toBe("bytes */20");
});
