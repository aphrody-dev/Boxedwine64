// SPDX-License-Identifier: GPL-2.0-or-later
// Compile actual transport against deterministic guest-memory test adapter.
#include "../../source/vulkan/vk64bridge.cpp"
#include <cassert>
#include <iostream>
int main() {
    KMemory64 mem; CPU64 cpu{&mem}; const uint64_t ptr=0x100020000ULL;
    uint32_t packet[]={VK64_WEBX_MAGIC,7,42,0}; memcpy(mem.data,packet,16);
    auto invoke=[&](uint64_t op,uint64_t p,uint64_t n){return (int64_t)vk64Bridge(&cpu,op,p,n);};
    assert(invoke(1,ptr,16)==-19);
    uint64_t saved=0; int aborted=0;
    vk64SetDispatch([&](uint64_t token,std::vector<uint8_t> bytes){saved=token; assert(bytes.size()==16);}, [&](uint64_t){++aborted;});
    assert(invoke(1,ptr,16)==0); assert(invoke(1,ptr,16)==-16);
    assert(invoke(2,0,0)==-11);
    std::vector<uint8_t> reply(12); reply[0]=42;
    vk64Complete(saved,reply);
    assert(invoke(2,0,0)==12); assert(invoke(2,ptr,11)==-90);
    assert(invoke(2,0x200000000ULL,12)==-14); assert(invoke(2,0,0)==12);
    assert(invoke(2,ptr+32,12)==12); assert(mem.data[32]==42); assert(invoke(2,0,0)==-2);
    assert(invoke(1,ptr,16)==0); auto old=saved; assert(invoke(3,0,0)==0);
    assert(invoke(1,ptr,16)==0); vk64Complete(old,reply); assert(invoke(2,0,0)==-11);
    reply[0]=41; vk64Complete(saved,reply); assert(invoke(2,0,0)==-5);
    vk64Cancel(&cpu,true); assert(invoke(2,0,0)==-2);
    mem.data[0]=0; assert(invoke(1,ptr,16)==-22);
    assert(invoke(1,UINT64_MAX-8,16)==-14);
    assert(aborted >= 2); vk64SetDispatch({});
    std::cout << "VK64 protocol conformance PASS (no GPU backend)\n";
}
