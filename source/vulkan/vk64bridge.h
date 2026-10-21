// SPDX-License-Identifier: GPL-2.0-or-later
#ifndef VK64_BRIDGE_H
#define VK64_BRIDGE_H
#include <cstdint>
#include <functional>
#include <vector>
class CPU64;
using Vk64Dispatch = std::function<void(uint64_t, std::vector<uint8_t>)>;
// Register before guest execution. Callback must return promptly and own its packet.
// No callback is installed by default: no Vulkan device or success is fabricated.
using Vk64Abort = std::function<void(uint64_t)>;
// Abort must be idempotent, nonblocking and must not reenter this bridge (called under its lock).
// It must release retained backend requests/resources on timeout, cancel and reset.
void vk64SetDispatch(Vk64Dispatch dispatch, Vk64Abort abort = {});
void vk64Complete(uint64_t token, std::vector<uint8_t> response);
uint64_t vk64Bridge(CPU64* cpu, uint64_t operation, uint64_t pointer, uint64_t bytes);
void vk64Cancel(CPU64* cpu, bool process);
#endif
