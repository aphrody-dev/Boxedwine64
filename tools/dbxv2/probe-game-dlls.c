/* SPDX-License-Identifier: GPL-2.0-or-later */
/* Load real installed libraries to report loader errors; no game files are changed. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include "probe-game-imports.h"

int main(void) {
    const char *directory = "Z:\\home\\username\\DBXV2\\bin";
    /* Names observed in the installation and its static import tables. */
    const char *libraries[] = {
        "steam_api64.dll", "xgcore.dll", "iggy_w64.dll",
        "render_pass_x64.dll", "oo2core_6_win64.dll",
        "EOSSDK-Win64-Shipping.dll",
        "MSVCP140.dll", "VCRUNTIME140.dll", "VCRUNTIME140_1.dll",
        "ucrtbase.dll", "d3d11.dll", "dxgi.dll", "d3dx11_43.dll",
        "D3DCOMPILER_43.dll", "DINPUT8.dll", "XINPUT1_3.dll",
        "WINMM.dll", "bcrypt.dll", "WININET.dll", "WS2_32.dll",
        "WINHTTP.dll", "CRYPT32.dll", "WINTRUST.dll", "Secur32.dll",
        "IPHLPAPI.dll", "ole32.dll", "OLEAUT32.dll"
    };
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOOPENFILEERRORBOX);
    SetLastError(0);
    BOOL current = SetCurrentDirectoryA(directory);
    DWORD currentError = current ? 0 : GetLastError();
    SetLastError(0);
    BOOL search = SetDllDirectoryA(directory);
    DWORD searchError = search ? 0 : GetLastError();
    fprintf(stderr, "DLL_PROBE directory=%s current=%d current_error=%lu search=%d search_error=%lu\n",
        directory, current != 0, currentError, search != 0, searchError);
    fflush(stderr);
    if (!current || !search) return 2;
    unsigned failed = 0;
    for (unsigned i = 0; i < sizeof(libraries) / sizeof(libraries[0]); i++) {
        fprintf(stderr, "DLL_PROBE begin name=%s\n", libraries[i]);
        fflush(stderr);
        SetLastError(0);
        HMODULE module = LoadLibraryA(libraries[i]);
        DWORD error = module ? 0 : GetLastError();
        char resolved[32768] = {0};
        DWORD length = module ? GetModuleFileNameA(module, resolved, sizeof(resolved)) : 0;
        DWORD pathError = module && !length ? GetLastError() : 0;
        fprintf(stderr, "DLL_PROBE result name=%s loaded=%d error=%lu path_error=%lu path=%s\n",
            libraries[i], module != NULL, error, pathError, length ? resolved : "<none>");
        fflush(stderr);
        if (!module) failed++;
        /* Keep modules loaded: unloading private DLLs can add unrelated teardown
           failures and prevents diagnosing the same shared dependency graph. */
    }
    fprintf(stderr, "DLL_PROBE done failed=%u total=%u\n", failed,
        (unsigned)(sizeof(libraries) / sizeof(libraries[0])));
    fflush(stderr);
    fprintf(stderr, "IMPORT_PROBE source_sha256=%s\n", import_source_sha256);
    unsigned missingTotal = 0;
    for (unsigned i = 0; i < sizeof(import_modules) / sizeof(import_modules[0]); i++) {
        const char *name = import_modules[i].module;
        fprintf(stderr, "IMPORT_PROBE begin module=%s\n", name);
        fflush(stderr);
        SetLastError(0);
        HMODULE module = LoadLibraryA(name);
        DWORD loadError = module ? 0 : GetLastError();
        unsigned missing = 0;
        for (unsigned j = 0; j < import_modules[i].count; j++) {
            const char *symbol = import_modules[i].names[j];
            const char *lookup = symbol;
            if (symbol[0] == '#') {
                char *end = NULL;
                unsigned long ordinal = strtoul(symbol + 1, &end, 10);
                if (*end || ordinal == 0 || ordinal > 65535) {
                    fprintf(stderr, "IMPORT_PROBE invalid_ordinal module=%s name=%s\n", name, symbol);
                    missing++;
                    continue;
                }
                lookup = MAKEINTRESOURCEA((WORD)ordinal);
            }
            SetLastError(0);
            FARPROC procedure = module ? GetProcAddress(module, lookup) : NULL;
            DWORD error = module ? (procedure ? 0 : GetLastError()) : loadError;
            if (!procedure) {
                fprintf(stderr, "IMPORT_PROBE missing module=%s name=%s error=%lu\n", name, symbol, error);
                fflush(stderr);
                missing++;
            }
        }
        fprintf(stderr, "IMPORT_PROBE module=%s total=%u missing=%u load_error=%lu\n", name, import_modules[i].count, missing, loadError);
        fflush(stderr);
        missingTotal += missing;
    }
    fprintf(stderr, "IMPORT_PROBE done missing=%u\n", missingTotal);
    fflush(stderr);
    return failed || missingTotal ? 1 : 0;
}
