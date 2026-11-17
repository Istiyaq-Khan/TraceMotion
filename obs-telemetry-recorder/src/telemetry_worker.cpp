#include "telemetry_worker.hpp"
#include <util/platform.h>

#include <cmath>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <iostream>
#include <algorithm>
#include <filesystem>
#include <vector>
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
    cursorMap_[LoadCursor(nullptr, IDC_SIZENWSE)]    = CursorVisualType::ResizeNWSE;
    cursorMap_[LoadCursor(nullptr, IDC_SIZENESW)]    = CursorVisualType::ResizeNESW;
    cursorMap_[LoadCursor(nullptr, IDC_SIZEALL)]     = CursorVisualType::OpenHand;
    cursorMap_[LoadCursor(nullptr, IDC_WAIT)]        = CursorVisualType::Wait;
    cursorMap_[LoadCursor(nullptr, IDC_APPSTARTING)] = CursorVisualType::Wait;
    cursorMap_[LoadCursor(nullptr, IDC_HELP)]        = CursorVisualType::Help;
}

CursorVisualType TelemetryWorker::ClassifyDynamicCursor(HCURSOR hCursor) const {
    if (!hCursor) return CursorVisualType::Arrow;

    ICONINFO ii{};
    if (!GetIconInfo(hCursor, &ii)) {
        return CursorVisualType::Arrow;
    }

    // RAII guard ensuring GDI objects are deleted on all return paths
    struct IconGuard {
        HBITMAP mask{nullptr};
        HBITMAP color{nullptr};
        ~IconGuard() {
            if (mask) DeleteObject(mask);
            if (color) DeleteObject(color);
        }
    } guard{ii.hbmMask, ii.hbmColor};

    if (!ii.hbmMask) {
        return CursorVisualType::Arrow;
    }

    BITMAP bmMask{};
    if (!GetObject(ii.hbmMask, sizeof(BITMAP), &bmMask) || bmMask.bmWidth <= 0 || bmMask.bmHeight <= 0) {
        return CursorVisualType::Arrow;
    }

    const int width = bmMask.bmWidth;
    const int height = ii.hbmColor ? bmMask.bmHeight : (bmMask.bmHeight / 2);
    if (width <= 0 || height <= 0 || width > 256 || height > 256) {
        return CursorVisualType::Arrow;
    }

    // Extract mask bits
    const int maskPitch = ((width + 31) / 32) * 4;
    std::vector<uint8_t> maskBits(maskPitch * bmMask.bmHeight, 0);
    if (GetBitmapBits(ii.hbmMask, static_cast<LONG>(maskBits.size()), maskBits.data()) <= 0) {
        return CursorVisualType::Arrow;
    }

    // Extract color bits if 32bpp color icon exists
    std::vector<uint32_t> colorPixels;
    bool hasColorAlpha = false;
    if (ii.hbmColor) {
        BITMAP bmColor{};
        if (GetObject(ii.hbmColor, sizeof(BITMAP), &bmColor) && bmColor.bmBitsPixel == 32) {
            colorPixels.resize(width * height, 0);
            if (GetBitmapBits(ii.hbmColor, static_cast<LONG>(colorPixels.size() * sizeof(uint32_t)), colorPixels.data()) > 0) {
                for (uint32_t px : colorPixels) {
                    if ((px >> 24) > 16) {
                        hasColorAlpha = true;
                        break;
                    }
                }
            }
        }
    }

    auto isPixelVisible = [&](int x, int y) -> bool {
        if (x < 0 || x >= width || y < 0 || y >= height) return false;
        if (hasColorAlpha) {
            const uint32_t px = colorPixels[y * width + x];
            return ((px >> 24) > 20);
        }
        const uint8_t* row = maskBits.data() + (y * maskPitch);
        const bool andBit = (row[x / 8] & (0x80 >> (x % 8))) != 0;
        if (ii.hbmColor) {
            return !andBit;
        } else {
            const uint8_t* xorRow = maskBits.data() + ((y + height) * maskPitch);
            const bool xorBit = (xorRow[x / 8] & (0x80 >> (x % 8))) != 0;
            return (!andBit || xorBit);
        }
    };

    int minX = width, maxX = -1;
    int minY = height, maxY = -1;
    int visiblePixelCount = 0;

    for (int y = 0; y < height; ++y) {
        for (int x = 0; x < width; ++x) {
            if (isPixelVisible(x, y)) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                visiblePixelCount++;
            }
        }
    }

    if (maxX < minX || maxY < minY || visiblePixelCount < 4) {
        return CursorVisualType::Arrow;
    }

    const int bbW = maxX - minX + 1;
    const int bbH = maxY - minY + 1;
    const float aspect = static_cast<float>(bbW) / static_cast<float>(bbH);

    const float hxNorm = static_cast<float>(ii.xHotspot - minX) / static_cast<float>(bbW);
    const float hyNorm = static_cast<float>(ii.yHotspot - minY) / static_cast<float>(bbH);

    const int midY = minY + bbH / 2;
    const int midX = minX + bbW / 2;

    int topHalfCount = 0, bottomHalfCount = 0;
    int leftHalfCount = 0, rightHalfCount = 0;
    for (int y = minY; y <= maxY; ++y) {
        for (int x = minX; x <= maxX; ++x) {
            if (isPixelVisible(x, y)) {
                if (y < midY) topHalfCount++;
                else bottomHalfCount++;
                if (x < midX) leftHalfCount++;
                else rightHalfCount++;
            }
        }
    }

    const float fillRatio = static_cast<float>(visiblePixelCount) / static_cast<float>(bbW * bbH);

    // 1. Text / I-Beam: Narrow vertical shape, centered hotspot
    if (aspect <= 0.55f && hxNorm >= 0.25f && hxNorm <= 0.75f && hyNorm >= 0.25f && hyNorm <= 0.75f) {
        return CursorVisualType::Text;
    }

    // 2. Horizontal Resize (ResizeEW): Wide aspect ratio, centered hotspot
    if (aspect >= 1.35f && hxNorm >= 0.30f && hxNorm <= 0.70f && hyNorm >= 0.25f && hyNorm <= 0.75f) {
        return CursorVisualType::ResizeEW;
    }

    // 3. Vertical Resize (ResizeNS): Tall aspect ratio, centered hotspot, wider tips
    if (aspect <= 0.70f && (static_cast<float>(bbH) / static_cast<float>(bbW)) >= 1.40f &&
        hxNorm >= 0.30f && hxNorm <= 0.70f && hyNorm >= 0.30f && hyNorm <= 0.70f) {
        int centerRowPixels = 0;
        int tipRowPixels = 0;
        for (int x = minX; x <= maxX; ++x) {
            if (isPixelVisible(x, midY)) centerRowPixels++;
            if (isPixelVisible(x, minY + 1) || isPixelVisible(x, maxY - 1)) tipRowPixels++;
        }
        if (tipRowPixels > centerRowPixels * 2 || aspect > 0.45f) {
            return CursorVisualType::ResizeNS;
        }
        return CursorVisualType::Text;
    }

    // 4. Pointer / Hand: Pointing finger tip at top, palm in lower half
    if (hyNorm <= 0.22f && hxNorm >= 0.05f && hxNorm <= 0.58f &&
        bottomHalfCount > static_cast<int>(topHalfCount * 1.3f) && aspect >= 0.55f && aspect <= 1.25f) {
        return CursorVisualType::Pointer;
    }

    // 5. Crosshair: Symmetric in X and Y, centered hotspot
    if (aspect >= 0.80f && aspect <= 1.25f &&
        hxNorm >= 0.40f && hxNorm <= 0.60f && hyNorm >= 0.40f && hyNorm <= 0.60f) {
        const float lrDiff = std::abs(static_cast<float>(leftHalfCount - rightHalfCount)) / static_cast<float>(visiblePixelCount);
        const float tbDiff = std::abs(static_cast<float>(topHalfCount - bottomHalfCount)) / static_cast<float>(visiblePixelCount);
        if (lrDiff < 0.15f && tbDiff < 0.15f && fillRatio < 0.40f) {
            return CursorVisualType::Crosshair;
        }
    }

    // 6. Diagonal Resizes (NWSE / NESW)
    if (aspect >= 0.75f && aspect <= 1.35f &&
        hxNorm >= 0.35f && hxNorm <= 0.65f && hyNorm >= 0.35f && hyNorm <= 0.65f) {
        int nwPixels = 0, nePixels = 0;
        for (int y = minY; y <= maxY; ++y) {
            for (int x = minX; x <= maxX; ++x) {
                if (isPixelVisible(x, y)) {
                    if ((x < midX && y < midY) || (x > midX && y > midY)) nwPixels++;
                    if ((x > midX && y < midY) || (x < midX && y > midY)) nePixels++;
                }
            }
        }
        if (nwPixels > static_cast<int>(nePixels * 1.8f)) {
            return CursorVisualType::ResizeNWSE;
        }
        if (nePixels > static_cast<int>(nwPixels * 1.8f)) {
            return CursorVisualType::ResizeNESW;
        }
    }

    // 7. OpenHand / ClosedHand
    if (aspect >= 0.70f && aspect <= 1.25f &&
        hxNorm >= 0.30f && hxNorm <= 0.70f && hyNorm >= 0.20f && hyNorm <= 0.65f) {
        if (fillRatio > 0.48f) {
            return CursorVisualType::ClosedHand;
        }
        if (fillRatio > 0.25f) {
            return CursorVisualType::OpenHand;
        }
    }

    // 8. NotAllowed
    if (aspect >= 0.85f && aspect <= 1.15f &&
        hxNorm >= 0.40f && hxNorm <= 0.60f && hyNorm >= 0.40f && hyNorm <= 0.60f) {
        return CursorVisualType::NotAllowed;
    }

    // 9. Standard Arrow
    if (hxNorm <= 0.20f && hyNorm <= 0.20f) {
        return CursorVisualType::Arrow;
    }

    return CursorVisualType::Arrow;
}

