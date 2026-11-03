#include "telemetry_worker.hpp"
#include <util/platform.h>

#include <cmath>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <iostream>
#include <algorithm>
#include <filesystem>
#include <timeapi.h>

#pragma comment(lib, "winmm.lib")

namespace tracemotion {

namespace {

LRESULT CALLBACK LowLevelMouseProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode == HC_ACTION) {
        const auto* hookStruct = reinterpret_cast<const MSLLHOOKSTRUCT*>(lParam);
        if (hookStruct) {
            GetGlobalTelemetryWorker().OnLowLevelMouseHook(wParam, *hookStruct);
        }
    }
    return CallNextHookEx(nullptr, nCode, wParam, lParam);
}

} // namespace

TelemetryWorker& GetGlobalTelemetryWorker() {
    static TelemetryWorker instance;
    return instance;
}

TelemetryWorker::TelemetryWorker() {
    InitializeCursorMap();
    samples_.reserve(INITIAL_RESERVE_SAMPLES);
}

TelemetryWorker::~TelemetryWorker() {
    if (IsRunning()) {
        Stop(0);
    }
}

void TelemetryWorker::InitializeCursorMap() {
    cursorMap_.clear();
    cursorMap_[LoadCursor(nullptr, IDC_ARROW)]       = CursorVisualType::Arrow;
    cursorMap_[LoadCursor(nullptr, IDC_IBEAM)]       = CursorVisualType::Text;
    cursorMap_[LoadCursor(nullptr, IDC_HAND)]        = CursorVisualType::Pointer;
    cursorMap_[LoadCursor(nullptr, IDC_CROSS)]       = CursorVisualType::Crosshair;
    cursorMap_[LoadCursor(nullptr, IDC_NO)]          = CursorVisualType::NotAllowed;
    cursorMap_[LoadCursor(nullptr, IDC_SIZEWE)]      = CursorVisualType::ResizeEW;
    cursorMap_[LoadCursor(nullptr, IDC_SIZENS)]      = CursorVisualType::ResizeNS;
    cursorMap_[LoadCursor(nullptr, IDC_SIZEALL)]     = CursorVisualType::OpenHand;
    cursorMap_[LoadCursor(nullptr, IDC_WAIT)]        = CursorVisualType::Arrow;
    cursorMap_[LoadCursor(nullptr, IDC_APPSTARTING)] = CursorVisualType::Arrow;
}

CursorVisualType TelemetryWorker::QueryCurrentCursorType() const {
    CURSORINFO ci{};
    ci.cbSize = sizeof(ci);
    if (GetCursorInfo(&ci) && (ci.flags & CURSOR_SHOWING)) {
        auto it = cursorMap_.find(ci.hCursor);
        if (it != cursorMap_.end()) {
            lastKnownCursorType_ = it->second;
            return it->second;
        }
    }
    return lastKnownCursorType_;
}

bool TelemetryWorker::Start(const std::string& outputPath, const DisplayCanvasGeometry& canvas, uint64_t startPtsNs) {
    if (isRunning_.load(std::memory_order_acquire)) {
        return false;
    }

    videoOutputPath_ = outputPath;
    canvas_ = canvas;
    startPtsNs_ = startPtsNs;
    lastPausePtsNs_ = 0;
    accumulatedPausedNs_ = 0;

    lastLeftClickTimeMs_ = 0;
    lastLeftClickCx_ = 0.0f;
    lastLeftClickCy_ = 0.0f;

    {
        std::lock_guard<std::mutex> lock(bufferMutex_);
        samples_.clear();
    }

    isRunning_.store(true, std::memory_order_release);
    isPaused_.store(false, std::memory_order_release);

    workerThread_ = std::thread(&TelemetryWorker::WorkerLoop, this);
    return true;
}

void TelemetryWorker::Pause(uint64_t pausePtsNs) {
    if (!isRunning_.load(std::memory_order_acquire) || isPaused_.load(std::memory_order_acquire)) {
        return;
    }

    lastPausePtsNs_ = pausePtsNs;
    isPaused_.store(true, std::memory_order_release);
}

