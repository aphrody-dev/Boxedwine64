/*
 *  Copyright (C) 2012-2025  The BoxedWine Team
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 2 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program; if not, write to the Free Software
 *  Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA 02111-1307, USA.
 */

#include "boxedwine.h"
#ifdef BOXEDWINE_ZLIB
#undef OF
#define STRICTUNZIP
extern "C"
{
    #include "../../lib/zlib/contrib/minizip/unzip.h"
}
#include "fsfilenode.h"
#include "fszip.h"
#include "fszipnode.h"
#include "fszipurl.h"
#include <time.h>
#include <string.h>

bool FsZip::setupZipRead(U64 zipOffset, U64 zipFileOffset, const void* owner) {
#ifdef BOXEDWINE_ZLIB
    // The (lastZipOffset, lastZipFileOffset) skip-ahead is only valid when the
    // stream is exactly where THIS reader last left it. If a different open-node
    // touched the shared unzFile in between (two processes mmap'ing the same zip
    // entry concurrently — each FsZipOpenNode has its own `pos`, but they share
    // this one decompression stream), the skip would fast-forward by the wrong
    // distance and decode the wrong file bytes. Forcing a fresh reopen+seek on an
    // owner change keeps each read positioned by its own (offset,pos).
    bool ownerChanged = (owner != lastReadOwner);
    if (zipOffset != lastZipOffset || zipFileOffset < lastZipFileOffset || ownerChanged) {
        unzCloseCurrentFile(this->zipfile);
        lastReadOwner = nullptr;
        lastZipOffset = ~static_cast<U64>(0);
        if (unzSetOffset64(this->zipfile, zipOffset) != UNZ_OK) return false;
        lastZipFileOffset = 0;
        if (unzOpenCurrentFile(this->zipfile) != UNZ_OK) return false;
        lastZipOffset = zipOffset;
    }
    lastReadOwner = owner;
    if (zipFileOffset != lastZipFileOffset) {
        int seekResult = unzSeekCurrentFile64(this->zipfile, zipFileOffset);
        if (seekResult == UNZ_OK) {
            lastZipFileOffset = zipFileOffset;
            return true;
        }
        if (seekResult != UNZ_PARAMERROR) return false;
        char tmp[4096] = {};
        U64 todo = zipFileOffset - lastZipFileOffset;
        while (todo) {
            int read = unzReadCurrentFile(this->zipfile, tmp, (unsigned)(todo > sizeof(tmp) ? sizeof(tmp) : todo));
            if (read <= 0) {
                lastReadOwner = nullptr;
                lastZipOffset = ~static_cast<U64>(0);
                return false;
            }
            todo -= (U64)read;
            lastZipFileOffset += (U64)read;
        }
    }
#endif
    return true;
}

