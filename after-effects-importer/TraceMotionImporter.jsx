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

    var PREF_SECTION = "TraceMotion_Preferences_v4";
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
    // Authentic Cursor Asset System & Calibrated Hotspot Geometry
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
                },
                wait: {
                    filePng: "busybutclickable-1__23-0.png",
                    fileSvg: "busybutclickable-1__23-0.svg",
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
                },
                wait: {
                    filePng: "busybutclickable-1__23-0.png",
                    fileSvg: "busybutclickable-1__23-0.svg",
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
                },
                wait: {
                    filePng: "wait__50-50.png",
                    fileSvg: "wait__50-50.svg",
                    anchorX: 0.50,
                    anchorY: 0.50
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

    function getCursorPreviewFile(styleId) {
        var searchDirs = [];
        try {
            if (typeof $.fileName !== "undefined" && $.fileName) {
                var scriptF = new File($.fileName);
                if (scriptF && scriptF.parent && scriptF.parent.exists) {
                    searchDirs.push(scriptF.parent.fsName + "/assets/cursors/previews/" + styleId + ".png");
                }
            }
        } catch (e) {}
        searchDirs.push("D:/all my code/TraceMotion/after-effects-importer/assets/cursors/previews/" + styleId + ".png");

        for (var d = 0; d < searchDirs.length; d++) {
            var f = new File(searchDirs[d]);
            if (f.exists) return f;
        }
        return getCursorAssetFile(styleId, "arrow", false);
    }

    // =========================================================================
    // Recordly Wallpapers Asset Library (All 39 4K/Retina Wallpapers)
    // =========================================================================
    var RECORDLY_WALLPAPERS = [
        { id: "tahoe-light", filename: "tahoe-light.jpg", label: "Tahoe Light", category: "Tahoe" },
        { id: "tahoe-dark", filename: "tahoe-dark.jpg", label: "Tahoe Dark", category: "Tahoe" },
        { id: "bluerays", filename: "bluerays.jpeg", label: "Blue Rays", category: "Photography" },
        { id: "cherrypop", filename: "cherrypop.jpg", label: "Cherry Pop", category: "Photography" },
        { id: "cityscape", filename: "cityscape.jpg", label: "Cityscape", category: "Photography" },
        { id: "energy-17", filename: "energy-17.jpg", label: "Energy 17", category: "Abstract" },
        { id: "energy-19", filename: "energy-19.jpg", label: "Energy 19", category: "Abstract" },
        { id: "energy-20", filename: "energy-20.jpg", label: "Energy 20", category: "Abstract" },
        { id: "energy-21", filename: "energy-21.jpg", label: "Energy 21", category: "Abstract" },
        { id: "energy-22", filename: "energy-22.jpg", label: "Energy 22", category: "Abstract" },
        { id: "energy-23", filename: "energy-23.jpg", label: "Energy 23", category: "Abstract" },
        { id: "energy-24", filename: "energy-24.jpg", label: "Energy 24", category: "Abstract" },
        { id: "energy-25", filename: "energy-25.jpg", label: "Energy 25", category: "Abstract" },
        { id: "energy-26", filename: "energy-26.jpg", label: "Energy 26", category: "Abstract" },
        { id: "energy-27", filename: "energy-27.jpg", label: "Energy 27", category: "Abstract" },
        { id: "flowerbomb", filename: "flowerbomb.jpg", label: "Flowerbomb", category: "Photography" },
        { id: "hyper-1", filename: "hyper-1.jpg", label: "Hyper 1", category: "Abstract" },
        { id: "hyper-2", filename: "hyper-2.jpg", label: "Hyper 2", category: "Abstract" },
        { id: "hyper-3", filename: "hyper-3.jpg", label: "Hyper 3", category: "Abstract" },
        { id: "hyper-4", filename: "hyper-4.jpg", label: "Hyper 4", category: "Abstract" },
        { id: "hyper-5", filename: "hyper-5.jpg", label: "Hyper 5", category: "Abstract" },
        { id: "hyper-6", filename: "hyper-6.jpg", label: "Hyper 6", category: "Abstract" },
        { id: "hyper-7", filename: "hyper-7.jpg", label: "Hyper 7", category: "Abstract" },
        { id: "hyper-8", filename: "hyper-8.jpg", label: "Hyper 8", category: "Abstract" },
        { id: "hyper-9", filename: "hyper-9.jpg", label: "Hyper 9", category: "Abstract" },
        { id: "monterey-graphic-light", filename: "monterey-graphic-light.jpg", label: "Monterey Graphic Light", category: "macOS" },
        { id: "monterey-graphic-dark", filename: "monterey-graphic-dark.jpg", label: "Monterey Graphic Dark", category: "macOS" },
        { id: "sequoia-light", filename: "sequoia-light.jpg", label: "Sequoia Light", category: "macOS" },
        { id: "sequoia-dark", filename: "sequoia-dark.jpg", label: "Sequoia Dark", category: "macOS" },
        { id: "sonoma-light", filename: "sonoma-light.jpg", label: "Sonoma Light", category: "macOS" },
        { id: "sonoma-dark", filename: "sonoma-dark.jpg", label: "Sonoma Dark", category: "macOS" },
        { id: "solitude", filename: "solitude.jpg", label: "Solitude", category: "Photography" },
        { id: "sparks", filename: "sparks.jpg", label: "Sparks", category: "Abstract" },
        { id: "storm", filename: "storm.jpg", label: "Storm", category: "Photography" },
        { id: "waves", filename: "waves.jpg", label: "Waves", category: "Photography" },
        { id: "wallpaper-1", filename: "wallpaper-1.jpg", label: "Wallpaper 1", category: "Photography" },
        { id: "wallpaper-2", filename: "wallpaper-2.jpg", label: "Wallpaper 2", category: "Photography" },
        { id: "wallpaper-3", filename: "wallpaper-3.jpg", label: "Wallpaper 3", category: "Photography" },
        { id: "wallpaper-4", filename: "wallpaper-4.jpg", label: "Wallpaper 4", category: "Photography" }
    ];

    function getWallpaperAssetFile(filename) {
        var searchDirs = [];
        try {
            if (typeof $.fileName !== "undefined" && $.fileName) {
                var scriptF = new File($.fileName);
                if (scriptF && scriptF.parent && scriptF.parent.exists) {
                    searchDirs.push(scriptF.parent.fsName + "/assets/wallpapers/" + filename);
                }
            }
        } catch (e) {}

        searchDirs.push("D:/all my code/TraceMotion/after-effects-importer/assets/wallpapers/" + filename);
        searchDirs.push(Folder.userData.fsName + "/Adobe/After Effects/TraceMotion/assets/wallpapers/" + filename);

        for (var d = 0; d < searchDirs.length; d++) {
            var f = new File(searchDirs[d]);
            if (f.exists) return f;
        }
        return null;
    }

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
    // Main Rig Generation Core (Precision Camera Rig & Multi-State Cursor Stack)
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
            // RIG LAYER HIERARCHY:
            // Layer 1 (Top): TraceMotion_Click_Ripples (Shape Layer) -> parented to Camera Rig
            // Layer 2..N:    Cursor State Layers (arrow, pointer, etc.) -> parented to Cursor Master
            // Layer N+1:     TraceMotion_Cursor_Master (Null Layer) -> parented to Camera Rig
            // Layer N+2:     TraceMotion_Camera_Controller (Null Guide Layer) -> carries all controls
            // Layer N+3:     TraceMotion_Camera_Rig (Master Null) -> pans & zooms all window elements
            // Layer N+4:     TraceMotion_Window_Matte (Shape Layer, Alpha Matte for Video) -> parented to Rig
            // Layer N+5:     Clean_Screen_Capture (Video Footage) -> parented to Rig
            // Layer N+6:     TraceMotion_Window_Shadow (Shape Layer with 3 Drop Shadows) -> parented to Rig
            // Layer N+7:     TraceMotion_Background (Wallpaper or Gradient Solid) -> bottom
            // -----------------------------------------------------------------

            // 5. Add Background Layer (Wallpaper or Gradient)
            var bgLayer = null;
            var wpKey = options.wallpaper || options.backgroundPreset || "tahoe-light";

            if (wpKey !== "none") {
                var wpFile = getWallpaperAssetFile(wpKey.indexOf(".") > 0 ? wpKey : (wpKey + ".jpg"));
                if (!wpFile || !wpFile.exists) {
                    // Check if wpKey matches an id in RECORDLY_WALLPAPERS
                    for (var w = 0; w < RECORDLY_WALLPAPERS.length; w++) {
                        if (RECORDLY_WALLPAPERS[w].id === wpKey || RECORDLY_WALLPAPERS[w].filename === wpKey) {
                            wpFile = getWallpaperAssetFile(RECORDLY_WALLPAPERS[w].filename);
                            break;
                        }
                    }
                }

                if (wpFile && wpFile.exists) {
                    try {
                        var wpFootage = proj.importFile(new ImportOptions(wpFile));
                        bgLayer = comp.layers.add(wpFootage);
                        bgLayer.name = "TraceMotion_Background [" + wpFootage.name + "]";
                        var coverScale = Math.max((compW / wpFootage.width) * 100.0, (compH / wpFootage.height) * 100.0);
                        bgLayer.transform.scale.setValue([coverScale, coverScale]);
                        bgLayer.transform.position.setValue([compW / 2, compH / 2]);
                    } catch (eWp) {}
                }

                // Fallback to Gradient Ramp solid if wallpaper was not imported
                if (!bgLayer) {
                    var bgData = BACKGROUND_PRESETS[wpKey] || BACKGROUND_PRESETS["tahoe-dawn"];
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
            }

            // 6. Create Master Camera Rig Null
            var cameraRig = comp.layers.addNull();
            cameraRig.name = "TraceMotion_Camera_Rig";
            cameraRig.guideLayer = true;
            cameraRig.transform.anchorPoint.setValue([footageW / 2, footageH / 2]);
            cameraRig.transform.position.setValue([compW / 2, compH / 2]);

            // 7. Create Master Camera Controller Null (Exposes User Tuning Sliders)
            var controller = comp.layers.addNull();
            controller.name = "TraceMotion_Camera_Controller";
            controller.guideLayer = true;

            var fxParade = controller.property("ADBE Effect Parade");
            fxParade.addProperty("ADBE Slider Control").name = "Zoom Scale";
            fxParade.addProperty("ADBE Slider Control").name = "Canvas Margin";
            fxParade.addProperty("ADBE Slider Control").name = "Corner Radius";
            fxParade.addProperty("ADBE Slider Control").name = "Shadow Intensity";
            fxParade.addProperty("ADBE Slider Control").name = "Cursor Sway";
            fxParade.addProperty("ADBE Point Control").name = "Camera Focus";

            // Initialize default values using live layer queries
            controller.effect("Zoom Scale")("Slider").setValue(100);
            controller.effect("Canvas Margin")("Slider").setValue(marginPct);
            controller.effect("Corner Radius")("Slider").setValue(options.cornerRadius || 20);
            controller.effect("Shadow Intensity")("Slider").setValue(options.shadowIntensity || 65);
            controller.effect("Cursor Sway")("Slider").setValue(options.swayAmount || 0.4);
            controller.effect("Camera Focus")("Point").setValue([footageW / 2, footageH / 2]);

            // Connect Camera Rig Null transforms to Camera Controller
            cameraRig.transform.anchorPoint.expression =
                "thisComp.layer('" + controller.name + "').effect('Camera Focus')('Point');";
            cameraRig.transform.position.expression =
                "[thisComp.width / 2, thisComp.height / 2];";
            cameraRig.transform.scale.expression =
                "var ctrl = thisComp.layer('" + controller.name + "');\n" +
                "var z = ctrl.effect('Zoom Scale')('Slider');\n" +
                "var m = ctrl.effect('Canvas Margin')('Slider');\n" +
                "var base = 100.0 * (1.0 - Math.min(0.4, m / 100.0));\n" +
                "var s = base * (z / 100.0);\n" +
                "[s, s];";

            // 8. Create Window Drop Shadow Layer (Underneath Video, Never Clipped by Track Matte!)
            var shadowLayer = comp.layers.addShape();
            shadowLayer.name = "TraceMotion_Window_Shadow";
            shadowLayer.parent = cameraRig;
            shadowLayer.transform.anchorPoint.setValue([0, 0]);
            shadowLayer.transform.position.setValue([footageW / 2, footageH / 2]);
            shadowLayer.transform.scale.setValue([100, 100]);

            var shRoot = shadowLayer.property("ADBE Root Vectors Group");
            var shGrp = shRoot.addProperty("ADBE Vector Group");
            shGrp.name = "Shadow Bounds";
            var shVecs = shGrp.property("ADBE Vectors Group");

            var shRect = shVecs.addProperty("ADBE Vector Shape - Rect");
            shRect.property("ADBE Vector Rect Size").setValue([footageW, footageH]);
            shRect.property("ADBE Vector Rect Position").setValue([0, 0]);
            shRect.property("ADBE Vector Rect Roundness").expression =
                "thisComp.layer('" + controller.name + "').effect('Corner Radius')('Slider');";

            var shFill = shVecs.addProperty("ADBE Vector Graphic - Fill");
            shFill.property("ADBE Vector Fill Color").setValue([1.0, 1.0, 1.0, 1.0]);

            // Add Multi-Stage Soft Drop Shadows to shadowLayer
            var shadowFx = shadowLayer.property("ADBE Effect Parade");

            // Shadow 1: Ambient Soft Diffusion (Distance 16, Softness 48)
            var sh1 = shadowFx.addProperty("ADBE Drop Shadow");
            sh1.name = "Window Drop Shadow (Ambient)";
            sh1.property("Distance").setValue(16);
            sh1.property("Softness").setValue(48);
            sh1.property("Direction").setValue(180);
            sh1.property("Opacity").expression =
                "thisComp.layer('" + controller.name + "').effect('Shadow Intensity')('Slider') * 0.70;";

            // Shadow 2: Body Depth (Distance 6, Softness 16)
            var sh2 = shadowFx.addProperty("ADBE Drop Shadow");
            sh2.name = "Window Drop Shadow (Body)";
            sh2.property("Distance").setValue(6);
            sh2.property("Softness").setValue(16);
            sh2.property("Direction").setValue(180);
            sh2.property("Opacity").expression =
                "thisComp.layer('" + controller.name + "').effect('Shadow Intensity')('Slider') * 0.40;";

            // Shadow 3: Contact Edge (Distance 2, Softness 6)
            var sh3 = shadowFx.addProperty("ADBE Drop Shadow");
            sh3.name = "Window Drop Shadow (Contact)";
            sh3.property("Distance").setValue(2);
            sh3.property("Softness").setValue(6);
            sh3.property("Direction").setValue(180);
            sh3.property("Opacity").expression =
                "thisComp.layer('" + controller.name + "').effect('Shadow Intensity')('Slider') * 0.25;";

            // 9. Add Screen Recording Video Layer (Parented to Rig, NO Drop Shadows to Prevent Matte Clipping)
            var videoLayer = comp.layers.add(footageItem);
            videoLayer.name = "Clean_Screen_Capture";
            videoLayer.parent = cameraRig;
            videoLayer.transform.anchorPoint.setValue([footageW / 2, footageH / 2]);
            videoLayer.transform.position.setValue([footageW / 2, footageH / 2]);
            videoLayer.transform.scale.setValue([100, 100]);
            videoLayer.motionBlur = options.enableMotionBlur;

            // 10. Create Window Track Matte Layer (Rounded Corners Matching Video Coordinates 1:1)
            var matteLayer = comp.layers.addShape();
            matteLayer.name = "TraceMotion_Window_Matte";
            matteLayer.parent = cameraRig;
            matteLayer.transform.anchorPoint.setValue([0, 0]);
            matteLayer.transform.position.setValue([footageW / 2, footageH / 2]);
            matteLayer.transform.scale.setValue([100, 100]);

            var mRoot = matteLayer.property("ADBE Root Vectors Group");
            var mGrp = mRoot.addProperty("ADBE Vector Group");
            mGrp.name = "Window Bounds";
            var mVecs = mGrp.property("ADBE Vectors Group");

            var mRect = mVecs.addProperty("ADBE Vector Shape - Rect");
            mRect.property("ADBE Vector Rect Size").setValue([footageW, footageH]);
            mRect.property("ADBE Vector Rect Position").setValue([0, 0]);
            mRect.property("ADBE Vector Rect Roundness").expression =
                "thisComp.layer('" + controller.name + "').effect('Corner Radius')('Slider');";

            var mFill = mVecs.addProperty("ADBE Vector Graphic - Fill");
            mFill.property("ADBE Vector Fill Color").setValue([1.0, 1.0, 1.0, 1.0]);

            // Set Alpha Track Matte on video layer (1:1 Match, Zero 1/4 Screen Clipping!)
            try {
                if (typeof videoLayer.setTrackMatte === "function") {
                    videoLayer.setTrackMatte(matteLayer, TrackMatteType.ALPHA);
                } else {
                    videoLayer.trackMatteType = TrackMatteType.ALPHA;
                }
            } catch (matteErr) {}

            // 11. Recordly Damped Harmonic Oscillator Simulation
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

            // 12. Recordly Smart Zoom & Pan Trajectory (Keyframing Controller Properties Freshly)
            var targetZoomScale = Math.max(1.0, (options.zoomDepthScale || 1.8));

            if (options.zoomMode === "auto-cluster") {
                var clusters = buildRecordlyZoomClusters(rawSamples, duration, targetZoomScale);
                var easeInOut = new KeyframeEase(0, 84.0);

                // Use dynamic property queries to avoid stale pointers
                controller.effect("Camera Focus")("Point").setValueAtTime(0, [footageW / 2, footageH / 2]);
                controller.effect("Zoom Scale")("Slider").setValueAtTime(0, 100);

                var zoomTransitionSec = 1.1;
                for (var cl = 0; cl < clusters.length; cl++) {
                    var cluster = clusters[cl];
                    var tStart = cluster.startSec;
                    var tInEnd = Math.min(cluster.endSec, tStart + zoomTransitionSec);
                    var tOutStart = Math.max(tInEnd, cluster.endSec - zoomTransitionSec * 0.85);
                    var tEnd = cluster.endSec;
                    var focusPt = [cluster.cx * footageW, cluster.cy * footageH];

                    controller.effect("Zoom Scale")("Slider").setValueAtTime(tStart, 100);
                    controller.effect("Camera Focus")("Point").setValueAtTime(tStart, [footageW / 2, footageH / 2]);

                    controller.effect("Zoom Scale")("Slider").setValueAtTime(tInEnd, targetZoomScale * 100);
                    controller.effect("Camera Focus")("Point").setValueAtTime(tInEnd, focusPt);

                    controller.effect("Zoom Scale")("Slider").setValueAtTime(tOutStart, targetZoomScale * 100);
                    controller.effect("Camera Focus")("Point").setValueAtTime(tOutStart, focusPt);

                    controller.effect("Zoom Scale")("Slider").setValueAtTime(tEnd, 100);
                    controller.effect("Camera Focus")("Point").setValueAtTime(tEnd, [footageW / 2, footageH / 2]);
                }

                var zProp = controller.effect("Zoom Scale")("Slider");
                for (var zk = 1; zk <= zProp.numKeys; zk++) {
                    SafeProp.setTemporalEase(zProp, zk, easeInOut, easeInOut);
                }
                var pProp = controller.effect("Camera Focus")("Point");
                for (var pk = 1; pk <= pProp.numKeys; pk++) {
                    SafeProp.setTemporalEase(pProp, pk, easeInOut, easeInOut);
                    try {
                        pProp.setSpatialContinuousAtKey(pk, true);
                        pProp.setSpatialAutoBezierAtKey(pk, true);
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

                controller.effect("Zoom Scale")("Slider").setValue(targetZoomScale * 100);

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

                    controller.effect("Camera Focus")("Point").setValueAtTime(kPoint.timeSec, [currentFocusX, currentFocusY]);
                }

                var easeOut = new KeyframeEase(0, 16.0);
                var easeIn = new KeyframeEase(0, 85.0);
                var contPProp = controller.effect("Camera Focus")("Point");
                for (var k = 1; k <= contPProp.numKeys; k++) {
                    SafeProp.setTemporalEase(contPProp, k, easeIn, easeOut);
                    try {
                        contPProp.setSpatialContinuousAtKey(k, true);
                        contPProp.setSpatialAutoBezierAtKey(k, true);
                    } catch (e) {}
                }
            } else {
                controller.effect("Zoom Scale")("Slider").setValue(100);
                controller.effect("Camera Focus")("Point").setValue([footageW / 2, footageH / 2]);
            }

            // 13. Create Master Cursor Null (Carries Spring Position, Velocity Sway & Click Bounce)
            var cursorMaster = comp.layers.addNull();
            cursorMaster.name = "TraceMotion_Cursor_Master";
            cursorMaster.guideLayer = true;
            cursorMaster.parent = cameraRig;
            cursorMaster.transform.anchorPoint.setValue([0, 0]);
            cursorMaster.motionBlur = options.enableMotionBlur;

            // Apply smoothed position keyframes to Cursor Master
            var masterPosProp = cursorMaster.transform.position;
            for (var f = 0; f < finalKeys.length; f++) {
                var s = finalKeys[f];
                masterPosProp.setValueAtTime(s.timeSec, [s.cx * footageW, s.cy * footageH]);
            }
            for (var ck = 1; ck <= masterPosProp.numKeys; ck++) {
                try {
                    masterPosProp.setSpatialContinuousAtKey(ck, true);
                    masterPosProp.setSpatialAutoBezierAtKey(ck, true);
                } catch (e) {}
            }

            // Apply Velocity Sway Rotation Expression
            if (options.swayAmount > 0) {
                cursorMaster.transform.rotation.expression =
                    "var v = transform.position.velocity;\n" +
                    "var spd = Math.sqrt(v[0] * v[0] + v[1] * v[1]);\n" +
                    "if (spd > 0.5) {\n" +
                    "    var ctrl = thisComp.layer('" + controller.name + "');\n" +
                    "    var sway = ctrl.effect('Cursor Sway')('Slider');\n" +
                    "    var speedFactor = Math.min(1.0, spd / 1400.0);\n" +
                    "    var dirBias = (v[0] + v[1] * 0.65) / spd;\n" +
                    "    clamp(dirBias * speedFactor * 10.0 * sway * 3.0, -35, 35);\n" +
                    "} else { 0; }";
            }

            // Apply Click Bounce Scale Keyframes to Cursor Master
            if (options.createClickBounce) {
                var masterScaleProp = cursorMaster.transform.scale;
                var bounceEase = new KeyframeEase(0, 75.0);

                for (var rIdx = 0; rIdx < clickSamplesList.length; rIdx++) {
                    var rawS = clickSamplesList[rIdx];
                    var clickTime = rawS.timeMs / 1000.0;

                    masterScaleProp.setValueAtTime(clickTime, [100.0, 100.0]);
                    masterScaleProp.setValueAtTime(clickTime + 0.175, [84.0, 84.0]);
                    masterScaleProp.setValueAtTime(clickTime + 0.350, [100.0, 100.0]);

                    var keyCount = masterScaleProp.numKeys;
                    if (keyCount >= 3) {
                        try {
                            SafeProp.setTemporalEase(masterScaleProp, keyCount - 2, bounceEase, bounceEase);
                            SafeProp.setTemporalEase(masterScaleProp, keyCount - 1, bounceEase, bounceEase);
                            SafeProp.setTemporalEase(masterScaleProp, keyCount, bounceEase, bounceEase);
                        } catch (e) {}
                    }
                }
            }

            // 14. Multi-State Cursor Rig (Import All Available Cursor States, Parent to Master Null)
            var styleDef = CURSOR_MANIFEST[options.cursorStyle] || CURSOR_MANIFEST.tahoe;
            var baseCursorHeight = 28.0 * 2.5 * (options.cursorScalePct / 100.0) * (footageH / 1080.0) * styleDef.sizeMultiplier;

            var cursorStateNames = ["arrow"];
            if (options.dynamicCursorStates && styleDef.cursors) {
                var potentialStates = ["pointer", "text", "crosshair", "open-hand", "closed-hand", "resize-ew", "resize-ns", "not-allowed", "wait"];
                for (var ps = 0; ps < potentialStates.length; ps++) {
                    var stKey = potentialStates[ps];
                    if (styleDef.cursors[stKey]) {
                        cursorStateNames.push(stKey);
                    }
                }
            }

            var stateLayers = {};
            for (var sn = 0; sn < cursorStateNames.length; sn++) {
                var stateName = cursorStateNames[sn];
                var cData = styleDef.cursors ? styleDef.cursors[stateName] : null;
                var assetFile = getCursorAssetFile(options.cursorStyle, stateName, options.preferSvg);

                var sLayer = null;
                var sWidth = 512;
                var sHeight = 512;

                if (assetFile && assetFile.exists) {
                    var cFootage = proj.importFile(new ImportOptions(assetFile));
                    sLayer = comp.layers.add(cFootage);
                    sLayer.name = "TraceMotion_Cursor_" + stateName + " [" + styleDef.label + "]";
                    sWidth = cFootage.width;
                    sHeight = cFootage.height;
                } else if (stateName === "arrow") {
                    // Procedural fallback for arrow
                    sLayer = comp.layers.addShape();
                    sLayer.name = "TraceMotion_Cursor_arrow [Procedural Vector]";

                    var rootGrp = sLayer.property("ADBE Root Vectors Group");
                    var shapeGrp = rootGrp.addProperty("ADBE Vector Group");
                    shapeGrp.name = "Cursor Arrow";
                    var grpVectors = shapeGrp.property("ADBE Vectors Group");

                    var pathShape = new Shape();
                    pathShape.vertices = [[0, 0], [0, 24], [6, 18], [11, 28], [14, 26], [9, 16], [17, 16]];
                    pathShape.closed = true;

                    var pathProp = grpVectors.addProperty("ADBE Vector Shape - Group");
                    pathProp.property("ADBE Vector Shape").setValue(pathShape);

                    var fillProp = grpVectors.addProperty("ADBE Vector Graphic - Fill");
                    fillProp.property("ADBE Vector Fill Color").setValue([0.05, 0.05, 0.05, 1.0]);

                    var strokeProp = grpVectors.addProperty("ADBE Vector Graphic - Stroke");
                    strokeProp.property("ADBE Vector Stroke Color").setValue([1.0, 1.0, 1.0, 1.0]);
                    strokeProp.property("ADBE Vector Stroke Width").setValue(2.0);

                    sWidth = 32;
                    sHeight = 32;
                    cData = { anchorX: 0, anchorY: 0 };
                }

                if (sLayer) {
                    sLayer.parent = cursorMaster;
                    sLayer.motionBlur = options.enableMotionBlur;

                    var hX = sWidth * (cData ? cData.anchorX : 0);
                    var hY = sHeight * (cData ? cData.anchorY : 0);
                    sLayer.transform.anchorPoint.setValue([hX, hY]);
                    sLayer.transform.position.setValue([0, 0]);

                    var sFactor = (baseCursorHeight / sHeight) * 100.0;
                    sLayer.transform.scale.setValue([sFactor, sFactor]);

                    sLayer.transform.opacity.setValue(stateName === "arrow" ? 100.0 : 0.0);
                    stateLayers[stateName] = sLayer;
                }
            }

            // Keyframe cursor state transitions using Hold keyframes on Opacity
            if (options.dynamicCursorStates && cursorStateNames.length > 1) {
                var lastState = "arrow";
                for (var sk = 0; sk < rawSamples.length; sk++) {
                    var sampleState = rawSamples[sk];
                    var tSec = sampleState.timeMs / 1000.0;

                    // Normalize telemetry cursor state
                    var curType = (sampleState.cursorType || sampleState.cursorVisualType || "").toLowerCase();
                    var activeState = "arrow";

                    if (sampleState.interactionType === "click" || sampleState.interactionType === "double-click") {
                        activeState = stateLayers["pointer"] ? "pointer" : "arrow";
                    } else if (curType === "pointer" || curType === "hand" || curType === "pointinghand") {
                        activeState = stateLayers["pointer"] ? "pointer" : "arrow";
                    } else if (curType === "text" || curType === "ibeam" || curType === "ibeamstroke") {
                        activeState = stateLayers["text"] ? "text" : "arrow";
                    } else if (curType === "crosshair" || curType === "cross") {
                        activeState = stateLayers["crosshair"] ? "crosshair" : "arrow";
                    } else if (curType === "open-hand" || curType === "grab" || curType === "openhand") {
                        activeState = stateLayers["open-hand"] ? "open-hand" : "arrow";
                    } else if (curType === "closed-hand" || curType === "grabbing" || curType === "closedhand") {
                        activeState = stateLayers["closed-hand"] ? "closed-hand" : "arrow";
                    } else if (curType === "resize-ew" || curType === "resize-horizontal" || curType === "resizeeastwest") {
                        activeState = stateLayers["resize-ew"] ? "resize-ew" : "arrow";
                    } else if (curType === "resize-ns" || curType === "resize-vertical" || curType === "resizenorthsouth") {
                        activeState = stateLayers["resize-ns"] ? "resize-ns" : "arrow";
                    } else if (curType === "not-allowed" || curType === "block") {
                        activeState = stateLayers["not-allowed"] ? "not-allowed" : "arrow";
                    } else if (curType === "wait" || curType === "busy" || curType === "beachball") {
                        activeState = stateLayers["wait"] ? "wait" : "arrow";
                    }

                    if (activeState !== lastState || sk === 0) {
                        for (var stKey in stateLayers) {
                            var op = (stKey === activeState) ? 100.0 : 0.0;
                            stateLayers[stKey].transform.opacity.setValueAtTime(tSec, op);
                        }
                        lastState = activeState;
                    }
                }

                // Apply HOLD interpolation on all state opacity keyframes
                for (var sName in stateLayers) {
                    var opProp = stateLayers[sName].transform.opacity;
                    var nOpKeys = opProp.numKeys;
                    for (var kIdx = 1; kIdx <= nOpKeys; kIdx++) {
                        try {
                            opProp.setInterpolationTypeAtKey(kIdx, KeyframeInterpolationType.HOLD);
                        } catch (eHold) {}
                    }
                }
            }

            // 15. Create Click Ripple VFX Layer (Transform Group fixed on rGroup, Positioned at exact Hotspot)
            if (options.clickEffect !== "none" && clickSamplesList.length > 0) {
                var rippleLayer = comp.layers.addShape();
                rippleLayer.name = "TraceMotion_Click_Ripples";
                rippleLayer.parent = cameraRig;
                rippleLayer.transform.anchorPoint.setValue([0, 0]);
                rippleLayer.transform.position.setValue([0, 0]);
                rippleLayer.transform.scale.setValue([100, 100]);
                rippleLayer.motionBlur = options.enableMotionBlur;

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
                    var sizeProp = ellipse.property("ADBE Vector Ellipse Size");

                    var stroke = rVectors.addProperty("ADBE Vector Graphic - Stroke");
                    stroke.property("ADBE Vector Stroke Color").setValue([rgbColor[0], rgbColor[1], rgbColor[2], 1.0]);
                    var strokeWProp = stroke.property("ADBE Vector Stroke Width");

                    // Transform Group is on rGroup (Vector Group), NOT rVectors!
                    var transGroup = rGroup.property("ADBE Vector Transform Group");
                    var posProp = transGroup.property("ADBE Vector Position");
                    var opacProp = transGroup.property("ADBE Vector Group Opacity");

                    // Set ripple center exactly at the calibrated click hotspot coordinates
                    posProp.setValue([clickSample.cx * footageW, clickSample.cy * footageH]);

                    opacProp.setValueAtTime(0, 0.0);
                    sizeProp.setValueAtTime(0, [0, 0]);

                    if (tClickStart > 0.02) {
                        opacProp.setValueAtTime(tClickStart - 0.016, 0.0);
                        sizeProp.setValueAtTime(tClickStart - 0.016, [0, 0]);
                    }

                    opacProp.setValueAtTime(tClickStart, 65.0);
                    opacProp.setValueAtTime(tClickEnd, 0.0);
                    opacProp.setValueAtTime(tClickEnd + 0.016, 0.0);

                    sizeProp.setValueAtTime(tClickStart, [4, 4]);
                    sizeProp.setValueAtTime(tClickEnd, [maxRadius * 2, maxRadius * 2]);
                    sizeProp.setValueAtTime(tClickEnd + 0.016, [0, 0]);

                    strokeWProp.setValueAtTime(tClickStart, 2.8);
                    strokeWProp.setValueAtTime(tClickEnd, 0.5);

                    var cubicEase = new KeyframeEase(0, 85.0);
                    try {
                        var kStart = sizeProp.nearestKeyIndex(tClickStart);
                        var kEnd = sizeProp.nearestKeyIndex(tClickEnd);
                        SafeProp.setTemporalEase(sizeProp, kStart, cubicEase, cubicEase);
                        SafeProp.setTemporalEase(sizeProp, kEnd, cubicEase, cubicEase);
                    } catch (eEase) {}
                }
            }

            // Lock Background Layer at the very end
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
                    "• Background: " + (bgLayer ? bgLayer.name : "None") + "\n" +
                    "• Selected Cursor: " + styleDef.label + " (" + cursorStateNames.length + " states)\n" +
                    "• Smart Auto-Zoom: " + targetZoomScale + "x (" + options.zoomMode + ")\n" +
                    "• Zero Render Artifacts: Verified clean ripple & track matte rig",
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
    // Responsive ScriptUI Studio Panel (Modern Dark Palette, Non-Resetting Scroll)
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
        // SCROLLABLE CONTAINER (Responsive Viewport with Scrollbar)
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
        scrollViewport.alignChildren = ["fill", undefined];
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

        var cursorPreviewRow = secCursor.add("group");
        cursorPreviewRow.orientation = "row";
        cursorPreviewRow.alignChildren = ["left", "center"];
        cursorPreviewRow.spacing = 10;
        cursorPreviewRow.margins = [0, 2, 0, 4];

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
            cursorResTxt.text = sDef.folder ? "512px Retina Multi-State" : "Procedural Vector Shape";

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
        var radPng = radRow.add("radiobutton", undefined, "PNG (Universal 2020+)");
        var radSvg = radRow.add("radiobutton", undefined, "Vector SVG (AE 2024+)");

        var canUseSvg = (aeMajorVer >= 24.0);
        var savedUseSvg = (getPref("preferSvg", "false") === "true") && canUseSvg;
        radPng.value = !savedUseSvg;
        radSvg.value = savedUseSvg;
        radSvg.enabled = canUseSvg;

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

        var chkDynamicStates = secCursor.add("checkbox", undefined, "Multi-State Switching (Arrow, Pointer, Text, Grab, Wait)");
        chkDynamicStates.value = getPref("dynamicCursorStates", "true") === "true";
        chkDynamicStates.helpTip = "Imports and dynamically switches all cursor states using calibrated hotspots and Hold keyframes.";

        var chkSway = secCursor.add("checkbox", undefined, "Dynamic Velocity Sway (PI/18 Tilt Physics)");
        chkSway.value = getPref("enableSway", "true") === "true";

        var chkBounce = secCursor.add("checkbox", undefined, "Click Bounce Depression (350ms Half-Sine 84%)");
        chkBounce.value = getPref("enableBounce", "true") === "true";

        var fxRow = secCursor.add("group");
        var fxLbl = fxRow.add("statictext", undefined, "Click Ripple VFX:");
        fxLbl.preferredSize.width = 90;
        var fxDropdown = fxRow.add("dropdownlist", undefined, ["Recordly Accent Ring", "None"]);
        var savedFxIdx = parseInt(getPref("clickEffectIdx", "0"), 10);
        fxDropdown.selection = (savedFxIdx >= 0 && savedFxIdx < 2) ? savedFxIdx : 0;

        var colorRow = secCursor.add("group");
        var colLbl = colorRow.add("statictext", undefined, "Ripple Color (Hex):");
        colLbl.preferredSize.width = 90;
        var colorInput = colorRow.add("edittext", undefined, getPref("clickColor", "#2563EB"));
        colorInput.characters = 8;

        // --- SECTION 3: Smart Zoom & Camera Engine ---
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

        var chkMotionBlur = secZoom.add("checkbox", undefined, "Native Composition Motion Blur");
        chkMotionBlur.value = getPref("enableMotionBlur", "true") === "true";

        // --- SECTION 4: Window Framing, Shadows & Backdrop ---
        var secFrame = contentGroup.add("panel", undefined, "4. Window Framing, Shadows & Backdrop");
        secFrame.orientation = "column";
        secFrame.alignChildren = ["fill", "top"];
        secFrame.spacing = 5;
        secFrame.margins = 8;

        var bgPreviewRow = secFrame.add("group");
        bgPreviewRow.orientation = "row";
        bgPreviewRow.alignChildren = ["left", "center"];
        bgPreviewRow.spacing = 10;
        bgPreviewRow.margins = [0, 2, 0, 4];

        var bgCard = bgPreviewRow.add("panel", [0, 0, 84, 44], undefined, { borderStyle: "none" });
        bgCard.size = [84, 44];
        bgCard.preferredSize = [84, 44];
        bgCard.maximumSize = [84, 44];

        // Build list of all available wallpapers + gradients
        var bgItems = [];
        var bgItemKeys = [];

        // Add 39 Recordly Wallpapers
        for (var wpI = 0; wpI < RECORDLY_WALLPAPERS.length; wpI++) {
            var wpObj = RECORDLY_WALLPAPERS[wpI];
            bgItems.push(wpObj.label + " [Wallpaper]");
            bgItemKeys.push(wpObj.filename);
        }

        // Add Gradient Presets
        bgItems.push("Tahoe Dawn [Gradient]");
        bgItemKeys.push("tahoe-dawn");
        bgItems.push("Dark Studio [Gradient]");
        bgItemKeys.push("dark-studio");
        bgItems.push("Midnight Deep [Gradient]");
        bgItemKeys.push("midnight-deep");
        bgItems.push("Sequoia Azure [Gradient]");
        bgItemKeys.push("sequoia-azure");
        bgItems.push("Clean Charcoal Solid");
        bgItemKeys.push("solid-charcoal");
        bgItems.push("Transparent / None");
        bgItemKeys.push("none");

        var currentBgKey = getPref("selectedBgKey", "tahoe-light.jpg");
        var savedBgIndex = 0;
        for (var bIdx = 0; bIdx < bgItemKeys.length; bIdx++) {
            if (bgItemKeys[bIdx] === currentBgKey) {
                savedBgIndex = bIdx;
                break;
            }
        }

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

            var bData = BACKGROUND_PRESETS[currentBgKey];
            if (!bData) {
                // If it's a wallpaper file, draw an aesthetic blue/charcoal background card
                bData = { start: [0.18, 0.35, 0.65], end: [0.08, 0.12, 0.22] };
            }

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

        var bgTitleTxt = bgMetaGrp.add("statictext", undefined, "Tahoe Light");
        try { bgTitleTxt.graphics.font = ScriptUI.newFont("Verdana", "Bold", 11); } catch (e) {}
        var bgTypeTxt = bgMetaGrp.add("statictext", undefined, "Recordly 4K Wallpaper");

        var bgRow = secFrame.add("group");
        var bgLbl = bgRow.add("statictext", undefined, "Backdrop Asset:");
        bgLbl.preferredSize.width = 90;
        var bgDropdown = bgRow.add("dropdownlist", undefined, bgItems);
        bgDropdown.selection = savedBgIndex;

        function updateBgPreview(key) {
            currentBgKey = key;
            if (key === "none") {
                bgTitleTxt.text = "Transparent";
                bgTypeTxt.text = "Edge-to-Edge Composition";
            } else if (BACKGROUND_PRESETS[key]) {
                var pr = BACKGROUND_PRESETS[key];
                bgTitleTxt.text = pr.label.split(" [")[0];
                bgTypeTxt.text = pr.isRadial ? "Radial Gradient Ramp" : "Linear Gradient Ramp";
            } else {
                // Look up in RECORDLY_WALLPAPERS
                var label = key;
                for (var w = 0; w < RECORDLY_WALLPAPERS.length; w++) {
                    if (RECORDLY_WALLPAPERS[w].filename === key) {
                        label = RECORDLY_WALLPAPERS[w].label;
                        break;
                    }
                }
                bgTitleTxt.text = label;
                bgTypeTxt.text = "4K / Retina Desktop Wallpaper";
            }

            try {
                bgCard.hide();
                bgCard.show();
            } catch (e) {}
        }

        bgDropdown.onChange = function () {
            var selIdx = bgDropdown.selection ? bgDropdown.selection.index : 0;
            var k = bgItemKeys[selIdx] || "tahoe-light.jpg";
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

        // --- SECTION 5: Action Buttons (Fixed at Bottom) ---
        var actionGrp = win.add("group");
        actionGrp.orientation = "row";
        actionGrp.alignment = ["fill", "bottom"];
        actionGrp.spacing = 6;

        var helpBtn = actionGrp.add("button", undefined, "[?] Help");
        helpBtn.preferredSize.width = 60;

        var generateBtn = actionGrp.add("button", undefined, "★ Build TraceMotion Rig");
        generateBtn.alignment = ["fill", "center"];
        try { generateBtn.graphics.font = ScriptUI.newFont("Verdana", "Bold", 12); } catch (e) {}

        helpBtn.onClick = function () {
            alert(
                "TraceMotion Studio - 1:1 Recordly Parity Engine\n\n" +
                "• Master Camera Rig: Complete camera pan and zoom controller parented cleanly to avoid coordinate drift.\n" +
                "• Window Framing: Precision rounded-corner shape matte with independent multi-stage drop shadows (Ambient, Body, Contact).\n" +
                "• Multi-State Cursor Rig: Imports all available cursor states (Arrow, Pointer Hand, Text I-Beam, Grab, Wait) calibrated with exact pixel hotspots.\n" +
                "• Wallpapers: Complete library of 39 4K Retina wallpapers from Recordly with automatic cover scale.\n" +
                "• Smart Auto-Zoom: Dynamic dwelling and cluster magnification easing curves.\n\n" +
                "Compatible with After Effects CC 2020 through CC 2026+.",
                "TraceMotion Guide"
            );
        };

        generateBtn.onClick = function () {
            if (!selectedVideoFile || !selectedVideoFile.exists) {
                if (videoPathInput.text) {
                    var vf = new File(videoPathInput.text);
                    if (vf.exists) selectedVideoFile = vf;
                }
            }
            if (!selectedJsonFile || !selectedJsonFile.exists) {
                if (jsonPathInput.text) {
                    var jf = new File(jsonPathInput.text);
                    if (jf.exists) selectedJsonFile = jf;
                }
            }

            if (!selectedVideoFile || !selectedVideoFile.exists) {
                alert("Please select a valid screen recording video file.", "TraceMotion Error");
                return;
            }
            if (!selectedJsonFile || !selectedJsonFile.exists) {
                alert("Please select a companion cursor telemetry JSON file (.cursor.json).", "TraceMotion Error");
                return;
            }

            var selStyleKey = styleKeys[cursorDropdown.selection ? cursorDropdown.selection.index : 0] || "tahoe";
            var zoomDepths = [1.25, 1.50, 1.80, 2.20, 3.50];
            var zoomModes = ["auto-cluster", "continuous", "static"];
            var fxModes = ["ripple", "none"];

            var selBgIdx = bgDropdown.selection ? bgDropdown.selection.index : 0;
            var chosenBg = bgItemKeys[selBgIdx] || "tahoe-light.jpg";

            var opts = {
                cursorStyle: selStyleKey,
                preferSvg: radSvg.value,
                cursorScalePct: parseFloat(sizeInput.text) || 100,
                dynamicCursorStates: chkDynamicStates.value,
                swayAmount: chkSway.value ? 0.4 : 0.0,
                createClickBounce: chkBounce.value,
                clickEffect: fxModes[fxDropdown.selection ? fxDropdown.selection.index : 0] || "ripple",
                clickEffectColor: colorInput.text || "#2563EB",
                clickEffectScale: 100.0,
                zoomMode: zoomModes[zoomModeDropdown.selection ? zoomModeDropdown.selection.index : 0] || "auto-cluster",
                zoomDepthScale: zoomDepths[depthDropdown.selection ? depthDropdown.selection.index : 2] || 1.80,
                cursorSmoothing: parseFloat(smoothInput.text) || 0.67,
                motionPreset: "smooth",
                enableMotionBlur: chkMotionBlur.value,
                cornerRadius: parseFloat(cornerInput.text) || 20,
                shadowIntensity: parseFloat(shadowInput.text) || 65,
                canvasMargin: parseFloat(marginInput.text) || 12,
                wallpaper: chosenBg,
                simplificationTolerance: 0.25,
                silent: false
            };

            // Save persistent preferences
            savePref("cursorStyleIdx", cursorDropdown.selection ? cursorDropdown.selection.index : 0);
            savePref("preferSvg", radSvg.value);
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
            savePref("selectedBgKey", chosenBg);
            savePref("cornerRadius", cornerInput.text);
            savePref("shadowIntensity", shadowInput.text);
            savePref("canvasMargin", marginInput.text);

            try {
                buildTraceMotionRig(selectedVideoFile, selectedJsonFile, opts);
            } catch (err) {}
        };

        // =====================================================================
        // Scroll Management (Non-Resetting Scroll Bar & Mouse Wheel Handler)
        // =====================================================================
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

        function updateScroll() {
            try {
                var prevVal = scrollBar.value || 0;
                win.layout.resize();
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
                    doScroll(prevVal);
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

        var handleWheel = function (e) {
            if (scrollBar.enabled) {
                var step = (e.deltaY !== undefined) ? e.deltaY : ((e.detail !== undefined) ? e.detail * 20 : 35);
                doScroll(scrollBar.value + step);
            }
        };
        try { win.addEventListener("wheel", handleWheel); } catch (e) {}
        try { win.addEventListener("mousewheel", handleWheel); } catch (e) {}

        if (win instanceof Window) {
            win.center();
            win.show();
        } else {
            win.layout.layout(true);
        }

        updateScroll();
        try {
            updateCursorPreview(styleKeys[cursorDropdown.selection ? cursorDropdown.selection.index : 0]);
        } catch (e) {}

        return win;
    }

    // Export module functions for automation / headless pipeline execution
    if (typeof TraceMotion === "undefined") {
        TraceMotion = {};
    }
    TraceMotion.buildRig = buildTraceMotionRig;
    TraceMotion.buildUI = buildUI;
    TraceMotion.CURSOR_MANIFEST = CURSOR_MANIFEST;
    TraceMotion.WALLPAPERS = RECORDLY_WALLPAPERS;

    // Launch UI if not running in headless automated test suite
    if (typeof $ !== "undefined" && !$.global.__TRACEMOTION_HEADLESS_TEST__) {
        buildUI(thisObj);
    }

})(this);
