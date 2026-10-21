// SPDX-License-Identifier: GPL-2.0-or-later
#include "boxedwine.h"
#if defined(BOXEDWINE_GUEST_X64) && defined(__EMSCRIPTEN__)
#include "vk64bridge.h"
#include "vk64bridge_abi.h"
#include <emscripten.h>
#include <cstdlib>
#include <memory>

extern "C" EMSCRIPTEN_KEEPALIVE uintptr_t bw64_vk64_alloc(uint32_t size) {
    if (size < 12 || size > VK64_MAX_PACKET) return 0;
    return reinterpret_cast<uintptr_t>(std::malloc(size));
}

extern "C" EMSCRIPTEN_KEEPALIVE void bw64_vk64_complete(uint32_t lo, uint32_t hi,
                                                       uint8_t* bytes, uint32_t size) {
    std::unique_ptr<uint8_t, decltype(&std::free)> owned(bytes, &std::free);
    std::vector<uint8_t> response;
    if (bytes && size >= 12 && size <= VK64_MAX_PACKET) response.assign(bytes, bytes + size);
    vk64Complete((uint64_t(hi) << 32) | lo, std::move(response));
}

// Enabled only after a real browser backend has initialized successfully.
extern "C" EMSCRIPTEN_KEEPALIVE int bw64_vk64_enable() {
    if (!MAIN_THREAD_EM_ASM_INT({
        return !!(Module['vk64Backend'] && typeof Module['vk64Backend'].dispatch === 'function');
    })) return 0;
    vk64SetDispatch([](uint64_t token, std::vector<uint8_t> packet) {
        MAIN_THREAD_EM_ASM({
            const lo = $0 >>> 0;
            const hi = $1 >>> 0;
            const key = hi + ':' + lo;
            const pointer = $2 >>> 0;
            const packet = new Uint8Array(wasmMemory.buffer).slice(pointer, pointer + ($3 >>> 0));
            const sequence = new DataView(packet.buffer).getUint32(8, true);
            function complete(bytes) {
                const pointer = Module['ccall']('bw64_vk64_alloc', 'number', ['number'], [bytes.length]) >>> 0;
                let size = 0;
                try { if (pointer) { new Uint8Array(wasmMemory.buffer).set(bytes, pointer); size = bytes.length; } }
                finally {
                    Module['ccall']('bw64_vk64_complete', null,
                        ['number', 'number', 'number', 'number'], [lo, hi, pointer, size]);
                }
            }
            Promise.resolve().then(() => Module['vk64Backend'].dispatch(key, packet)).then(complete).catch(() => {
                const error = new Uint8Array(12), view = new DataView(error.buffer);
                view.setUint32(0, sequence, true);
                view.setInt32(4, -4, true); // VK_ERROR_DEVICE_LOST: actual backend failure.
                try { complete(error); }
                catch (failure) { console.error('VK64 completion failed', failure); }
            });
        }, uint32_t(token), uint32_t(token >> 32), packet.data(), packet.size());
    }, [](uint64_t token) {
        MAIN_THREAD_ASYNC_EM_ASM({
            Module['vk64Backend']?.cancel(($1 >>> 0) + ':' + ($0 >>> 0));
        }, uint32_t(token), uint32_t(token >> 32));
    });
    return 1;
}
#endif
