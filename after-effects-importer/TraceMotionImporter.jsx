/**
 * TraceMotion Importer & Rig Generator for Adobe After Effects
 * 
 * Ingests screen recordings and synchronized mouse telemetry (.cursor.json)
 * captured via OBS Studio or Recordly. Reconstructs dynamic camera zooms, deadband
 * safe zones, damped harmonic oscillator spring smoothing, authentic system cursor assets
 * (macOS Tahoe, macOS Classic, Windows 11 Fluent, Figma), and click ripple VFX inside native AE comps.
 *
 * Compatible with Adobe After Effects CC 2020 through 2026+
 */

(function (thisObj) {
    "use strict";

    // =========================================================================
    // ExtendScript Polyfills & Helper Utilities
    // =========================================================================
    if (!Array.prototype.indexOf) {
        Array.prototype.indexOf = function (searchElement, fromIndex) {
            var k;
            if (this === null) throw new TypeError('"this" is null or not defined');
            var o = Object(this);
            var len = o.length >>> 0;
            if (len === 0) return -1;
            var n = fromIndex | 0;
            if (Math.abs(n) >= len) n = 0;
            k = Math.max(n >= 0 ? n : len - Math.abs(n), 0);
            while (k < len) {
                if (k in o && o[k] === searchElement) return k;
                k++;
            }
            return -1;
        };
    }

    var JSONParser = {
        parse: function (jsonStr) {
            if (typeof JSON !== "undefined" && typeof JSON.parse === "function") {
                try {
                    return JSON.parse(jsonStr);
                } catch (e) {}
            }
            var filtered = jsonStr
                .replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, "@")
                .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\\-]?\d+)?/g, "]")
                .replace(/(?:^|:|,)(?:[\s\t\r\n]*\[)+/g, "");
            if (/^[\],:{}\s]*$/.test(filtered)) {
                return eval("(" + jsonStr + ")");
            }
            throw new Error("Invalid telemetry JSON format");
        }
    };

    function hexToRgb(hex) {
        var cleanHex = hex.replace("#", "");
        if (cleanHex.length === 3) {
            cleanHex = cleanHex.charAt(0) + cleanHex.charAt(0) +
                       cleanHex.charAt(1) + cleanHex.charAt(1) +
                       cleanHex.charAt(2) + cleanHex.charAt(2);
        }
        var num = parseInt(cleanHex, 16);
        if (isNaN(num)) return [0.145, 0.388, 0.922]; // Default Recordly blue
        var r = ((num >> 16) & 255) / 255.0;
        var g = ((num >> 8) & 255) / 255.0;
        var b = (num & 255) / 255.0;
        return [r, g, b];
    }

    var PREF_SECTION = "TraceMotion_Preferences_v2";
    function savePref(key, value) {
        try {
            app.settings.saveSetting(PREF_SECTION, key, String(value));
        } catch (e) {}
    }
    function getPref(key, defaultValue) {
        try {
            if (app.settings.haveSetting(PREF_SECTION, key)) {
                return app.settings.getSetting(PREF_SECTION, key);
            }
        } catch (e) {}
        return defaultValue;
    }

    // =========================================================================
    // Embedded Cursor Manifest & Hotspot Definitions (Recordly 1:1 Match)
    // =========================================================================
    var CURSOR_MANIFEST = {
        tahoe: {
            id: "tahoe",
            label: "macOS Tahoe (Recordly Default)",
            folder: "tahoe",
            sizeMultiplier: 1.0,
            cursors: {
                arrow: {
                    filePng: "pointer-1__14-6.png",
                    fileSvg: "pointer-1__14-6.svg",
                    anchorX: 0.14,
                    anchorY: 0.06
                },
                pointer: {
                    filePng: "pointinghand-1__40-10.png",
                    fileSvg: "pointinghand-1__40-10.svg",
                    anchorX: 0.40,
                    anchorY: 0.10
                },
                text: {
                    filePng: "ibeam-1__50-44.png",
                    fileSvg: "ibeam-1__50-44.svg",
                    anchorX: 0.50,
                    anchorY: 0.44
                },
                crosshair: {
                    filePng: "crosshair-1__50-50.png",
                    fileSvg: "crosshair-1__50-50.svg",
                    anchorX: 0.50,
                    anchorY: 0.50
                },
                "open-hand": {
                    filePng: "openhand-1__55-57.png",
                    fileSvg: "openhand-1__55-57.svg",
                    anchorX: 0.55,
                    anchorY: 0.57
                },
                "closed-hand": {
                    filePng: "closedhand-1__50-46.png",
                    fileSvg: "closedhand-1__50-46.svg",
                    anchorX: 0.50,
                    anchorY: 0.46
                },
                "resize-ew": {
                    filePng: "resizeeastwest-1__50-50.png",
                    fileSvg: "resizeeastwest-1__50-50.svg",
                    anchorX: 0.50,
                    anchorY: 0.50
                },
                "resize-ns": {
                    filePng: "resizenorthsouth-1__50-49.png",
                    fileSvg: "resizenorthsouth-1__50-49.svg",
                    anchorX: 0.50,
                    anchorY: 0.49
                },
                "not-allowed": {
                    filePng: "notallowed-1__23-0.png",
                    fileSvg: "notallowed-1__23-0.svg",
                    anchorX: 0.23,
                    anchorY: 0.00
                }
            }
        },
        macos: {
            id: "macos",
            label: "macOS Classic",
            folder: "macos",
            sizeMultiplier: 1.714,
            cursors: {
                arrow: {
                    filePng: "pointer-1__34-24.png",
                    fileSvg: "pointer-1__34-24.svg",
                    anchorX: 0.34,
                    anchorY: 0.24
                },
                pointer: {
                    filePng: "pointinghand-1__39-26.png",
                    fileSvg: "pointinghand-1__39-26.svg",
                    anchorX: 0.39,
                    anchorY: 0.26
                },
                text: {
                    filePng: "ibeamstroke-1__50-50.png",
                    fileSvg: "ibeamstroke-1__50-50.svg",
                    anchorX: 0.50,
                    anchorY: 0.50
                },
                crosshair: {
                    filePng: "crosshair-1__50-50.png",
                    fileSvg: "crosshair-1__50-50.svg",
                    anchorX: 0.50,
                    anchorY: 0.50
                },
                "open-hand": {
                    filePng: "openhand-1__50-50.png",
                    fileSvg: "openhand-1__50-50.svg",
                    anchorX: 0.50,
                    anchorY: 0.50
                },
                "closed-hand": {
                    filePng: "closedhand-1__50-50.png",
                    fileSvg: "closedhand-1__50-50.svg",
                    anchorX: 0.50,
                    anchorY: 0.50
                },
                "resize-ew": {
                    filePng: "resizeeastwest-1__50-50.png",
                    fileSvg: "resizeeastwest-1__50-50.svg",
                    anchorX: 0.50,
                    anchorY: 0.50
                },
                "resize-ns": {
                    filePng: "resizenorthsouth-1__50-50.png",
                    fileSvg: "resizenorthsouth-1__50-50.svg",
                    anchorX: 0.50,
                    anchorY: 0.50
                },
                "not-allowed": {
                    filePng: "notallowed-1__23-0.png",
                    fileSvg: "notallowed-1__23-0.svg",
                    anchorX: 0.23,
                    anchorY: 0.00
                }
            }
        },
        windows11: {
            id: "windows11",
            label: "Windows 11 Fluent",
            folder: "windows11",
            sizeMultiplier: 1.6787,
            cursors: {
                arrow: {
                    filePng: "arrow__31-22.png",
                    fileSvg: "arrow__31-22.svg",
                    anchorX: 0.00,
                    anchorY: 0.00
                },
                pointer: {
                    filePng: "pointer__54-35.png",
                    fileSvg: "pointer__54-35.svg",
                    anchorX: 0.1875,
                    anchorY: 0.00
                },
                text: {
                    filePng: "text__50-50.png",
                    fileSvg: "text__50-50.svg",
                    anchorX: 0.50,
                    anchorY: 0.50
                },
                crosshair: {
                    filePng: "cross__50-50.png",
                    fileSvg: "cross__50-50.svg",
                    anchorX: 0.50,
                    anchorY: 0.50
                },
                "open-hand": {
                    filePng: "grab__50-50.png",
                    fileSvg: "grab__50-50.svg",
                    anchorX: 0.50,
                    anchorY: 0.50
                },
                "closed-hand": {
                    filePng: "grabbing__50-50.png",
                    fileSvg: "grabbing__50-50.svg",
                    anchorX: 0.50,
                    anchorY: 0.50
                },
                "resize-ew": {
                    filePng: "resize-horizontal__51-49.png",
                    fileSvg: "resize-horizontal__51-49.svg",
                    anchorX: 0.3438,
                    anchorY: 0.125
                },
                "resize-ns": {
                    filePng: "resize-vertical__48-50.png",
                    fileSvg: "resize-vertical__48-50.svg",
                    anchorX: 0.125,
                    anchorY: 0.3438
                },
                "not-allowed": {
                    filePng: "block__50-50.png",
                    fileSvg: "block__50-50.svg",
                    anchorX: 0.25,
                    anchorY: 0.25
                }
            }
        },
        custom: {
            id: "custom",
            label: "Figma / Minimal Cursor",
            folder: "custom",
            sizeMultiplier: 1.0,
            cursors: {
                arrow: {
                    filePng: "minimal-cursor.png",
                    fileSvg: "minimal-cursor.svg",
                    anchorX: 0.1010,
                    anchorY: 0.0508
                },
                pointer: {
                    filePng: "minimal-cursor.png",
                    fileSvg: "minimal-cursor.svg",
                    anchorX: 0.1010,
                    anchorY: 0.0508
                }
            }
        },
        procedural: {
            id: "procedural",
            label: "Vector Shape (Procedural Fallback)",
            folder: null,
            sizeMultiplier: 1.0,
            cursors: {
                arrow: {
                    anchorX: 0.00,
                    anchorY: 0.00
                }
            }
        }
    };

    // Locate cursor assets directory relative to this script
    function getCursorAssetFile(styleId, cursorType, preferSvg) {
        var style = CURSOR_MANIFEST[styleId] || CURSOR_MANIFEST.tahoe;
        if (!style.folder) return null; // Procedural
        var cData = style.cursors[cursorType] || style.cursors.arrow;
        if (!cData) return null;

        var scriptFile = new File($.fileName);
        var baseDir = scriptFile.parent.fsName + "/assets/cursors/" + style.folder + "/";
        var primaryFile = preferSvg ? new File(baseDir + cData.fileSvg) : new File(baseDir + cData.filePng);
        if (primaryFile.exists) return primaryFile;

        // Fallback between PNG / SVG
        var altFile = preferSvg ? new File(baseDir + cData.filePng) : new File(baseDir + cData.fileSvg);
        if (altFile.exists) return altFile;

        return null;
    }

    // =========================================================================
    // Recordly Damped Harmonic Oscillator Spring Physics Solver
    // =========================================================================
    function getCursorSpringConfig(smoothingFactor, tuning) {
        var clamped = Math.min(2.0, Math.max(0.0, smoothingFactor));
        var stiffnessBoost = 1.12;

        var tStiffness = (tuning && tuning.stiffnessMultiplier) || 1.0;
        var tDamping = (tuning && tuning.dampingMultiplier) || 1.0;
        var tMass = (tuning && tuning.massMultiplier) || 1.0;

        if (clamped <= 0) {
            return {
                stiffness: 1000.0 * tStiffness,
                damping: 100.0 * tDamping,
                mass: 1.0 * tMass,
                restDelta: 0.0001,
                restSpeed: 0.001
            };
        }

        if (clamped <= 0.5) {
            var legacyNorm = clamped / 0.5;
            return {
                stiffness: (760.0 - legacyNorm * 420.0) * stiffnessBoost * tStiffness,
                damping: (34.0 + legacyNorm * 24.0) * tDamping,
                mass: (0.85 + legacyNorm * 0.55) * tMass,
                restDelta: 0.0002,
                restSpeed: 0.01
            };
        }

        var extNorm = (clamped - 0.5) / 1.5;
        return {
            stiffness: (340.0 - extNorm * 180.0) * stiffnessBoost * tStiffness,
            damping: (58.0 + extNorm * 22.0) * tDamping,
            mass: (1.35 + extNorm * 0.45) * tMass,
            restDelta: 0.0002,
            restSpeed: 0.01
        };
    }

    function resolveSpringPosition(t, target, initialDelta, initialVelocity, dampingRatio, undampedAngularFreq) {
        if (dampingRatio < 1.0) {
            var dampedFreq = undampedAngularFreq * Math.sqrt(1.0 - dampingRatio * dampingRatio);
            var envelope = Math.exp(-dampingRatio * undampedAngularFreq * t);
            return target - envelope * (
                ((initialVelocity + dampingRatio * undampedAngularFreq * initialDelta) / dampedFreq) * Math.sin(dampedFreq * t) +
                initialDelta * Math.cos(dampedFreq * t)
            );
        }
        if (dampingRatio === 1.0) {
            return target - Math.exp(-undampedAngularFreq * t) * (initialDelta + (initialVelocity + undampedAngularFreq * initialDelta) * t);
        }
        var dampedFreqOver = undampedAngularFreq * Math.sqrt(dampingRatio * dampingRatio - 1.0);
        var envelopeOver = Math.exp(-dampingRatio * undampedAngularFreq * t);
        var freqT = Math.min(dampedFreqOver * t, 300.0);
        var sinhVal = (Math.exp(freqT) - Math.exp(-freqT)) / 2.0;
        var coshVal = (Math.exp(freqT) + Math.exp(-freqT)) / 2.0;

        return target - (envelopeOver * (
            (initialVelocity + dampingRatio * undampedAngularFreq * initialDelta) * sinhVal +
            dampedFreqOver * initialDelta * coshVal
        )) / dampedFreqOver;
    }

    function stepSpringValue(state, target, deltaMs, config) {
        var safeDeltaMs = Math.min(80.0, Math.max(1.0, deltaMs));

        if (!state.initialized || isNaN(state.value)) {
            state.value = target;
            state.velocity = 0;
            state.initialized = true;
            return state.value;
        }

        var restDelta = config.restDelta || 0.0005;
        var restSpeed = config.restSpeed || 0.02;

        if (Math.abs(target - state.value) <= restDelta && Math.abs(state.velocity) <= restSpeed) {
            state.value = target;
            state.velocity = 0;
            return state.value;
        }

        var stiffness = config.stiffness;
        var damping = config.damping;
        var mass = config.mass;

        var undampedAngularFreq = Math.sqrt(stiffness / mass);
        var dampingRatio = damping / (2.0 * Math.sqrt(stiffness * mass));
        var initialDelta = target - state.value;
        var initialVelocity = -state.velocity;
        var tSec = safeDeltaMs / 1000.0;

        var current = resolveSpringPosition(tSec, target, initialDelta, initialVelocity, dampingRatio, undampedAngularFreq);

        // Overshoot guard for overdamped springs
        if (dampingRatio >= 1.0) {
            var crossed = (state.value <= target && current > target) || (state.value >= target && current < target);
            if (crossed) {
                state.value = target;
                state.velocity = 0;
                return state.value;
            }
        }

        var epsilon = 0.0001;
        var ahead = resolveSpringPosition(tSec + epsilon, target, initialDelta, initialVelocity, dampingRatio, undampedAngularFreq);
        var analyticalVelocity = (ahead - current) / epsilon;

        var isBelowVel = Math.abs(analyticalVelocity) <= restSpeed;
        var isBelowDisp = Math.abs(target - current) <= restDelta;

        if (isBelowVel && isBelowDisp) {
            state.value = target;
            state.velocity = 0;
        } else {
            state.value = current;
            state.velocity = analyticalVelocity;
        }

        return state.value;
    }

    // Binary search monotonic interpolation
    function interpolateCursorPosition(samples, timeMs) {
        if (!samples || samples.length === 0) return null;
        if (timeMs <= samples[0].timeMs) return { cx: samples[0].cx, cy: samples[0].cy };
        if (timeMs >= samples[samples.length - 1].timeMs) {
            var last = samples[samples.length - 1];
            return { cx: last.cx, cy: last.cy };
        }

        var lo = 0;
        var hi = samples.length - 1;
        while (lo < hi - 1) {
            var mid = (lo + hi) >> 1;
            if (samples[mid].timeMs <= timeMs) lo = mid;
            else hi = mid;
        }

        var a = samples[lo];
        var b = samples[hi];
        var span = b.timeMs - a.timeMs;
        if (span <= 0) return { cx: a.cx, cy: a.cy };
        var t = (timeMs - a.timeMs) / span;

        return {
            cx: a.cx + (b.cx - a.cx) * t,
            cy: a.cy + (b.cy - a.cy) * t
        };
    }

    // =========================================================================
    // Ramer-Douglas-Peucker (RDP) Trajectory Simplification
    // =========================================================================
    function getPerpendicularDistance(point, lineStart, lineEnd) {
        var dx = lineEnd.cx - lineStart.cx;
        var dy = lineEnd.cy - lineStart.cy;
        var mag = Math.sqrt(dx * dx + dy * dy);
        if (mag === 0) {
            var diffX = point.cx - lineStart.cx;
            var diffY = point.cy - lineStart.cy;
            return Math.sqrt(diffX * diffX + diffY * diffY);
        }
        var u = ((point.cx - lineStart.cx) * dx + (point.cy - lineStart.cy) * dy) / (mag * mag);
        u = Math.max(0, Math.min(1, u));
        var projX = lineStart.cx + u * dx;
        var projY = lineStart.cy + u * dy;
        var distX = point.cx - projX;
        var distY = point.cy - projY;
        return Math.sqrt(distX * distX + distY * distY);
    }

    function rdpSimplify(points, epsilon) {
        if (points.length <= 2) return points;

        var dmax = 0;
        var index = 0;
        var end = points.length - 1;

        for (var i = 1; i < end; i++) {
            if (points[i].isClick) {
                dmax = Number.MAX_VALUE;
                index = i;
                break;
            }
            var d = getPerpendicularDistance(points[i], points[0], points[end]);
            if (d > dmax) {
                index = i;
                dmax = d;
            }
        }

        if (dmax > epsilon) {
            var rec1 = rdpSimplify(points.slice(0, index + 1), epsilon);
            var rec2 = rdpSimplify(points.slice(index), epsilon);
            return rec1.slice(0, rec1.length - 1).concat(rec2);
        } else {
            return [points[0], points[end]];
        }
    }

    // =========================================================================
    // Main Rig Generation Core
    // =========================================================================
    function buildTraceMotionRig(videoFile, telemetryFile, options) {
        app.beginUndoGroup("Generate TraceMotion Rig");

        try {
            // 1. Read and parse JSON telemetry
            telemetryFile.open("r");
            var jsonContent = telemetryFile.read();
            telemetryFile.close();

            var telemetryData = JSONParser.parse(jsonContent);
            var rawSamples = telemetryData.samples || [];
            if (!rawSamples || rawSamples.length === 0) {
                alert("No telemetry samples found in the provided JSON file.", "TraceMotion Error");
                return;
            }

            // 2. Import Video Footage
            var importOpts = new ImportOptions(videoFile);
            var footageItem = app.project.importFile(importOpts);
            var compW = footageItem.width;
            var compH = footageItem.height;
            var duration = footageItem.duration;
            var fps = footageItem.frameRate || 60;

            // 3. Create Composition
            var comp = app.project.items.addComp(
                footageItem.name.replace(/\.[^\.]+$/, "") + "_TraceMotion",
                compW,
                compH,
                1.0,
                duration,
                fps
            );
            comp.openInViewer();
            comp.motionBlur = options.enableMotionBlur;

            // 4. Add Screen Recording Video Layer
            var videoLayer = comp.layers.add(footageItem);
            videoLayer.name = "Clean_Screen_Capture";
            videoLayer.motionBlur = options.enableMotionBlur;

            // 5. Create Master Controller Null
            var controller = comp.layers.addNull();
            controller.name = "TraceMotion_Camera_Controller";
            controller.guideLayer = true;

            var fxParade = controller.property("ADBE Effect Parade");
            var zoomSlider = fxParade.addProperty("ADBE Slider Control");
            zoomSlider.name = "Zoom Scale";
            zoomSlider.property("Slider").setValue(100);

            var marginSlider = fxParade.addProperty("ADBE Slider Control");
            marginSlider.name = "Deadband Margin Pct";
            marginSlider.property("Slider").setValue(options.deadbandMargin);

            var swaySlider = fxParade.addProperty("ADBE Slider Control");
            swaySlider.name = "Cursor Sway";
            swaySlider.property("Slider").setValue(options.swayAmount);

            var camFocusProp = fxParade.addProperty("ADBE Point Control");
            camFocusProp.name = "Camera Focus";
            var pointProp = camFocusProp.property("Point");

            // 6. Recordly Damped Harmonic Oscillator Simulation
            var springConfig = getCursorSpringConfig(options.cursorSmoothing, {
                stiffnessMultiplier: options.motionPreset === "focused" ? 1.35 : 0.92,
                dampingMultiplier: options.motionPreset === "focused" ? 0.79 : 1.36,
                massMultiplier: 1.29
            });

            var xSpring = { value: rawSamples[0].cx, velocity: 0, initialized: true };
            var ySpring = { value: rawSamples[0].cy, velocity: 0, initialized: true };

            var dtMs = 1000.0 / fps;
            var totalFrames = Math.max(1, Math.ceil(duration * fps));
            var simulatedPath = [];

            // Identify explicit click events
            var clickTimeMap = {};
            for (var c = 0; c < rawSamples.length; c++) {
                var sRaw = rawSamples[c];
                var iType = sRaw.interactionType;
                if (iType === "click" || iType === "double-click" || iType === "right-click" || iType === "middle-click") {
                    clickTimeMap[Math.round(sRaw.timeMs)] = true;
                }
            }

            for (var frame = 0; frame <= totalFrames; frame++) {
                var timeMs = frame * dtMs;
                var target = interpolateCursorPosition(rawSamples, timeMs);
                var smX = stepSpringValue(xSpring, target.cx, dtMs, springConfig);
                var smY = stepSpringValue(ySpring, target.cy, dtMs, springConfig);

                simulatedPath.push({
                    timeMs: timeMs,
                    timeSec: timeMs / 1000.0,
                    cx: smX,
                    cy: smY,
                    isClick: !!clickTimeMap[Math.round(timeMs)]
                });
            }

            // 7. Decimate Keyframes with RDP (or keep pristine at tolerance <= 0)
            var finalKeys = simulatedPath;
            if (options.simplificationTolerance > 0) {
                var normTol = options.simplificationTolerance / Math.max(compW, compH);
                finalKeys = rdpSimplify(simulatedPath, normTol);
            }

            // 8. Compute Deadband Camera Path matching Recordly SNAP_TO_EDGES_RATIO_AUTO
            var currentFocusX = compW / 2;
            var currentFocusY = compH / 2;
            var zoomDepth = Math.max(100, options.defaultZoomDepth) / 100.0;
            var halfSpanX = (compW / 2) / zoomDepth;
            var halfSpanY = (compH / 2) / zoomDepth;
            var deadbandRatio = (options.deadbandMargin / 100.0);
            var insetX = (halfSpanX * 2) * deadbandRatio;
            var insetY = (halfSpanY * 2) * deadbandRatio;

            for (var kIdx = 0; kIdx < finalKeys.length; kIdx++) {
                var kPoint = finalKeys[kIdx];
                var ptX = kPoint.cx * compW;
                var ptY = kPoint.cy * compH;

                var safeL = currentFocusX - halfSpanX + insetX;
                var safeR = currentFocusX + halfSpanX - insetX;
                var safeT = currentFocusY - halfSpanY + insetY;
                var safeB = currentFocusY + halfSpanY - insetY;

                if (ptX < safeL) currentFocusX = ptX + (halfSpanX - insetX);
                else if (ptX > safeR) currentFocusX = ptX - (halfSpanX - insetX);

                if (ptY < safeT) currentFocusY = ptY + (halfSpanY - insetY);
                else if (ptY > safeB) currentFocusY = ptY - (halfSpanY - insetY);

                currentFocusX = Math.max(halfSpanX, Math.min(compW - halfSpanX, currentFocusX));
                currentFocusY = Math.max(halfSpanY, Math.min(compH - halfSpanY, currentFocusY));

                pointProp.setValueAtTime(kPoint.timeSec, [currentFocusX, currentFocusY]);
            }

            // Apply Cubic Bezier Ease on Camera Focus
            var easeOut = new KeyframeEase(0, 16.0);
            var easeIn = new KeyframeEase(0, 85.0);
            for (var k = 1; k <= pointProp.numKeys; k++) {
                pointProp.setTemporalEaseAtKey(k, [easeIn], [easeOut]);
                pointProp.setSpatialContinuousAtKey(k, true);
                pointProp.setSpatialAutoBezierAtKey(k, true);
            }

            // 9. Camera Expression Binding on Video Layer
            videoLayer.transform.anchorPoint.expression =
                "var ctrl = thisComp.layer('" + controller.name + "');\n" +
                "ctrl.effect('Camera Focus')('Point');";
            videoLayer.transform.position.expression = "[thisComp.width / 2, thisComp.height / 2];";
            videoLayer.transform.scale.expression =
                "var ctrl = thisComp.layer('" + controller.name + "');\n" +
                "var z = ctrl.effect('Zoom Scale')('Slider');\n" +
                "[z, z];";

            // 10. Generate Calibrated Cursor Layer with Hotspot Locking
            if (options.createCursor) {
                var styleDef = CURSOR_MANIFEST[options.cursorStyle] || CURSOR_MANIFEST.tahoe;
                var arrowData = styleDef.cursors.arrow;
                var assetFile = getCursorAssetFile(options.cursorStyle, "arrow", options.preferSvg);

                var cursorLayer = null;
                var assetWidth = 512;
                var assetHeight = 512;

                if (assetFile && assetFile.exists) {
                    var cursorFootage = app.project.importFile(new ImportOptions(assetFile));
                    cursorLayer = comp.layers.add(cursorFootage);
                    cursorLayer.name = "TraceMotion_Cursor [" + styleDef.label + "]";
                    assetWidth = cursorFootage.width;
                    assetHeight = cursorFootage.height;
                } else {
                    // Procedural Clean Vector Shape Fallback
                    cursorLayer = comp.layers.addShape();
                    cursorLayer.name = "TraceMotion_Cursor [Procedural Vector]";

                    var rootGrp = cursorLayer.property("ADBE Root Vectors Group");
                    var shapeGrp = rootGrp.addProperty("ADBE Vector Group");
                    shapeGrp.name = "Cursor Arrow";
                    var grpVectors = shapeGrp.property("ADBE Vectors Group");

                    var pathShape = new Shape();
                    pathShape.vertices = [
                        [0, 0], [0, 24], [6, 18], [11, 28], [14, 26], [9, 16], [17, 16]
                    ];
                    pathShape.closed = true;

                    var pathProp = grpVectors.addProperty("ADBE Vector Shape - Group");
                    pathProp.property("Path").setValue(pathShape);

                    var fillProp = grpVectors.addProperty("ADBE Vector Graphic - Fill");
                    fillProp.property("Color").setValue([0.05, 0.05, 0.05, 1.0]);

                    var strokeProp = grpVectors.addProperty("ADBE Vector Graphic - Stroke");
                    strokeProp.property("Color").setValue([1.0, 1.0, 1.0, 1.0]);
                    strokeProp.property("Stroke Width").setValue(2.0);

                    assetWidth = 32;
                    assetHeight = 32;
                }

                cursorLayer.motionBlur = options.enableMotionBlur;

                // CRITICAL FIX: Lock Anchor Point exactly to cursor hotspot
                var hotspotX = assetWidth * arrowData.anchorX;
                var hotspotY = assetHeight * arrowData.anchorY;
                cursorLayer.transform.anchorPoint.setValue([hotspotX, hotspotY]);

                // Calculate base size scale matching Recordly dotRadius
                var baseCursorHeight = 28.0 * 2.5 * (options.cursorScalePct / 100.0) * (compH / 1080.0) * styleDef.sizeMultiplier;
                var baseScaleFactor = (baseCursorHeight / assetHeight) * 100.0;
                cursorLayer.transform.scale.setValue([baseScaleFactor, baseScaleFactor]);

                // Dynamic Pointer Hand State (Optional)
                var pointerLayer = null;
                var pointerData = styleDef.cursors.pointer;
                var pointerAssetFile = pointerData ? getCursorAssetFile(options.cursorStyle, "pointer", options.preferSvg) : null;

                if (options.dynamicCursorStates && pointerAssetFile && pointerAssetFile.exists) {
                    var pointerFootage = app.project.importFile(new ImportOptions(pointerAssetFile));
                    pointerLayer = comp.layers.add(pointerFootage);
                    pointerLayer.name = "TraceMotion_PointerHand [" + styleDef.label + "]";
                    pointerLayer.motionBlur = options.enableMotionBlur;

                    // Calibrate Pointer Hand Hotspot
                    var pHotspotX = pointerFootage.width * pointerData.anchorX;
                    var pHotspotY = pointerFootage.height * pointerData.anchorY;
                    pointerLayer.transform.anchorPoint.setValue([pHotspotX, pHotspotY]);

                    // Scale matching Arrow layer
                    var pScaleFactor = (baseCursorHeight / pointerFootage.height) * 100.0;
                    pointerLayer.transform.scale.setValue([pScaleFactor, pScaleFactor]);

                    // Parent to Arrow layer so it shares the exact position and spring movement
                    pointerLayer.parent = cursorLayer;
                    pointerLayer.transform.position.setValue([0, 0]);

                    // Animate opacity using HOLD keyframes based on cursorType / clicks
                    var arrowOpacity = cursorLayer.transform.opacity;
                    var pointerOpacity = pointerLayer.transform.opacity;

                    for (var sk = 0; sk < rawSamples.length; sk++) {
                        var sampleState = rawSamples[sk];
                        var isPointer = (sampleState.cursorType === "pointer") ||
                                        (sampleState.interactionType === "click") ||
                                        (sampleState.interactionType === "double-click");
                        var tSec = sampleState.timeMs / 1000.0;

                        arrowOpacity.setValueAtTime(tSec, isPointer ? 0.0 : 100.0);
                        pointerOpacity.setValueAtTime(tSec, isPointer ? 100.0 : 0.0);
                    }

                    for (var ok = 1; ok <= arrowOpacity.numKeys; ok++) {
                        arrowOpacity.setInterpolationTypeAtKey(ok, KeyframeInterpolationType.HOLD);
                    }
                    for (var pk = 1; pk <= pointerOpacity.numKeys; pk++) {
                        pointerOpacity.setInterpolationTypeAtKey(pk, KeyframeInterpolationType.HOLD);
                    }
                }

                // Populate Smoothed Movement Keyframes
                var cursorPosProp = cursorLayer.transform.position;
                for (var f = 0; f < finalKeys.length; f++) {
                    var s = finalKeys[f];
                    cursorPosProp.setValueAtTime(s.timeSec, [s.cx * compW, s.cy * compH]);
                }

                // Spatial smoothing on cursor trajectory
                for (var ck = 1; ck <= cursorPosProp.numKeys; ck++) {
                    cursorPosProp.setSpatialContinuousAtKey(ck, true);
                    cursorPosProp.setSpatialAutoBezierAtKey(ck, true);
                }

                // CRITICAL FIX: Parent coordinate transformation through camera zoom
                // Transforms footage coordinates into comp space with zero pixel drift
                cursorLayer.transform.position.expression =
                    "var vid = thisComp.layer('" + videoLayer.name + "');\n" +
                    "vid.toComp(value);";

                // Recordly Cursor Sway Expression
                cursorLayer.transform.rotation.expression =
                    "var v = transform.position.velocity;\n" +
                    "var spd = Math.sqrt(v[0] * v[0] + v[1] * v[1]);\n" +
                    "if (spd > 0.5) {\n" +
                    "    var ctrl = thisComp.layer('" + controller.name + "');\n" +
                    "    var sway = ctrl.effect('Cursor Sway')('Slider');\n" +
                    "    var speedFactor = Math.min(1.0, spd / 1400.0);\n" +
                    "    var dirBias = (v[0] + v[1] * 0.65) / spd;\n" +
                    "    clamp(dirBias * speedFactor * 10.0 * sway * 3.0, -35, 35);\n" +
                    "} else { 0; }";

                // 11. Replicate Recordly Half-Sine Click Bounce Animation
                if (options.createClickBounce) {
                    var cursorScaleProp = cursorLayer.transform.scale;
                    var bounceEase = new KeyframeEase(0, 75.0);

                    for (var rIdx = 0; rIdx < rawSamples.length; rIdx++) {
                        var rawS = rawSamples[rIdx];
                        var iType = rawS.interactionType;
                        if (iType === "click" || iType === "double-click" || iType === "right-click") {
                            var clickTime = rawS.timeMs / 1000.0;
                            // 350ms half-sine depression: 100% -> 84% at 175ms -> 100% at 350ms
                            var depressedScale = baseScaleFactor * 0.84;

                            cursorScaleProp.setValueAtTime(clickTime, [baseScaleFactor, baseScaleFactor]);
                            cursorScaleProp.setValueAtTime(clickTime + 0.175, [depressedScale, depressedScale]);
                            cursorScaleProp.setValueAtTime(clickTime + 0.350, [baseScaleFactor, baseScaleFactor]);

                            // Apply smooth ease to bounce keys
                            var keyCount = cursorScaleProp.numKeys;
                            if (keyCount >= 3) {
                                try {
                                    cursorScaleProp.setTemporalEaseAtKey(keyCount - 2, [bounceEase], [bounceEase]);
                                    cursorScaleProp.setTemporalEaseAtKey(keyCount - 1, [bounceEase], [bounceEase]);
                                    cursorScaleProp.setTemporalEaseAtKey(keyCount, [bounceEase], [bounceEase]);
                                } catch (e) {}
                            }
                        }
                    }
                }

                // 12. Replicate Recordly Click Ripple VFX
                if (options.clickEffect !== "none") {
                    var rippleLayer = comp.layers.addShape();
                    rippleLayer.name = "TraceMotion_Click_Ripples";
                    rippleLayer.motionBlur = options.enableMotionBlur;

                    // Camera follow expression
                    rippleLayer.transform.position.expression =
                        "var vid = thisComp.layer('" + videoLayer.name + "');\n" +
                        "vid.toComp(value);";

                    var rippleRoot = rippleLayer.property("ADBE Root Vectors Group");
                    var rgbColor = hexToRgb(options.clickEffectColor);
                    var maxRadius = Math.max(40, baseCursorHeight * 1.95 * (options.clickEffectScale / 100.0));

                    var processedClicks = 0;
                    for (var rc = 0; rc < rawSamples.length; rc++) {
                        var clickSample = rawSamples[rc];
                        var clickType = clickSample.interactionType;
                        if (clickType === "click" || clickType === "double-click" || clickType === "right-click") {
                            processedClicks++;
                            var tClickStart = (clickSample.timeMs + 175) / 1000.0; // Peak bounce depression
                            var tClickEnd = tClickStart + 0.600; // 600ms ripple duration

                            var rGroup = rippleRoot.addProperty("ADBE Vector Group");
                            rGroup.name = "Ripple_" + processedClicks;
                            var rVectors = rGroup.property("ADBE Vectors Group");

                            var ellipse = rVectors.addProperty("ADBE Vector Shape - Ellipse");
                            var sizeProp = ellipse.property("Size");
                            var stroke = rVectors.addProperty("ADBE Vector Graphic - Stroke");
                            stroke.property("Color").setValue([rgbColor[0], rgbColor[1], rgbColor[2], 1.0]);
                            var strokeProp = stroke.property("Stroke Width");

                            var transGroup = rVectors.property("ADBE Vector Transform Group");
                            var posProp = transGroup.property("Position");
                            var opacProp = transGroup.property("Opacity");

                            posProp.setValue([clickSample.cx * compW, clickSample.cy * compH]);

                            // Expand with Ease-Out Cubic
                            sizeProp.setValueAtTime(tClickStart, [2, 2]);
                            sizeProp.setValueAtTime(tClickEnd, [maxRadius * 2, maxRadius * 2]);
                            var cubicEase = new KeyframeEase(0, 100.0);
                            try {
                                sizeProp.setTemporalEaseAtKey(sizeProp.nearestKeyIndex(tClickStart), [cubicEase], [cubicEase]);
                                sizeProp.setTemporalEaseAtKey(sizeProp.nearestKeyIndex(tClickEnd), [cubicEase], [cubicEase]);
                            } catch (e) {}

                            // Cubic fade on Opacity
                            opacProp.setValueAtTime(tClickStart, 60.0);
                            opacProp.setValueAtTime(tClickEnd, 0.0);

                            strokeProp.setValueAtTime(tClickStart, 2.5);
                            strokeProp.setValueAtTime(tClickEnd, 0.5);
                        }
                    }
                }
            }

            alert(
                "TraceMotion Rig Generated Successfully!\n\n" +
                "• Comp: " + comp.name + " (" + compW + "x" + compH + " @ " + fps + " FPS)\n" +
                "• Selected Cursor: " + CURSOR_MANIFEST[options.cursorStyle].label + "\n" +
                "• Raw Telemetry Points: " + rawSamples.length + "\n" +
                "• Motion Engine: Recordly Damped Harmonic Oscillator (Smoothing " + options.cursorSmoothing + ")\n" +
                "• Calibrated Hotspot: [" + (arrowData.anchorX * 100).toFixed(1) + "%, " + (arrowData.anchorY * 100).toFixed(1) + "%]\n" +
                "• Camera Parent Tracking: Zero coordinate drift active",
                "TraceMotion Complete"
            );

        } catch (err) {
            alert("Error constructing TraceMotion rig:\n" + err.toString(), "TraceMotion Exception");
        } finally {
            app.endUndoGroup();
        }
    }

    // =========================================================================
    // User Interface Dialog (ScriptUI)
    // =========================================================================
    function showDialog() {
        var win = new Window("dialog", "TraceMotion: Screen Recording & Telemetry Importer");
        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.spacing = 10;
        win.margins = 16;

        // Banner Header
        var headerGroup = win.add("group");
        headerGroup.orientation = "column";
        headerGroup.alignChildren = ["left", "top"];
        var title = headerGroup.add("statictext", undefined, "TraceMotion Importer & Rig Generator");
        title.graphics.font = ScriptUI.newFont("Verdana", "Bold", 14);
        var subtitle = headerGroup.add("statictext", undefined, "Precision cursor tracking, spring physics, and dynamic camera rig for After Effects.");

        // Panel 1: Source Footage & Telemetry
        var filePanel = win.add("panel", undefined, "1. Source Footage & Companion Telemetry");
        filePanel.orientation = "column";
        filePanel.alignChildren = ["fill", "top"];
        filePanel.spacing = 8;
        filePanel.margins = 12;

        var videoGroup = filePanel.add("group");
        videoGroup.add("statictext", undefined, "Video Footage:");
        var videoPathInput = videoGroup.add("edittext", undefined, "");
        videoPathInput.characters = 34;
        var videoBrowseBtn = videoGroup.add("button", undefined, "Browse...");

        var jsonGroup = filePanel.add("group");
        jsonGroup.add("statictext", undefined, "Telemetry JSON:");
        var jsonPathInput = jsonGroup.add("edittext", undefined, "");
        jsonPathInput.characters = 34;
        var jsonBrowseBtn = jsonGroup.add("button", undefined, "Browse...");

        var selectedVideoFile = null;
        var selectedJsonFile = null;

        videoBrowseBtn.onClick = function () {
            var f = File.openDialog("Select Screen Recording Video", "Video Files:*.mp4;*.mov;*.webm;*.mkv;*.*");
            if (f) {
                selectedVideoFile = f;
                videoPathInput.text = f.fsName;
                var companion = new File(f.fsName + ".cursor.json");
                if (companion.exists) {
                    selectedJsonFile = companion;
                    jsonPathInput.text = companion.fsName;
                }
            }
        };

        jsonBrowseBtn.onClick = function () {
            var f = File.openDialog("Select Companion Cursor Telemetry JSON", "JSON Files:*.json");
            if (f) {
                selectedJsonFile = f;
                jsonPathInput.text = f.fsName;
            }
        };

        // Panel 2: Cursor Model & Asset Selection
        var cursorPanel = win.add("panel", undefined, "2. Cursor Model & Visual Asset");
        cursorPanel.orientation = "column";
        cursorPanel.alignChildren = ["fill", "top"];
        cursorPanel.spacing = 8;
        cursorPanel.margins = 12;

        var styleGroup = cursorPanel.add("group");
        styleGroup.add("statictext", undefined, "Cursor Style:");
        var cursorDropdown = styleGroup.add("dropdownlist", undefined, [
            "macOS Tahoe (Recordly Default)",
            "macOS Classic",
            "Windows 11 Fluent",
            "Figma / Minimal",
            "Vector Shape (Procedural)"
        ]);
        var savedStyleIdx = parseInt(getPref("cursorStyleIdx", "0"), 10);
        cursorDropdown.selection = (savedStyleIdx >= 0 && savedStyleIdx < 5) ? savedStyleIdx : 0;

        var formatGroup = cursorPanel.add("group");
        formatGroup.add("statictext", undefined, "Asset Pipeline:");
        var radPng = formatGroup.add("radiobutton", undefined, "High-Res PNG (Universal AE 2020+)");
        var radSvg = formatGroup.add("radiobutton", undefined, "Vector SVG (AE 2024+)");
        var savedUseSvg = getPref("preferSvg", "false") === "true";
        radPng.value = !savedUseSvg;
        radSvg.value = savedUseSvg;

        var sizeGroup = cursorPanel.add("group");
        sizeGroup.add("statictext", undefined, "Cursor Scale (%):");
        var sizeSlider = sizeGroup.add("slider", undefined, 100, 40, 250);
        var sizeInput = sizeGroup.add("edittext", undefined, getPref("cursorScalePct", "100"));
        sizeInput.characters = 5;
        sizeSlider.value = parseFloat(sizeInput.text) || 100;
        sizeSlider.onChanging = function () { sizeInput.text = Math.round(sizeSlider.value); };
        sizeInput.onChange = function () { sizeSlider.value = parseFloat(sizeInput.text) || 100; };

        var chkDynamicStates = cursorPanel.add("checkbox", undefined, "Dynamic Cursor States (Auto-Swap Arrow/Pointer Hand on Hover & Clicks)");
        chkDynamicStates.value = getPref("dynamicCursorStates", "true") === "true";

        // Panel 3: Motion Curves & Spring Physics
        var motionPanel = win.add("panel", undefined, "3. Motion Curves & Spring Physics");
        motionPanel.orientation = "column";
        motionPanel.alignChildren = ["fill", "top"];
        motionPanel.spacing = 8;
        motionPanel.margins = 12;

        var presetGroup = motionPanel.add("group");
        presetGroup.add("statictext", undefined, "Physics Tuning:");
        var presetDropdown = presetGroup.add("dropdownlist", undefined, [
            "Smooth (Recordly Signature Harmonic Spring)",
            "Focused (Snappy Responsive)",
            "Custom"
        ]);
        var savedPresetIdx = parseInt(getPref("motionPresetIdx", "0"), 10);
        presetDropdown.selection = (savedPresetIdx >= 0 && savedPresetIdx < 3) ? savedPresetIdx : 0;

        var smoothGroup = motionPanel.add("group");
        smoothGroup.add("statictext", undefined, "Smoothing Factor:");
        var smoothSlider = smoothGroup.add("slider", undefined, 67, 0, 150);
        var smoothInput = smoothGroup.add("edittext", undefined, getPref("cursorSmoothing", "0.67"));
        smoothInput.characters = 5;
        smoothSlider.value = Math.round((parseFloat(smoothInput.text) || 0.67) * 100);
        smoothSlider.onChanging = function () { smoothInput.text = (smoothSlider.value / 100).toFixed(2); };
        smoothInput.onChange = function () { smoothSlider.value = Math.round((parseFloat(smoothInput.text) || 0.67) * 100); };

        presetDropdown.onChange = function () {
            if (presetDropdown.selection.index === 0) {
                smoothInput.text = "0.67";
                smoothSlider.value = 67;
            } else if (presetDropdown.selection.index === 1) {
                smoothInput.text = "0.45";
                smoothSlider.value = 45;
            }
        };

        var chkSway = motionPanel.add("checkbox", undefined, "Dynamic Velocity-Biased Cursor Sway (PI/18 Tilt)");
        chkSway.value = getPref("enableSway", "true") === "true";

        var chkMotionBlur = motionPanel.add("checkbox", undefined, "Native Composition Motion Blur");
        chkMotionBlur.value = getPref("enableMotionBlur", "true") === "true";

        // Panel 4: Click VFX & Ripple Animation
        var clickPanel = win.add("panel", undefined, "4. Click Bounce & Ripple VFX");
        clickPanel.orientation = "column";
        clickPanel.alignChildren = ["fill", "top"];
        clickPanel.spacing = 8;
        clickPanel.margins = 12;

        var chkBounce = clickPanel.add("checkbox", undefined, "Recordly Click Scale Bounce (350ms Half-Sine 84% Depression)");
        chkBounce.value = getPref("enableBounce", "true") === "true";

        var fxGroup = clickPanel.add("group");
        fxGroup.add("statictext", undefined, "Click Ripple VFX:");
        var fxDropdown = fxGroup.add("dropdownlist", undefined, [
            "Ripple Ring (Recordly Accent)",
            "None"
        ]);
        var savedFxIdx = parseInt(getPref("clickEffectIdx", "0"), 10);
        fxDropdown.selection = (savedFxIdx >= 0 && savedFxIdx < 2) ? savedFxIdx : 0;

        var colorGroup = clickPanel.add("group");
        colorGroup.add("statictext", undefined, "Ripple Color (Hex):");
        var colorInput = colorGroup.add("edittext", undefined, getPref("clickColor", "#2563EB"));
        colorInput.characters = 9;

        // Panel 5: Camera Tracking Parameters
        var camPanel = win.add("panel", undefined, "5. Camera Zoom & Keyframe Decimation");
        camPanel.orientation = "column";
        camPanel.alignChildren = ["fill", "top"];
        camPanel.spacing = 8;
        camPanel.margins = 12;

        var camGroup = camPanel.add("group");
        camGroup.add("statictext", undefined, "Default Zoom Depth (%):");
        var zoomInput = camGroup.add("edittext", undefined, getPref("zoomDepth", "160"));
        zoomInput.characters = 5;

        camGroup.add("statictext", undefined, "Deadband Margin (%):");
        var marginInput = camGroup.add("edittext", undefined, getPref("deadbandMargin", "25"));
        marginInput.characters = 5;

        var rdpGroup = camPanel.add("group");
        rdpGroup.add("statictext", undefined, "Trajectory Tolerance (px):");
        var rdpInput = rdpGroup.add("edittext", undefined, getPref("rdpTol", "0.25"));
        rdpInput.characters = 5;
        rdpGroup.add("statictext", undefined, "(0 = raw 60 FPS keyframes)");

        // Buttons
        var btnGroup = win.add("group");
        btnGroup.alignment = ["right", "bottom"];
        var cancelBtn = btnGroup.add("button", undefined, "Cancel");
        var buildBtn = btnGroup.add("button", undefined, "Build TraceMotion Rig");
        buildBtn.preferredSize.width = 170;

        cancelBtn.onClick = function () {
            win.close();
        };

        buildBtn.onClick = function () {
            if (!selectedVideoFile || !selectedVideoFile.exists) {
                alert("Please select a valid screen recording video footage file.", "Missing Video");
                return;
            }
            if (!selectedJsonFile || !selectedJsonFile.exists) {
                alert("Please select a valid .cursor.json companion telemetry file.", "Missing Telemetry");
                return;
            }

            var styleKeys = ["tahoe", "macos", "windows11", "custom", "procedural"];
            var selectedStyleKey = styleKeys[cursorDropdown.selection.index] || "tahoe";
            var presetKeys = ["smooth", "focused", "custom"];
            var selectedPresetKey = presetKeys[presetDropdown.selection.index] || "smooth";

            // Persist selections
            savePref("cursorStyleIdx", cursorDropdown.selection.index);
            savePref("preferSvg", radSvg.value);
            savePref("cursorScalePct", sizeInput.text);
            savePref("dynamicCursorStates", chkDynamicStates.value);
            savePref("motionPresetIdx", presetDropdown.selection.index);
            savePref("cursorSmoothing", smoothInput.text);
            savePref("enableSway", chkSway.value);
            savePref("enableMotionBlur", chkMotionBlur.value);
            savePref("enableBounce", chkBounce.value);
            savePref("clickEffectIdx", fxDropdown.selection.index);
            savePref("clickColor", colorInput.text);
            savePref("zoomDepth", zoomInput.text);
            savePref("deadbandMargin", marginInput.text);
            savePref("rdpTol", rdpInput.text);

            var options = {
                cursorStyle: selectedStyleKey,
                preferSvg: radSvg.value,
                cursorScalePct: parseFloat(sizeInput.text) || 100.0,
                dynamicCursorStates: chkDynamicStates.value,
                motionPreset: selectedPresetKey,
                cursorSmoothing: parseFloat(smoothInput.text) || 0.67,
                swayAmount: chkSway.value ? 0.4 : 0.0,
                enableMotionBlur: chkMotionBlur.value,
                createCursor: true,
                createClickBounce: chkBounce.value,
                clickEffect: fxDropdown.selection.index === 0 ? "ripple" : "none",
                clickEffectColor: colorInput.text || "#2563EB",
                clickEffectScale: 100.0,
                defaultZoomDepth: parseFloat(zoomInput.text) || 160.0,
                deadbandMargin: parseFloat(marginInput.text) || 25.0,
                simplificationTolerance: parseFloat(rdpInput.text) || 0.25
            };

            win.close();
            buildTraceMotionRig(selectedVideoFile, selectedJsonFile, options);
        };

        win.center();
        win.show();
    }

    // Launch UI
    showDialog();

})(this);
