// SPDX-License-Identifier: GPL-2.0-or-later
#ifndef VK64_BRIDGE_ABI_H
#define VK64_BRIDGE_ABI_H
#include <stdint.h>
#define VK64_SYSCALL_NR UINT64_C(0x564b0000)
#define VK64_SUBMIT 1
#define VK64_POLL 2
#define VK64_CANCEL 3
#define VK64_MAX_PACKET (16u * 1024u * 1024u)
#define VK64_WEBX_MAGIC UINT32_C(0x58574756)
// RDI=operation, RSI=guest pointer, RDX=byte count. Signed Linux errno result.
// WebX request: magic/cmd/seq/length (16 bytes LE), opaque serialized payload.
// WebX response: seq/result/length (12 bytes LE), opaque serialized payload.
// POLL(0,0) queries ready size. Failed copies never consume a response.
#endif
