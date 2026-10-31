#pragma once

#include "telemetry_common.hpp"

#include <windows.h>
#include <atomic>
#include <chrono>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>
#include <unordered_map>

namespace tracemotion {

class TelemetryWorker {
public:
    TelemetryWorker();
    ~TelemetryWorker();

    TelemetryWorker(const TelemetryWorker&) = delete;
    TelemetryWorker& operator=(const TelemetryWorker&) = delete;

    /**
     * Start the telemetry capture session.
     * @param outputPath Full path of the video output file being recorded by OBS.
     * @param canvas Output video geometry and source crop offset.
     * @param startPtsNs OBS recording start timestamp from os_gettime_ns().
     */
    bool Start(const std::string& outputPath, const DisplayCanvasGeometry& canvas, uint64_t startPtsNs);

    /**
     * Pause telemetry capture, matching OBS recording pause.
     */
    void Pause(uint64_t pausePtsNs);

    /**
     * Resume telemetry capture, matching OBS recording unpause.
     */
    void Resume(uint64_t resumePtsNs);

    /**
     * Stop telemetry capture, shut down worker thread, unhook mouse, and write JSON.
     * @param stopPtsNs Timestamp when recording stopped.
     * @param overrideOutputPath Optional final recording file path (e.g. from obs_frontend_get_last_recording).
     */
    bool Stop(uint64_t stopPtsNs, const std::string& overrideOutputPath = "");

    /**
     * Whether a capture session is currently running.
     */
    bool IsRunning() const noexcept { return isRunning_.load(std::memory_order_acquire); }

    /**
     * Internal callback invoked by Win32 low-level mouse hook.
     */
    void OnLowLevelMouseHook(WPARAM wParam, const MSLLHOOKSTRUCT& info);

private:
    void WorkerLoop();
    void InitializeCursorMap();
    CursorVisualType QueryCurrentCursorType() const;
    void SamplePositionAndState(InteractionType interaction);
    void FlushJsonToFile();

    // Configuration and state
    std::string videoOutputPath_;
    DisplayCanvasGeometry canvas_;
    uint64_t startPtsNs_{0};
    uint64_t lastPausePtsNs_{0};
    uint64_t accumulatedPausedNs_{0};

    std::atomic<bool> isRunning_{false};
    std::atomic<bool> isPaused_{false};
    std::atomic<DWORD> workerThreadId_{0};

    // Low-level Windows Hook
    HHOOK mouseHook_{nullptr};

    // Pre-allocated ring buffer for zero runtime allocations
    static constexpr size_t INITIAL_RESERVE_SAMPLES = 60 * 60 * 60; // 1 hr @ 60 Hz
    std::vector<CursorSample> samples_;
    mutable std::mutex bufferMutex_;

    // Cursor tracking state
    std::unordered_map<HCURSOR, CursorVisualType> cursorMap_;
    mutable CursorVisualType lastKnownCursorType_{CursorVisualType::Arrow};

    // Double click detection state
    uint32_t lastLeftClickTimeMs_{0};
    float lastLeftClickCx_{0.0f};
    float lastLeftClickCy_{0.0f};

    // Threading
    std::thread workerThread_;
};

// Global singleton instance accessor for the C-style hook callback
TelemetryWorker& GetGlobalTelemetryWorker();

} // namespace tracemotion
