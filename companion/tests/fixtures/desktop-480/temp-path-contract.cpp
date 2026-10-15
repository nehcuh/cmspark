/* Exact current Windows production profile fragment, with API-return stubs only.
 * Running this fixture on Mac is NOT execution of Kernel32 or WebView2. */
#include <string>
#include <stdexcept>
#include <iostream>
#include <cwchar>
using DWORD = unsigned long;
constexpr int MAX_PATH = 260;
static DWORD requested;
static int allocations;
static DWORD GetTempPathW(DWORD capacity, wchar_t *out) {
  if (capacity != MAX_PATH) throw std::runtime_error("CHANGED_CAPACITY");
  out[0] = 0;
  if (requested > 0 && requested < MAX_PATH) {
    for (DWORD i = 0; i < requested; i++) out[i] = L'x';
    out[requested] = 0;
  }
  return requested;
}
static std::wstring random_id() { return L"inert"; }
static bool CreateDirectoryW(const wchar_t *, void *) { allocations++; return true; }
struct Probe {
  std::wstring profile;
  void run() {
#include "desktop-temp-path-fragment.inc"
  }
};
int main() {
  int failures = 0;
  for (DWORD value : {0UL, 1UL, 259UL, 260UL, 261UL}) {
    requested = value; allocations = 0; bool threw = false;
    try { Probe{}.run(); } catch (...) { threw = true; }
    bool accepts = value > 0 && value < MAX_PATH;
    bool pass = accepts ? !threw && allocations == 1 : threw && allocations == 0;
    std::cout << "{\"api_return\":" << value << ",\"allocations\":" << allocations
              << ",\"threw\":" << (threw ? "true" : "false") << ",\"pass\":" << (pass ? "true" : "false")
              << ",\"Windows_native\":false}\n";
    failures += !pass;
  }
  return failures ? 1 : 0;
}
