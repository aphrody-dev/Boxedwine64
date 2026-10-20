import { expect, test } from "bun:test";

// Compile the actual production method with a bounded virtual minizip stream.
// No multi-gigabyte fixture or game resources are copied into the test tree.
test("ZIP64 positioning preserves >4 GiB and terminates on EOF/error", async () => {
  const root = `${import.meta.dir}/../..`;
  const implementation = await Bun.file(`${root}/source/io/fszip.cpp`).text();
  const begin = implementation.indexOf("bool FsZip::setupZipRead(");
  const end = implementation.indexOf("bool FsZip::init(", begin);
  expect(begin).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(begin);
  const directory = `${process.env.TEMP ?? process.env.TMPDIR ?? "/tmp"}/boxedwine-zip64-${crypto.randomUUID()}`;
  const source = `${directory}/test.cpp`;
  const binary = `${directory}/test${process.platform === "win32" ? ".exe" : ""}`;
  await Bun.write(
    source,
    `
#include <stdint.h>
#include <assert.h>
#define BOXEDWINE_ZLIB 1
#define UNZ_OK 0
#define UNZ_PARAMERROR -102
#define U64 unsigned long long int
static U64 cursor = 0, centralOffset = 0, limit = ~static_cast<U64>(0);
static int failure = 0, openFailure = 0;
static int opens = 0;
int unzCloseCurrentFile(void*) { return 0; }
int unzSeekCurrentFile64(void*, U64) { return UNZ_PARAMERROR; }
int unzSetOffset64(void*, U64 offset) { centralOffset = offset; return 0; }
int unzOpenCurrentFile(void*) { cursor = 0; ++opens; return openFailure; }
int unzReadCurrentFile(void*, void*, unsigned count) {
    if (failure) return failure;
    if (cursor >= limit) return 0;
    if (count > limit - cursor) count = (unsigned)(limit - cursor);
    cursor += count;
    return (int)count;
}
struct FsZip {
    void* zipfile = nullptr;
    U64 lastZipOffset = ~static_cast<U64>(0), lastZipFileOffset = 0;
    const void* lastReadOwner = nullptr;
    bool setupZipRead(U64, U64, const void*);
};
${implementation.slice(begin, end)}
int main() {
    FsZip zip;
    int ownerA, ownerB;
    const U64 large = (static_cast<U64>(1) << 32) + 123;
    assert(zip.setupZipRead(large + 77, large, &ownerA));
    assert(cursor == large && centralOffset == large + 77);
    assert(zip.lastZipFileOffset == large);
    assert(zip.setupZipRead(large + 77, large + 29, &ownerA));
    assert(opens == 1 && cursor == large + 29);
    assert(zip.setupZipRead(large + 77, 11, &ownerB));
    assert(opens == 2 && cursor == 11);
    limit = 20;
    assert(!zip.setupZipRead(large + 77, 21, &ownerB));
    assert(cursor == 20);
    limit = ~static_cast<U64>(0); failure = -3;
    assert(!zip.setupZipRead(large + 77, 40, &ownerA));
    failure = 0;
    assert(zip.setupZipRead(large + 77, 40, &ownerA));
    assert(cursor == 40);
    openFailure = -1;
    assert(!zip.setupZipRead(8, 0, &ownerA));
    openFailure = 0;
    assert(zip.setupZipRead(large + 77, 45, &ownerA));
    assert(cursor == 45);
}
`,
  );
  const compile = Bun.spawnSync([
    process.env.CXX ?? "clang++",
    "-std=c++11",
    source,
    "-o",
    binary,
  ]);
  expect(compile.stderr.toString()).not.toContain("error:");
  expect(compile.exitCode).toBe(0);
  const run = Bun.spawnSync([binary], { timeout: 10000 });
  expect(run.exitCode).toBe(0);
}, 30000);