void TelemetryWorker::Resume(uint64_t resumePtsNs) {
    if (!isRunning_.load(std::memory_order_acquire) || !isPaused_.load(std::memory_order_acquire)) {
        return;
    }

    if (lastPausePtsNs_ > 0 && resumePtsNs >= lastPausePtsNs_) {
        accumulatedPausedNs_ += (resumePtsNs - lastPausePtsNs_);
    }
    lastPausePtsNs_ = 0;
    isPaused_.store(false, std::memory_order_release);
}

bool TelemetryWorker::Stop(uint64_t /*stopPtsNs*/, const std::string& overrideOutputPath) {
    if (!isRunning_.load(std::memory_order_acquire)) {
        return false;
    }

    if (!overrideOutputPath.empty()) {
        videoOutputPath_ = overrideOutputPath;
    }

    isRunning_.store(false, std::memory_order_release);

    // Unblock the message loop on the worker thread
    const DWORD targetThreadId = workerThreadId_.load(std::memory_order_acquire);
    if (targetThreadId != 0) {
        PostThreadMessage(targetThreadId, WM_QUIT, 0, 0);
    }

    if (workerThread_.joinable()) {
        workerThread_.join();
    }

    FlushJsonToFile();
    return true;
}

void TelemetryWorker::OnLowLevelMouseHook(WPARAM wParam, const MSLLHOOKSTRUCT& /*info*/) {
    if (!isRunning_.load(std::memory_order_acquire) || isPaused_.load(std::memory_order_acquire)) {
        return;
    }

    InteractionType interaction = InteractionType::Move;
    switch (wParam) {
        case WM_LBUTTONDOWN:
            interaction = InteractionType::Click;
            break;
        case WM_RBUTTONDOWN:
            interaction = InteractionType::RightClick;
            break;
        case WM_MBUTTONDOWN:
            interaction = InteractionType::MiddleClick;
            break;
        case WM_LBUTTONUP:
        case WM_RBUTTONUP:
        case WM_MBUTTONUP:
            interaction = InteractionType::MouseUp;
            break;
        default:
            return; // Ignore raw move hooks here; periodic poller handles smooth trajectory
    }

    SamplePositionAndState(interaction);
}

void TelemetryWorker::SamplePositionAndState(InteractionType interaction) {
    POINT pt{};
    if (!GetPhysicalCursorPos(&pt)) {
        GetCursorPos(&pt);
    }

    // Normalized relative coordinates [0.0, 1.0]
    const float denomW = (canvas_.sourceWidth > 0) ? static_cast<float>(canvas_.sourceWidth) : 1920.0f;
    const float denomH = (canvas_.sourceHeight > 0) ? static_cast<float>(canvas_.sourceHeight) : 1080.0f;

    float cx = (static_cast<float>(pt.x) - static_cast<float>(canvas_.sourceX)) / denomW;
    float cy = (static_cast<float>(pt.y) - static_cast<float>(canvas_.sourceY)) / denomH;

    cx = std::clamp(cx, 0.0f, 1.0f);
    cy = std::clamp(cy, 0.0f, 1.0f);

    // Compute monotonic presentation timestamp relative to recording start in milliseconds
    const uint64_t nowNs = os_gettime_ns();
    uint64_t elapsedNs = 0;
    if (nowNs > (startPtsNs_ + accumulatedPausedNs_)) {
        elapsedNs = nowNs - startPtsNs_ - accumulatedPausedNs_;
    }
    const uint32_t timeMs = static_cast<uint32_t>(elapsedNs / 1'000'000ULL);

    // Handle double-click classification
    if (interaction == InteractionType::Click) {
        const float dist = std::hypot(cx - lastLeftClickCx_, cy - lastLeftClickCy_);
        if (lastLeftClickTimeMs_ > 0 &&
            (timeMs - lastLeftClickTimeMs_) <= DOUBLE_CLICK_TIME_THRESHOLD_MS &&
            dist <= DOUBLE_CLICK_DISTANCE_THRESHOLD) {
            interaction = InteractionType::DoubleClick;
        }
        lastLeftClickTimeMs_ = timeMs;
        lastLeftClickCx_ = cx;
        lastLeftClickCy_ = cy;
    }

    const CursorVisualType cursorType = QueryCurrentCursorType();

    CursorSample sample{};
    sample.timeMs = timeMs;
    sample.cx = cx;
    sample.cy = cy;
    sample.interaction = interaction;
    sample.cursorType = cursorType;

    {
        std::lock_guard<std::mutex> lock(bufferMutex_);
        if (!samples_.empty()) {
            const auto& prev = samples_.back();
            // Suppress duplicate redundant samples occurring in the exact same millisecond
            if (prev.timeMs == timeMs && prev.interaction == interaction &&
                std::abs(prev.cx - cx) < 0.0001f && std::abs(prev.cy - cy) < 0.0001f) {
                return;
            }
        }
        samples_.push_back(sample);
    }
}