bool FsZip::init(BString zipPath, BString mount) {
#ifdef BOXEDWINE_ZLIB
    BString strippedMount;

    std::shared_ptr<FsNode> root = Fs::getNodeFromLocalPath(B(""), B(""), true);
    // A bw64url: spec is not a filesystem path — give its tombstone file a
    // fixed name instead of deriving one from the spec string.
    BString deleteName = fsZipUrlIsSpec(zipPath) ? B("bw64url") : Fs::getFileNameFromNativePath(zipPath);
    deleteFilePath = root->nativePath.stringByApppendingPath(deleteName + ".deleted");
    if (mount.length()) {
        Fs::makeLocalDirs(mount);
        strippedMount = mount.substr(0, mount.length() - 1);
    }
    this->lastZipOffset = 0xFFFFFFFFFFFFFFFFl;
    if (zipPath.length()) {
        unz_global_info64 global_info = {};

        this->zipfile = fsZipUrlIsSpec(zipPath) ? fsZipUrlOpen(zipPath)
                                                 : unzOpen64(zipPath.c_str());
        if (!this->zipfile) {
            klog_fmt("Could not load zip file: %s", zipPath.c_str());
            return false;
        }

        if (unzGetGlobalInfo64( this->zipfile, &global_info ) != UNZ_OK) {
            klog_fmt("Could not read file global info from zip file: %s", zipPath.c_str());
            unzClose( this->zipfile );
            this->zipfile = nullptr;
            return false;
        }
        fsZipInfo* zipInfo = new fsZipInfo[global_info.number_entry];
        for (U64 i = 0; i < global_info.number_entry; ++i) {
            unz_file_info64 file_info = {};
            struct tm tm={0};
            char tmp[MAX_FILEPATH_LEN];

            tmp[0] = '/';
            if ( unzGetCurrentFileInfo64(this->zipfile, &file_info, tmp + 1, MAX_FILEPATH_LEN - 1, nullptr, 0, nullptr, 0 ) != UNZ_OK ) {
                klog_fmt("Could not read file info from zip file: %s", zipPath.c_str());
                delete[] zipInfo;
                unzClose( zipfile );
                zipfile = nullptr;
                return false;
            }
            zipInfo[i].filename = BString::copy(tmp);
            zipInfo[i].offset = unzGetOffset64(this->zipfile);
            Fs::remoteNameToLocal(zipInfo[i].filename); // converts special characters like :

            // Layout sniff: a single x86_64 path anywhere in the archive
            // flips guestIs64. We don't `break` because (a) we still need to
            // process every entry, and (b) seeing the marker repeatedly is
            // harmless. Patterns we look for (in priority order — all are
            // strong signals):
            //   - "x86_64-linux-gnu/"     glibc multiarch dir
            //   - "x86_64-unix/"          Wine64's unix-side modules
            //   - "x86_64-windows/"       Wine64's PE-side modules
            //   - "lib64/"                generic 64-bit libdir
            // 32-bit-only zips contain `i386-linux-gnu/`, `i386-unix/`,
            // `i386-windows/`, and `lib/i386-*` paths but never any of the
            // markers above — so this check has no false positives against
            // existing TinyCore16 / Wine7.0 / Wine9.0 32-bit rootfs zips.
            if (!guestIs64) {
                const char* fn = zipInfo[i].filename.c_str();
                if (strstr(fn, "x86_64-linux-gnu/") != nullptr
                 || strstr(fn, "x86_64-unix/")      != nullptr
                 || strstr(fn, "x86_64-windows/")   != nullptr
                 || strstr(fn, "/lib64/")           != nullptr) {
                    guestIs64 = true;
                }
            }

            if (zipInfo[i].filename.endsWith("/")) {
                zipInfo[i].filename = zipInfo[i].filename.substr(0, zipInfo[i].filename.length() - 1);
                zipInfo[i].isDirectory = true;
            } else {
                zipInfo[i].length = file_info.uncompressed_size;
            }               
            tm.tm_sec = file_info.tmu_date.tm_sec;
            tm.tm_min = file_info.tmu_date.tm_min;
            tm.tm_hour = file_info.tmu_date.tm_hour;
            tm.tm_mday = file_info.tmu_date.tm_mday;
            tm.tm_mon = file_info.tmu_date.tm_mon;
            tm.tm_year = file_info.tmu_date.tm_year;
            if (tm.tm_year>1900)
                tm.tm_year-=1900;

            zipInfo[i].lastModified = ((U64)mktime(&tm))*1000l;
            
            unzGoToNextFile(this->zipfile);
        }
        std::vector<BString> deletedLocalPaths;
        readLinesFromFile(deleteFilePath, deletedLocalPaths);

        for (U64 i = 0; i < global_info.number_entry; ++i) {
            if (zipInfo[i].filename.endsWith(EXT_LINK)) {
                char tmp[MAX_FILEPATH_LEN];
                zipInfo[i].filename = zipInfo[i].filename.substr(0, zipInfo[i].filename.length() - 5);
                zipInfo[i].isLink = true;
                unzSetOffset64(zipfile, zipInfo[i].offset);
                unzOpenCurrentFile(zipfile);
                int read = unzReadCurrentFile(this->zipfile, tmp, MAX_FILEPATH_LEN - 1);
                if (read < 0) {
                    delete[] zipInfo;
                    unzClose(zipfile);
                    zipfile = nullptr;
                    return false;
                }
                tmp[read] = 0;
                zipInfo[i].link = BString::copy(tmp);
                unzCloseCurrentFile(this->zipfile);
            }
            BString localZipPart = zipInfo[i].filename;
            Fs::remoteNameToLocal(localZipPart);
            BString localPath = strippedMount + localZipPart;
            if (vectorIndexOf(deletedLocalPaths, localPath) != -1) {
                continue;
            }
            BString parentPath = Fs::getParentPath(localPath);
            std::shared_ptr<FsNode> parent = Fs::getNodeFromLocalPath(B(""), parentPath, true);
            if (!parent) {
                Fs::makeLocalDirs(parentPath);
                parent = Fs::getNodeFromLocalPath(B(""), parentPath, true);
            }
            BString localFileName = Fs::getFileNameFromPath(localPath);
            BString nativePath = Fs::getNativePathFromParentAndLocalFilename(parent, localFileName);
            std::shared_ptr<FsNode> existingNode = Fs::getNodeFromLocalPath(B(""), localPath, false);
            if (!existingNode) {
                std::shared_ptr<FsFileNode> node = Fs::addFileNode(localPath, zipInfo[i].link, nativePath, zipInfo[i].isDirectory, parent);
                node->zipNode = std::make_shared<FsZipNode>(zipInfo[i], shared_from_this());
            }
        }   
        delete[] zipInfo;
    }
#endif
    return true;
}

