#pragma once

#include <cstdint>
#include <string>
#include <string_view>

namespace tracemotion {

constexpr uint32_t TELEMETRY_SCHEMA_VERSION = 2;
constexpr uint32_t DEFAULT_SAMPLE_RATE_HZ = 60;
constexpr uint32_t DOUBLE_CLICK_TIME_THRESHOLD_MS = 350;
constexpr float DOUBLE_CLICK_DISTANCE_THRESHOLD = 0.04f; // Normalized screen coordinates

enum class InteractionType : uint8_t {
    Move = 0,
    Click = 1,
    DoubleClick = 2,
    RightClick = 3,
    MiddleClick = 4,
    MouseUp = 5
};

inline constexpr std::string_view ToString(InteractionType type) noexcept {
    switch (type) {
        case InteractionType::Move: return "move";
        case InteractionType::Click: return "click";
        case InteractionType::DoubleClick: return "double-click";
        case InteractionType::RightClick: return "right-click";
        case InteractionType::MiddleClick: return "middle-click";
        case InteractionType::MouseUp: return "mouseup";
        default: return "move";
    }
}

enum class CursorVisualType : uint8_t {
    Arrow = 0,
    Text = 1,
    Pointer = 2,
    Crosshair = 3,
    OpenHand = 4,
    ClosedHand = 5,
    ResizeEW = 6,
    ResizeNS = 7,
    NotAllowed = 8
};

inline constexpr std::string_view ToString(CursorVisualType type) noexcept {
    switch (type) {
        case CursorVisualType::Arrow: return "arrow";
        case CursorVisualType::Text: return "text";
        case CursorVisualType::Pointer: return "pointer";
        case CursorVisualType::Crosshair: return "crosshair";
        case CursorVisualType::OpenHand: return "open-hand";
        case CursorVisualType::ClosedHand: return "closed-hand";
        case CursorVisualType::ResizeEW: return "resize-ew";
        case CursorVisualType::ResizeNS: return "resize-ns";
        case CursorVisualType::NotAllowed: return "not-allowed";
        default: return "arrow";
    }
}

struct CursorSample {
    uint32_t timeMs{0};
    float cx{0.5f};
    float cy{0.5f};
    InteractionType interaction{InteractionType::Move};
    CursorVisualType cursorType{CursorVisualType::Arrow};
};

struct DisplayCanvasGeometry {
    uint32_t outputWidth{1920};
    uint32_t outputHeight{1080};
    int32_t sourceX{0};
    int32_t sourceY{0};
    uint32_t sourceWidth{1920};
    uint32_t sourceHeight{1080};
};

} // namespace tracemotion
