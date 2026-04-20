#include "gzipfilereader.h"

GzipFileReader::GzipFileReader()
    : decomp(nullptr), window(nullptr), writePos(0), readPos(0), count(0),
      inBufPos(0), inBufLen(0), deflateStart(0),
      streamEnded(false), errored(false), isOpen(false), uncompSize(0) {}

GzipFileReader::~GzipFileReader() {
    close();
}

bool GzipFileReader::open(const char *path) {
    close();

    file = LittleFS.open(path);
    if (!file) {
        return false;
    }

    window = (uint8_t *)malloc(WINDOW_SIZE);
    decomp = (tinfl_decompressor *)malloc(sizeof(tinfl_decompressor));
    if (!window || !decomp) {
        close();
        return false;
    }

    if (!parseGzipHeader()) {
        close();
        return false;
    }

    if (file.size() >= 4) {
        size_t savedPos = file.position();
        file.seek(file.size() - 4);
        uint8_t isize[4];
        file.read(isize, 4);
        uncompSize = (uint32_t)isize[0] | ((uint32_t)isize[1] << 8) |
                     ((uint32_t)isize[2] << 16) | ((uint32_t)isize[3] << 24);
        file.seek(savedPos);
    }

    resetStreamState();
    isOpen = true;
    return true;
}

void GzipFileReader::close() {
    if (file) file.close();
    if (window) { free(window); window = nullptr; }
    if (decomp) { free(decomp); decomp = nullptr; }
    writePos = readPos = count = 0;
    inBufPos = inBufLen = 0;
    streamEnded = errored = isOpen = false;
    uncompSize = 0;
}

bool GzipFileReader::parseGzipHeader() {
    uint8_t hdr[10];
    if (file.read(hdr, 10) != 10) return false;
    if (hdr[0] != 0x1F || hdr[1] != 0x8B) return false;
    if (hdr[2] != 0x08) return false;
    uint8_t flags = hdr[3];

    if (flags & 0x04) {
        uint8_t xlen[2];
        if (file.read(xlen, 2) != 2) return false;
        uint16_t elen = (uint16_t)xlen[0] | ((uint16_t)xlen[1] << 8);
        if (!file.seek(file.position() + elen)) return false;
    }
    if (flags & 0x08) {
        int c;
        do { c = file.read(); } while (c > 0);
        if (c < 0) return false;
    }
    if (flags & 0x10) {
        int c;
        do { c = file.read(); } while (c > 0);
        if (c < 0) return false;
    }
    if (flags & 0x02) {
        if (!file.seek(file.position() + 2)) return false;
    }

    deflateStart = file.position();
    return true;
}

void GzipFileReader::resetStreamState() {
    tinfl_init(decomp);
    writePos = readPos = count = 0;
    inBufPos = inBufLen = 0;
    streamEnded = false;
    errored = false;
}

bool GzipFileReader::seek(size_t pos) {
    if (!isOpen || pos != 0) return false;
    if (!file.seek(deflateStart)) return false;
    resetStreamState();
    return true;
}

uint32_t GzipFileReader::size() const {
    return uncompSize;
}

bool GzipFileReader::pumpOnce() {
    if (streamEnded || errored) return false;

    if (inBufPos >= inBufLen) {
        int n = file.read(inBuf, INPUT_BUF_SIZE);
        if (n <= 0) {
            errored = true;
            return false;
        }
        inBufLen = (size_t)n;
        inBufPos = 0;
    }

    size_t freeSpace = WINDOW_SIZE - count;
    if (freeSpace == 0) return true;
    size_t contiguous = WINDOW_SIZE - writePos;
    if (contiguous > freeSpace) contiguous = freeSpace;

    size_t inSize = inBufLen - inBufPos;
    size_t outSize = contiguous;
    uint32_t flags = 0;
    if (file.available() > 0) flags |= TINFL_FLAG_HAS_MORE_INPUT;

    tinfl_status status = tinfl_decompress(
        decomp,
        inBuf + inBufPos, &inSize,
        window, window + writePos, &outSize,
        flags
    );

    inBufPos += inSize;
    writePos = (writePos + outSize) % WINDOW_SIZE;
    count += outSize;

    yield();

    if (status == TINFL_STATUS_DONE) {
        streamEnded = true;
    } else if (status < 0) {
        errored = true;
        return false;
    }
    return true;
}

int GzipFileReader::readByte() {
    while (count == 0) {
        if (streamEnded || errored) return -1;
        if (!pumpOnce()) return -1;
    }
    uint8_t b = window[readPos];
    readPos = (readPos + 1) % WINDOW_SIZE;
    count--;
    return b;
}

bool GzipFileReader::available() {
    if (!isOpen || errored) return false;
    if (count > 0) return true;
    if (streamEnded) return false;
    while (count == 0 && !streamEnded && !errored) {
        if (!pumpOnce()) break;
    }
    return count > 0;
}

String GzipFileReader::readStringUntil(char terminator) {
    String result;
    result.reserve(64);
    int b;
    while ((b = readByte()) >= 0) {
        if ((char)b == terminator) break;
        result += (char)b;
    }
    return result;
}