test.skipIf(process.platform === "win32")(
  "bundled minizip reads sparse ZIP64 sizes and central offsets >4 GiB",
  async () => {
    const root = `${import.meta.dir}/../..`;
    const directory = `${process.env.TMPDIR ?? "/tmp"}/boxedwine-zip64-${crypto.randomUUID()}`;
    const source = `${directory}/metadata.c`;
    const binary = `${directory}/metadata`;
    await Bun.write(
      source,
      `
#define _FILE_OFFSET_BITS 64
#include <stdio.h>
#include <stdint.h>
#include <assert.h>
#include "unzip.h"
#include "zip.h"
#include <string.h>
static void word(FILE* f, uint64_t n, unsigned bytes) {
    while (bytes--) { assert(fputc(n & 255, f) != EOF); n >>= 8; }
}
int main(int argc, char** argv) {
    assert(argc == 2);
    FILE* f = fopen(argv[1], "wb"); assert(f);
    const uint64_t size = ((uint64_t)1 << 32) + 17;
    word(f, 0x04034b50, 4); word(f, 45, 2);
    word(f, 0, 8); word(f, 0, 4);
    word(f, 0xffffffff, 4); word(f, 0xffffffff, 4);
    word(f, 8, 2); word(f, 20, 2);
    assert(fwrite("data.cpk", 1, 8, f) == 8);
    word(f, 1, 2); word(f, 16, 2); word(f, size, 8); word(f, size, 8);
    const uint64_t central = 58 + size;
    assert(fseeko(f, central - 4, SEEK_SET) == 0);
    assert(fwrite("TAIL", 1, 4, f) == 4);
    word(f, 0x02014b50, 4); word(f, 45, 2); word(f, 45, 2);
    word(f, 0, 8); word(f, 0, 4);
    word(f, 0xffffffff, 4); word(f, 0xffffffff, 4);
    word(f, 8, 2); word(f, 28, 2); word(f, 0, 2);
    word(f, 0, 2); word(f, 0, 2); word(f, 0, 4); word(f, 0xffffffff, 4);
    assert(fwrite("data.cpk", 1, 8, f) == 8);
    word(f, 1, 2); word(f, 24, 2); word(f, size, 8); word(f, size, 8); word(f, 0, 8);
    const uint64_t end64 = central + 82;
    word(f, 0x06064b50, 4); word(f, 44, 8); word(f, 45, 2); word(f, 45, 2);
    word(f, 0, 4); word(f, 0, 4); word(f, 1, 8); word(f, 1, 8);
    word(f, 82, 8); word(f, central, 8);
    word(f, 0x07064b50, 4); word(f, 0, 4); word(f, end64, 8); word(f, 1, 4);
    word(f, 0x06054b50, 4); word(f, 0, 4); word(f, 0xffff, 2); word(f, 0xffff, 2);
    word(f, 0xffffffff, 4); word(f, 0xffffffff, 4); word(f, 0, 2);
    assert(fclose(f) == 0);
    unzFile z = unzOpen64(argv[1]); assert(z);
    unz_global_info64 global; assert(unzGetGlobalInfo64(z, &global) == UNZ_OK);
    assert(global.number_entry == 1);
    unz_file_info64 info; assert(unzGetCurrentFileInfo64(z, &info, 0, 0, 0, 0, 0, 0) == UNZ_OK);
    assert(info.uncompressed_size == size && info.compressed_size == size);
    assert(unzGetOffset64(z) == central);
    assert(unzSetOffset64(z, central) == UNZ_OK);
    assert(unzOpenCurrentFile(z) == UNZ_OK);
    unsigned char bytes[8]; assert(unzReadCurrentFile(z, bytes, 8) == 8);
    for (int i = 0; i < 8; ++i) assert(bytes[i] == 0);
    assert(unzSeekCurrentFile64(z, size - 4) == UNZ_OK);
    assert(unztell64(z) == size - 4);
    assert(unzReadCurrentFile(z, bytes, 8) == 4);
    assert(bytes[0] == 84 && bytes[1] == 65 && bytes[2] == 73 && bytes[3] == 76);
    assert(unzReadCurrentFile(z, bytes, 8) == 0);
    assert(unzSeekCurrentFile64(z, size + 1) == UNZ_PARAMERROR);
    assert(unzSeekCurrentFile64(z, 0) == UNZ_OK);
    assert(unzReadCurrentFile(z, bytes, 8) == 8 && bytes[0] == 0);
    unzCloseCurrentFile(z); unzClose(z);
    assert(remove(argv[1]) == 0);
    /* Small ZIP32 entries retain sequential CRC and DEFLATE behavior. */
    zipFile output = zipOpen(argv[1], APPEND_STATUS_CREATE); assert(output);
    const char* text = "plain-and-compressed";
    for (int method = 0; method <= 8; method += 8) {
        assert(zipOpenNewFileInZip(output, method ? "deflated" : "stored",
            0, 0, 0, 0, 0, 0, method, Z_DEFAULT_COMPRESSION) == ZIP_OK);
        assert(zipWriteInFileInZip(output, text, strlen(text)) == ZIP_OK);
        assert(zipCloseFileInZip(output) == ZIP_OK);
    }
    assert(zipClose(output, 0) == ZIP_OK);
    z = unzOpen64(argv[1]); assert(z);
    assert(unzOpenCurrentFile(z) == UNZ_OK);
    assert(unzSeekCurrentFile64(z, 6) == UNZ_OK);
    assert(unzReadCurrentFile(z, bytes, 3) == 3 && memcmp(bytes, "and", 3) == 0);
    assert(unzSeekCurrentFile64(z, 0) == UNZ_OK);
    unsigned char complete[64];
    assert(unzReadCurrentFile(z, complete, sizeof(complete)) == strlen(text));
    assert(memcmp(complete, text, strlen(text)) == 0);
    assert(unzCloseCurrentFile(z) == UNZ_OK);
    assert(unzGoToNextFile(z) == UNZ_OK);
    assert(unzOpenCurrentFile(z) == UNZ_OK);
    assert(unzSeekCurrentFile64(z, 6) == UNZ_PARAMERROR);
    assert(unztell64(z) == 0);
    assert(unzReadCurrentFile(z, complete, sizeof(complete)) == strlen(text));
    assert(memcmp(complete, text, strlen(text)) == 0);
    assert(unzCloseCurrentFile(z) == UNZ_OK);
    unzClose(z);
    assert(remove(argv[1]) == 0);
}
`,
    );
    const minizip = `${root}/lib/zlib/contrib/minizip`;
    const compile = Bun.spawnSync([
      process.env.CC ?? "cc",
      "-D_FILE_OFFSET_BITS=64",
      "-I",
      minizip,
      source,
      `${minizip}/unzip.c`,
      `${minizip}/zip.c`,
      `${minizip}/ioapi.c`,
      "-lz",
      "-o",
      binary,
    ]);
    expect(compile.stderr.toString()).not.toContain("error:");
    expect(compile.exitCode).toBe(0);
    const run = Bun.spawnSync([binary, `${directory}/sparse.zip`], {
      timeout: 10000,
    });
    expect(run.exitCode).toBe(0);
  },
  30000,
);
