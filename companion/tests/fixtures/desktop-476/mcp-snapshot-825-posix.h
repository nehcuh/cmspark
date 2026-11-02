// CPU-only Win32 filesystem leaves for the exact native worker on non-Windows.
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
using DWORD=uint32_t;using HRESULT=int32_t;using HANDLE=int;using HINTERNET=void*;using ULONGLONG=uint64_t;using BOOL=int;
constexpr HANDLE INVALID_HANDLE_VALUE=-1;
constexpr DWORD GENERIC_READ=1,GENERIC_WRITE=2,FILE_SHARE_READ=1,FILE_SHARE_WRITE=2,FILE_SHARE_DELETE=4,OPEN_EXISTING=3,FILE_FLAG_OPEN_REPARSE_POINT=0x200000,FILE_ATTRIBUTE_DIRECTORY=16,FILE_ATTRIBUTE_REPARSE_POINT=1024,FILE_BEGIN=0,NO_ERROR=0;
struct LARGE_INTEGER {int64_t QuadPart=0;};
struct BY_HANDLE_FILE_INFORMATION {DWORD dwFileAttributes=0,dwVolumeSerialNumber=0,nFileSizeHigh=0,nFileSizeLow=0,nNumberOfLinks=0,nFileIndexHigh=0,nFileIndexLow=0;};
std::wstring module825;
DWORD GetModuleFileNameW(void*,wchar_t* out,DWORD capacity){if(module825.size()>=capacity)return capacity;std::copy(module825.begin(),module825.end(),out);return (DWORD)module825.size();}
HANDLE CreateFileW(wchar_t const* path,DWORD,DWORD,void*,DWORD,DWORD,void*){std::wstring value(path);return open(std::string(value.begin(),value.end()).c_str(),O_RDWR|O_NOFOLLOW);}
BOOL GetFileInformationByHandle(HANDLE file,BY_HANDLE_FILE_INFORMATION* out){struct stat s{};if(fstat(file,&s))return 0;out->dwFileAttributes=S_ISDIR(s.st_mode)?FILE_ATTRIBUTE_DIRECTORY:0;out->dwVolumeSerialNumber=(DWORD)s.st_dev;out->nFileSizeHigh=(DWORD)((uint64_t)s.st_size>>32);out->nFileSizeLow=(DWORD)s.st_size;out->nNumberOfLinks=(DWORD)s.st_nlink;out->nFileIndexHigh=(DWORD)((uint64_t)s.st_ino>>32);out->nFileIndexLow=(DWORD)s.st_ino;return 1;}
BOOL ReadFile(HANDLE file,void* bytes,DWORD size,DWORD* got,void*){auto n=read(file,bytes,size);*got=n<0?0:(DWORD)n;return n>=0;}
BOOL WriteFile(HANDLE file,void const* bytes,DWORD size,DWORD* wrote,void*){auto n=write(file,bytes,size);*wrote=n<0?0:(DWORD)n;return n>=0;}
BOOL SetFilePointerEx(HANDLE file,LARGE_INTEGER offset,void*,DWORD){return lseek(file,offset.QuadPart,SEEK_SET)>=0;}
BOOL FlushFileBuffers(HANDLE file){return fsync(file)==0;}
BOOL CloseHandle(HANDLE file){return close(file)==0;}