FsZip::~FsZip() {
#ifdef BOXEDWINE_ZLIB
    unzClose(this->zipfile);
#endif
}

void FsZip::remove(BString localPath) {
    BOXEDWINE_CRITICAL_SECTION;
    std::vector<BString> lines;
    readLinesFromFile(deleteFilePath, lines);
    if (vectorIndexOf(lines, localPath) == -1) {
        lines.push_back(localPath);
        writeLinesToFile(deleteFilePath, lines);
    }
}

bool FsZip::doesFileExist(BString zipFile, BString file) {
    unzFile z = fsZipUrlIsSpec(zipFile) ? fsZipUrlOpen(zipFile) : unzOpen64(zipFile.c_str());
    unz_global_info64 global_info = {};
    if (!z) {
        return false;
    }
    if (unzGetGlobalInfo64(z, &global_info) != UNZ_OK) {
        unzClose(z);
        return false;
    }
    for (U64 i = 0; i < global_info.number_entry; ++i) {
        unz_file_info64 file_info;
        char tmp[MAX_FILEPATH_LEN];

        if (unzGetCurrentFileInfo64(z, &file_info, tmp, MAX_FILEPATH_LEN, nullptr, 0, nullptr, 0) != UNZ_OK) {
            unzClose(z);
            return false;
        }

        if (file == tmp) {
            unzCloseCurrentFile(z);
            unzClose(z);
            return true;
        }
        unzGoToNextFile(z);
    }
    unzClose(z);
    return false;
}

bool FsZip::readFileFromZip(BString zipFile, BString file, BString& result) {
    unzFile z = fsZipUrlIsSpec(zipFile) ? fsZipUrlOpen(zipFile) : unzOpen64(zipFile.c_str());
    unz_global_info64 global_info = {};
    if (!z) {
        return false;
    }
    if (unzGetGlobalInfo64( z, &global_info ) != UNZ_OK) {
        unzClose( z );
        return false;
    }
    for (U64 i = 0; i < global_info.number_entry; ++i) {
        unz_file_info64 file_info;
        char tmp[MAX_FILEPATH_LEN];

        if ( unzGetCurrentFileInfo64(z, &file_info, tmp, MAX_FILEPATH_LEN, nullptr, 0, nullptr, 0 ) != UNZ_OK ) {
            unzClose( z );
            return false;
        }
        
        if (file == tmp) {
            // BString is a bounded in-memory text helper, not the streaming API.
            if (file_info.uncompressed_size > 0x7ffffffeULL || unzOpenCurrentFile(z) != UNZ_OK) {
                unzClose(z);
                return false;
            }
            std::vector<char> buffer((size_t)file_info.uncompressed_size + 1);
            U64 totalRead = 0;
            while (totalRead < file_info.uncompressed_size) {
                U64 remaining = file_info.uncompressed_size - totalRead;
                int read = unzReadCurrentFile(z, buffer.data() + (size_t)totalRead,
                    (unsigned)(remaining > 65536 ? 65536 : remaining));
                if (read <= 0) break;
                totalRead += (U64)read;
            }
            int closeResult = unzCloseCurrentFile(z);
            unzClose(z);
            if (totalRead != file_info.uncompressed_size || closeResult != UNZ_OK) return false;
            buffer[(size_t)totalRead] = 0;
            result = BString::copy(buffer.data());
            return true;
        }
        unzGoToNextFile(z);
    }
    unzClose(z);
    return false;
}

