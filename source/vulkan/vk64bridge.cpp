// SPDX-License-Identifier: GPL-2.0-or-later
#include "boxedwine.h"
#ifdef BOXEDWINE_GUEST_X64
#include "cpu64.h"
#include "kmemory64.h"
#include "vk64bridge.h"
#include "vk64bridge_abi.h"
#include <chrono>
#include <mutex>
#include <unordered_map>
namespace {
using Clock = std::chrono::steady_clock;
struct Pending {
    KMemory64* memory;
    uint64_t token;
    uint32_t sequence;
    Clock::time_point deadline;
    std::vector<uint8_t> response;
    int error = 0;
};
std::mutex gate;
std::unordered_map<CPU64*, Pending> pending;
Vk64Dispatch dispatch;
Vk64Abort abortRequest;
uint64_t nextToken = 0;
uint32_t word(const uint8_t* p) {
    return uint32_t(p[0]) | (uint32_t(p[1]) << 8) | (uint32_t(p[2]) << 16) | (uint32_t(p[3]) << 24);
}
void expire() {
    auto now = Clock::now();
    for (auto it = pending.begin(); it != pending.end();) {
        if (it->second.deadline <= now) {
            if (abortRequest) abortRequest(it->second.token);
            it = pending.erase(it);
        } else ++it;
    }
}
bool range(KMemory64* memory, uint64_t ptr, uint64_t len, uint32_t permission) {
    if (!ptr || !len || len > VK64_MAX_PACKET || ptr > UINT64_MAX - len) return false;
    for (uint64_t page = ptr >> 12, last = (ptr + len - 1) >> 12; page <= last; ++page) {
        auto flags = memory->getPageFlags(page);
        if ((flags & (K64_PAGE_MAPPED | permission)) != (K64_PAGE_MAPPED | permission)) return false;
    }
    return true;
}
}
void vk64SetDispatch(Vk64Dispatch callback, Vk64Abort abort) {
    std::lock_guard<std::mutex> lock(gate);
    for (auto& item : pending) if (abortRequest) abortRequest(item.second.token);
    abortRequest = std::move(abort);
    dispatch = std::move(callback);
    pending.clear(); // Invalidates completions from the previous backend.
}
void vk64Complete(uint64_t token, std::vector<uint8_t> response) {
    std::lock_guard<std::mutex> lock(gate);
    expire();
    for (auto& item : pending) {
        auto& p = item.second;
        if (p.token != token || p.error || !p.response.empty()) continue;
        if (response.size() < 12 || response.size() > VK64_MAX_PACKET ||
            word(response.data()) != p.sequence || word(response.data() + 8) != response.size() - 12) {
            p.error = -K_EIO;
        } else p.response = std::move(response);
        return;
    }
}
void vk64Cancel(CPU64* cpu, bool process) {
    std::lock_guard<std::mutex> lock(gate);
    for (auto it = pending.begin(); it != pending.end();) {
        if (it->first == cpu || (process && it->second.memory == cpu->memory)) {
            if (abortRequest) abortRequest(it->second.token);
            it = pending.erase(it);
        }
        else ++it;
    }
}
uint64_t vk64Bridge(CPU64* cpu, uint64_t operation, uint64_t ptr, uint64_t bytes) {
    if (!cpu || !cpu->memory) return -K_EFAULT;
    std::unique_lock<std::mutex> lock(gate);
    expire();
    if (operation == VK64_CANCEL) {
        auto it = pending.find(cpu);
        if (it != pending.end()) {
            if (abortRequest) abortRequest(it->second.token);
            pending.erase(it);
        }
        return 0;
    }
    if (operation == VK64_POLL) {
        auto it = pending.find(cpu);
        if (it == pending.end()) return -K_ENOENT;
        auto& p = it->second;
        if (p.error) return p.error;
        if (p.response.empty()) return -K_EAGAIN;
        auto size = p.response.size();
        if (!ptr && !bytes) return size;
        if (bytes < size) return -K_EMSGSIZE;
        if (!range(cpu->memory, ptr, size, K64_PAGE_WRITE)) return -K_EFAULT;
        cpu->memory->memcpyToGuest(ptr, p.response.data(), size);
        pending.erase(it);
        return size;
    }
    if (operation != VK64_SUBMIT) return -K_EINVAL;
    if (bytes < 16 || bytes > VK64_MAX_PACKET) return -K_EMSGSIZE;
    if (!range(cpu->memory, ptr, bytes, K64_PAGE_READ)) return -K_EFAULT;
    if (pending.count(cpu)) return -K_EBUSY;
    if (!dispatch) return -K_ENODEV;
    // Four slots bound retained replies to 64 MiB; requests are moved to the backend.
    if (pending.size() >= 4 || nextToken == UINT64_MAX) return -K_EAGAIN;
    std::vector<uint8_t> packet(bytes);
    cpu->memory->memcpyFromGuest(packet.data(), ptr, bytes);
    if (word(packet.data()) != VK64_WEBX_MAGIC || word(packet.data() + 12) != bytes - 16) return -K_EINVAL;
    auto token = ++nextToken;
    pending.emplace(cpu, Pending{cpu->memory, token, word(packet.data() + 8), Clock::now() + std::chrono::seconds(30), {}, 0});
    auto callback = dispatch;
    auto abort = abortRequest;
    lock.unlock(); // Completion may run synchronously without deadlocking.
    callback(token, std::move(packet));
    lock.lock();
    auto current = pending.find(cpu);
    // A concurrent cancellation may precede start; repeat idempotent abort after it.
    if ((current == pending.end() || current->second.token != token) && abort) abort(token);
    return 0;
}
#endif
