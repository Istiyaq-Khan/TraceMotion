#include "telemetry_worker.hpp"

#include <obs-module.h>
#include <obs-frontend-api.h>
#include <util/platform.h>

#include <string>
#include <iostream>

OBS_DECLARE_MODULE()
OBS_MODULE_USE_DEFAULT_LOCALE("tracemotion-obs", "en-US")

extern "C" {

MODULE_EXPORT const char* obs_module_name(void) {
    return "TraceMotion OBS Telemetry Recorder";
}

MODULE_EXPORT const char* obs_module_description(void) {
    return "Synchronized high-frequency mouse telemetry capture for Recordly and After Effects post-production.";
}

} // extern "C"

namespace {

std::string GetCurrentRecordingOutputPath() {
    obs_output_t* recordingOutput = obs_frontend_get_recording_output();
    if (!recordingOutput) {
        blog(LOG_WARNING, "[TraceMotion] Failed to retrieve recording output handle.");
        return "";
    }

    obs_data_t* settings = obs_output_get_settings(recordingOutput);
    std::string outputPath;

    if (settings) {
        // Standard recording path
        const char* path = obs_data_get_string(settings, "path");
        if (path && *path) {
            outputPath = path;
        } else {
            // Check alternative URL/target fields used in custom/advanced output mode
            const char* url = obs_data_get_string(settings, "url");
            if (url && *url) {
                outputPath = url;
            }
        }
        obs_data_release(settings);
    }

    obs_output_release(recordingOutput);
    return outputPath;
}

void OnFrontendEvent(enum obs_frontend_event event, void* /*private_data*/) {
    auto& worker = tracemotion::GetGlobalTelemetryWorker();

    switch (event) {
        case OBS_FRONTEND_EVENT_RECORDING_STARTED: {
            blog(LOG_INFO, "[TraceMotion] OBS Recording Started. Initializing telemetry pipeline...");

            // Query active canvas dimensions with stack-safe oversized buffer
            tracemotion::DisplayCanvasGeometry canvas{};
            canvas.sourceWidth = 1920;
            canvas.sourceHeight = 1080;
            canvas.outputWidth = 1920;
            canvas.outputHeight = 1080;
            canvas.sourceX = 0;
            canvas.sourceY = 0;

            alignas(struct obs_video_info) uint8_t oviBuffer[512] = {0};
            auto* ovi = reinterpret_cast<struct obs_video_info*>(oviBuffer);
            if (obs_get_video_info(ovi)) {
                if (ovi->base_width > 0 && ovi->base_width <= 16384) {
                    canvas.sourceWidth = ovi->base_width;
                }
                if (ovi->base_height > 0 && ovi->base_height <= 16384) {
                    canvas.sourceHeight = ovi->base_height;
                }
                if (ovi->output_width > 0 && ovi->output_width <= 16384) {
                    canvas.outputWidth = ovi->output_width;
                } else {
                    canvas.outputWidth = canvas.sourceWidth;
                }
                if (ovi->output_height > 0 && ovi->output_height <= 16384) {
                    canvas.outputHeight = ovi->output_height;
                } else {
                    canvas.outputHeight = canvas.sourceHeight;
                }
            }

            const std::string outputPath = GetCurrentRecordingOutputPath();
            const uint64_t startPtsNs = os_gettime_ns();

            blog(LOG_INFO, "[TraceMotion] Target output: %s (Canvas: %ux%u -> %ux%u)",
                 outputPath.empty() ? "(pending determination)" : outputPath.c_str(),
                 canvas.sourceWidth, canvas.sourceHeight, canvas.outputWidth, canvas.outputHeight);

            worker.Start(outputPath, canvas, startPtsNs);
            break;
        }

        case OBS_FRONTEND_EVENT_RECORDING_PAUSED: {
            blog(LOG_INFO, "[TraceMotion] Recording paused. Suspending telemetry logging.");
            worker.Pause(os_gettime_ns());
            break;
        }

        case OBS_FRONTEND_EVENT_RECORDING_UNPAUSED: {
            blog(LOG_INFO, "[TraceMotion] Recording resumed. Resuming telemetry logging.");
            worker.Resume(os_gettime_ns());
            break;
        }

        case OBS_FRONTEND_EVENT_RECORDING_STOPPED: {
            blog(LOG_INFO, "[TraceMotion] OBS Recording Stopped. Finalizing and writing sidecar JSON...");

            std::string finalPath;
            char* lastRecording = obs_frontend_get_last_recording();
            if (lastRecording && *lastRecording) {
                blog(LOG_INFO, "[TraceMotion] Confirmed recorded file: %s", lastRecording);
                finalPath = lastRecording;
                bfree(lastRecording);
            }

            worker.Stop(os_gettime_ns(), finalPath);
            blog(LOG_INFO, "[TraceMotion] Telemetry JSON successfully emitted.");
            break;
        }

        default:
            break;
    }
}

} // namespace

extern "C" {

MODULE_EXPORT bool obs_module_load(void) {
    blog(LOG_INFO, "[TraceMotion] Loading TraceMotion OBS Studio Telemetry Plugin v1.0.0...");
    obs_frontend_add_event_callback(OnFrontendEvent, nullptr);
    return true;
}

MODULE_EXPORT void obs_module_unload(void) {
    blog(LOG_INFO, "[TraceMotion] Unloading TraceMotion OBS Studio Telemetry Plugin...");
    obs_frontend_remove_event_callback(OnFrontendEvent, nullptr);

    auto& worker = tracemotion::GetGlobalTelemetryWorker();
    if (worker.IsRunning()) {
        worker.Stop(os_gettime_ns());
    }
}

} // extern "C"