bool FsZip::extractFileFromZip(BString zipFile, BString file, BString path) {
    unzFile z = fsZipUrlIsSpec(zipFile) ? fsZipUrlOpen(zipFile) : unzOpen64(zipFile.c_str());
    unz_global_info64 global_info = {};
    if (!z) {
        return false;
    }
    if (unzGetGlobalInfo64( z, &global_info ) != UNZ_OK) {
        unzClose( z );
        return false;
    }
    for (U64 i = 0; i < global_info.number_entry; ++i) {
        unz_file_info64 file_info;
        char tmp[MAX_FILEPATH_LEN];

        if ( unzGetCurrentFileInfo64(z, &file_info, tmp, MAX_FILEPATH_LEN, nullptr, 0, nullptr, 0 ) != UNZ_OK ) {
            unzClose( z );
            return false;
        }
        
        if (file == tmp) {
            if (unzOpenCurrentFile(z) != UNZ_OK) {
                unzClose(z);
                return false;
            }
            if (!Fs::doesNativePathExist(path)) {
                Fs::makeNativeDirs(path);
            }
            BString outPath = path.stringByApppendingPath(Fs::getFileNameFromPath(file));
            FILE* f = fopen(outPath.c_str(), "wb");
            if (f) {
                U64 totalRead = 0;
                U8 buffer[4096] = {};

                while (totalRead<file_info.uncompressed_size) {
                    int read = unzReadCurrentFile(z, buffer, sizeof(buffer));
                    if (read <= 0) {
                        break;
                    }
                    if (fwrite(buffer, 1, read, f) != (size_t)read) break;
                    totalRead += (U64)read;
                }
                int fileCloseResult = fclose(f);
                int zipCloseResult = unzCloseCurrentFile(z);
                unzClose(z);
                return totalRead == file_info.uncompressed_size && fileCloseResult == 0 && zipCloseResult == UNZ_OK;
            } else {
                unzCloseCurrentFile(z);
                unzClose(z);
                return false;
            }
        }
        unzGoToNextFile(z);
    }
    unzClose(z);
    return false;
}

bool FsZip::iterateFiles(BString zipFile, std::function<void(BString)> it) {
    unzFile z = fsZipUrlIsSpec(zipFile) ? fsZipUrlOpen(zipFile) : unzOpen64(zipFile.c_str());
    unz_global_info64 global_info = {};
    if (!z) {
        return false;
    }

    if (unzGetGlobalInfo64(z, &global_info) != UNZ_OK) {
        unzClose(z);
        return false;
    }

    for (U64 i = 0; i < global_info.number_entry; ++i) {
        unz_file_info64 file_info;
        char tmp[MAX_FILEPATH_LEN];

        if (unzGetCurrentFileInfo64(z, &file_info, tmp, MAX_FILEPATH_LEN, nullptr, 0, nullptr, 0) != UNZ_OK) {
            unzClose(z);
            return false;
        }
        it(BString::copy(tmp));
        unzGoToNextFile(z);
    }
    unzClose(z);
    return true;
}

