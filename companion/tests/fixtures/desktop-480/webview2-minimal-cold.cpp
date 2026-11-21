#include <windows.h>
#include <roapi.h>
#include <wrl.h>
#include <WebView2.h>
#include <cstdio>
#include <cwchar>
#include <string>

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace {
constexpr UINT begin_message = WM_APP + 1;
ULONGLONG started;
std::wstring profile;
ComPtr<ICoreWebView2Environment> environment;
ComPtr<ICoreWebView2Controller> controller;

void note(const char* phase, HRESULT result = S_OK) {
  std::printf("WEBVIEW2_PHASE %s %llu 0x%08lX\n", phase, GetTickCount64() - started,
              static_cast<unsigned long>(result));
  std::fflush(stdout);
}

LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
  if (message != begin_message) return DefWindowProcW(window, message, wparam, lparam);
  note("ENV_CALL");
  const auto result = CreateCoreWebView2EnvironmentWithOptions(nullptr, profile.c_str(), nullptr,
    Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
      [window](HRESULT status, ICoreWebView2Environment* value) -> HRESULT {
        note("ENV_CALLBACK", status);
        if (FAILED(status) || !value) {
          PostQuitMessage(5);
          return E_FAIL;
        }
        environment = value;
        note("CONTROLLER_CALL");
        const auto request = environment->CreateCoreWebView2Controller(window,
          Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
            [](HRESULT completed, ICoreWebView2Controller* host) -> HRESULT {
              note("CONTROLLER_CALLBACK", completed);
              controller = host;
              PostQuitMessage(SUCCEEDED(completed) && host ? 0 : 7);
              return S_OK;
            }).Get());
        note("CONTROLLER_RETURN", request);
        if (FAILED(request)) PostQuitMessage(6);
        return request;
      }).Get());
  note("ENV_RETURN", result);
  if (FAILED(result)) PostQuitMessage(4);
  return 0;
}
}

int wmain() {
  started = GetTickCount64();
  note("MAIN");
  wchar_t scratch[MAX_PATH];
  const DWORD length = GetTempPathW(MAX_PATH, scratch);
  if (!length || length >= MAX_PATH) return 1;
  profile = std::wstring(scratch) + L"cmspark-webview2-minimal-profile";
  if (!CreateDirectoryW(profile.c_str(), nullptr)) return 1;
  if (FAILED(RoInitialize(RO_INIT_SINGLETHREADED))) return 2;
  auto instance = GetModuleHandleW(nullptr);
  WNDCLASSW window_class{};
  window_class.lpfnWndProc = window_proc;
  window_class.hInstance = instance;
  window_class.lpszClassName = L"CMsparkWebView2ColdDiagnostic";
  if (!RegisterClassW(&window_class)) return 3;
  const auto window = CreateWindowExW(0, window_class.lpszClassName, L"CMspark diagnostic",
    WS_OVERLAPPEDWINDOW, 0, 0, 360, 420, nullptr, nullptr, instance, nullptr);
  if (!window || !PostMessageW(window, begin_message, 0, 0)) return 3;
  MSG message{};
  BOOL next;
  while ((next = GetMessageW(&message, nullptr, 0, 0)) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  if (controller) controller->Close();
  controller.Reset();
  environment.Reset();
  DestroyWindow(window);
  RoUninitialize();
  return next < 0 ? 8 : static_cast<int>(message.wParam);
}
