// Unshipped owned Session fixture. One read handle; no FILE_SHARE_DELETE.
#define _WIN32_WINNT 0x0600
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <wchar.h>

int wmain(int argc, wchar_t **argv) {
    if (argc != 3) return 1;
    HANDLE held = CreateFileW(argv[1], GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL, NULL);
    if (held == INVALID_HANDLE_VALUE) return 2;
    int result = 0;
    HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
    DWORD written = 0;
    static const char ready[] = "LOCKED\r\n";
    if (output == NULL || output == INVALID_HANDLE_VALUE ||
        GetFileType(output) != FILE_TYPE_PIPE ||
        !WriteFile(output, ready, (DWORD)(sizeof(ready) - 1), &written, NULL) ||
        written != (DWORD)(sizeof(ready) - 1)) {
        result = 3;
    } else {
        // Same holder-only 10000 ms ceiling as the former Stopwatch loop.
        // Parent retains its original 5000 ms readiness/close and 15000 ms case.
        ULONGLONG start = GetTickCount64();
        for (;;) {
            DWORD attributes = GetFileAttributesW(argv[2]);
            if (attributes != INVALID_FILE_ATTRIBUTES) {
                if (attributes & FILE_ATTRIBUTE_DIRECTORY) result = 4;
                break;
            }
            DWORD error = GetLastError();
            if (error != ERROR_FILE_NOT_FOUND && error != ERROR_PATH_NOT_FOUND) {
                result = 4;
                break;
            }
            if (GetTickCount64() - start > 10000) {
                result = 5;
                break;
            }
            Sleep(1);
        }
    }
    if (!CloseHandle(held) && result == 0) result = 6;
    return result;
}
