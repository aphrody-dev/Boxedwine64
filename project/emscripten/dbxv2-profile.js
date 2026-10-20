// SPDX-License-Identifier: GPL-2.0-or-later
import { DBXV2_MOUNT_PATH, normalizeGamePath } from "./dbxv2-archive.js";

/** Mount the complete original installation; this profile does not patch the game or its launchers. */
export async function loadDbxv2Profile({
  manifestUrl = "/dbxv2/manifest.json",
  origin = location.origin,
  fetcher = fetch,
} = {}) {
  const url = new URL(manifestUrl, origin);
  if (url.origin !== origin)
    throw new Error("Installation manifest must be same-origin");
  const response = await fetcher(url, { cache: "no-store", redirect: "error" });
  if (!response.ok)
    throw new Error(`Installation manifest HTTP ${response.status}`);
  const manifest = await response.json();
  const archive = new URL(manifest.archiveUrl, origin);
  if (
    archive.origin !== origin ||
    archive.username ||
    archive.password ||
    /[;|\s]/.test(archive.href)
  )
    throw new Error("Invalid same-origin archive URL");
  if (
    !Number.isSafeInteger(manifest.archiveBytes) ||
    manifest.archiveBytes <= 0 ||
    !Number.isSafeInteger(manifest.entryCount) ||
    manifest.entryCount <= 0
  )
    throw new Error("Invalid archive metadata");
  if (
    manifest.mountPath !== undefined &&
    manifest.mountPath !== DBXV2_MOUNT_PATH
  )
    throw new Error("Unexpected guest mount path");
  const executable = normalizeGamePath(manifest.executable ?? "START.exe");
  if (!executable.toLowerCase().endsWith(".exe"))
    throw new Error("The launch target must be an original EXE");
  const probe = await fetcher(archive, {
    headers: { Range: "bytes=0-3" },
    cache: "no-store",
    redirect: "error",
  });
  if (
    probe.status !== 206 ||
    probe.headers.get("content-range") !== `bytes 0-3/${manifest.archiveBytes}`
  ) {
    await probe.body?.cancel();
    throw new Error(
      "The installation server must support precise HTTP byte ranges",
    );
  }
  const signature = new Uint8Array(await probe.arrayBuffer());
  if (
    signature.length !== 4 ||
    signature[0] !== 0x50 ||
    signature[1] !== 0x4b ||
    signature[2] !== 3 ||
    signature[3] !== 4
  )
    throw new Error("Invalid installation ZIP signature");
  const program = `${DBXV2_MOUNT_PATH}/${executable}`;
  return {
    program,
    programArgv: [program],
    workingDirectory: DBXV2_MOUNT_PATH,
    zipSpecs: [
      `bw64url:${manifest.archiveBytes};${archive.href}|${manifest.archiveBytes}`,
    ],
    entryCount: manifest.entryCount,
    archiveBytes: manifest.archiveBytes,
  };
}
