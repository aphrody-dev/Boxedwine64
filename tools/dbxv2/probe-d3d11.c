/* SPDX-License-Identifier: GPL-2.0-or-later */
/* A standalone capability probe; it never loads or modifies game files. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdio.h>

/* Use the stable ABI without requiring DirectX headers or import libraries. */
typedef HRESULT (WINAPI *CreateDeviceFn)(
    void *, int, HMODULE, UINT, const int *, UINT, UINT,
    void **, int *, void **);

static void release_interface(void *object) {
    typedef ULONG (WINAPI *ReleaseFn)(void *);
    if (object) {
        void **vtable = *(void ***)object;
        ((ReleaseFn)vtable[2])(object);
    }
}

int main(void) {
    HMODULE library = LoadLibraryA("d3d11.dll");
    if (!library) {
        fprintf(stderr, "D3D11_PROBE load_failed win32=%lu\n", GetLastError());
        return 2;
    }
    CreateDeviceFn create = (CreateDeviceFn)GetProcAddress(library, "D3D11CreateDevice");
    if (!create) {
        fprintf(stderr, "D3D11_PROBE entrypoint_missing win32=%lu\n", GetLastError());
        FreeLibrary(library);
        return 3;
    }
    /* Hardware only: a software fallback must not masquerade as GPU support. */
    const int levels[] = { 0xb000, 0xa100, 0xa000, 0x9300, 0x9200, 0x9100 };
    void *device = NULL, *context = NULL;
    int selected = 0;
    HRESULT result = create(NULL, 1, NULL, 0, levels,
        sizeof(levels) / sizeof(levels[0]), 7, &device, &selected, &context);
    fprintf(stderr, "D3D11_PROBE hardware hresult=0x%08lx feature_level=0x%04x device=%d context=%d\n",
        (unsigned long)result, selected, device != NULL, context != NULL);
    fflush(stderr);
    release_interface(context);
    release_interface(device);
    FreeLibrary(library);
    /* Success at a lower level is reported but does not pass the FL11_0 gate. */
    return FAILED(result) ? 4 : selected < 0xb000 ? 5 : 0;
}
