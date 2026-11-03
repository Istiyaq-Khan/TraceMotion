/**
 * TraceMotion Importer & Rig Generator for Adobe After Effects
 * 
 * Ingests screen recordings and synchronized mouse telemetry (.cursor.json)
 * captured via OBS Studio or Recordly. Reconstructs dynamic camera zooms, deadband
 * safe zones, damped harmonic oscillator spring smoothing, authentic system cursor assets
 * (macOS Tahoe, macOS Classic, Windows 11 Fluent, Figma), automatic macOS window framing,
 * rounded corner track mattes, multi-stage soft drop shadows, and click ripple VFX.
 *
 * Compatible with Adobe After Effects CC 2020 through CC 2026+ (ES3/ES5 ExtendScript)
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

    if (!Array.prototype.filter) {
        Array.prototype.filter = function (fn, thisArg) {
            if (this === null) throw new TypeError();
            var t = Object(this);
            var len = t.length >>> 0;
            if (typeof fn !== "function") throw new TypeError();
            var res = [];
            for (var i = 0; i < len; i++) {
                if (i in t) {
                    var val = t[i];
                    if (fn.call(thisArg, val, i, t)) res.push(val);
                }
            }
            return res;
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
        var cleanHex = String(hex).replace("#", "");
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

    var PREF_SECTION = "TraceMotion_Preferences_v3";
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
    // Safe Property & Defensive ExtendScript Access Layer
    // =========================================================================
    var SafeProp = {
        find: function (parent, matchNames, fallbackIndex) {
            if (!parent) return null;
            if (typeof matchNames === "string") matchNames = [matchNames];
            for (var i = 0; i < matchNames.length; i++) {
                try {
                    var p = parent.property(matchNames[i]);
                    if (p) return p;
                } catch (e) {}
            }
            if (fallbackIndex !== undefined) {
                try {
                    var pIdx = parent.property(fallbackIndex);
                    if (pIdx) return pIdx;
                } catch (e) {}
            }
            return null;
        },
        findFresh: function (root, pathNames) {
            if (!root) return null;
            var curr = root;
            for (var i = 0; i < pathNames.length; i++) {
                try {
                    curr = curr.property(pathNames[i]);
                    if (!curr) return null;
                } catch (e) {
                    return null;
                }
            }
            return curr;
        },
        setExpression: function (prop, expr) {
            if (!prop) return false;
            try {
                prop.expression = expr;
                return true;
            } catch (e) {
                return false;
            }
        },
        setValue: function (prop, val) {
            if (!prop) return;
            try { prop.setValue(val); } catch (e) {}
        },
        setValueAtTime: function (prop, time, val) {
            if (!prop) return;
            try { prop.setValueAtTime(time, val); } catch (e) {}
        },
        getNumKeys: function (prop) {
            if (!prop) return 0;
            try { return prop.numKeys || 0; } catch (e) { return 0; }
        },
        setTemporalEase: function (prop, keyIdx, inEase, outEase) {
            if (!prop) return;
            var totalK = SafeProp.getNumKeys(prop);
            if (keyIdx < 1 || keyIdx > totalK) return;
            try {
                var val = prop.keyValue(keyIdx);
                if (val instanceof Array) {
                    if (val.length === 2) {
                        prop.setTemporalEaseAtKey(keyIdx, [inEase, inEase], [outEase, outEase]);
                    } else if (val.length === 3) {
                        prop.setTemporalEaseAtKey(keyIdx, [inEase, inEase, inEase], [outEase, outEase, outEase]);
                    } else {
                        prop.setTemporalEaseAtKey(keyIdx, [inEase], [outEase]);
                    }
                } else {
                    prop.setTemporalEaseAtKey(keyIdx, [inEase], [outEase]);
                }
            } catch (e) {}
        }
    };

    function ensureProject() {
        if (!app.project) {
            app.newProject();
        }
        return app.project;
    }

    function getActiveComp() {
        if (app.project && app.project.activeItem && (app.project.activeItem instanceof CompItem)) {
            return app.project.activeItem;
        }
        return null;
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
                    filePng: "",
                    fileSvg: "",
                    anchorX: 0.00,
                    anchorY: 0.00
                },
                pointer: {
                    filePng: "",
                    fileSvg: "",
                    anchorX: 0.00,
                    anchorY: 0.00
                }
            }
        }
    };

    // Locate cursor assets directory safely across dialog, palette, and CEP contexts
    function getCursorAssetFile(styleId, cursorType, preferSvg) {
        var style = CURSOR_MANIFEST[styleId] || CURSOR_MANIFEST.tahoe;
        if (!style || !style.folder) return null; // Procedural
        var cData = (style.cursors && style.cursors[cursorType]) || (style.cursors && style.cursors.arrow);
        if (!cData) return null;

        var searchDirs = [];
        try {
            if (typeof $.fileName !== "undefined" && $.fileName) {
                var scriptF = new File($.fileName);
                if (scriptF && scriptF.parent && scriptF.parent.exists) {
                    searchDirs.push(scriptF.parent.fsName + "/assets/cursors/" + style.folder + "/");
                }
            }
        } catch (e) {}

        searchDirs.push("D:/all my code/TraceMotion/after-effects-importer/assets/cursors/" + style.folder + "/");
        searchDirs.push(Folder.userData.fsName + "/Adobe/After Effects/TraceMotion/assets/cursors/" + style.folder + "/");

        for (var d = 0; d < searchDirs.length; d++) {
            var baseDir = searchDirs[d];
            var primaryFile = preferSvg ? new File(baseDir + cData.fileSvg) : new File(baseDir + cData.filePng);
            if (primaryFile && primaryFile.exists) return primaryFile;

            var altFile = preferSvg ? new File(baseDir + cData.filePng) : new File(baseDir + cData.fileSvg);
            if (altFile && altFile.exists) return altFile;
        }

        return null;
    }

    // Locate downscaled preview image for ScriptUI preview box
    function getCursorPreviewFile(styleId) {
        var searchDirs = [];
        try {
            if (typeof $.fileName !== "undefined" && $.fileName) {
                var scriptF = new File($.fileName);
                if (scriptF && scriptF.parent && scriptF.parent.exists) {
                    searchDirs.push(scriptF.parent.fsName + "/assets/cursors/previews/" + styleId + "_preview.png");
                }
            }
        } catch (e) {}

        searchDirs.push("D:/all my code/TraceMotion/after-effects-importer/assets/cursors/previews/" + styleId + "_preview.png");
        searchDirs.push(Folder.userData.fsName + "/Adobe/After Effects/TraceMotion/assets/cursors/previews/" + styleId + "_preview.png");

        for (var i = 0; i < searchDirs.length; i++) {
            var f = new File(searchDirs[i]);
            if (f && f.exists) return f;
        }

        return getCursorAssetFile(styleId, "arrow", false);
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
    // Recordly Smart Zoom & Cluster Detection Engine
    // =========================================================================
    function buildRecordlyZoomClusters(rawSamples, durationSec, zoomScale) {
        var totalMs = durationSec * 1000.0;
        var mergeGapMs = 2500;
        var padMs = 500;
        var dwellMinMs = 450;
        var dwellMaxMs = 2600;
        var dwellMoveThresh = 0.02;

        var candidates = [];

        // 1. Explicit Clicks from Telemetry
        for (var i = 0; i < rawSamples.length; i++) {
            var s = rawSamples[i];
            var it = s.interactionType;
            if (it === "click" || it === "double-click" || it === "right-click" || it === "middle-click") {
                candidates.push({
                    timeMs: s.timeMs,
                    cx: s.cx,
                    cy: s.cy,
                    strength: it === "double-click" ? 1500 : 1000,
                    isExplicit: true
                });
            }
        }

        // 2. Dwell Heuristic Candidates (mouse stationary)
        var runStart = 0;
        for (var j = 1; j < rawSamples.length; j++) {
            var prev = rawSamples[j - 1];
            var curr = rawSamples[j];
            var dist = Math.sqrt(Math.pow(curr.cx - prev.cx, 2) + Math.pow(curr.cy - prev.cy, 2));
            if (dist > dwellMoveThresh) {
                var rLen = j - runStart;
                if (rLen >= 2) {
                    var startS = rawSamples[runStart];
                    var endS = rawSamples[j - 1];
                    var runDur = endS.timeMs - startS.timeMs;
                    if (runDur >= dwellMinMs && runDur <= dwellMaxMs) {
                        var sumX = 0, sumY = 0;
                        for (var r = runStart; r < j; r++) {
                            sumX += rawSamples[r].cx;
                            sumY += rawSamples[r].cy;
                        }
                        candidates.push({
                            timeMs: Math.round((startS.timeMs + endS.timeMs) / 2),
                            cx: sumX / rLen,
                            cy: sumY / rLen,
                            strength: runDur,
                            isExplicit: false
                        });
                    }
                }
                runStart = j;
            }
        }

        if (candidates.length === 0) return [];

        candidates.sort(function (a, b) { return a.timeMs - b.timeMs; });

        // 3. Merge Clusters within mergeGapMs
        var clusters = [];
        var curStart = candidates[0].timeMs;
        var curEnd = candidates[0].timeMs;
        var bestStrength = candidates[0].strength;
        var bestCx = candidates[0].cx;
        var bestCy = candidates[0].cy;
        var sumCx = candidates[0].cx;
        var sumCy = candidates[0].cy;
        var count = 1;

        for (var k = 1; k < candidates.length; k++) {
            var c = candidates[k];
            var gap = c.timeMs - curEnd;
            if (gap <= mergeGapMs) {
                curEnd = Math.max(curEnd, c.timeMs);
                if (c.strength > bestStrength) {
                    bestStrength = c.strength;
                    bestCx = c.cx;
                    bestCy = c.cy;
                }
                sumCx += c.cx;
                sumCy += c.cy;
                count++;
            } else {
                clusters.push({
                    startMs: Math.max(0, curStart - padMs),
                    endMs: Math.min(totalMs, curEnd + padMs),
                    cx: bestCx !== undefined ? bestCx : (sumCx / count),
                    cy: bestCy !== undefined ? bestCy : (sumCy / count)
                });
                curStart = c.timeMs;
                curEnd = c.timeMs;
                bestStrength = c.strength;
                bestCx = c.cx;
                bestCy = c.cy;
                sumCx = c.cx;
                sumCy = c.cy;
                count = 1;
            }
        }

        clusters.push({
            startMs: Math.max(0, curStart - padMs),
            endMs: Math.min(totalMs, curEnd + padMs),
            cx: bestCx !== undefined ? bestCx : (sumCx / count),
            cy: bestCy !== undefined ? bestCy : (sumCy / count)
        });

        // 4. Clamp focus to Recordly viewport safety bounds
        var marginX = 1.0 / (2.0 * zoomScale);
        var marginY = 1.0 / (2.0 * zoomScale);
        for (var cl = 0; cl < clusters.length; cl++) {
            var clItem = clusters[cl];
            clItem.cx = Math.max(marginX, Math.min(1.0 - marginX, clItem.cx));
            clItem.cy = Math.max(marginY, Math.min(1.0 - marginY, clItem.cy));
            clItem.startSec = clItem.startMs / 1000.0;
            clItem.endSec = clItem.endMs / 1000.0;
        }

        return clusters;
    }

    // =========================================================================
    // Backdrop Gradient Color Presets
    // =========================================================================
    var BACKGROUND_PRESETS = {
        "tahoe-dawn": {
            label: "Tahoe Dawn (Electric Blue / Warm Violet)",
            start: [0.231, 0.510, 0.965], // #3B82F6
            end: [0.545, 0.361, 0.965],   // #8B5CF6
            solid: "#1E1B4B",
            isRadial: false
        },
        "dark-studio": {
            label: "Dark Studio (Charcoal / Deep Black)",
            start: [0.120, 0.120, 0.135], // #1F1F23
            end: [0.045, 0.045, 0.055],   // #0C0C0E
            solid: "#0F0F12",
            isRadial: true
        },
        "midnight-deep": {
            label: "Midnight Deep (Slate Navy / Indigo)",
            start: [0.090, 0.125, 0.220], // #172038
            end: [0.040, 0.055, 0.110],   // #0A0E1C
            solid: "#0A0E1C",
            isRadial: true
        },
        "sequoia-azure": {
            label: "Sequoia Azure (Vibrant Azure Cobalt)",
            start: [0.145, 0.388, 0.922], // #2563EB
            end: [0.090, 0.225, 0.540],   // #173A8A
            solid: "#10234E",
            isRadial: false
        },
        "solid-charcoal": {
            label: "Clean Charcoal Solid",
            start: [0.118, 0.118, 0.125], // #1E1E20
            end: [0.118, 0.118, 0.125],
            solid: "#1E1E20",
            isRadial: false
        },
        "none": {
            label: "Transparent / None (Edge-to-Edge)",
            start: [0, 0, 0],
            end: [0, 0, 0],
            solid: "#000000",
            isRadial: false
        }
    };

    // =========================================================================
    // Main Rig Generation Core (Defensive Architecture - Zero Object Invalidation)
    // =========================================================================
    function buildTraceMotionRig(videoFile, telemetryFile, options) {
        var proj = ensureProject();
        var undoStarted = false;

        try {
            app.beginUndoGroup("Build TraceMotion Rig");
            undoStarted = true;

            // 1. Read and parse JSON telemetry
            if (!telemetryFile || !telemetryFile.exists) {
                alert("Telemetry JSON file does not exist: " + (telemetryFile ? telemetryFile.fsName : "null"), "TraceMotion Error");
                return;
            }
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
            if (!videoFile || !videoFile.exists) {
                alert("Video footage file does not exist: " + (videoFile ? videoFile.fsName : "null"), "TraceMotion Error");
                return;
            }
            var importOpts = new ImportOptions(videoFile);
            var footageItem = proj.importFile(importOpts);
            if (!footageItem) {
                alert("Failed to import video footage into project.", "Import Error");
                return;
            }

            var footageW = footageItem.width;
            var footageH = footageItem.height;
            var duration = footageItem.duration;
            var fps = footageItem.frameRate || 60;

            // 3. Canvas Sizing with Breathing Room Margin
            var marginPct = Math.max(0, Math.min(30, options.canvasMargin || 12));
            var marginScaleFactor = 1.0 + (marginPct / 100.0) * 0.5;
            var compW = Math.round(footageW * marginScaleFactor);
            var compH = Math.round(footageH * marginScaleFactor);

            if (compW % 2 !== 0) compW++;
            if (compH % 2 !== 0) compH++;

            // 4. Create Composition
            var baseName = footageItem.name.replace(/\.[^\.]+$/, "");
            var comp = proj.items.addComp(
                baseName + "_TraceMotion",
                compW,
                compH,
                1.0,
                duration,
                fps
            );
            try { comp.openInViewer(); } catch (viewerErr) {}
            comp.motionBlur = options.enableMotionBlur;

            // -----------------------------------------------------------------
            // RIG LAYER STACK BUILD (Constructed in Natural Bottom-to-Top Order)
            // Layer 6 (Bottom): Background Solid (Gradient Ramp)
            // Layer 5: Clean Video Footage
            // Layer 4: Window Track Matte (Shape Layer with Roundness)
            // Layer 3: Master Camera Controller Null
            // Layer 2: Calibrated Cursor Layer
            // Layer 1 (Top): Click Ripple VFX
            // -----------------------------------------------------------------

            // 5. Layer 6 (Bottom): Add Background Layer (Never locked prematurely)
            var bgPresetKey = options.backgroundPreset || "tahoe-dawn";
            var bgData = BACKGROUND_PRESETS[bgPresetKey] || BACKGROUND_PRESETS["tahoe-dawn"];
            var bgLayer = null;

            if (bgPresetKey !== "none") {
                bgLayer = comp.layers.addSolid(bgData.start, "TraceMotion_Background", compW, compH, 1.0, duration);

                var bgFx = bgLayer.property("ADBE Effect Parade");
                var ramp = bgFx.addProperty("ADBE Ramp");
                ramp.name = "Background Gradient";

                var rStartPt = SafeProp.find(ramp, ["ADBE Ramp-0001", "Start of Ramp"], 1);
                var rStartCol = SafeProp.find(ramp, ["ADBE Ramp-0002", "Start Color"], 2);
                var rEndPt = SafeProp.find(ramp, ["ADBE Ramp-0003", "End of Ramp"], 3);
                var rEndCol = SafeProp.find(ramp, ["ADBE Ramp-0004", "End Color"], 4);
                var rShape = SafeProp.find(ramp, ["ADBE Ramp-0005", "Ramp Shape"], 5);

                if (bgData.isRadial) {
                    SafeProp.setValue(rStartPt, [compW * 0.5, compH * 0.45]);
                    SafeProp.setValue(rEndPt, [compW * 0.9, compH * 0.9]);
                    SafeProp.setValue(rShape, 2); // Radial Ramp
                } else {
                    SafeProp.setValue(rStartPt, [compW * 0.2, compH * 0.1]);
                    SafeProp.setValue(rEndPt, [compW * 0.8, compH * 0.9]);
                    SafeProp.setValue(rShape, 1); // Linear Ramp
                }
                SafeProp.setValue(rStartCol, bgData.start);
                SafeProp.setValue(rEndCol, bgData.end);
            }

            // 6. Layer 5: Add Screen Recording Video Layer
            var videoLayer = comp.layers.add(footageItem);
            videoLayer.name = "Clean_Screen_Capture";
            videoLayer.motionBlur = options.enableMotionBlur;

            // Apply Multi-Stage Drop Shadows to videoLayer
            var videoFx = videoLayer.property("ADBE Effect Parade");

            // Shadow 1: Ambient Soft Diffusion
            var shadow1 = videoFx.addProperty("ADBE Drop Shadow");
            shadow1.name = "Window Drop Shadow (Ambient)";
            var s1Dist = SafeProp.find(shadow1, ["ADBE Drop Shadow-0003", "Distance"], 3);
            SafeProp.setValue(s1Dist, 20);
            var s1Soft = SafeProp.find(shadow1, ["ADBE Drop Shadow-0004", "Softness"], 4);
            SafeProp.setValue(s1Soft, 56);
            var s1Opac = SafeProp.find(shadow1, ["ADBE Drop Shadow-0002", "Opacity"], 2);
            SafeProp.setValue(s1Opac, Math.round((options.shadowIntensity || 65) * 0.70));
            var s1Dir = SafeProp.find(shadow1, ["ADBE Drop Shadow-0005", "Direction"], 5);
            SafeProp.setValue(s1Dir, 180);

            // Shadow 2: Contact Crisp Depth
            var shadow2 = videoFx.addProperty("ADBE Drop Shadow");
            shadow2.name = "Window Drop Shadow (Contact)";
            var s2Dist = SafeProp.find(shadow2, ["ADBE Drop Shadow-0003", "Distance"], 3);
            SafeProp.setValue(s2Dist, 5);
            var s2Soft = SafeProp.find(shadow2, ["ADBE Drop Shadow-0004", "Softness"], 4);
            SafeProp.setValue(s2Soft, 16);
            var s2Opac = SafeProp.find(shadow2, ["ADBE Drop Shadow-0002", "Opacity"], 2);
            SafeProp.setValue(s2Opac, Math.round((options.shadowIntensity || 65) * 0.40));
            var s2Dir = SafeProp.find(shadow2, ["ADBE Drop Shadow-0005", "Direction"], 5);
            SafeProp.setValue(s2Dir, 180);

            // 7. Layer 4: Create Window Track Matte Layer (Rounded Corners)
            // Added immediately after videoLayer so it is directly above videoLayer (Index 1 vs Index 2)
            var matteLayer = comp.layers.addShape();
            matteLayer.name = "TraceMotion_Window_Matte";
            matteLayer.guideLayer = false;

            var mRoot = matteLayer.property("ADBE Root Vectors Group");
            var mGrp = mRoot.addProperty("ADBE Vector Group");
            mGrp.name = "Window Bounds";
            var mVecs = mGrp.property("ADBE Vectors Group");

            var mRect = mVecs.addProperty("ADBE Vector Shape - Rect");
            var rectSizeProp = SafeProp.find(mRect, ["ADBE Vector Rect Size", "Size", "Größe", "Taille"], 1);
            SafeProp.setValue(rectSizeProp, [footageW, footageH]);
            var rectRoundProp = SafeProp.find(mRect, ["ADBE Vector Rect Roundness", "Roundness", "Rundung", "Rayon"], 3);
            SafeProp.setValue(rectRoundProp, options.cornerRadius || 20);

            var mFill = mVecs.addProperty("ADBE Vector Graphic - Fill");
            var fillColProp = SafeProp.find(mFill, ["ADBE Vector Fill Color", "Color", "Farbe", "Couleur"], 1);
            SafeProp.setValue(fillColProp, [1.0, 1.0, 1.0, 1.0]);

            // Set Alpha Track Matte on video layer (native in AE 2020 through 2026+)
            try {
                if (typeof videoLayer.setTrackMatte === "function") {
                    videoLayer.setTrackMatte(matteLayer, TrackMatteType.ALPHA);
                } else {
                    videoLayer.trackMatteType = TrackMatteType.ALPHA;
                }
            } catch (matteErr) {}

            // 8. Layer 3: Create Master Camera Controller Null
            var controller = comp.layers.addNull();
            controller.name = "TraceMotion_Camera_Controller";
            controller.guideLayer = true;

            var fxParade = controller.property("ADBE Effect Parade");

            var zoomSlider = fxParade.addProperty("ADBE Slider Control");
            zoomSlider.name = "Zoom Scale";

            var marginSlider = fxParade.addProperty("ADBE Slider Control");
            marginSlider.name = "Canvas Margin";

            var cornerSlider = fxParade.addProperty("ADBE Slider Control");
            cornerSlider.name = "Corner Radius";

            var shadowSlider = fxParade.addProperty("ADBE Slider Control");
            shadowSlider.name = "Shadow Intensity";

            var swaySlider = fxParade.addProperty("ADBE Slider Control");
            swaySlider.name = "Cursor Sway";

            var camFocusCtrl = fxParade.addProperty("ADBE Point Control");
            camFocusCtrl.name = "Camera Focus";

            // Query properties freshly now that all effects exist on the controller
            var fxParadeFresh = controller.property("ADBE Effect Parade");
            var zoomProp = SafeProp.find(fxParadeFresh.property("Zoom Scale"), ["ADBE Slider Control-0001", "Slider"], 1);
            var marginProp = SafeProp.find(fxParadeFresh.property("Canvas Margin"), ["ADBE Slider Control-0001", "Slider"], 1);
            var cornerProp = SafeProp.find(fxParadeFresh.property("Corner Radius"), ["ADBE Slider Control-0001", "Slider"], 1);
            var shadowProp = SafeProp.find(fxParadeFresh.property("Shadow Intensity"), ["ADBE Slider Control-0001", "Slider"], 1);
            var swayProp = SafeProp.find(fxParadeFresh.property("Cursor Sway"), ["ADBE Slider Control-0001", "Slider"], 1);
            var pointProp = SafeProp.find(fxParadeFresh.property("Camera Focus"), ["ADBE Point Control-0001", "Point"], 1);

            SafeProp.setValue(zoomProp, 100);
            SafeProp.setValue(marginProp, marginPct);
            SafeProp.setValue(cornerProp, options.cornerRadius || 20);
            SafeProp.setValue(shadowProp, options.shadowIntensity || 65);
            SafeProp.setValue(swayProp, options.swayAmount || 0.4);
            SafeProp.setValue(pointProp, [footageW / 2, footageH / 2]);

            // Connect Matte Roundness & Shadow Opacities to Controller Sliders
            // Defensive Fresh Querying to Prevent Stale C++ Pointers / 'Object is invalid'
            try {
                var freshRound = SafeProp.findFresh(matteLayer, [
                    "ADBE Root Vectors Group",
                    "Window Bounds",
                    "ADBE Vectors Group",
                    "ADBE Vector Shape - Rect",
                    "ADBE Vector Rect Roundness"
                ]);
                if (!freshRound) {
                    var mRectFresh = SafeProp.findFresh(matteLayer, [
                        "ADBE Root Vectors Group",
                        "Window Bounds",
                        "ADBE Vectors Group",
                        "ADBE Vector Shape - Rect"
                    ]);
                    if (mRectFresh) freshRound = SafeProp.find(mRectFresh, ["ADBE Vector Rect Roundness", "Roundness"], 3);
                }
                if (freshRound) {
                    SafeProp.setExpression(freshRound, "var ctrl = thisComp.layer('" + controller.name + "');\nctrl.effect('Corner Radius')('Slider');");
                }
            } catch (eRound) {}

            try {
                var vFxFresh = videoLayer.property("ADBE Effect Parade");
                if (vFxFresh) {
                    var sh1Fresh = vFxFresh.property("Window Drop Shadow (Ambient)");
                    if (sh1Fresh) {
                        var s1Prop = SafeProp.find(sh1Fresh, ["ADBE Drop Shadow-0002", "Opacity"], 2);
                        if (s1Prop) SafeProp.setExpression(s1Prop, "var ctrl = thisComp.layer('" + controller.name + "');\nctrl.effect('Shadow Intensity')('Slider') * 0.70;");
                    }
                    var sh2Fresh = vFxFresh.property("Window Drop Shadow (Contact)");
                    if (sh2Fresh) {
                        var s2Prop = SafeProp.find(sh2Fresh, ["ADBE Drop Shadow-0002", "Opacity"], 2);
                        if (s2Prop) SafeProp.setExpression(s2Prop, "var ctrl = thisComp.layer('" + controller.name + "');\nctrl.effect('Shadow Intensity')('Slider') * 0.40;");
                    }
                }
            } catch (eShad) {}

            // 9. Recordly Damped Harmonic Oscillator Simulation
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

            var clickTimeMap = {};
            var clickSamplesList = [];
            for (var c = 0; c < rawSamples.length; c++) {
                var sRaw = rawSamples[c];
                var iType = sRaw.interactionType;
                if (iType === "click" || iType === "double-click" || iType === "right-click" || iType === "middle-click") {
                    clickTimeMap[Math.round(sRaw.timeMs)] = true;
                    clickSamplesList.push(sRaw);
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

            var finalKeys = simulatedPath;
            if (options.simplificationTolerance > 0) {
                var normTol = options.simplificationTolerance / Math.max(footageW, footageH);
                finalKeys = rdpSimplify(simulatedPath, normTol);
            }

            // 10. Recordly Smart Zoom & Pan Trajectory
            var targetZoomScale = Math.max(1.0, (options.zoomDepthScale || 1.8));

            if (options.zoomMode === "auto-cluster") {
                var clusters = buildRecordlyZoomClusters(rawSamples, duration, targetZoomScale);
                var easeInOut = new KeyframeEase(0, 84.0);

                SafeProp.setValueAtTime(pointProp, 0, [footageW / 2, footageH / 2]);
                SafeProp.setValueAtTime(zoomProp, 0, 100);

                var zoomTransitionSec = 1.1;
                for (var cl = 0; cl < clusters.length; cl++) {
                    var cluster = clusters[cl];
                    var tStart = cluster.startSec;
                    var tInEnd = Math.min(cluster.endSec, tStart + zoomTransitionSec);
                    var tOutStart = Math.max(tInEnd, cluster.endSec - zoomTransitionSec * 0.85);
                    var tEnd = cluster.endSec;

                    var focusPt = [cluster.cx * footageW, cluster.cy * footageH];

                    SafeProp.setValueAtTime(zoomProp, tStart, 100);
                    SafeProp.setValueAtTime(pointProp, tStart, [footageW / 2, footageH / 2]);

                    SafeProp.setValueAtTime(zoomProp, tInEnd, targetZoomScale * 100);
                    SafeProp.setValueAtTime(pointProp, tInEnd, focusPt);

                    SafeProp.setValueAtTime(zoomProp, tOutStart, targetZoomScale * 100);
                    SafeProp.setValueAtTime(pointProp, tOutStart, focusPt);

                    SafeProp.setValueAtTime(zoomProp, tEnd, 100);
                    SafeProp.setValueAtTime(pointProp, tEnd, [footageW / 2, footageH / 2]);
                }

                var totalZKeys = SafeProp.getNumKeys(zoomProp);
                for (var zk = 1; zk <= totalZKeys; zk++) {
                    SafeProp.setTemporalEase(zoomProp, zk, easeInOut, easeInOut);
                }
                var totalPKeys = SafeProp.getNumKeys(pointProp);
                for (var pk = 1; pk <= totalPKeys; pk++) {
                    SafeProp.setTemporalEase(pointProp, pk, easeInOut, easeInOut);
                    try {
                        pointProp.setSpatialContinuousAtKey(pk, true);
                        pointProp.setSpatialAutoBezierAtKey(pk, true);
                    } catch (e) {}
                }

            } else if (options.zoomMode === "continuous") {
                var currentFocusX = footageW / 2;
                var currentFocusY = footageH / 2;
                var halfSpanX = (footageW / 2) / targetZoomScale;
                var halfSpanY = (footageH / 2) / targetZoomScale;
                var deadbandRatio = (options.deadbandMargin || 25) / 100.0;
                var insetX = (halfSpanX * 2) * deadbandRatio;
                var insetY = (halfSpanY * 2) * deadbandRatio;

                SafeProp.setValue(zoomProp, targetZoomScale * 100);

                for (var kIdx = 0; kIdx < finalKeys.length; kIdx++) {
                    var kPoint = finalKeys[kIdx];
                    var ptX = kPoint.cx * footageW;
                    var ptY = kPoint.cy * footageH;

                    var safeL = currentFocusX - halfSpanX + insetX;
                    var safeR = currentFocusX + halfSpanX - insetX;
                    var safeT = currentFocusY - halfSpanY + insetY;
                    var safeB = currentFocusY + halfSpanY - insetY;

                    if (ptX < safeL) currentFocusX = ptX + (halfSpanX - insetX);
                    else if (ptX > safeR) currentFocusX = ptX - (halfSpanX - insetX);

                    if (ptY < safeT) currentFocusY = ptY + (halfSpanY - insetY);
                    else if (ptY > safeB) currentFocusY = ptY - (halfSpanY - insetY);

                    currentFocusX = Math.max(halfSpanX, Math.min(footageW - halfSpanX, currentFocusX));
                    currentFocusY = Math.max(halfSpanY, Math.min(footageH - halfSpanY, currentFocusY));

                    SafeProp.setValueAtTime(pointProp, kPoint.timeSec, [currentFocusX, currentFocusY]);
                }

                var easeOut = new KeyframeEase(0, 16.0);
                var easeIn = new KeyframeEase(0, 85.0);
                var totalContPKeys = SafeProp.getNumKeys(pointProp);
                for (var k = 1; k <= totalContPKeys; k++) {
                    SafeProp.setTemporalEase(pointProp, k, easeIn, easeOut);
                    try {
                        pointProp.setSpatialContinuousAtKey(k, true);
                        pointProp.setSpatialAutoBezierAtKey(k, true);
                    } catch (e) {}
                }
            } else {
                SafeProp.setValue(zoomProp, 100);
                SafeProp.setValue(pointProp, [footageW / 2, footageH / 2]);
            }

            // 11. Camera Transformation Expressions (Defensively Applied)
            try {
                videoLayer.transform.anchorPoint.expression =
                    "var ctrl = thisComp.layer('" + controller.name + "');\n" +
                    "ctrl.effect('Camera Focus')('Point');";
            } catch (eAP) {}

            try {
                videoLayer.transform.position.expression = "[thisComp.width / 2, thisComp.height / 2];";
            } catch (ePos) {}

            try {
                videoLayer.transform.scale.expression =
                    "var ctrl = thisComp.layer('" + controller.name + "');\n" +
                    "var z = ctrl.effect('Zoom Scale')('Slider');\n" +
                    "var m = ctrl.effect('Canvas Margin')('Slider');\n" +
                    "var base = 100.0 * (1.0 - Math.min(0.4, m / 100.0));\n" +
                    "var s = base * (z / 100.0);\n" +
                    "[s, s];";
            } catch (eScl) {}

            try {
                matteLayer.transform.anchorPoint.expression =
                    "var vid = thisComp.layer('" + videoLayer.name + "');\nvid.transform.anchorPoint;";
            } catch (eMAP) {}
            try {
                matteLayer.transform.position.expression =
                    "var vid = thisComp.layer('" + videoLayer.name + "');\nvid.transform.position;";
            } catch (eMPos) {}
            try {
                matteLayer.transform.scale.expression =
                    "var vid = thisComp.layer('" + videoLayer.name + "');\nvid.transform.scale;";
            } catch (eMScl) {}

            // 12. Layer 2: Generate Calibrated Cursor Layer with Hotspot Locking
            var styleDef = CURSOR_MANIFEST[options.cursorStyle] || CURSOR_MANIFEST.tahoe;
            var arrowData = (styleDef.cursors && styleDef.cursors.arrow) || { anchorX: 0.14, anchorY: 0.06 };
            var assetFile = getCursorAssetFile(options.cursorStyle, "arrow", options.preferSvg);

            var cursorLayer = null;
            var assetWidth = 512;
            var assetHeight = 512;

            if (assetFile && assetFile.exists) {
                var cursorFootage = proj.importFile(new ImportOptions(assetFile));
                cursorLayer = comp.layers.add(cursorFootage);
                cursorLayer.name = "TraceMotion_Cursor [" + styleDef.label + "]";
                assetWidth = cursorFootage.width;
                assetHeight = cursorFootage.height;
            } else {
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
                var pPath = SafeProp.find(pathProp, ["ADBE Vector Shape", "Path"], 1);
                SafeProp.setValue(pPath, pathShape);

                var fillProp = grpVectors.addProperty("ADBE Vector Graphic - Fill");
                var pFill = SafeProp.find(fillProp, ["ADBE Vector Fill Color", "Color"], 1);
                SafeProp.setValue(pFill, [0.05, 0.05, 0.05, 1.0]);

                var strokeProp = grpVectors.addProperty("ADBE Vector Graphic - Stroke");
                var pStrokeCol = SafeProp.find(strokeProp, ["ADBE Vector Stroke Color", "Color"], 1);
                SafeProp.setValue(pStrokeCol, [1.0, 1.0, 1.0, 1.0]);
                var pStrokeW = SafeProp.find(strokeProp, ["ADBE Vector Stroke Width", "Stroke Width"], 2);
                SafeProp.setValue(pStrokeW, 2.0);

                assetWidth = 32;
                assetHeight = 32;
            }

            cursorLayer.motionBlur = options.enableMotionBlur;

            var hotspotX = assetWidth * arrowData.anchorX;
            var hotspotY = assetHeight * arrowData.anchorY;
            SafeProp.setValue(cursorLayer.transform.anchorPoint, [hotspotX, hotspotY]);

            var baseCursorHeight = 28.0 * 2.5 * (options.cursorScalePct / 100.0) * (footageH / 1080.0) * styleDef.sizeMultiplier;
            var baseScaleFactor = (baseCursorHeight / assetHeight) * 100.0;
            SafeProp.setValue(cursorLayer.transform.scale, [baseScaleFactor, baseScaleFactor]);

            // Dynamic Pointer Hand State (Optional)
            var pointerLayer = null;
            var pointerData = styleDef.cursors && styleDef.cursors.pointer;
            var pointerAssetFile = pointerData ? getCursorAssetFile(options.cursorStyle, "pointer", options.preferSvg) : null;

            if (options.dynamicCursorStates && pointerAssetFile && pointerAssetFile.exists) {
                var pointerFootage = proj.importFile(new ImportOptions(pointerAssetFile));
                pointerLayer = comp.layers.add(pointerFootage);
                pointerLayer.name = "TraceMotion_PointerHand [" + styleDef.label + "]";
                pointerLayer.motionBlur = options.enableMotionBlur;

                var pHotspotX = pointerFootage.width * pointerData.anchorX;
                var pHotspotY = pointerFootage.height * pointerData.anchorY;
                SafeProp.setValue(pointerLayer.transform.anchorPoint, [pHotspotX, pHotspotY]);

                var pScaleFactor = (baseCursorHeight / pointerFootage.height) * 100.0;
                SafeProp.setValue(pointerLayer.transform.scale, [pScaleFactor, pScaleFactor]);

                pointerLayer.parent = cursorLayer;
                SafeProp.setValue(pointerLayer.transform.position, [0, 0]);

                var arrowOpacity = cursorLayer.transform.opacity;
                var pointerOpacity = pointerLayer.transform.opacity;

                for (var sk = 0; sk < rawSamples.length; sk++) {
                    var sampleState = rawSamples[sk];
                    var isPointer = (sampleState.cursorType === "pointer") ||
                                    (sampleState.interactionType === "click") ||
                                    (sampleState.interactionType === "double-click");
                    var tSec = sampleState.timeMs / 1000.0;

                    SafeProp.setValueAtTime(arrowOpacity, tSec, isPointer ? 0.0 : 100.0);
                    SafeProp.setValueAtTime(pointerOpacity, tSec, isPointer ? 100.0 : 0.0);
                }

                var totalOk = SafeProp.getNumKeys(arrowOpacity);
                for (var ok = 1; ok <= totalOk; ok++) {
                    try { arrowOpacity.setInterpolationTypeAtKey(ok, KeyframeInterpolationType.HOLD); } catch (e) {}
                }
                var totalPk2 = SafeProp.getNumKeys(pointerOpacity);
                for (var pk2 = 1; pk2 <= totalPk2; pk2++) {
                    try { pointerOpacity.setInterpolationTypeAtKey(pk2, KeyframeInterpolationType.HOLD); } catch (e) {}
                }
            }

            var cursorPosProp = cursorLayer.transform.position;
            for (var f = 0; f < finalKeys.length; f++) {
                var s = finalKeys[f];
                SafeProp.setValueAtTime(cursorPosProp, s.timeSec, [s.cx * footageW, s.cy * footageH]);
            }

            var totalCk = SafeProp.getNumKeys(cursorPosProp);
            for (var ck = 1; ck <= totalCk; ck++) {
                try {
                    cursorPosProp.setSpatialContinuousAtKey(ck, true);
                    cursorPosProp.setSpatialAutoBezierAtKey(ck, true);
                } catch (e) {}
            }

            try {
                cursorLayer.transform.position.expression =
                    "var vid = thisComp.layer('" + videoLayer.name + "');\n" +
                    "vid.toComp(value);";
            } catch (eCPos) {}

            try {
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
            } catch (eCRot) {}

            if (options.createClickBounce) {
                var cursorScaleProp = cursorLayer.transform.scale;
                var bounceEase = new KeyframeEase(0, 75.0);

                for (var rIdx = 0; rIdx < clickSamplesList.length; rIdx++) {
                    var rawS = clickSamplesList[rIdx];
                    var clickTime = rawS.timeMs / 1000.0;
                    var depressedScale = baseScaleFactor * 0.84;

                    SafeProp.setValueAtTime(cursorScaleProp, clickTime, [baseScaleFactor, baseScaleFactor]);
                    SafeProp.setValueAtTime(cursorScaleProp, clickTime + 0.175, [depressedScale, depressedScale]);
                    SafeProp.setValueAtTime(cursorScaleProp, clickTime + 0.350, [baseScaleFactor, baseScaleFactor]);

                    var keyCount = SafeProp.getNumKeys(cursorScaleProp);
                    if (keyCount >= 3) {
                        try {
                            SafeProp.setTemporalEase(cursorScaleProp, keyCount - 2, bounceEase, bounceEase);
                            SafeProp.setTemporalEase(cursorScaleProp, keyCount - 1, bounceEase, bounceEase);
                            SafeProp.setTemporalEase(cursorScaleProp, keyCount, bounceEase, bounceEase);
                        } catch (e) {}
                    }
                }
            }

            // 13. Layer 1 (Top): Clean Click Ripple VFX (ZERO CENTER CIRCLE ARTIFACT)
            if (options.clickEffect !== "none" && clickSamplesList.length > 0) {
                var rippleLayer = comp.layers.addShape();
                rippleLayer.name = "TraceMotion_Click_Ripples";
                rippleLayer.motionBlur = options.enableMotionBlur;

                SafeProp.setValue(rippleLayer.transform.anchorPoint, [0, 0]);
                SafeProp.setValue(rippleLayer.transform.position, [0, 0]);

                try {
                    rippleLayer.transform.position.expression =
                        "var vid = thisComp.layer('" + videoLayer.name + "');\n" +
                        "vid.toComp([0, 0]);";
                } catch (eRPos) {}
                try {
                    rippleLayer.transform.scale.expression =
                        "var vid = thisComp.layer('" + videoLayer.name + "');\n" +
                        "vid.transform.scale;";
                } catch (eRScl) {}

                var rippleRoot = rippleLayer.property("ADBE Root Vectors Group");
                var rgbColor = hexToRgb(options.clickEffectColor || "#2563EB");
                var maxRadius = Math.max(40, baseCursorHeight * 1.95 * (options.clickEffectScale / 100.0));

                for (var rc = 0; rc < clickSamplesList.length; rc++) {
                    var clickSample = clickSamplesList[rc];
                    var tClickStart = (clickSample.timeMs + 175) / 1000.0;
                    var tClickEnd = tClickStart + 0.550;

                    var rGroup = rippleRoot.addProperty("ADBE Vector Group");
                    rGroup.name = "Ripple_" + (rc + 1);
                    var rVectors = rGroup.property("ADBE Vectors Group");

                    var ellipse = rVectors.addProperty("ADBE Vector Shape - Ellipse");
                    var sizeProp = SafeProp.find(ellipse, ["ADBE Vector Ellipse Size", "Size"], 1);

                    var stroke = rVectors.addProperty("ADBE Vector Graphic - Stroke");
                    var strokeColProp = SafeProp.find(stroke, ["ADBE Vector Stroke Color", "Color"], 1);
                    SafeProp.setValue(strokeColProp, [rgbColor[0], rgbColor[1], rgbColor[2], 1.0]);
                    var strokeWProp = SafeProp.find(stroke, ["ADBE Vector Stroke Width", "Stroke Width"], 2);

                    var transGroup = rVectors.property("ADBE Vector Transform Group");
                    var posProp = SafeProp.find(transGroup, ["ADBE Vector Position", "Position"], 2);
                    var opacProp = SafeProp.find(transGroup, ["ADBE Vector Group Opacity", "Opacity"], 4);

                    SafeProp.setValue(posProp, [clickSample.cx * footageW, clickSample.cy * footageH]);

                    SafeProp.setValueAtTime(opacProp, 0, 0.0);
                    SafeProp.setValueAtTime(sizeProp, 0, [0, 0]);

                    if (tClickStart > 0.02) {
                        SafeProp.setValueAtTime(opacProp, tClickStart - 0.016, 0.0);
                        SafeProp.setValueAtTime(sizeProp, tClickStart - 0.016, [0, 0]);
                    }

                    SafeProp.setValueAtTime(opacProp, tClickStart, 65.0);
                    SafeProp.setValueAtTime(opacProp, tClickEnd, 0.0);
                    SafeProp.setValueAtTime(opacProp, tClickEnd + 0.016, 0.0);

                    SafeProp.setValueAtTime(sizeProp, tClickStart, [4, 4]);
                    SafeProp.setValueAtTime(sizeProp, tClickEnd, [maxRadius * 2, maxRadius * 2]);
                    SafeProp.setValueAtTime(sizeProp, tClickEnd + 0.016, [0, 0]);

                    SafeProp.setValueAtTime(strokeWProp, tClickStart, 2.8);
                    SafeProp.setValueAtTime(strokeWProp, tClickEnd, 0.5);

                    var cubicEase = new KeyframeEase(0, 85.0);
                    try {
                        var kStart = sizeProp.nearestKeyIndex(tClickStart);
                        var kEnd = sizeProp.nearestKeyIndex(tClickEnd);
                        SafeProp.setTemporalEase(sizeProp, kStart, cubicEase, cubicEase);
                        SafeProp.setTemporalEase(sizeProp, kEnd, cubicEase, cubicEase);
                    } catch (e) {}
                }
            }

            // 14. Optional Lock on Background Layer at the Very End
            if (bgLayer) {
                try { bgLayer.locked = true; } catch (lockErr) {}
            }

            app.endUndoGroup();
            undoStarted = false;

            if (!options.silent) {
                alert(
                    "TraceMotion Rig Generated Successfully!\n\n" +
                    "• Comp: " + comp.name + " (" + compW + "x" + compH + " @ " + fps + " FPS)\n" +
                    "• Window Framing: " + (options.cornerRadius || 20) + "px rounded corners & soft drop shadows\n" +
                    "• Background: " + bgData.label + "\n" +
                    "• Selected Cursor: " + styleDef.label + "\n" +
                    "• Smart Auto-Zoom: " + targetZoomScale + "x (" + options.zoomMode + ")\n" +
                    "• Zero Render Artifacts: Verified clean ripple & guide overlays",
                    "TraceMotion Complete"
                );
            }
            return comp;

        } catch (e) {
            if (undoStarted) {
                try { app.endUndoGroup(); } catch (ue) {}
            }
            if (!options.silent) {
                alert(
                    "TraceMotion Build Error:\n" + e.toString() +
                    "\nLine: " + (e.line !== undefined ? e.line : "unknown") +
                    (e.fileName ? "\nFile: " + e.fileName : "") +
                    "\nStack:\n" + (typeof $ !== "undefined" && $.stack ? $.stack : "n/a"),
                    "TraceMotion Exception"
                );
            }
            throw e;
        }
    }

    // =========================================================================
    // Active Rig Inspector / Live Updater Core
    // =========================================================================
    function updateActiveRig(comp, options) {
        if (!comp) return;
        var ctrl = comp.layer("TraceMotion_Camera_Controller");
        if (!ctrl) {
            alert("No TraceMotion_Camera_Controller layer found in the active composition.", "Update Rig");
            return;
        }

        var undoStarted = false;
        try {
            app.beginUndoGroup("Update TraceMotion Rig Parameters");
            undoStarted = true;

            var cornerProp = SafeProp.find(ctrl.effect("Corner Radius"), ["ADBE Slider Control-0001", "Slider"], 1);
            if (cornerProp) cornerProp.setValue(options.cornerRadius);

            var shadowProp = SafeProp.find(ctrl.effect("Shadow Intensity"), ["ADBE Slider Control-0001", "Slider"], 1);
            if (shadowProp) shadowProp.setValue(options.shadowIntensity);

            var marginProp = SafeProp.find(ctrl.effect("Canvas Margin"), ["ADBE Slider Control-0001", "Slider"], 1);
            if (marginProp) marginProp.setValue(options.canvasMargin);

            var swayProp = SafeProp.find(ctrl.effect("Cursor Sway"), ["ADBE Slider Control-0001", "Slider"], 1);
            if (swayProp) swayProp.setValue(options.swayAmount);

            // Update Background Gradient if present
            var bgLayer = comp.layer("TraceMotion_Background");
            if (bgLayer && options.backgroundPreset !== "none") {
                var wasLocked = bgLayer.locked;
                if (wasLocked) {
                    try { bgLayer.locked = false; } catch (e) {}
                }

                var bgData = BACKGROUND_PRESETS[options.backgroundPreset] || BACKGROUND_PRESETS["tahoe-dawn"];
                var ramp = bgLayer.effect("Background Gradient");
                if (ramp) {
                    var rStartCol = SafeProp.find(ramp, ["ADBE Ramp-0002", "Start Color"], 2);
                    var rEndCol = SafeProp.find(ramp, ["ADBE Ramp-0004", "End Color"], 4);
                    var rShape = SafeProp.find(ramp, ["ADBE Ramp-0005", "Ramp Shape"], 5);
                    SafeProp.setValue(rStartCol, bgData.start);
                    SafeProp.setValue(rEndCol, bgData.end);
                    SafeProp.setValue(rShape, bgData.isRadial ? 2 : 1);
                }

                if (wasLocked) {
                    try { bgLayer.locked = true; } catch (e) {}
                }
            }

            app.endUndoGroup();
            undoStarted = false;

            alert("TraceMotion rig parameters updated successfully in active composition!", "TraceMotion Updated");
        } catch (e) {
            if (undoStarted) {
                try { app.endUndoGroup(); } catch (ue) {}
            }
            alert("Error updating rig: " + e.toString() + "\nLine: " + e.line, "TraceMotion Error");
        }
    }

    // =========================================================================
    // Modern ScriptUI User Interface (Dockable Panel, Live Previews & Smooth Scrolling)
    // =========================================================================
    function buildUI(thisObj) {
        var isPanel = (thisObj instanceof Panel);
        var win = isPanel ? thisObj : new Window("palette", "TraceMotion Studio", undefined, { resizeable: true });

        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.spacing = 6;
        win.margins = 8;

        // Custom Dark Palette Styling
        try {
            var darkBg = win.graphics.newBrush(win.graphics.BrushType.SOLID_COLOR, [0.14, 0.14, 0.15, 1.0]);
            win.graphics.backgroundColor = darkBg;
        } catch (e) {}

        // --- Header Banner (Fixed at Top) ---
        var headerGrp = win.add("group");
        headerGrp.orientation = "row";
        headerGrp.alignChildren = ["fill", "center"];
        headerGrp.spacing = 8;

        var headerTextGrp = headerGrp.add("group");
        headerTextGrp.orientation = "column";
        headerTextGrp.alignChildren = ["left", "center"];
        headerTextGrp.spacing = 2;

        var titleTxt = headerTextGrp.add("statictext", undefined, "TraceMotion Studio");
        try { titleTxt.graphics.font = ScriptUI.newFont("Verdana", "Bold", 14); } catch (e) {}
        var subTxt = headerTextGrp.add("statictext", undefined, "Recordly Smart Zoom & Precision Framing Rig");

        var activeComp = getActiveComp();
        var hasActiveRig = !!(activeComp && activeComp.layer("TraceMotion_Camera_Controller"));

        var aeVerStr = (typeof app !== "undefined" && app.version) ? String(app.version) : "17.0";
        var aeMajorVer = parseFloat(aeVerStr) || 17.0;
        var isAE2020 = (aeMajorVer >= 17.0 && aeMajorVer < 18.0);

        var statusTxt = headerGrp.add("statictext", undefined, hasActiveRig ? "● Rig Active: " + activeComp.name : ("○ Ready (" + (isAE2020 ? "AE 2020" : "AE v" + Math.floor(aeMajorVer)) + ")"));
        statusTxt.alignment = ["right", "center"];

        // =====================================================================
        // SCROLLABLE CONTAINER (Responsive Viewport with Arrow Buttons & Scrollbar)
        // =====================================================================
        var outerScrollBox = win.add("group");
        outerScrollBox.orientation = "row";
        outerScrollBox.alignment = ["fill", "fill"];
        outerScrollBox.alignChildren = ["fill", "fill"];
        outerScrollBox.spacing = 3;
        outerScrollBox.margins = 0;

        var scrollViewport = outerScrollBox.add("group");
        scrollViewport.orientation = "column";
        scrollViewport.alignment = ["fill", "fill"];
        scrollViewport.alignChildren = ["fill", undefined]; // Crucial: Do not clamp child Y!
        scrollViewport.spacing = 0;
        scrollViewport.margins = 0;

        var contentGroup = scrollViewport.add("group");
        contentGroup.orientation = "column";
        contentGroup.alignment = ["fill", "top"];
        contentGroup.alignChildren = ["fill", "top"];
        contentGroup.spacing = 6;
        contentGroup.margins = [0, 0, 4, 0];

        // Dedicated Scroll Bar Column with Mini Arrow Buttons
        var scrollCol = outerScrollBox.add("group");
        scrollCol.orientation = "column";
        scrollCol.alignment = ["right", "fill"];
        scrollCol.alignChildren = ["center", "fill"];
        scrollCol.spacing = 2;
        scrollCol.margins = [0, 0, 0, 0];
        scrollCol.preferredSize.width = 16;

        var btnScrollUp = scrollCol.add("button", undefined, "▲");
        btnScrollUp.preferredSize = [16, 16];
        btnScrollUp.helpTip = "Scroll panel upwards";

        var scrollBar = scrollCol.add("scrollbar", undefined, 0, 0, 100);
        scrollBar.alignment = ["fill", "fill"];
        scrollBar.preferredSize.width = 16;
        scrollBar.visible = true;

        var btnScrollDown = scrollCol.add("button", undefined, "▼");
        btnScrollDown.preferredSize = [16, 16];
        btnScrollDown.helpTip = "Scroll panel downwards";

        // --- SECTION 1: Source Media & Telemetry ---
        var secMedia = contentGroup.add("panel", undefined, "1. Source Media & Telemetry Ingest");
        secMedia.orientation = "column";
        secMedia.alignChildren = ["fill", "top"];
        secMedia.spacing = 5;
        secMedia.margins = 8;

        var videoRow = secMedia.add("group");
        var vidLbl = videoRow.add("statictext", undefined, "Video Footage:");
        vidLbl.preferredSize.width = 90;
        var videoPathInput = videoRow.add("edittext", undefined, "");
        videoPathInput.preferredSize.width = 160;
        videoPathInput.helpTip = "Screen recording video file (MP4, MOV, MKV, WebM) captured via OBS or Recordly.";
        var videoBrowseBtn = videoRow.add("button", undefined, "Browse...");
        videoBrowseBtn.preferredSize.width = 65;

        var jsonRow = secMedia.add("group");
        var jsonLbl = jsonRow.add("statictext", undefined, "Cursor JSON:");
        jsonLbl.preferredSize.width = 90;
        var jsonPathInput = jsonRow.add("edittext", undefined, "");
        jsonPathInput.preferredSize.width = 160;
        jsonPathInput.helpTip = "Companion mouse telemetry file (.cursor.json) containing synchronized cursor coordinates and click events.";
        var jsonBrowseBtn = jsonRow.add("button", undefined, "Browse...");
        jsonBrowseBtn.preferredSize.width = 65;

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

        // --- SECTION 2: Cursor Model & Live Visual Preview ---
        var secCursor = contentGroup.add("panel", undefined, "2. Cursor Model & Visual Assets");
        secCursor.orientation = "column";
        secCursor.alignChildren = ["fill", "top"];
        secCursor.spacing = 5;
        secCursor.margins = 8;

        // Visual Mouse Cursor Preview Card (Dual-Engine Canvas)
        var cursorPreviewRow = secCursor.add("group");
        cursorPreviewRow.orientation = "row";
        cursorPreviewRow.alignChildren = ["left", "center"];
        cursorPreviewRow.spacing = 10;
        cursorPreviewRow.margins = [0, 2, 0, 4];

        // Procedural Vector Cursor Drawing Engine
        function drawVectorCursor(g, styleKey, boxW, boxH) {
            var ox = Math.round(boxW * 0.28);
            var oy = Math.round(boxH * 0.18);
            var curPen = g.newPen(g.PenType.SOLID_COLOR, [0.08, 0.08, 0.10, 1.0], 1.5);
            var fillBrush = g.newBrush(g.BrushType.SOLID_COLOR, [0.98, 0.98, 0.99, 1.0]);

            if (styleKey === "windows11") {
                g.newPath();
                g.moveTo(ox, oy);
                g.lineTo(ox, oy + 24);
                g.lineTo(ox + 6, oy + 19);
                g.lineTo(ox + 11, oy + 29);
                g.lineTo(ox + 15, oy + 27);
                g.lineTo(ox + 10, oy + 17);
                g.lineTo(ox + 18, oy + 17);
                g.closePath();
                g.fillPath(fillBrush);
                g.strokePath(curPen);
            } else if (styleKey === "custom") {
                g.newPath();
                g.moveTo(ox + 2, oy);
                g.lineTo(ox + 2, oy + 22);
                g.lineTo(ox + 7, oy + 16);
                g.lineTo(ox + 16, oy + 16);
                g.closePath();
                var figmaB = g.newBrush(g.BrushType.SOLID_COLOR, [0.10, 0.10, 0.12, 1.0]);
                g.fillPath(figmaB);
                var figmaP = g.newPen(g.PenType.SOLID_COLOR, [1.0, 1.0, 1.0, 1.0], 1.2);
                g.strokePath(figmaP);
            } else {
                // macOS Tahoe / Classic
                g.newPath();
                g.moveTo(ox, oy);
                g.lineTo(ox, oy + 24);
                g.lineTo(ox + 6, oy + 18);
                g.lineTo(ox + 12, oy + 28);
                g.lineTo(ox + 15, oy + 26);
                g.lineTo(ox + 9, oy + 16);
                g.lineTo(ox + 17, oy + 16);
                g.closePath();
                g.fillPath(fillBrush);
                g.strokePath(curPen);
            }
        }

        function drawHotspotPip(g, anchorX, anchorY, boxW, boxH) {
            var ox = Math.round(boxW * 0.28);
            var oy = Math.round(boxH * 0.18);
            var px = Math.round(ox + anchorX * 26);
            var py = Math.round(oy + anchorY * 26);
            var targetBrush = g.newBrush(g.BrushType.SOLID_COLOR, [0.15, 0.75, 1.0, 1.0]);
            var targetPen = g.newPen(g.PenType.SOLID_COLOR, [0.05, 0.15, 0.35, 1.0], 1);
            g.rectPath(px - 2, py - 2, 5, 5);
            g.fillPath(targetBrush);
            g.rectPath(px - 2, py - 2, 5, 5);
            g.strokePath(targetPen);
        }

        var cursorCanvas = cursorPreviewRow.add("panel", [0, 0, 56, 56], undefined, { borderStyle: "none" });
        cursorCanvas.size = [56, 56];
        cursorCanvas.preferredSize = [56, 56];
        cursorCanvas.maximumSize = [56, 56];
        cursorCanvas.currentStyleKey = "tahoe";
        cursorCanvas.previewImage = null;

        var initPrevF = getCursorPreviewFile("tahoe");
        if (initPrevF && initPrevF.exists) {
            try { cursorCanvas.previewImage = ScriptUI.newImage(initPrevF); } catch (e) {}
        }

        cursorCanvas.onDraw = function () {
            var g = this.graphics;
            var w = (this.size && this.size[0]) || 56;
            var h = (this.size && this.size[1]) || 56;
            if (w <= 0 || h <= 0) { w = 56; h = 56; }

            var cardB = g.newBrush(g.BrushType.SOLID_COLOR, [0.16, 0.16, 0.18, 1.0]);
            g.rectPath(0, 0, w, h);
            g.fillPath(cardB);
            var borderP = g.newPen(g.PenType.SOLID_COLOR, [0.30, 0.30, 0.35, 1.0], 1);
            g.rectPath(0, 0, w, h);
            g.strokePath(borderP);

            var drewImg = false;
            if (this.previewImage) {
                try {
                    g.drawImage(this.previewImage, 6, 6, 44, 44);
                    drewImg = true;
                } catch (e) {}
            }

            var sDef = CURSOR_MANIFEST[this.currentStyleKey] || CURSOR_MANIFEST.tahoe;
            var aData = (sDef.cursors && sDef.cursors.arrow) || { anchorX: 0.14, anchorY: 0.06 };

            if (!drewImg) {
                drawVectorCursor(g, this.currentStyleKey, w, h);
            }

            drawHotspotPip(g, aData.anchorX, aData.anchorY, w, h);
        };

        var cursorMetaGrp = cursorPreviewRow.add("group");
        cursorMetaGrp.orientation = "column";
        cursorMetaGrp.alignChildren = ["left", "center"];
        cursorMetaGrp.spacing = 2;

        var cursorTitleTxt = cursorMetaGrp.add("statictext", undefined, "macOS Tahoe (Recordly Default)");
        try { cursorTitleTxt.graphics.font = ScriptUI.newFont("Verdana", "Bold", 11); } catch (e) {}

        var cursorHotspotTxt = cursorMetaGrp.add("statictext", undefined, "Hotspot: [14%, 6%]");
        var cursorResTxt = cursorMetaGrp.add("statictext", undefined, "512px Retina Asset");

        var styleRow = secCursor.add("group");
        var styleLbl = styleRow.add("statictext", undefined, "Cursor Style:");
        styleLbl.preferredSize.width = 90;
        var cursorDropdown = styleRow.add("dropdownlist", undefined, [
            "macOS Tahoe (Recordly Default)",
            "macOS Classic",
            "Windows 11 Fluent",
            "Figma / Minimal",
            "Vector Shape (Procedural)"
        ]);
        cursorDropdown.helpTip = "Selects the authentic cursor graphic asset pack calibrated with exact pixel hotspots.";
        var savedStyleIdx = parseInt(getPref("cursorStyleIdx", "0"), 10);
        cursorDropdown.selection = (savedStyleIdx >= 0 && savedStyleIdx < 5) ? savedStyleIdx : 0;

        function updateCursorPreview(styleKey) {
            var sDef = CURSOR_MANIFEST[styleKey] || CURSOR_MANIFEST.tahoe;
            cursorCanvas.currentStyleKey = styleKey;
            cursorTitleTxt.text = sDef.label;

            var prevF = getCursorPreviewFile(styleKey);
            cursorCanvas.previewImage = null;
            if (prevF && prevF.exists) {
                try { cursorCanvas.previewImage = ScriptUI.newImage(prevF); } catch (e) {}
            }

            var aData = (sDef.cursors && sDef.cursors.arrow) || { anchorX: 0, anchorY: 0 };
            cursorHotspotTxt.text = "Hotspot: [" + Math.round(aData.anchorX * 100) + "%, " + Math.round(aData.anchorY * 100) + "%]";
            cursorResTxt.text = sDef.folder ? "512px Retina Asset" : "Procedural Vector Shape";

            try {
                cursorCanvas.hide();
                cursorCanvas.show();
            } catch (e) {}
        }

        var styleKeys = ["tahoe", "macos", "windows11", "custom", "procedural"];
        cursorDropdown.onChange = function () {
            var selIdx = cursorDropdown.selection ? cursorDropdown.selection.index : 0;
            var k = styleKeys[selIdx] || "tahoe";
            updateCursorPreview(k);
        };
        updateCursorPreview(styleKeys[cursorDropdown.selection ? cursorDropdown.selection.index : 0]);

        var radRow = secCursor.add("group");
        var radLbl = radRow.add("statictext", undefined, "Asset Format:");
        radLbl.preferredSize.width = 90;
        var radPng = radRow.add("radiobutton", undefined, "PNG (Universal)");
        var radSvg = radRow.add("radiobutton", undefined, "Vector SVG (AE 2024+)");

        var canUseSvg = (aeMajorVer >= 24.0);
        var savedUseSvg = (getPref("preferSvg", "false") === "true") && canUseSvg;
        radPng.value = !savedUseSvg;
        radSvg.value = savedUseSvg;
        radSvg.enabled = canUseSvg;

        radPng.helpTip = "High-resolution 512px Retina raster asset, calibrated for 100% compatibility with After Effects CC 2020 through 2026+.";
        radSvg.helpTip = canUseSvg 
            ? "Scalable vector asset, natively rendered in AE 2024 and newer." 
            : "Vector SVG import requires AE 2024+. In AE 2020, high-res Retina PNG is automatically used.";

        var sizeRow = secCursor.add("group");
        var sizeLbl = sizeRow.add("statictext", undefined, "Cursor Scale (%):");
        sizeLbl.preferredSize.width = 90;
        var sizeSlider = sizeRow.add("slider", undefined, 100, 40, 250);
        sizeSlider.preferredSize.width = 145;
        var sizeInput = sizeRow.add("edittext", undefined, getPref("cursorScalePct", "100"));
        sizeInput.characters = 4;
        sizeSlider.value = parseFloat(sizeInput.text) || 100;
        sizeSlider.onChanging = function () { sizeInput.text = Math.round(sizeSlider.value); };
        sizeInput.onChange = function () { sizeSlider.value = parseFloat(sizeInput.text) || 100; };
        sizeSlider.helpTip = "Scale of the cursor relative to screen recording dimensions (100% = standard desktop size).";

        var chkDynamicStates = secCursor.add("checkbox", undefined, "Dynamic Cursor States (Auto-Swap Arrow / Hand on Click)");
        chkDynamicStates.value = getPref("dynamicCursorStates", "true") === "true";
        chkDynamicStates.helpTip = "Automatically swaps the cursor between Arrow and Pointing Hand on clicks and link interactions.";

        var chkSway = secCursor.add("checkbox", undefined, "Dynamic Velocity Sway (PI/18 Tilt Physics)");
        chkSway.value = getPref("enableSway", "true") === "true";
        chkSway.helpTip = "Tilts the cursor dynamically in the direction of high-velocity movement matching Recordly.";

        var chkBounce = secCursor.add("checkbox", undefined, "Click Bounce Depression (350ms Half-Sine 84%)");
        chkBounce.value = getPref("enableBounce", "true") === "true";
        chkBounce.helpTip = "Compresses the cursor scale smoothly during mouse down events.";

        var fxRow = secCursor.add("group");
        var fxLbl = fxRow.add("statictext", undefined, "Click Ripple VFX:");
        fxLbl.preferredSize.width = 90;
        var fxDropdown = fxRow.add("dropdownlist", undefined, ["Recordly Accent Ring", "None"]);
        var savedFxIdx = parseInt(getPref("clickEffectIdx", "0"), 10);
        fxDropdown.selection = (savedFxIdx >= 0 && savedFxIdx < 2) ? savedFxIdx : 0;
        fxDropdown.helpTip = "Renders expanding accent ripple rings during mouse clicks (verified zero center circle artifact).";

        var colorRow = secCursor.add("group");
        var colLbl = colorRow.add("statictext", undefined, "Ripple Color (Hex):");
        colLbl.preferredSize.width = 90;
        var colorInput = colorRow.add("edittext", undefined, getPref("clickColor", "#2563EB"));
        colorInput.characters = 8;
        colorInput.helpTip = "Hexadecimal color code for the click ripple animation (Default: #2563EB Recordly Blue).";

        // --- SECTION 3: Smart Zoom & Framing Engine ---
        var secZoom = contentGroup.add("panel", undefined, "3. Smart Zoom & Camera Engine");
        secZoom.orientation = "column";
        secZoom.alignChildren = ["fill", "top"];
        secZoom.spacing = 5;
        secZoom.margins = 8;

        var zoomModeRow = secZoom.add("group");
        var zmModeLbl = zoomModeRow.add("statictext", undefined, "Zoom Engine:");
        zmModeLbl.preferredSize.width = 90;
        var zoomModeDropdown = zoomModeRow.add("dropdownlist", undefined, [
            "Smart Auto-Cluster (Recordly Dwell & Clicks)",
            "Continuous Deadband Follow",
            "Manual Overview (100% Static)"
        ]);
        var savedZoomModeIdx = parseInt(getPref("zoomModeIdx", "0"), 10);
        zoomModeDropdown.selection = (savedZoomModeIdx >= 0 && savedZoomModeIdx < 3) ? savedZoomModeIdx : 0;
        zoomModeDropdown.helpTip = "Auto-Cluster analyzes click clusters and sustained dwells to dynamically zoom in on points of interest.";

        var depthRow = secZoom.add("group");
        var depthLbl = depthRow.add("statictext", undefined, "Zoom Scale Level:");
        depthLbl.preferredSize.width = 90;
        var depthDropdown = depthRow.add("dropdownlist", undefined, [
            "1.25x (Subtle Detail)",
            "1.50x (Moderate Focus)",
            "1.80x (Recordly Signature Default)",
            "2.20x (Close-Up)",
            "3.50x (Macro Detail)"
        ]);
        var savedDepthIdx = parseInt(getPref("depthIdx", "2"), 10);
        depthDropdown.selection = (savedDepthIdx >= 0 && savedDepthIdx < 5) ? savedDepthIdx : 2;
        depthDropdown.helpTip = "Target magnification when zooming into active interaction clusters.";

        var smoothRow = secZoom.add("group");
        var smLbl = smoothRow.add("statictext", undefined, "Spring Physics:");
        smLbl.preferredSize.width = 90;
        var smoothSlider = smoothRow.add("slider", undefined, 67, 10, 150);
        smoothSlider.preferredSize.width = 145;
        var smoothInput = smoothRow.add("edittext", undefined, getPref("cursorSmoothing", "0.67"));
        smoothInput.characters = 4;
        smoothSlider.value = Math.round((parseFloat(smoothInput.text) || 0.67) * 100);
        smoothSlider.onChanging = function () { smoothInput.text = (smoothSlider.value / 100).toFixed(2); };
        smoothInput.onChange = function () { smoothSlider.value = Math.round((parseFloat(smoothInput.text) || 0.67) * 100); };
        smoothSlider.helpTip = "Damped harmonic oscillator smoothing factor. Lower = snappier, Higher = smoother cinematic lag.";

        var chkMotionBlur = secZoom.add("checkbox", undefined, "Native Composition Motion Blur");
        chkMotionBlur.value = getPref("enableMotionBlur", "true") === "true";
        chkMotionBlur.helpTip = "Enables After Effects 180-degree shutter motion blur on cursor and camera pans.";

        // --- SECTION 4: Window Framing & Live Background Preview ---
        var secFrame = contentGroup.add("panel", undefined, "4. Window Framing, Shadows & Backdrop");
        secFrame.orientation = "column";
        secFrame.alignChildren = ["fill", "top"];
        secFrame.spacing = 5;
        secFrame.margins = 8;

        // Visual Background Gradient Preview Card
        var bgPreviewRow = secFrame.add("group");
        bgPreviewRow.orientation = "row";
        bgPreviewRow.alignChildren = ["left", "center"];
        bgPreviewRow.spacing = 10;
        bgPreviewRow.margins = [0, 2, 0, 4];

        var bgCard = bgPreviewRow.add("panel", [0, 0, 84, 44], undefined, { borderStyle: "none" });
        bgCard.size = [84, 44];
        bgCard.preferredSize = [84, 44];
        bgCard.maximumSize = [84, 44];

        var bgKeys = ["tahoe-dawn", "dark-studio", "midnight-deep", "sequoia-azure", "solid-charcoal", "none"];
        var savedBgIdx = parseInt(getPref("bgPresetIdx", "0"), 10);
        var currentBgKey = bgKeys[(savedBgIdx >= 0 && savedBgIdx < 6) ? savedBgIdx : 0] || "tahoe-dawn";

        bgCard.onDraw = function () {
            var g = this.graphics;
            var w = (this.size && this.size[0]) || 84;
            var h = (this.size && this.size[1]) || 44;
            if (w <= 0 || h <= 0) { w = 84; h = 44; }

            if (currentBgKey === "none") {
                var trB = g.newBrush(g.BrushType.SOLID_COLOR, [0.12, 0.12, 0.14, 1.0]);
                g.rectPath(0, 0, w, h);
                g.fillPath(trB);
                var tPen = g.newPen(g.PenType.SOLID_COLOR, [0.60, 0.60, 0.65, 1.0], 1);
                g.drawString("Transparent", tPen, 8, 16);
                var bPen = g.newPen(g.PenType.SOLID_COLOR, [0.35, 0.35, 0.40, 1.0], 1);
                g.rectPath(0, 0, w, h);
                g.strokePath(bPen);
                return;
            }

            var bData = BACKGROUND_PRESETS[currentBgKey] || BACKGROUND_PRESETS["tahoe-dawn"];
            var sCol = bData.start;
            var eCol = bData.end;
            var steps = 28;
            var stripW = w / steps;

            for (var i = 0; i < steps; i++) {
                var t = i / (steps - 1);
                var r = sCol[0] + (eCol[0] - sCol[0]) * t;
                var gr = sCol[1] + (eCol[1] - sCol[1]) * t;
                var b = sCol[2] + (eCol[2] - sCol[2]) * t;
                var stripB = g.newBrush(g.BrushType.SOLID_COLOR, [r, gr, b, 1.0]);
                g.rectPath(Math.floor(i * stripW), 0, Math.ceil(stripW) + 1, h);
                g.fillPath(stripB);
            }

            var borderPen = g.newPen(g.PenType.SOLID_COLOR, [0.38, 0.38, 0.44, 1.0], 1);
            g.rectPath(0, 0, w, h);
            g.strokePath(borderPen);
        };

        var bgMetaGrp = bgPreviewRow.add("group");
        bgMetaGrp.orientation = "column";
        bgMetaGrp.alignChildren = ["left", "center"];
        bgMetaGrp.spacing = 2;

        var bgTitleTxt = bgMetaGrp.add("statictext", undefined, "Tahoe Dawn");
        try { bgTitleTxt.graphics.font = ScriptUI.newFont("Verdana", "Bold", 11); } catch (e) {}

        var bgTypeTxt = bgMetaGrp.add("statictext", undefined, "Electric Blue to Warm Violet");

        var bgRow = secFrame.add("group");
        var bgLbl = bgRow.add("statictext", undefined, "Backdrop Style:");
        bgLbl.preferredSize.width = 90;
        var bgDropdown = bgRow.add("dropdownlist", undefined, [
            "Tahoe Dawn (Electric Blue / Violet)",
            "Dark Studio (Charcoal / Deep Black)",
            "Midnight Deep (Navy / Indigo)",
            "Sequoia Azure (Vibrant Cobalt)",
            "Clean Charcoal Solid",
            "Transparent / None (Edge-to-Edge)"
        ]);
        bgDropdown.selection = (savedBgIdx >= 0 && savedBgIdx < 6) ? savedBgIdx : 0;
        bgDropdown.helpTip = "Generates a stylized desktop backdrop solid beneath the screen capture window.";

        function updateBgPreview(key) {
            currentBgKey = key;
            var bData = BACKGROUND_PRESETS[key] || BACKGROUND_PRESETS["tahoe-dawn"];
            bgTitleTxt.text = bData.label.split(" (")[0];
            bgTypeTxt.text = key === "none" ? "Edge-to-Edge Composition" : (bData.isRadial ? "Radial Gradient Ramp" : "Linear Gradient Ramp");
            try {
                bgCard.hide();
                bgCard.show();
            } catch (e) {}
        }

        bgDropdown.onChange = function () {
            var selIdx = bgDropdown.selection ? bgDropdown.selection.index : 0;
            var k = bgKeys[selIdx] || "tahoe-dawn";
            updateBgPreview(k);
        };
        updateBgPreview(currentBgKey);

        var cornerRow = secFrame.add("group");
        var crnLbl = cornerRow.add("statictext", undefined, "Corner Radius (px):");
        crnLbl.preferredSize.width = 90;
        var cornerSlider = cornerRow.add("slider", undefined, 20, 0, 64);
        cornerSlider.preferredSize.width = 145;
        var cornerInput = cornerRow.add("edittext", undefined, getPref("cornerRadius", "20"));
        cornerInput.characters = 4;
        cornerSlider.value = parseFloat(cornerInput.text) || 20;
        cornerSlider.onChanging = function () { cornerInput.text = Math.round(cornerSlider.value); };
        cornerInput.onChange = function () { cornerSlider.value = parseFloat(cornerInput.text) || 20; };
        cornerSlider.helpTip = "Rounds the video capture corners using a non-destructive shape track matte (Recordly standard: 20px).";

        var shadowRow = secFrame.add("group");
        var shdLbl = shadowRow.add("statictext", undefined, "Shadow Depth (%):");
        shdLbl.preferredSize.width = 90;
        var shadowSlider = shadowRow.add("slider", undefined, 65, 0, 100);
        shadowSlider.preferredSize.width = 145;
        var shadowInput = shadowRow.add("edittext", undefined, getPref("shadowIntensity", "65"));
        shadowInput.characters = 4;
        shadowSlider.value = parseFloat(shadowInput.text) || 65;
        shadowSlider.onChanging = function () { shadowInput.text = Math.round(shadowSlider.value); };
        shadowInput.onChange = function () { shadowSlider.value = parseFloat(shadowInput.text) || 65; };
        shadowSlider.helpTip = "Controls multi-stage soft ambient and contact drop shadow intensity.";

        var marginRow = secFrame.add("group");
        var mgnLbl = marginRow.add("statictext", undefined, "Canvas Margin (%):");
        mgnLbl.preferredSize.width = 90;
        var marginSlider = marginRow.add("slider", undefined, 12, 0, 25);
        marginSlider.preferredSize.width = 145;
        var marginInput = marginRow.add("edittext", undefined, getPref("canvasMargin", "12"));
        marginInput.characters = 4;
        marginSlider.value = parseFloat(marginInput.text) || 12;
        marginSlider.onChanging = function () { marginInput.text = Math.round(marginSlider.value); };
        marginInput.onChange = function () { marginSlider.value = parseFloat(marginInput.text) || 12; };
        marginSlider.helpTip = "Breathing room margin around floating capture window to showcase rounded corners and drop shadows.";

        // --- SECTION 5: Action Buttons (Fixed at Bottom) ---
        var actionGrp = win.add("group");
        actionGrp.orientation = "row";
        actionGrp.alignment = ["fill", "bottom"];
        actionGrp.spacing = 6;

        var helpBtn = actionGrp.add("button", undefined, "[?] Help");
        helpBtn.preferredSize.width = 60;
        helpBtn.helpTip = "View detailed parameter guides and recommended Recordly production standards.";

        var updateBtn = actionGrp.add("button", undefined, "Update Active Rig");
        updateBtn.preferredSize.width = 125;
        updateBtn.enabled = hasActiveRig;
        updateBtn.helpTip = "Updates the corner radius, shadow, margin, and backdrop of the active composition rig without re-importing.";

        var buildBtn = actionGrp.add("button", undefined, "Build TraceMotion Rig");
        buildBtn.preferredSize.width = 150;
        buildBtn.helpTip = "Ingests source media and telemetry, builds the complete smart zoom and window framing rig.";

        helpBtn.onClick = function () {
            alert(
                "TraceMotion Studio Quick Reference:\n\n" +
                "1. SMART AUTO-ZOOM:\n" +
                "   • Clusters clicks and sustained mouse dwells (450ms-2600ms).\n" +
                "   • Smooth cubic Bézier zooms into interaction clusters and returns to 100% overview.\n\n" +
                "2. WINDOW FRAMING:\n" +
                "   • 20px rounded corners with non-destructive shape track matte.\n" +
                "   • Multi-stage soft drop shadows (ambient diffusion + contact depth).\n" +
                "   • 12% canvas margin ensures the window floats cleanly over backdrops.\n\n" +
                "3. ZERO-ARTIFACT VFX:\n" +
                "   • Click ripples strictly stay at 0% opacity until mouse press.\n" +
                "   • No center circles or diagnostic shapes in final render output.",
                "TraceMotion Reference"
            );
        };

        function gatherOptions() {
            var selectedStyleKey = (cursorDropdown.selection ? styleKeys[cursorDropdown.selection.index] : null) || "tahoe";

            var zoomModes = ["auto-cluster", "continuous", "none"];
            var selectedZoomMode = (zoomModeDropdown.selection ? zoomModes[zoomModeDropdown.selection.index] : null) || "auto-cluster";

            var depthScales = [1.25, 1.50, 1.80, 2.20, 3.50];
            var selectedDepthScale = (depthDropdown.selection ? depthScales[depthDropdown.selection.index] : null) || 1.80;

            var selectedBgKey = (bgDropdown.selection ? bgKeys[bgDropdown.selection.index] : null) || "tahoe-dawn";

            savePref("cursorStyleIdx", cursorDropdown.selection ? cursorDropdown.selection.index : 0);
            savePref("preferSvg", radSvg.value && canUseSvg);
            savePref("cursorScalePct", sizeInput.text);
            savePref("dynamicCursorStates", chkDynamicStates.value);
            savePref("enableSway", chkSway.value);
            savePref("enableBounce", chkBounce.value);
            savePref("clickEffectIdx", fxDropdown.selection ? fxDropdown.selection.index : 0);
            savePref("clickColor", colorInput.text);
            savePref("zoomModeIdx", zoomModeDropdown.selection ? zoomModeDropdown.selection.index : 0);
            savePref("depthIdx", depthDropdown.selection ? depthDropdown.selection.index : 2);
            savePref("cursorSmoothing", smoothInput.text);
            savePref("enableMotionBlur", chkMotionBlur.value);
            savePref("cornerRadius", cornerInput.text);
            savePref("shadowIntensity", shadowInput.text);
            savePref("canvasMargin", marginInput.text);
            savePref("bgPresetIdx", bgDropdown.selection ? bgDropdown.selection.index : 0);

            return {
                cursorStyle: selectedStyleKey,
                preferSvg: (radSvg.value && canUseSvg),
                cursorScalePct: parseFloat(sizeInput.text) || 100.0,
                dynamicCursorStates: chkDynamicStates.value,
                swayAmount: chkSway.value ? 0.4 : 0.0,
                createClickBounce: chkBounce.value,
                clickEffect: (fxDropdown.selection && fxDropdown.selection.index === 0) ? "ripple" : "none",
                clickEffectColor: colorInput.text || "#2563EB",
                clickEffectScale: 100.0,
                zoomMode: selectedZoomMode,
                zoomDepthScale: selectedDepthScale,
                cursorSmoothing: parseFloat(smoothInput.text) || 0.67,
                motionPreset: (smoothSlider.value < 55) ? "focused" : "smooth",
                enableMotionBlur: chkMotionBlur.value,
                cornerRadius: parseFloat(cornerInput.text) || 20.0,
                shadowIntensity: parseFloat(shadowInput.text) || 65.0,
                canvasMargin: parseFloat(marginInput.text) || 12.0,
                backgroundPreset: selectedBgKey,
                simplificationTolerance: 0.25
            };
        }

        updateBtn.onClick = function () {
            var curComp = getActiveComp();
            if (!curComp) {
                alert("Please select or open an active composition containing a TraceMotion rig.", "Update Rig");
                return;
            }
            var opts = gatherOptions();
            updateActiveRig(curComp, opts);
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

            var opts = gatherOptions();
            if (!isPanel) {
                win.close();
            }
            buildTraceMotionRig(selectedVideoFile, selectedJsonFile, opts);
        };

        function doScroll(newVal) {
            var maxV = scrollBar.maxvalue || 0;
            var target = Math.max(0, Math.min(maxV, newVal));
            scrollBar.value = target;
            contentGroup.location = [contentGroup.location[0], -Math.round(target)];
        }

        scrollBar.onChanging = function () { doScroll(scrollBar.value); };
        scrollBar.onChange = function () { doScroll(scrollBar.value); };
        btnScrollUp.onClick = function () { doScroll(scrollBar.value - 75); };
        btnScrollDown.onClick = function () { doScroll(scrollBar.value + 75); };

        // Scrollbar Layout and Viewport Bounds Evaluator
        function updateScroll() {
            try {
                win.layout.layout(true);
                var viewH = (scrollViewport.size && (scrollViewport.size[1] || scrollViewport.size.height)) || 0;
                var contH = (contentGroup.size && (contentGroup.size[1] || contentGroup.size.height)) || 0;
                if (viewH <= 0) {
                    var winH = (win.size && (win.size[1] || win.size.height)) || 540;
                    viewH = Math.max(100, winH - 120);
                }
                if (contH > viewH) {
                    scrollBar.enabled = true;
                    scrollBar.maxvalue = contH - viewH;
                    scrollBar.jumpdelta = Math.max(30, Math.floor(viewH * 0.35));
                    btnScrollUp.enabled = true;
                    btnScrollDown.enabled = true;
                } else {
                    scrollBar.enabled = false;
                    scrollBar.maxvalue = 0;
                    scrollBar.value = 0;
                    contentGroup.location = [contentGroup.location[0], 0];
                    btnScrollUp.enabled = false;
                    btnScrollDown.enabled = false;
                }
            } catch (e) {}
        }

        win.onResizing = win.onResize = updateScroll;

        try {
            win.addEventListener("wheel", function (e) {
                if (scrollBar.enabled) {
                    var step = (e.deltaY !== undefined) ? e.deltaY : 35;
                    doScroll(scrollBar.value + step);
                }
            });
        } catch (e) {}

        if (win instanceof Window) {
            win.center();
            win.show();
        } else {
            win.layout.layout(true);
        }

        // Initialize dynamic previews & scroll bounds upon panel launch
        updateScroll();
        try {
            updateCursorPreview(styleKeys[cursorDropdown.selection ? cursorDropdown.selection.index : 0]);
            updateBgPreview(currentBgKey);
        } catch (initErr) {}

        return win;
    }

    // Expose API for external automation and automated test harnesses
    try {
        $.global.TraceMotion = {
            buildRig: buildTraceMotionRig,
            updateRig: updateActiveRig,
            buildUI: buildUI,
            BACKGROUND_PRESETS: BACKGROUND_PRESETS,
            CURSOR_MANIFEST: CURSOR_MANIFEST
        };
    } catch (apiErr) {}

    // Launch UI
    buildUI(thisObj);

})(this);
