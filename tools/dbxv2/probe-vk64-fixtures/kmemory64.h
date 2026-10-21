#pragma once
#include <cstdint>
#include <cstring>
#define K64_PAGE_MAPPED 32
#define K64_PAGE_READ 1
#define K64_PAGE_WRITE 2
class KMemory64 {
public:
    uint8_t data[4096] = {};
    uint32_t getPageFlags(uint64_t page) { return page == 0x100020 ? 35 : 0; }
    void memcpyFromGuest(void* out, uint64_t ptr, uint64_t len) { memcpy(out,data+(ptr-0x100020000ULL),len); }
    void memcpyToGuest(uint64_t ptr,const void* in,uint64_t len) { memcpy(data+(ptr-0x100020000ULL),in,len); }
};
