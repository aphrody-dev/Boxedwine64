/* SPDX-License-Identifier: GPL-2.0-or-later */
#ifndef VK64_CLIENT_H
#define VK64_CLIENT_H
#include "../../../source/vulkan/vk64bridge_abi.h"
/* Transport only. Deliberately exports no fake Vulkan device functions. */
static inline long vk64_call(uint64_t op, const void* ptr, uint64_t bytes) {
    long result;
    __asm__ volatile("syscall" : "=a"(result) : "a"(VK64_SYSCALL_NR), "D"(op), "S"(ptr), "d"(bytes) : "rcx", "r11", "memory");
    return result;
}
#endif
