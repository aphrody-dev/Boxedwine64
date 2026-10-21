/* SPDX-License-Identifier: GPL-2.0-or-later */
#define _GNU_SOURCE
#include <sys/mman.h>
#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include "../rootfs64/libvulkan64/vk64_client.h"
int main(void) {
    uint32_t* packet = mmap((void*)UINT64_C(0x100020000), 4096, PROT_READ|PROT_WRITE,
        MAP_PRIVATE|MAP_ANONYMOUS|MAP_FIXED_NOREPLACE, -1, 0);
    if (packet == MAP_FAILED || (uintptr_t)packet <= UINT32_MAX) return 2;
    packet[0]=VK64_WEBX_MAGIC; packet[1]=0; packet[2]=42; packet[3]=0;
    long result=vk64_call(VK64_SUBMIT, packet, 16);
    printf("VK64 high_pointer=%p submit=%ld (expected -19 without backend)\n", (void*)packet, result);
    if (result != -19) return 3;
    if (vk64_call(VK64_SUBMIT, (void*)UINT64_C(0x100030000), 16) != -14) return 4;
    if (vk64_call(VK64_SUBMIT, packet, VK64_MAX_PACKET+1) != -90) return 5;
    if (vk64_call(VK64_CANCEL, 0, 0) != 0) return 6;
    munmap(packet,4096);
    puts("VK64 transport absence and high addresses: PASS");
    return 0;
}