CursorVisualType TelemetryWorker::QueryCurrentCursorType() const {
    CURSORINFO ci{};
    ci.cbSize = sizeof(ci);
    if (GetCursorInfo(&ci) && (ci.flags & CURSOR_SHOWING) && ci.hCursor != nullptr) {
        // Fast path 1: Standard system IDC cursor handles
        auto it = cursorMap_.find(ci.hCursor);
        if (it != cursorMap_.end()) {
            lastKnownCursorType_ = it->second;
            return it->second;
        }

        // Fast path 2: Dynamic handle cache (< 2ns)
        auto dIt = dynamicCursorCache_.find(ci.hCursor);
        if (dIt != dynamicCursorCache_.end()) {
            lastKnownCursorType_ = dIt->second;
            return dIt->second;
        }

        // Path 3: Inspect icon info and mask geometry
        const CursorVisualType detected = ClassifyDynamicCursor(ci.hCursor);
        if (dynamicCursorCache_.size() > 512) {
            dynamicCursorCache_.clear();
        }
        dynamicCursorCache_[ci.hCursor] = detected;
        lastKnownCursorType_ = detected;
        return detected;
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

    dynamicCursorCache_.clear();

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
            return;
    }

    SamplePositionAndState(interaction);
}

void TelemetryWorker::SamplePositionAndState(InteractionType interaction) {
    POINT pt{};
    if (!GetPhysicalCursorPos(&pt)) {
        GetCursorPos(&pt);
    }

    const float denomW = (canvas_.sourceWidth > 0) ? static_cast<float>(canvas_.sourceWidth) : 1920.0f;
    const float denomH = (canvas_.sourceHeight > 0) ? static_cast<float>(canvas_.sourceHeight) : 1080.0f;

    float cx = (static_cast<float>(pt.x) - static_cast<float>(canvas_.sourceX)) / denomW;
    float cy = (static_cast<float>(pt.y) - static_cast<float>(canvas_.sourceY)) / denomH;

    cx = std::clamp(cx, 0.0f, 1.0f);
    cy = std::clamp(cy, 0.0f, 1.0f);

    const uint64_t nowNs = os_gettime_ns();
    uint64_t elapsedNs = 0;
    if (nowNs > (startPtsNs_ + accumulatedPausedNs_)) {
        elapsedNs = nowNs - startPtsNs_ - accumulatedPausedNs_;
    }
    const uint32_t timeMs = static_cast<uint32_t>(elapsedNs / 1'000'000ULL);

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

    typedef DPI_AWARENESS_CONTEXT (WINAPI *PFN_SetThreadDpiAwarenessContext)(DPI_AWARENESS_CONTEXT);
    auto pfnSetThreadDpi = reinterpret_cast<PFN_SetThreadDpiAwarenessContext>(
        GetProcAddress(GetModuleHandleW(L"user32.dll"), "SetThreadDpiAwarenessContext"));
    if (pfnSetThreadDpi) {
        pfnSetThreadDpi(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }

    timeBeginPeriod(1);

    HMODULE hModule = nullptr;
    GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                       reinterpret_cast<LPCWSTR>(&LowLevelMouseProc), &hModule);

    if (hModule) {
        mouseHook_ = SetWindowsHookEx(WH_MOUSE_LL, LowLevelMouseProc, hModule, 0);
    }

    constexpr uint32_t sampleIntervalMs = 1000 / DEFAULT_SAMPLE_RATE_HZ;
    auto nextTick = std::chrono::steady_clock::now() + std::chrono::milliseconds(sampleIntervalMs);

    bool wasLDown = (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;
    bool wasRDown = (GetAsyncKeyState(VK_RBUTTON) & 0x8000) != 0;
    bool wasMDown = (GetAsyncKeyState(VK_MBUTTON) & 0x8000) != 0;

    MSG msg{};
    while (isRunning_.load(std::memory_order_acquire)) {
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

        const auto now = std::chrono::steady_clock::now();
        if (now < nextTick) {
            std::this_thread::sleep_until(nextTick);
        }
        nextTick += std::chrono::milliseconds(sampleIntervalMs);

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
