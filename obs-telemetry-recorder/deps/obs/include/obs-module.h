#pragma once

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

#ifndef MODULE_EXPORT
#ifdef _MSC_VER
#define MODULE_EXPORT __declspec(dllexport)
#else
#define MODULE_EXPORT __attribute__((visibility("default")))
#endif
#endif

#define LOG_ERROR   100
#define LOG_WARNING 200
#define LOG_INFO    300
#define LOG_DEBUG   400

#ifdef __cplusplus
#define OBS_DECLARE_MODULE() \
    static void *obs_module_pointer = nullptr; \
    extern "C" { \
        MODULE_EXPORT void obs_module_set_pointer(void *module) { obs_module_pointer = module; } \
        MODULE_EXPORT void *obs_current_module(void) { return obs_module_pointer; } \
        MODULE_EXPORT uint32_t obs_module_ver(void) { return 0x21000001; } \
        MODULE_EXPORT void obs_module_set_locale(const char *locale) { (void)locale; } \
        MODULE_EXPORT void obs_module_free_locale(void) {} \
        MODULE_EXPORT bool obs_module_get_string(const char *val, const char **out) { if (out) *out = val; return true; } \
    }
#else
#define OBS_DECLARE_MODULE() \
    static void *obs_module_pointer = NULL; \
    MODULE_EXPORT void obs_module_set_pointer(void *module) { obs_module_pointer = module; } \
    MODULE_EXPORT void *obs_current_module(void) { return obs_module_pointer; } \
    MODULE_EXPORT uint32_t obs_module_ver(void) { return 0x21000001; } \
    MODULE_EXPORT void obs_module_set_locale(const char *locale) { (void)locale; } \
    MODULE_EXPORT void obs_module_free_locale(void) {} \
    MODULE_EXPORT bool obs_module_get_string(const char *val, const char **out) { if (out) *out = val; return true; }
#endif

#define OBS_MODULE_USE_DEFAULT_LOCALE(name, default_locale)

#ifdef __cplusplus
extern "C" {
#endif

typedef struct obs_output obs_output_t;
typedef struct obs_data obs_data_t;

enum video_format {
    VIDEO_FORMAT_NONE,
    VIDEO_FORMAT_I420,
    VIDEO_FORMAT_NV12,
    VIDEO_FORMAT_YVYU,
    VIDEO_FORMAT_YUY2,
    VIDEO_FORMAT_UYVY,
    VIDEO_FORMAT_RGBA,
    VIDEO_FORMAT_BGRA,
    VIDEO_FORMAT_BGRX,
    VIDEO_FORMAT_Y800,
    VIDEO_FORMAT_I444,
    VIDEO_FORMAT_BGR3,
    VIDEO_FORMAT_I422,
    VIDEO_FORMAT_I40A,
    VIDEO_FORMAT_I422A,
    VIDEO_FORMAT_I444A,
    VIDEO_FORMAT_YUVA,
    VIDEO_FORMAT_AYUV,
    VIDEO_FORMAT_P010,
    VIDEO_FORMAT_P216,
    VIDEO_FORMAT_P416,
    VIDEO_FORMAT_V210,
};

enum video_colorspace {
    VIDEO_CS_DEFAULT,
    VIDEO_CS_601,
    VIDEO_CS_709,
    VIDEO_CS_SRGB,
    VIDEO_CS_2100_PQ,
    VIDEO_CS_2100_HLG,
};

enum video_range_type {
    VIDEO_RANGE_DEFAULT,
    VIDEO_RANGE_PARTIAL,
    VIDEO_RANGE_FULL,
};

enum obs_scale_type {
    OBS_SCALE_DISABLE,
    OBS_SCALE_POINT,
    OBS_SCALE_BICUBIC,
    OBS_SCALE_BILINEAR,
    OBS_SCALE_LANCZOS,
    OBS_SCALE_AREA,
};

struct obs_video_info {
    const char *graphics_module;
    uint32_t fps_num;
    uint32_t fps_den;
    uint32_t base_width;
    uint32_t base_height;
    uint32_t output_width;
    uint32_t output_height;
    enum video_format output_format;
    uint32_t adapter;
    bool gpu_conversion;
    enum video_colorspace colorspace;
    enum video_range_type range;
    enum obs_scale_type scale_type;
};

MODULE_EXPORT const char *obs_module_name(void);
MODULE_EXPORT const char *obs_module_description(void);
MODULE_EXPORT bool obs_module_load(void);
MODULE_EXPORT void obs_module_unload(void);

void blog(int log_level, const char *format, ...);
bool obs_get_video_info(struct obs_video_info *ovi);
obs_data_t *obs_output_get_settings(const obs_output_t *output);
const char *obs_data_get_string(obs_data_t *data, const char *name);
void obs_data_release(obs_data_t *data);
void obs_output_release(obs_output_t *output);
void bfree(void *ptr);

#ifdef __cplusplus
}
#endif