void TelemetryWorker::WorkerLoop() {
    workerThreadId_.store(GetCurrentThreadId(), std::memory_order_release);

    // Ensure thread is Per-Monitor V2 DPI aware so cursor coordinates are unscaled physical screen pixels
    typedef DPI_AWARENESS_CONTEXT (WINAPI *PFN_SetThreadDpiAwarenessContext)(DPI_AWARENESS_CONTEXT);
    auto pfnSetThreadDpi = reinterpret_cast<PFN_SetThreadDpiAwarenessContext>(
        GetProcAddress(GetModuleHandleW(L"user32.dll"), "SetThreadDpiAwarenessContext"));
    if (pfnSetThreadDpi) {
        pfnSetThreadDpi(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }

    // Request 1ms OS timer resolution for smooth frame-pacing
    timeBeginPeriod(1);

    // Retrieve the DLL's own HMODULE for safe 64-bit hook installation
    HMODULE hModule = nullptr;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                       reinterpret_cast<LPCWSTR>(&LowLevelMouseProc), &hModule);

    if (hModule) {
        mouseHook_ = SetWindowsHookEx(WH_MOUSE_LL, LowLevelMouseProc, hModule, 0);
    }

    constexpr uint32_t sampleIntervalMs = 1000 / DEFAULT_SAMPLE_RATE_HZ; // ~16ms for 60Hz
    auto nextTick = std::chrono::steady_clock::now() + std::chrono::milliseconds(sampleIntervalMs);

    // Track physical mouse button states for zero-drop capture
    bool wasLDown = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;
    bool wasRDown = (GetAsyncKeyState(VK_RBUTTON) & 0x8000) != 0;
    bool wasMDown = (GetAsyncKeyState(VK_MBUTTON) & 0x8000) != 0;

    MSG msg{};
    while (isRunning_.load(std::memory_order_acquire)) {
        // Drain Win32 message queue (services WH_MOUSE_LL hook)
        while (PeekMessage(&msg, nullptr, 0, 0, PM_REMOVE)) {
            if (msg.message == WM_QUIT) {
                break;
            }
            TranslateMessage(&msg);
            DispatchMessage(&msg);
        }

        if (!isRunning_.load(std::memory_order_acquire)) {
            break;
        }

        if (!isPaused_.load(std::memory_order_acquire)) {
            // Check button state transitions (guarantees zero missed clicks)
            const bool isLDown = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;
            const bool isRDown = (GetAsyncKeyState(VK_RBUTTON) & 0x8000) != 0;
            const bool isMDown = (GetAsyncKeyState(VK_MBUTTON) & 0x8000) != 0;

            InteractionType interaction = InteractionType::Move;
            if (isLDown && !wasLDown) {
                interaction = InteractionType::Click;
            } else if (!isLDown && wasLDown) {
                interaction = InteractionType::MouseUp;
            } else if (isRDown && !wasRDown) {
                interaction = InteractionType::RightClick;
            } else if (!isRDown && wasRDown) {
                interaction = InteractionType::MouseUp;
            } else if (isMDown && !wasMDown) {
                interaction = InteractionType::MiddleClick;
            } else if (!isMDown && wasMDown) {
                interaction = InteractionType::MouseUp;
            }

            wasLDown = isLDown;
            wasRDown = isRDown;
            wasMDown = isMDown;

            SamplePositionAndState(interaction);
        }

        // Drift-compensated sleep
        const auto now = std::chrono::steady_clock::now();
        if (now < nextTick) {
            std::this_thread::sleep_until(nextTick);
        }
        nextTick += std::chrono::milliseconds(sampleIntervalMs);

        // If system lag pushed us significantly behind, resync baseline
        if (std::chrono::steady_clock::now() > nextTick + std::chrono::milliseconds(sampleIntervalMs)) {
            nextTick = std::chrono::steady_clock::now() + std::chrono::milliseconds(sampleIntervalMs);
        }
    }

    if (mouseHook_) {
        UnhookWindowsHookEx(mouseHook_);
        mouseHook_ = nullptr;
    }

    timeEndPeriod(1);
    workerThreadId_.store(0, std::memory_order_release);
}

