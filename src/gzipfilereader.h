#ifndef GzipFileReader_h
#define GzipFileReader_h

#include <Arduino.h>
#include <LittleFS.h>

extern "C" {
#include <rom/miniz.h>
}

class GzipFileReader {
public:
    GzipFileReader();
    ~GzipFileReader();

    bool open(const char *path);
    void close();
    bool seek(size_t pos);
    bool available();
    String readStringUntil(char terminator);
    uint32_t size() const;

    operator bool() const { return isOpen && !errored; }

private:
    static constexpr size_t WINDOW_SIZE = 32768;
    static constexpr size_t INPUT_BUF_SIZE = 1024;

    File file;
    tinfl_decompressor *decomp;
    uint8_t *window;
    size_t writePos;
    size_t readPos;
    size_t count;
    uint8_t inBuf[INPUT_BUF_SIZE];
    size_t inBufPos;
    size_t inBufLen;
    size_t deflateStart;
    bool streamEnded;
    bool errored;
    bool isOpen;
    uint32_t uncompSize;

    bool parseGzipHeader();
    void resetStreamState();
    bool pumpOnce();
    int readByte();
};

#endif
