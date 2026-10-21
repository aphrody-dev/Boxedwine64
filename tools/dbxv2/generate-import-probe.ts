// SPDX-License-Identifier: GPL-2.0-or-later
// Input is the existing `re bin <EXE> --strings 0 --json` owner's output.
const [reportPath, executablePath] = Bun.argv.slice(2);
if (!reportPath || !executablePath)
  throw new Error(
    "Usage: bun generate-import-probe.ts <re-bin.json> <original.exe>",
  );
const report = await Bun.file(reportPath).json();
const imports = report.pe?.imports;
if (!Array.isArray(imports)) throw new Error("Missing pe.imports");
const hasher = new Bun.CryptoHasher("sha256");
for await (const chunk of Bun.file(executablePath).stream())
  hasher.update(chunk);
const sourceSha256 = hasher.digest("hex");
if (
  typeof report.triage?.sha256 !== "string" ||
  report.triage.sha256.toLowerCase() !== sourceSha256.toLowerCase()
)
  throw new Error("RE report SHA256 does not match the supplied executable");
const quote = (value: string) => {
  if (!/^[\x20-\x7e]+$/.test(value)) throw new Error("Non-ASCII import name");
  return JSON.stringify(value);
};
const lines = [
  "/* Generated from re bin imports; no executable bytes included. */",
  "#ifndef DBXV2_IMPORTS_H",
  "#define DBXV2_IMPORTS_H",
  `static const char *import_source_sha256 = "${sourceSha256}";`,
];
for (const [index, entry] of imports.entries()) {
  if (
    typeof entry.module !== "string" ||
    !Array.isArray(entry.functions) ||
    entry.count !== entry.functions.length ||
    !entry.functions.every((f: unknown) => typeof f === "string")
  )
    throw new Error("Invalid import record");
  lines.push(
    `static const char *import_names_${index}[] = {${entry.functions.length ? entry.functions.map(quote).join(",") : "NULL"}};`,
  );
}
lines.push(
  "static const struct { const char *module; const char **names; unsigned count; } import_modules[] = {",
);
for (const [index, entry] of imports.entries())
  lines.push(
    `{${quote(entry.module)}, import_names_${index}, ${entry.functions.length}},`,
  );
lines.push("};", "#endif", "");
await Bun.write(
  new URL("./probe-game-imports.h", import.meta.url),
  lines.join("\n"),
);
console.log(
  JSON.stringify({
    modules: imports.length,
    functions: imports.reduce(
      (n: number, e: { functions: string[] }) => n + e.functions.length,
      0,
    ),
  }),
);
