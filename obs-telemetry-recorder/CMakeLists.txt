cmake_minimum_required(VERSION 3.20)

project(tracemotion-obs LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Plugin target definition
add_library(tracemotion-obs MODULE
    src/main.cpp
    src/telemetry_worker.cpp
    include/telemetry_common.hpp
    include/telemetry_worker.hpp
)

target_include_directories(tracemotion-obs PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

# MSVC specific compiler flags
if(MSVC)
    target_compile_options(tracemotion-obs PRIVATE
        /W4
        /WX-
        /EHsc
        /utf-8
        /permissive-
        /Zc:inline
        /Zc:preprocessor
    )
    target_compile_definitions(tracemotion-obs PRIVATE
        WIN32_LEAN_AND_MEAN
        NOMINMAX
        _CRT_SECURE_NO_WARNINGS
    )
endif()

# Locate libobs and obs-frontend-api
if(DEFINED OBS_DIR)
    find_path(LIBOBS_INCLUDE_DIR "obs-module.h"
        PATHS
        "${CMAKE_CURRENT_SOURCE_DIR}/deps/obs/include"
        "${OBS_DIR}/libobs"
        "${OBS_DIR}/include"
        "${OBS_DIR}/include/obs"
        "${OBS_DIR}/deps/obs/include"
    )

    find_path(OBS_FRONTEND_INCLUDE_DIR "obs-frontend-api.h"
        PATHS
        "${CMAKE_CURRENT_SOURCE_DIR}/deps/obs/include"
        "${OBS_DIR}/UI/obs-frontend-api"
        "${OBS_DIR}/include"
        "${OBS_DIR}/include/obs"
        "${OBS_DIR}/deps/obs/include"
    )

    find_library(LIBOBS_LIB NAMES obs libobs
        PATHS
        "${OBS_DIR}/build/libobs/Release"
        "${OBS_DIR}/build/libobs"
        "${OBS_DIR}/lib"
        "${OBS_DIR}/bin/64bit"
    )

    find_library(OBS_FRONTEND_LIB NAMES obs-frontend-api libobs-frontend-api
        PATHS
        "${OBS_DIR}/build/UI/obs-frontend-api/Release"
        "${OBS_DIR}/build/UI/obs-frontend-api"
        "${OBS_DIR}/lib"
        "${OBS_DIR}/bin/64bit"
    )

    if(LIBOBS_INCLUDE_DIR)
        target_include_directories(tracemotion-obs PRIVATE ${LIBOBS_INCLUDE_DIR})
    else()
        target_include_directories(tracemotion-obs PRIVATE "${OBS_DIR}/libobs" "${OBS_DIR}/include")
    endif()

    if(OBS_FRONTEND_INCLUDE_DIR)
        target_include_directories(tracemotion-obs PRIVATE ${OBS_FRONTEND_INCLUDE_DIR})
    else()
        target_include_directories(tracemotion-obs PRIVATE "${OBS_DIR}/UI/obs-frontend-api")
    endif()

    if(LIBOBS_LIB)
        target_link_libraries(tracemotion-obs PRIVATE ${LIBOBS_LIB})
    else()
        target_link_libraries(tracemotion-obs PRIVATE libobs)
    endif()

    if(OBS_FRONTEND_LIB)
        target_link_libraries(tracemotion-obs PRIVATE ${OBS_FRONTEND_LIB})
    else()
        target_link_libraries(tracemotion-obs PRIVATE obs-frontend-api)
    endif()

    target_link_libraries(tracemotion-obs PRIVATE winmm user32 gdi32)
else()
    # Try find_package or fallback to standard OBS SDK search
    find_package(libobs QUIET)
    find_package(obs-frontend-api QUIET)

    if(TARGET obs::libobs AND TARGET obs::obs-frontend-api)
        target_link_libraries(tracemotion-obs PRIVATE
            obs::libobs
            obs::obs-frontend-api
            winmm
            user32
            gdi32
        )
    else()
        message(STATUS "[TraceMotion] Standalone build: Using custom include directories.")
        message(STATUS "Tip: Specify -DOBS_DIR=\"C:/path/to/obs-studio\" to link with custom OBS builds.")

        target_include_directories(tracemotion-obs PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/../../deps/obs/include
        )
        target_link_libraries(tracemotion-obs PRIVATE
            winmm
            user32
            gdi32
        )
    endif()
endif()

set_target_properties(tracemotion-obs PROPERTIES
    PREFIX ""
    OUTPUT_NAME "tracemotion-obs"
)

# Output installation rule
install(TARGETS tracemotion-obs
    LIBRARY DESTINATION "${CMAKE_INSTALL_PREFIX}/obs-plugins/64bit"
    RUNTIME DESTINATION "${CMAKE_INSTALL_PREFIX}/obs-plugins/64bit"
)