bool FsZip::detectGuestIs64(BString zipFile) {
    // Mirrors FsZip::init's layout sniff (see fszip.cpp ~line 99) but stops
    // at the first hit and avoids constructing a full FsZip / opening every
    // entry. Used by the UI launcher to badge installed Wine zips before
    // any container is created.
    unzFile z = fsZipUrlIsSpec(zipFile) ? fsZipUrlOpen(zipFile) : unzOpen64(zipFile.c_str());
    if (!z) {
        return false;
    }
    unz_global_info64 global_info = {};
    if (unzGetGlobalInfo64(z, &global_info) != UNZ_OK) {
        unzClose(z);
        return false;
    }
    bool result = false;
    for (U64 i = 0; i < global_info.number_entry; ++i) {
        unz_file_info64 file_info;
        char tmp[MAX_FILEPATH_LEN];
        if (unzGetCurrentFileInfo64(z, &file_info, tmp, MAX_FILEPATH_LEN, nullptr, 0, nullptr, 0) != UNZ_OK) {
            break;
        }
        if (strstr(tmp, "x86_64-linux-gnu/") != nullptr
         || strstr(tmp, "x86_64-unix/")      != nullptr
         || strstr(tmp, "x86_64-windows/")   != nullptr
         || strstr(tmp, "/lib64/")           != nullptr) {
            result = true;
            break;
        }
        unzGoToNextFile(z);
    }
    unzClose(z);
    return result;
}

BString FsZip::unzip(BString zipFile, BString path, std::function<void(U32, BString fileName)> percentDone) {
    unzFile z = fsZipUrlIsSpec(zipFile) ? fsZipUrlOpen(zipFile) : unzOpen64(zipFile.c_str());
    unz_global_info64 global_info = {};
    if (!z) {
        return "Could not open zip file: " + zipFile;
    }
    U64 fileSize = Fs::getNativeFileSize(zipFile);
    U64 compressedFileSizeProcessed = 0;

    if (unzGetGlobalInfo64(z, &global_info) != UNZ_OK) {
        unzClose(z);
        return "Could not read file global info from zip file: "+ zipFile;
    }
    if (!Fs::doesNativePathExist(path)) {
        if (!Fs::makeNativeDirs(path)) {
            return "Could not create directory: " + path + "\n\n" + strerror(errno);
        }
    }
    for (U64 i = 0; i < global_info.number_entry; ++i) {
        unz_file_info64 file_info;
        char tmp[MAX_FILEPATH_LEN];

        if (unzGetCurrentFileInfo64(z, &file_info, tmp, MAX_FILEPATH_LEN, nullptr, 0, nullptr, 0) != UNZ_OK) {
            unzClose(z);
            return "Could not read file info from zip file: "+zipFile;
        }
        BString fileName = BString::copy(tmp);
        if (fileName.endsWith("/")) {
            BString dirPath = path.stringByApppendingPath(fileName);
            if (!Fs::doesNativePathExist(dirPath)) {
                if (!Fs::makeNativeDirs(dirPath)) {
                    unzClose(z);
                    return "Could not create directory: " + dirPath + "\n\n" + strerror(errno);
                }
            }
            unzGoToNextFile(z);
            continue;
        }
        if (Fs::nativePathSeperator != "/") {
            fileName = fileName.replace("/", Fs::nativePathSeperator);
        }
        if (unzOpenCurrentFile(z) != UNZ_OK) {
            unzClose(z);
            return "Could not open zip entry: " + fileName;
        }
        percentDone(fileSize ? (U32)(compressedFileSizeProcessed * 100 / fileSize) : 0, fileName);
        BString outPath = path.stringByApppendingPath(fileName);
#ifdef BOXEDWINE_MSVC
        if (outPath.length() > 255) {
            outPath = "\\\\?\\" + outPath;
        }
#endif
        FILE* f = fopen(outPath.c_str(), "wb");
        if (f) {
            U64 totalRead = 0;
            U8 buffer[4096] = {};

            while (totalRead < file_info.uncompressed_size) {
                int read = unzReadCurrentFile(z, buffer, sizeof(buffer));
                if (read <= 0) {
                    break;
                }
                if (fwrite(buffer, 1, read, f) != (size_t)read) break;
                totalRead += (U64)read;
            }
            int fileCloseResult = fclose(f);
            int zipCloseResult = unzCloseCurrentFile(z);
            if (totalRead != file_info.uncompressed_size || fileCloseResult != 0 || zipCloseResult != UNZ_OK) {
                unzClose(z);
                return "Could not extract complete file: " + outPath;
            }
            compressedFileSizeProcessed += file_info.compressed_size;            
        } else {
            unzCloseCurrentFile(z);
            unzClose(z);
            return "Could not create file: " + outPath + "\n\n" + strerror(errno);
        }
        unzGoToNextFile(z);
    }
    unzClose(z);
    return B("");
}
#endif
