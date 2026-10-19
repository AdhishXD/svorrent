#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <winsock2.h>
#include <ws2tcpip.h>
#include <stdio.h>
#include <stdbool.h>

#ifdef _MSC_VER
#pragma comment(lib, "ws2_32.lib")
#pragma comment(lib, "shell32.lib")
#endif

static bool is_server_listening(void) {
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return false;

    SOCKET sock = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (sock == INVALID_SOCKET) {
        WSACleanup();
        return false;
    }

    u_long mode = 1;
    ioctlsocket(sock, FIONBIO, &mode);

    struct sockaddr_in addr;
    ZeroMemory(&addr, sizeof(addr));
    addr.sin_family = AF_INET;
    addr.sin_port = htons(3001);
    addr.sin_addr.s_addr = inet_addr("127.0.0.1");

    int result = connect(sock, (struct sockaddr*)&addr, sizeof(addr));
    bool connected = result == 0;
    int error = connected ? 0 : WSAGetLastError();
    if (!connected && (error == WSAEWOULDBLOCK || error == WSAEINPROGRESS || error == WSAEALREADY)) {
        fd_set writeSet;
        FD_ZERO(&writeSet);
        FD_SET(sock, &writeSet);

        struct timeval tv;
        tv.tv_sec = 0;
        tv.tv_usec = 300000;

        if (select(0, NULL, &writeSet, NULL, &tv) > 0) {
            int socketError = 0;
            int size = sizeof(socketError);
            connected = getsockopt(sock, SOL_SOCKET, SO_ERROR, (char*)&socketError, &size) == 0 && socketError == 0;
        }
    }

    closesocket(sock);
    WSACleanup();
    return connected;
}

static bool file_exists(const wchar_t* path) {
    DWORD attrs = GetFileAttributesW(path);
    return (attrs != INVALID_FILE_ATTRIBUTES && !(attrs & FILE_ATTRIBUTE_DIRECTORY));
}

static bool find_node(const wchar_t* appDir, wchar_t* outNode, size_t maxLen) {
    wchar_t candidate[MAX_PATH];

    // 1. Check in appDir\node.exe
    swprintf(candidate, MAX_PATH, L"%s\\node.exe", appDir);
    if (file_exists(candidate)) {
        wcsncpy(outNode, candidate, maxLen);
        return true;
    }

    // 2. Check in appDir\node\node.exe
    swprintf(candidate, MAX_PATH, L"%s\\node\\node.exe", appDir);
    if (file_exists(candidate)) {
        wcsncpy(outNode, candidate, maxLen);
        return true;
    }

    // 3. Search PATH
    if (SearchPathW(NULL, L"node.exe", NULL, MAX_PATH, candidate, NULL) > 0) {
        wcsncpy(outNode, candidate, maxLen);
        return true;
    }

    // 4. Common standard install locations
    const wchar_t* common[] = {
        L"C:\\Program Files\\nodejs\\node.exe",
        L"C:\\Program Files (x86)\\nodejs\\node.exe"
    };
    for (int i = 0; i < 2; i++) {
        if (file_exists(common[i])) {
            wcsncpy(outNode, common[i], maxLen);
            return true;
        }
    }

    // 5. LocalAppData / AppData
    wchar_t envBuf[MAX_PATH];
    if (GetEnvironmentVariableW(L"LOCALAPPDATA", envBuf, MAX_PATH) > 0) {
        swprintf(candidate, MAX_PATH, L"%s\\Programs\\nodejs\\node.exe", envBuf);
        if (file_exists(candidate)) {
            wcsncpy(outNode, candidate, maxLen);
            return true;
        }
    }
    if (GetEnvironmentVariableW(L"APPDATA", envBuf, MAX_PATH) > 0) {
        swprintf(candidate, MAX_PATH, L"%s\\nvm\\current\\node.exe", envBuf);
        if (file_exists(candidate)) {
            wcsncpy(outNode, candidate, maxLen);
            return true;
        }
    }

    return false;
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow) {
    (void)hInstance;
    (void)hPrevInstance;
    (void)lpCmdLine;
    (void)nCmdShow;
    if (is_server_listening()) {
        ShellExecuteW(NULL, L"open", L"http://localhost:3001", NULL, NULL, SW_SHOWNORMAL);
        return 0;
    }

    wchar_t exePath[MAX_PATH];
    GetModuleFileNameW(NULL, exePath, MAX_PATH);
    wchar_t* lastSlash = wcsrchr(exePath, L'\\');
    if (lastSlash) *lastSlash = L'\0';

    wchar_t nodePath[MAX_PATH];
    if (!find_node(exePath, nodePath, MAX_PATH)) {
        int res = MessageBoxW(
            NULL,
            L"Svorrent requires Node.js (v18+) to run.\n\nWould you like to open nodejs.org to download Node.js now?",
            L"Svorrent — Node.js Required",
            MB_ICONINFORMATION | MB_YESNO | MB_DEFBUTTON1
        );
        if (res == IDYES) {
            ShellExecuteW(NULL, L"open", L"https://nodejs.org", NULL, NULL, SW_SHOWNORMAL);
        }
        return 1;
    }

    wchar_t backendDir[MAX_PATH];
    swprintf(backendDir, MAX_PATH, L"%s\\backend", exePath);

    wchar_t serverJs[MAX_PATH];
    swprintf(serverJs, MAX_PATH, L"%s\\server.js", backendDir);
    if (!file_exists(serverJs)) {
        swprintf(backendDir, MAX_PATH, L"%s", exePath);
    }

    wchar_t cmdLine[1024];
    swprintf(cmdLine, 1024, L"\"%s\" --openssl-legacy-provider server.js", nodePath);

    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;
    ZeroMemory(&pi, sizeof(pi));

    BOOL success = CreateProcessW(
        nodePath,
        cmdLine,
        NULL,
        NULL,
        FALSE,
        CREATE_NO_WINDOW | DETACHED_PROCESS,
        NULL,
        backendDir,
        &si,
        &pi
    );

    if (!success) {
        MessageBoxW(NULL, L"Failed to launch Svorrent background server.", L"Svorrent Error", MB_ICONERROR | MB_OK);
        return 1;
    }

    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);

    bool ready = false;
    for (int i = 0; i < 20; i++) {
        Sleep(300);
        if (is_server_listening()) {
            ready = true;
            break;
        }
    }

    if (!ready) {
        MessageBoxW(NULL, L"Svorrent could not start its local server. Check that port 3001 is free and Node.js is installed, then try again.", L"Svorrent Startup Error", MB_ICONERROR | MB_OK);
        return 1;
    }

    ShellExecuteW(NULL, L"open", L"http://localhost:3001", NULL, NULL, SW_SHOWNORMAL);
    return 0;
}