void TelemetryWorker::FlushJsonToFile() {
    std::lock_guard<std::mutex> lock(bufferMutex_);
    if (samples_.empty()) {
        return;
    }

    std::string targetPath = videoOutputPath_;
    if (targetPath.empty()) {
        try {
            const char* userProfile = std::getenv("USERPROFILE");
            if (userProfile) {
                std::filesystem::path videosDir = std::filesystem::path(userProfile) / "Videos";
                if (std::filesystem::exists(videosDir)) {
                    std::filesystem::path newestFile;
                    std::filesystem::file_time_type newestTime{};
                    for (const auto& entry : std::filesystem::directory_iterator(videosDir)) {
                        if (entry.is_regular_file()) {
                            auto ext = entry.path().extension().string();
                            for (auto& c : ext) c = static_cast<char>(tolower(c));
                            if (ext == ".mkv" || ext == ".mp4" || ext == ".mov" || ext == ".flv" || ext == ".ts") {
                                auto lastTime = entry.last_write_time();
                                if (newestFile.empty() || lastTime > newestTime) {
                                    newestTime = lastTime;
                                    newestFile = entry.path();
                                }
                            }
                        }
                    }
                    if (!newestFile.empty()) {
                        targetPath = newestFile.string();
                    } else {
                        targetPath = (videosDir / "recording.mkv").string();
                    }
                }
            }
        } catch (...) {
            // ignore filesystem inspection exceptions
        }
    }

    if (targetPath.empty()) {
        targetPath = "recording.mkv";
    }

    const std::string jsonPath = targetPath + ".cursor.json";
    std::ofstream out(jsonPath, std::ios::out | std::ios::trunc);
    if (!out.is_open()) {
        return;
    }

    // Produce compact, high-speed JSON matching Recordly version 2 schema with geometry calibration
    out << "{\n  \"version\": " << TELEMETRY_SCHEMA_VERSION << ",\n"
        << "  \"canvas\": {\"sourceWidth\":" << canvas_.sourceWidth
        << ",\"sourceHeight\":" << canvas_.sourceHeight
        << ",\"sourceX\":" << canvas_.sourceX
        << ",\"sourceY\":" << canvas_.sourceY
        << ",\"outputWidth\":" << canvas_.outputWidth
        << ",\"outputHeight\":" << canvas_.outputHeight << "},\n"
        << "  \"samples\": [\n";

    for (size_t i = 0; i < samples_.size(); ++i) {
        const auto& s = samples_[i];
        out << "    {"
            << "\"timeMs\":" << s.timeMs << ","
            << "\"cx\":" << std::fixed << std::setprecision(4) << s.cx << ","
            << "\"cy\":" << std::fixed << std::setprecision(4) << s.cy << ","
            << "\"interactionType\":\"" << ToString(s.interaction) << "\","
            << "\"cursorType\":\"" << ToString(s.cursorType) << "\""
            << "}";

        if (i + 1 < samples_.size()) {
            out << ",";
        }
        out << "\n";
    }

    out << "  ]\n}\n";
    out.close();
}

} // namespace tracemotion
