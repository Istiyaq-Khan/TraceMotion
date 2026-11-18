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
    // ExtendScript Polyfills & Helper Utilities (ES3 Compatible)
    // =========================================================================
    if (!Object.keys) {
        Object.keys = function (obj) {
            var keys = [];
            for (var prop in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, prop)) {
                    keys.push(prop);
                }
            }
            return keys;
        };
    }

    function getObjectKeys(obj) {
        if (!obj) return [];
        var keys = [];
        for (var prop in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, prop)) {
                keys.push(prop);
            }
        }
        return keys;
    }

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
        if (typeof Folder !== "undefined" && Folder.userData && Folder.userData.fsName) {
            searchDirs.push(Folder.userData.fsName + "/Adobe/After Effects/TraceMotion/assets/cursors/" + style.folder + "/");
        }

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
                    searchDirs.push(scriptF.parent.fsName + "/assets/cursors/previews/" + styleId + "_preview.png");
                    searchDirs.push(scriptF.parent.fsName + "/assets/cursors/previews/" + styleId + ".png");
                    searchDirs.push(scriptF.parent.fsName + "/assets/cursors/" + styleId + "/arrow.png");
                }
            }
        } catch (e) {}
        searchDirs.push("D:/all my code/TraceMotion/after-effects-importer/assets/cursors/previews/" + styleId + "_preview.png");
        searchDirs.push("D:/all my code/TraceMotion/after-effects-importer/assets/cursors/previews/" + styleId + ".png");
        searchDirs.push("D:/all my code/TraceMotion/after-effects-importer/assets/cursors/" + styleId + "/arrow.png");

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
        if (typeof Folder !== "undefined" && Folder.userData && Folder.userData.fsName) {
            searchDirs.push(Folder.userData.fsName + "/Adobe/After Effects/TraceMotion/assets/wallpapers/" + filename);
        }

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
    
    // =========================================================================
    // Recordly Telemetry Interaction & Typing Detection Engine
    // =========================================================================
    function detectTelemetryInteractions(rawSamples, durationSec, enableTypingSpeedup) {
        var totalMs = durationSec * 1000.0;
        var dragIntervals = [];
        var typingIntervals = [];

        // 1. Detect drag and text selection intervals
        for (var i = 0; i < rawSamples.length; i++) {
            var s = rawSamples[i];
            var it = s.interactionType;
            if (it === "click" || it === "double-click") {
                for (var j = i + 1; j < rawSamples.length && (rawSamples[j].timeMs - s.timeMs) <= 4000; j++) {
                    var candidate = rawSamples[j];
                    if (candidate.interactionType === "mouseup") {
                        var dragDuration = candidate.timeMs - s.timeMs;
                        var dragDx = Math.abs(candidate.cx - s.cx);
                        var dragDy = Math.abs(candidate.cy - s.cy);
                        var dragDist = Math.sqrt(dragDx * dragDx + dragDy * dragDy);
                        if (dragDuration >= 120 && dragDist > 0.012) {
                            dragIntervals.push({
                                startMs: s.timeMs,
                                endMs: candidate.timeMs,
                                isText: dragDx > dragDy * 1.4 || s.cursorType === "text"
                            });
                        }
                        break;
                    }
                }
            }
        }

        // Text selection motion runs (I-beam moving horizontally across text)
        var textRunStart = -1;
        var textRunStartPos = null;
        for (var k = 0; k < rawSamples.length; k++) {
            var smp = rawSamples[k];
            if (smp.cursorType === "text") {
                if (textRunStart < 0) {
                    textRunStart = smp.timeMs;
                    textRunStartPos = [smp.cx, smp.cy];
                }
            } else {
                if (textRunStart >= 0 && textRunStartPos) {
                    var lastS = rawSamples[k - 1];
                    var tDur = lastS.timeMs - textRunStart;
                    var tDx = Math.abs(lastS.cx - textRunStartPos[0]);
                    var tDy = Math.abs(lastS.cy - textRunStartPos[1]);
                    // Only treat as drag if there is genuine horizontal displacement across text
                    if (tDur >= 200 && tDx > 0.02 && tDx > tDy * 1.4) {
                        dragIntervals.push({
                            startMs: textRunStart,
                            endMs: lastS.timeMs,
                            isText: true
                        });
                    }
                    textRunStart = -1;
                    textRunStartPos = null;
                }
            }
        }

        // 2. Detect typing intervals (click into text field followed by stationary dwell)
        for (var c = 0; c < rawSamples.length; c++) {
            var clickS = rawSamples[c];
            if ((clickS.interactionType === "click" || clickS.interactionType === "double-click") && clickS.cursorType === "text") {
                var windowEnd = Math.min(totalMs, clickS.timeMs + 8000);
                var maxDisp = 0;
                var lastStationaryMs = clickS.timeMs;
                for (var w = c + 1; w < rawSamples.length && rawSamples[w].timeMs <= windowEnd; w++) {
                    var sMove = rawSamples[w];
                    var d = Math.sqrt(Math.pow(sMove.cx - clickS.cx, 2) + Math.pow(sMove.cy - clickS.cy, 2));
                    if (d > maxDisp) maxDisp = d;
                    if (maxDisp > 0.025) break; // User moved mouse away, typing session finished
                    lastStationaryMs = sMove.timeMs;
                }
                var typingDur = lastStationaryMs - clickS.timeMs;
                if (typingDur >= 1000) {
                    typingIntervals.push({
                        startMs: clickS.timeMs,
                        endMs: lastStationaryMs,
                        cx: clickS.cx,
                        cy: clickS.cy
                    });
                    // Advance c past this typing block to avoid duplicates
                    while (c < rawSamples.length - 1 && rawSamples[c + 1].timeMs <= lastStationaryMs) {
                        c++;
                    }
                }
            }
        }

        // Merge overlapping typing intervals
        var mergedTyping = [];
        if (typingIntervals.length > 0) {
            typingIntervals.sort(function(a, b) { return a.startMs - b.startMs; });
            var curTyping = {
                startMs: typingIntervals[0].startMs,
                endMs: typingIntervals[0].endMs,
                cx: typingIntervals[0].cx,
                cy: typingIntervals[0].cy
            };
            for (var m = 1; m < typingIntervals.length; m++) {
                var nextT = typingIntervals[m];
                if (nextT.startMs <= curTyping.endMs + 600) {
                    curTyping.endMs = Math.max(curTyping.endMs, nextT.endMs);
                } else {
                    mergedTyping.push(curTyping);
                    curTyping = {
                        startMs: nextT.startMs,
                        endMs: nextT.endMs,
                        cx: nextT.cx,
                        cy: nextT.cy
                    };
                }
            }
            mergedTyping.push(curTyping);
        }

        // 3. Build 2.0x Time-Mapping Function for Typing Speed-Up
        var speedFactor = 2.0;
        var totalSavedSec = 0;
        if (enableTypingSpeedup && mergedTyping.length > 0) {
            for (var t = 0; t < mergedTyping.length; t++) {
                var durSec = (mergedTyping[t].endMs - mergedTyping[t].startMs) / 1000.0;
                totalSavedSec += durSec * (1.0 - 1.0 / speedFactor);
            }
        }

        function timeMapFn(tSec) {
            if (!enableTypingSpeedup || mergedTyping.length === 0) {
                return { compSec: tSec, isTyping: false };
            }
            var tMs = tSec * 1000.0;
            var savedMs = 0;
            var inTyping = false;
            for (var i = 0; i < mergedTyping.length; i++) {
                var seg = mergedTyping[i];
                if (tMs <= seg.startMs) {
                    break;
                } else if (tMs >= seg.endMs) {
                    savedMs += (seg.endMs - seg.startMs) * (1.0 - 1.0 / speedFactor);
                } else {
                    savedMs += (tMs - seg.startMs) * (1.0 - 1.0 / speedFactor);
                    inTyping = true;
                    break;
                }
            }
            return {
                compSec: Math.max(0, (tMs - savedMs) / 1000.0),
                isTyping: inTyping
            };
        }

        function isDragAtTime(tMs) {
            for (var d = 0; d < dragIntervals.length; d++) {
                if (tMs >= dragIntervals[d].startMs && tMs <= dragIntervals[d].endMs) {
                    return true;
                }
            }
            return false;
        }

        return {
            dragIntervals: dragIntervals,
            typingIntervals: mergedTyping,
            totalSavedSec: totalSavedSec,
            timeMapFn: timeMapFn,
            isDragAtTime: isDragAtTime
        };
    }

    // =========================================================================
    // Recordly Smart Zoom & Cluster Detection Engine (with Typing Clusters)
    // =========================================================================
    function buildRecordlyZoomClusters(rawSamples, durationSec, zoomScale, typingIntervals) {
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

        // 3. Typing Intervals as High-Priority Focus Candidates
        if (typingIntervals && typingIntervals.length > 0) {
            for (var tp = 0; tp < typingIntervals.length; tp++) {
                var tItem = typingIntervals[tp];
                candidates.push({
                    timeMs: Math.round((tItem.startMs + tItem.endMs) / 2),
                    cx: tItem.cx,
                    cy: tItem.cy,
                    strength: 2400,
                    isExplicit: true
                });
            }
        }

        if (candidates.length === 0) return [];

        candidates.sort(function (a, b) { return a.timeMs - b.timeMs; });

        // Merge Clusters within mergeGapMs
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

        // Clamp focus to Recordly viewport safety bounds
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

            // Analyze telemetry for drags, text selection, and typing speedup
            var enableTypingSpeedup = options.enableTypingSpeedup !== false;
            var telemetryAnalysis = detectTelemetryInteractions(rawSamples, duration, enableTypingSpeedup);
            var compDuration = Math.max(0.2, duration - telemetryAnalysis.totalSavedSec);
            var timeMapFn = telemetryAnalysis.timeMapFn;

            // 3. Canvas Sizing with Breathing Room Margin
            var marginPct = Math.max(0, Math.min(30, options.canvasMargin !== undefined ? options.canvasMargin : 12));
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
                compDuration,
                fps
            );
            try { comp.openInViewer(); } catch (viewerErr) {}
            comp.motionBlur = options.enableMotionBlur !== false;

            // -----------------------------------------------------------------
            // RIG LAYER HIERARCHY:
            // Layer 1 (Top): TraceMotion_Click_Ripples (Two-Tier Shockwave Shape Layer)
            // Layer 2..N:    Cursor State Layers -> parented to Cursor Master
            // Layer N+1:     TraceMotion_Cursor_Master (Null Layer) -> parented to Camera Rig
            // Layer N+2:     TraceMotion_Camera_Controller (Null Guide Layer) -> carries all controls
            // Layer N+3:     TraceMotion_Camera_Rig (Master Null) -> pans & zooms all window elements
            // Layer N+4:     TraceMotion_Window_Matte (Shape Layer, Alpha Matte for Video)
            // Layer N+5:     Clean_Screen_Capture (Video Footage, Time-Remapped during typing)
            // Layer N+6:     TraceMotion_Window_Shadow (Shape Layer with 3 Drop Shadows)
            // Layer N+7:     TraceMotion_Background (Cover-scale Wallpaper or Gradient)
            // -----------------------------------------------------------------

            // 5. Add Background Layer (Wallpaper or Gradient)
            var bgLayer = null;
            var wpKey = options.wallpaper || options.backgroundPreset || "tahoe-light.jpg";

            if (wpKey !== "none") {
                var wpFile = getWallpaperAssetFile(wpKey.indexOf(".") > 0 ? wpKey : (wpKey + ".jpg"));
                if (!wpFile || !wpFile.exists) {
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

                if (!bgLayer) {
                    var bgData = BACKGROUND_PRESETS[wpKey] || BACKGROUND_PRESETS["tahoe-dawn"];
                    bgLayer = comp.layers.addSolid(bgData.start, "TraceMotion_Background", compW, compH, 1.0, compDuration);
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
                        SafeProp.setValue(rShape, 2);
                    } else {
                        SafeProp.setValue(rStartPt, [compW * 0.2, compH * 0.1]);
                        SafeProp.setValue(rEndPt, [compW * 0.8, compH * 0.9]);
                        SafeProp.setValue(rShape, 1);
                    }
                    SafeProp.setValue(rStartCol, bgData.start);
                    SafeProp.setValue(rEndCol, bgData.end);
                }
            }

            // 6. Create Master Camera Rig Null
            var cameraRig = comp.layers.addNull();
            cameraRig.name = "TraceMotion_Camera_Rig";
            cameraRig.guideLayer = true;
            cameraRig.transform.anchorPoint.setValue([0, 0]);
            cameraRig.transform.position.setValue([0, 0]);

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

            controller.effect("Zoom Scale")("Slider").setValue(100);
            controller.effect("Canvas Margin")("Slider").setValue(marginPct);
            controller.effect("Corner Radius")("Slider").setValue(options.cornerRadius !== undefined ? options.cornerRadius : 20);
            controller.effect("Shadow Intensity")("Slider").setValue(options.shadowIntensity !== undefined ? options.shadowIntensity : 65);
            controller.effect("Cursor Sway")("Slider").setValue(options.swayAmount !== undefined ? options.swayAmount : 0.4);
            controller.effect("Camera Focus")("Point").setValue([footageW / 2, footageH / 2]);

            // Connect Camera Rig Null transforms to Camera Controller (Recordly 1:1 Monotonic Straight-Line Focus)
            var maxZoomFactor = Math.max(1.0, (options.zoomDepthScale || 1.8));
            var maxZoomDeltaVal = Math.max(1.0, (maxZoomFactor - 1.0) * 100.0);

            cameraRig.transform.scale.expression =
                "var ctrl = thisComp.layer('" + controller.name + "');\n" +
                "var z = ctrl.effect('Zoom Scale')('Slider');\n" +
                "var m = ctrl.effect('Canvas Margin')('Slider');\n" +
                "var base = 100.0 * (1.0 - Math.min(0.4, m / 100.0));\n" +
                "var s = base * (z / 100.0);\n" +
                "[s, s];";

            cameraRig.transform.position.expression =
                "var ctrl = thisComp.layer('" + controller.name + "');\n" +
                "var z = ctrl.effect('Zoom Scale')('Slider');\n" +
                "var m = ctrl.effect('Canvas Margin')('Slider');\n" +
                "var focus = ctrl.effect('Camera Focus')('Point');\n" +
                "var base = 1.0 - Math.min(0.4, m / 100.0);\n" +
                "var curScale = base * (z / 100.0);\n" +
                "var stageCenterX = thisComp.width / 2;\n" +
                "var stageCenterY = thisComp.height / 2;\n" +
                "var fW = " + footageW + ";\n" +
                "var fH = " + footageH + ";\n" +
                "var centerPt = [fW / 2, fH / 2];\n" +
                "var progress = Math.max(0.0, Math.min(1.0, (z - 100.0) / " + maxZoomDeltaVal.toFixed(1) + "));\n" +
                "var targetFocus = [centerPt[0] + (focus[0] - centerPt[0]) * progress, centerPt[1] + (focus[1] - centerPt[1]) * progress];\n" +
                "[stageCenterX - targetFocus[0] * curScale, stageCenterY - targetFocus[1] * curScale];";

            // 8. Create Window Drop Shadow Layer (Underneath Video, Never Clipped by Track Matte!)
            var shadowLayer = comp.layers.addShape();
            shadowLayer.name = "TraceMotion_Window_Shadow";
            shadowLayer.parent = cameraRig;
            shadowLayer.transform.anchorPoint.setValue([0, 0]);
            shadowLayer.transform.position.setValue([0, 0]);
            shadowLayer.transform.scale.setValue([100, 100]);

            var shRoot = shadowLayer.property("ADBE Root Vectors Group");
            var shGrp = shRoot.addProperty("ADBE Vector Group");
            shGrp.name = "Shadow Bounds";
            var shVecs = shGrp.property("ADBE Vectors Group");

            var shRect = shVecs.addProperty("ADBE Vector Shape - Rect");
            shRect.property("ADBE Vector Rect Size").setValue([footageW, footageH]);
            shRect.property("ADBE Vector Rect Position").setValue([footageW / 2, footageH / 2]);
            shRect.property("ADBE Vector Rect Roundness").expression =
                "thisComp.layer('" + controller.name + "').effect('Corner Radius')('Slider');";

            var shFill = shVecs.addProperty("ADBE Vector Graphic - Fill");
            shFill.property("ADBE Vector Fill Color").setValue([1.0, 1.0, 1.0, 1.0]);

            // Multi-Stage Soft Drop Shadows on shadowLayer
            var shadowFx = shadowLayer.property("ADBE Effect Parade");

            var sh1 = shadowFx.addProperty("ADBE Drop Shadow");
            sh1.name = "Window Drop Shadow (Ambient)";
            sh1.property("Distance").setValue(16);
            sh1.property("Softness").setValue(48);
            sh1.property("Direction").setValue(180);
            sh1.property("Opacity").expression =
                "thisComp.layer('" + controller.name + "').effect('Shadow Intensity')('Slider') * 0.70;";

            var sh2 = shadowFx.addProperty("ADBE Drop Shadow");
            sh2.name = "Window Drop Shadow (Body)";
            sh2.property("Distance").setValue(6);
            sh2.property("Softness").setValue(16);
            sh2.property("Direction").setValue(180);
            sh2.property("Opacity").expression =
                "thisComp.layer('" + controller.name + "').effect('Shadow Intensity')('Slider') * 0.40;";

            var sh3 = shadowFx.addProperty("ADBE Drop Shadow");
            sh3.name = "Window Drop Shadow (Contact)";
            sh3.property("Distance").setValue(2);
            sh3.property("Softness").setValue(6);
            sh3.property("Direction").setValue(180);
            sh3.property("Opacity").expression =
                "thisComp.layer('" + controller.name + "').effect('Shadow Intensity')('Slider') * 0.25;";

            // 9. Add Clean Screen Capture Video Footage Layer
            var videoLayer = comp.layers.add(footageItem);
            videoLayer.name = "Clean_Screen_Capture";
            videoLayer.parent = cameraRig;
            videoLayer.transform.anchorPoint.setValue([0, 0]);
            videoLayer.transform.position.setValue([0, 0]);
            videoLayer.transform.scale.setValue([100, 100]);

            // Apply 2.0x Time Remapping during typing intervals if enabled
            if (enableTypingSpeedup && telemetryAnalysis.typingIntervals.length > 0) {
                try {
                    videoLayer.timeRemapEnabled = true;
                    var trProp = videoLayer.property("ADBE Time Remapping");
                    while (trProp.numKeys > 0) {
                        trProp.removeKey(1);
                    }
                    trProp.setValueAtTime(0, 0);

                    for (var ty = 0; ty < telemetryAnalysis.typingIntervals.length; ty++) {
                        var tSeg = telemetryAnalysis.typingIntervals[ty];
                        var rawStartSec = tSeg.startMs / 1000.0;
                        var rawEndSec = tSeg.endMs / 1000.0;
                        var mappedStart = timeMapFn(rawStartSec).compSec;
                        var mappedEnd = timeMapFn(rawEndSec).compSec;

                        trProp.setValueAtTime(mappedStart, rawStartSec);
                        trProp.setValueAtTime(mappedEnd, rawEndSec);
                    }
                    trProp.setValueAtTime(compDuration, duration);

                    // Linear temporal ease on time remap keys
                    for (var trk = 1; trk <= trProp.numKeys; trk++) {
                        trProp.setInterpolationTypeAtKey(trk, KeyframeInterpolationType.LINEAR);
                    }
                } catch (eTr) {}
            }

            // 10. Add Window Matte Shape Layer (Alpha Track Matte for Video Footage)
            var matteLayer = comp.layers.addShape();
            matteLayer.name = "TraceMotion_Window_Matte";
            matteLayer.parent = cameraRig;
            matteLayer.transform.anchorPoint.setValue([0, 0]);
            matteLayer.transform.position.setValue([0, 0]);
            matteLayer.transform.scale.setValue([100, 100]);

            var mRoot = matteLayer.property("ADBE Root Vectors Group");
            var mGrp = mRoot.addProperty("ADBE Vector Group");
            mGrp.name = "Window Matte Shape";
            var mVecs = mGrp.property("ADBE Vectors Group");

            var mRect = mVecs.addProperty("ADBE Vector Shape - Rect");
            mRect.property("ADBE Vector Rect Size").setValue([footageW, footageH]);
            mRect.property("ADBE Vector Rect Position").setValue([footageW / 2, footageH / 2]);
            mRect.property("ADBE Vector Rect Roundness").expression =
                "thisComp.layer('" + controller.name + "').effect('Corner Radius')('Slider');";

            var mFill = mVecs.addProperty("ADBE Vector Graphic - Fill");
            mFill.property("ADBE Vector Fill Color").setValue([1.0, 1.0, 1.0, 1.0]);

            var mRoot = matteLayer.property("ADBE Root Vectors Group");
            var mGrp = mRoot.addProperty("ADBE Vector Group");
            mGrp.name = "Window Matte Shape";
            var mVecs = mGrp.property("ADBE Vectors Group");

            var mRect = mVecs.addProperty("ADBE Vector Shape - Rect");
            mRect.property("ADBE Vector Rect Size").setValue([footageW, footageH]);
            mRect.property("ADBE Vector Rect Position").setValue([0, 0]);
            mRect.property("ADBE Vector Rect Roundness").expression =
                "thisComp.layer('" + controller.name + "').effect('Corner Radius')('Slider');";

            var mFill = mVecs.addProperty("ADBE Vector Graphic - Fill");
            mFill.property("ADBE Vector Fill Color").setValue([1.0, 1.0, 1.0, 1.0]);

            // Set Video Footage Track Matte to Alpha Matte
            matteLayer.moveBefore(videoLayer);
            try {
                if (typeof TrackMatteType !== "undefined" && typeof TrackMatteType.ALPHA !== "undefined") {
                    videoLayer.setTrackMatte(matteLayer, TrackMatteType.ALPHA);
                } else {
                    videoLayer.trackMatteType = TrackMatteType.ALPHA;
                }
            } catch (tmErr) {
                try { videoLayer.trackMatteType = TrackMatteType.ALPHA; } catch (eFallback) {}
            }

            // 11. Spring Physics Solver Configuration
            var feel = options.motionFeel || "natural";
            var smoothingVal = 0.5;
            if (feel === "snappy") smoothingVal = 0.2;
            else if (feel === "silky") smoothingVal = 0.85;
            else if (feel === "raw") smoothingVal = 0.0;

            var springConfig = getCursorSpringConfig(smoothingVal);
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

                var isDrag = telemetryAnalysis.isDragAtTime(timeMs);
                var smX, smY;

                if (isDrag) {
                    // Lock cursor 1:1 during text selection and dragging so it leads the highlight
                    xSpring.value = target.cx;
                    xSpring.velocity = 0;
                    ySpring.value = target.cy;
                    ySpring.velocity = 0;
                    smX = target.cx;
                    smY = target.cy;
                } else {
                    smX = stepSpringValue(xSpring, target.cx, dtMs, springConfig);
                    smY = stepSpringValue(ySpring, target.cy, dtMs, springConfig);
                }

                var mappedCompSec = timeMapFn(timeMs / 1000.0).compSec;
                simulatedPath.push({
                    timeMs: timeMs,
                    timeSec: mappedCompSec,
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

            // 12. Recordly Smart Zoom & Pan Trajectory (Strict Straight-Line Easing, No Wobble!)
            var targetZoomScale = Math.max(1.0, (options.zoomDepthScale || 1.8));

            if (options.zoomMode === "auto-cluster") {
                var clusters = buildRecordlyZoomClusters(rawSamples, duration, targetZoomScale, telemetryAnalysis.typingIntervals);
                var easeInOut = new KeyframeEase(0, 84.0);

                controller.effect("Camera Focus")("Point").setValueAtTime(0, [footageW / 2, footageH / 2]);
                controller.effect("Zoom Scale")("Slider").setValueAtTime(0, 100);

                var zoomTransitionSec = 0.95;
                for (var cl = 0; cl < clusters.length; cl++) {
                    var cluster = clusters[cl];
                    var rawStartSec = cluster.startSec;
                    var rawEndSec = cluster.endSec;

                    var tStart = timeMapFn(rawStartSec).compSec;
                    var tEnd = timeMapFn(rawEndSec).compSec;
                    var tInEnd = Math.min(tEnd, tStart + zoomTransitionSec);
                    var tOutStart = Math.max(tInEnd, tEnd - zoomTransitionSec * 0.85);

                    var focusPt = [cluster.cx * footageW, cluster.cy * footageH];

                    controller.effect("Zoom Scale")("Slider").setValueAtTime(tStart, 100);
                    controller.effect("Camera Focus")("Point").setValueAtTime(tStart, focusPt);

                    controller.effect("Zoom Scale")("Slider").setValueAtTime(tInEnd, targetZoomScale * 100);
                    controller.effect("Camera Focus")("Point").setValueAtTime(tInEnd, focusPt);

                    controller.effect("Zoom Scale")("Slider").setValueAtTime(tOutStart, targetZoomScale * 100);
                    controller.effect("Camera Focus")("Point").setValueAtTime(tOutStart, focusPt);

                    controller.effect("Zoom Scale")("Slider").setValueAtTime(tEnd, 100);
                    controller.effect("Camera Focus")("Point").setValueAtTime(tEnd, focusPt);
                }

                var zProp = controller.effect("Zoom Scale")("Slider");
                for (var zk = 1; zk <= zProp.numKeys; zk++) {
                    SafeProp.setTemporalEase(zProp, zk, easeInOut, easeInOut);
                }

                var pProp = controller.effect("Camera Focus")("Point");
                for (var pk = 1; pk <= pProp.numKeys; pk++) {
                    SafeProp.setTemporalEase(pProp, pk, easeInOut, easeInOut);
                    try {
                        // Strict Linear spatial tangents eliminate the boomerang loop / waggle!
                        pProp.setSpatialContinuousAtKey(pk, false);
                        pProp.setSpatialAutoBezierAtKey(pk, false);
                        pProp.setInterpolationTypeAtKey(pk, KeyframeInterpolationType.LINEAR);
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
                        contPProp.setSpatialContinuousAtKey(k, false);
                        contPProp.setSpatialAutoBezierAtKey(k, false);
                        contPProp.setInterpolationTypeAtKey(k, KeyframeInterpolationType.LINEAR);
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
            cursorMaster.motionBlur = options.enableMotionBlur !== false;

            var masterPosProp = cursorMaster.transform.position;
            for (var f = 0; f < finalKeys.length; f++) {
                var s = finalKeys[f];
                masterPosProp.setValueAtTime(s.timeSec, [s.cx * footageW, s.cy * footageH]);
            }
            for (var ck = 1; ck <= masterPosProp.numKeys; ck++) {
                try {
                    masterPosProp.setSpatialContinuousAtKey(ck, false);
                    masterPosProp.setSpatialAutoBezierAtKey(ck, false);
                    masterPosProp.setInterpolationTypeAtKey(ck, KeyframeInterpolationType.LINEAR);
                } catch (e) {}
            }

            // Dynamic Velocity Sway (Tilt Rotation)
            if (options.enableVelocitySway !== false) {
                cursorMaster.transform.rotation.expression =
                    "var swayMaxDeg = 10.0 * thisComp.layer('" + controller.name + "').effect('Cursor Sway')('Slider');\n" +
                    "var vx = transform.position.velocity[0];\n" +
                    "var normVx = Math.max(-1.0, Math.min(1.0, vx / 2200.0));\n" +
                    "-normVx * swayMaxDeg;";
            }

            // Click Bounce Compression
            if (options.enableClickBounce !== false && clickSamplesList.length > 0) {
                var scaleProp = cursorMaster.transform.scale;
                scaleProp.setValue([100, 100]);

                var bounceDurationSec = 0.350;
                var depressionScale = 84.0;
                var overshootScale = 104.0;

                for (var ci = 0; ci < clickSamplesList.length; ci++) {
                    var cSample = clickSamplesList[ci];
                    var mappedClickSec = timeMapFn(cSample.timeMs / 1000.0).compSec;
                    var tDip = mappedClickSec + 0.045;
                    var tOvershoot = mappedClickSec + 0.160;
                    var tSettle = mappedClickSec + bounceDurationSec;

                    if (mappedClickSec > 0.02) {
                        scaleProp.setValueAtTime(mappedClickSec - 0.016, [100, 100]);
                    }
                    scaleProp.setValueAtTime(mappedClickSec, [100, 100]);
                    scaleProp.setValueAtTime(tDip, [depressionScale, depressionScale]);
                    scaleProp.setValueAtTime(tOvershoot, [overshootScale, overshootScale]);
                    scaleProp.setValueAtTime(tSettle, [100, 100]);
                }
            }

            // 14. Create Multi-State Cursor Stack
            var styleKey = options.cursorStyle || "tahoe";
            var styleDef = CURSOR_MANIFEST[styleKey] || CURSOR_MANIFEST.tahoe;
            var userCursorScale = (options.cursorScale || 100) / 100.0;
            var baseCursorHeight = 32.0 * userCursorScale;

            var cursorStateLayers = {};
            var cursorStateNames = [
                "arrow", "pointer", "text", "crosshair",
                "open-hand", "closed-hand", "resize-ew", "resize-ns",
                "not-allowed", "wait"
            ];

            for (var st = 0; st < cursorStateNames.length; st++) {
                var stateName = cursorStateNames[st];
                var assetFile = getCursorAssetFile(styleKey, stateName, false);
                if (!assetFile || !assetFile.exists) {
                    assetFile = getCursorAssetFile(styleKey, "arrow", false);
                }
                if (!assetFile || !assetFile.exists) continue;

                var cursorItem = proj.importFile(new ImportOptions(assetFile));
                var cLayer = comp.layers.add(cursorItem);
                cLayer.name = "Cursor_" + stateName;
                cLayer.parent = cursorMaster;
                cLayer.motionBlur = options.enableMotionBlur !== false;

                var anchorMeta = (styleDef.cursors && styleDef.cursors[stateName]) || { anchorX: 0.14, anchorY: 0.06 };
                var hotspotX = cursorItem.width * anchorMeta.anchorX;
                var hotspotY = cursorItem.height * anchorMeta.anchorY;
                cLayer.transform.anchorPoint.setValue([hotspotX, hotspotY]);
                cLayer.transform.position.setValue([0, 0]);

                var targetH = (stateName === "text" || stateName.indexOf("resize") >= 0) ? (baseCursorHeight * 1.15) : baseCursorHeight;
                var sPercent = (targetH / cursorItem.height) * 100.0;
                cLayer.transform.scale.setValue([sPercent, sPercent]);

                cursorStateLayers[stateName] = cLayer;
                cLayer.transform.opacity.setValueAtTime(0, (stateName === "arrow") ? 100.0 : 0.0);
            }

            // Dynamic State Switching via Opacity Hold Keyframes (ES3 Safe)
            if (options.enableAutoStates !== false && getObjectKeys(cursorStateLayers).length > 1) {
                var stateRuns = [];
                var currentRunState = rawSamples[0].cursorType || "arrow";
                var currentRunStart = rawSamples[0].timeMs;

                for (var rIdx = 1; rIdx < rawSamples.length; rIdx++) {
                    var sType = rawSamples[rIdx].cursorType || "arrow";
                    if (sType !== currentRunState) {
                        stateRuns.push({
                            state: currentRunState,
                            startSec: timeMapFn(currentRunStart / 1000.0).compSec,
                            endSec: timeMapFn(rawSamples[rIdx].timeMs / 1000.0).compSec
                        });
                        currentRunState = sType;
                        currentRunStart = rawSamples[rIdx].timeMs;
                    }
                }
                stateRuns.push({
                    state: currentRunState,
                    startSec: timeMapFn(currentRunStart / 1000.0).compSec,
                    endSec: compDuration
                });

                for (var runI = 0; runI < stateRuns.length; runI++) {
                    var run = stateRuns[runI];
                    var activeState = cursorStateLayers[run.state] ? run.state : "arrow";

                    for (var sKey in cursorStateLayers) {
                        if (cursorStateLayers.hasOwnProperty(sKey)) {
                            var opProp = cursorStateLayers[sKey].transform.opacity;
                            var targetOpacity = (sKey === activeState) ? 100.0 : 0.0;
                            opProp.setValueAtTime(run.startSec, targetOpacity);
                            var kIdxVal = opProp.nearestKeyIndex(run.startSec);
                            try {
                                opProp.setInterpolationTypeAtKey(kIdxVal, KeyframeInterpolationType.HOLD);
                            } catch (eHold) {}
                        }
                    }
                }
            }

            // 15. Create Two-Tier Studio Click Ripple VFX Layer (Pop Disc + Shockwave Ring)
            var rippleOption = options.clickEffect || "#2563EB";
            if (rippleOption !== "none" && clickSamplesList.length > 0) {
                var rippleLayer = comp.layers.addShape();
                rippleLayer.name = "TraceMotion_Click_Ripples";
                rippleLayer.parent = cameraRig;
                rippleLayer.transform.anchorPoint.setValue([0, 0]);
                rippleLayer.transform.position.setValue([0, 0]);
                rippleLayer.transform.scale.setValue([100, 100]);
                rippleLayer.motionBlur = options.enableMotionBlur !== false;

                var rippleRoot = rippleLayer.property("ADBE Root Vectors Group");
                var rippleHex = (rippleOption.indexOf("#") === 0) ? rippleOption : "#2563EB";
                if (rippleOption === "white") rippleHex = "#FFFFFF";
                else if (rippleOption === "emerald") rippleHex = "#10B981";
                else if (rippleOption === "amber") rippleHex = "#F59E0B";

                var rgbColor = hexToRgb(rippleHex);
                var maxRadius = Math.max(38, baseCursorHeight * 1.85);

                for (var rc = 0; rc < clickSamplesList.length; rc++) {
                    var clickSample = clickSamplesList[rc];
                    var mappedClickStart = timeMapFn(clickSample.timeMs / 1000.0).compSec;
                    var tInnerEnd = mappedClickStart + 0.120;
                    var tOuterEnd = mappedClickStart + 0.450;

                    // Build Vector Hierarchy first
                    var rGroup = rippleRoot.addProperty("ADBE Vector Group");
                    rGroup.name = "Ripple_" + (rc + 1);
                    var rVectors = rGroup.property("ADBE Vectors Group");

                    // Tier 1: Inner Soft Pop Disc
                    var inEllipse = rVectors.addProperty("ADBE Vector Shape - Ellipse");
                    var inFill = rVectors.addProperty("ADBE Vector Graphic - Fill");

                    // Tier 2: Outer Shockwave Ring
                    var outEllipse = rVectors.addProperty("ADBE Vector Shape - Ellipse");
                    var outStroke = rVectors.addProperty("ADBE Vector Graphic - Stroke");

                    var transGroup = rGroup.property("ADBE Vector Transform Group");

                    // Query properties cleanly after all addProperty calls to avoid ExtendScript reference invalidation
                    var inSizeProp = inEllipse.property("ADBE Vector Ellipse Size");
                    var inFillProp = inFill.property("ADBE Vector Fill Color");
                    var outSizeProp = outEllipse.property("ADBE Vector Ellipse Size");
                    var outStrokeColProp = outStroke.property("ADBE Vector Stroke Color");
                    var outStrokeWProp = outStroke.property("ADBE Vector Stroke Width");
                    var posProp = transGroup.property("ADBE Vector Position");
                    var opacProp = transGroup.property("ADBE Vector Group Opacity");

                    posProp.setValue([clickSample.cx * footageW, clickSample.cy * footageH]);
                    inFillProp.setValue([rgbColor[0], rgbColor[1], rgbColor[2], 0.35]);
                    outStrokeColProp.setValue([rgbColor[0], rgbColor[1], rgbColor[2], 0.85]);

                    opacProp.setValueAtTime(0, 0.0);
                    inSizeProp.setValueAtTime(0, [0, 0]);
                    outSizeProp.setValueAtTime(0, [0, 0]);

                    if (mappedClickStart > 0.02) {
                        opacProp.setValueAtTime(mappedClickStart - 0.016, 0.0);
                        inSizeProp.setValueAtTime(mappedClickStart - 0.016, [0, 0]);
                        outSizeProp.setValueAtTime(mappedClickStart - 0.016, [0, 0]);
                    }

                    // Master Opacity
                    opacProp.setValueAtTime(mappedClickStart, 85.0);
                    opacProp.setValueAtTime(tOuterEnd, 0.0);
                    opacProp.setValueAtTime(tOuterEnd + 0.016, 0.0);

                    // Inner Pop Disc Keyframes
                    inSizeProp.setValueAtTime(mappedClickStart, [0, 0]);
                    inSizeProp.setValueAtTime(tInnerEnd, [28, 28]);
                    inSizeProp.setValueAtTime(tInnerEnd + 0.016, [0, 0]);

                    // Outer Shockwave Ring Keyframes
                    outSizeProp.setValueAtTime(mappedClickStart, [4, 4]);
                    outSizeProp.setValueAtTime(tOuterEnd, [maxRadius * 2, maxRadius * 2]);
                    outSizeProp.setValueAtTime(tOuterEnd + 0.016, [0, 0]);

                    // Dynamic Stroke Taper
                    outStrokeWProp.setValueAtTime(mappedClickStart, 3.2);
                    outStrokeWProp.setValueAtTime(tOuterEnd, 0.6);

                    var cubicEase = new KeyframeEase(0, 85.0);
                    try {
                        var kStart = outSizeProp.nearestKeyIndex(mappedClickStart);
                        var kEnd = outSizeProp.nearestKeyIndex(tOuterEnd);
                        SafeProp.setTemporalEase(outSizeProp, kStart, cubicEase, cubicEase);
                        SafeProp.setTemporalEase(outSizeProp, kEnd, cubicEase, cubicEase);
                    } catch (eEase) {}
                }
            }

            if (bgLayer) {
                try { bgLayer.locked = true; } catch (lockErr) {}
            }

            app.endUndoGroup();
            undoStarted = false;

            if (!options.silent) {
                alert(
                    "TraceMotion Rig Generated Successfully!\n\n" +
                    "• Comp: " + comp.name + " (" + compW + "x" + compH + " @ " + fps + " FPS)\n" +
                    "• Window Framing: " + (options.cornerRadius !== undefined ? options.cornerRadius : 20) + "px rounded corners & soft drop shadows\n" +
                    "• Background: " + (bgLayer ? bgLayer.name : "None") + "\n" +
                    "• Selected Cursor: " + styleDef.label + " (" + cursorStateNames.length + " states)\n" +
                    "• Smart Auto-Zoom: " + targetZoomScale + "x (" + options.zoomMode + ")\n" +
                    (telemetryAnalysis.typingIntervals.length > 0 ? ("• Typing Speed-Up: 2.0x playback on " + telemetryAnalysis.typingIntervals.length + " typing segment(s)\n") : "") +
                    "• Zero Render Artifacts: Verified two-tier ripple & straight-line zoom rig",
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
    // Responsive ScriptUI Studio Panel (1:1 with tracemotion_studio_ui_ux_prototype.html)
    // =========================================================================
    function buildUI(thisObj) {
        var isPanel = (thisObj instanceof Panel) || (thisObj && typeof thisObj.toString === "function" && thisObj.toString().indexOf("Panel") >= 0);
        var win = isPanel
            ? thisObj
            : new Window("palette", "TraceMotion Studio", undefined, { resizeable: true });

        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.spacing = 6;
        win.margins = [10, 8, 10, 8];

        try {
            var bgCol = [0.067, 0.071, 0.086, 1.0]; // #111216
            win.graphics.backgroundColor = win.graphics.newBrush(win.graphics.BrushType.SOLID_COLOR, bgCol);
        } catch (e) {}

        // 1. Header Group
        var headerGrp = win.add("group");
        headerGrp.orientation = "row";
        headerGrp.alignChildren = ["left", "center"];
        headerGrp.alignment = ["fill", "top"];
        headerGrp.spacing = 8;
        headerGrp.margins = [0, 2, 0, 4];

        var emblemBox = headerGrp.add("panel", [0, 0, 26, 26], undefined, { borderStyle: "none" });
        emblemBox.size = [26, 26];
        emblemBox.onDraw = function () {
            var g = this.graphics;
            var w = 26, h = 26;
            var bgB = g.newBrush(g.BrushType.SOLID_COLOR, [0.145, 0.388, 0.922, 1.0]);
            g.rectPath(0, 0, w, h);
            g.fillPath(bgB);
            var pen = g.newPen(g.PenType.SOLID_COLOR, [1.0, 1.0, 1.0, 1.0], 1.5);
            g.newPath();
            g.moveTo(7, 5); g.lineTo(19, 5); g.lineTo(19, 17); g.lineTo(7, 17); g.closePath();
            g.strokePath(pen);
            g.newPath();
            g.moveTo(11, 10); g.lineTo(16, 13); g.lineTo(14, 15); g.lineTo(11, 10);
            var fillW = g.newBrush(g.BrushType.SOLID_COLOR, [1.0, 1.0, 1.0, 1.0]);
            g.fillPath(fillW);
        };

        var titleCol = headerGrp.add("group");
        titleCol.orientation = "column";
        titleCol.alignChildren = ["left", "center"];
        titleCol.spacing = 1;

        var titleTxt = titleCol.add("statictext", undefined, "TraceMotion Studio");
        try { titleTxt.graphics.font = ScriptUI.newFont("Verdana", "Bold", 13); } catch (e) {}
        try { titleTxt.graphics.foregroundColor = titleTxt.graphics.newPen(titleTxt.graphics.PenType.SOLID_COLOR, [1.0, 1.0, 1.0, 1.0], 1); } catch (e) {}

        var subTxt = titleCol.add("statictext", undefined, "Recordly Smart Framing & Cursor Rig");
        try { subTxt.graphics.font = ScriptUI.newFont("Verdana", "Regular", 9); } catch (e) {}
        try { subTxt.graphics.foregroundColor = subTxt.graphics.newPen(subTxt.graphics.PenType.SOLID_COLOR, [0.65, 0.68, 0.75, 1.0], 1); } catch (e) {}

        var activeComp = getActiveComp();
        var hasActiveRig = !!(activeComp && activeComp.layer("TraceMotion_Camera_Controller"));
        var statusTxt = headerGrp.add("statictext", undefined, hasActiveRig ? "● Rig Active" : "Ready (AE 2020+)");
        statusTxt.alignment = ["right", "center"];
        try { statusTxt.graphics.font = ScriptUI.newFont("Verdana", "Regular", 9); } catch (e) {}
        try {
            var stCol = hasActiveRig ? [0.2, 0.8, 0.4, 1.0] : [0.6, 0.7, 0.9, 1.0];
            statusTxt.graphics.foregroundColor = statusTxt.graphics.newPen(statusTxt.graphics.PenType.SOLID_COLOR, stCol, 1);
        } catch (e) {}

        // 2. Interactive Composition Preview Stage (Compact 96px height)
        var previewStage = win.add("panel", undefined, undefined, { borderStyle: "none" });
        previewStage.preferredSize = [-1, 96];
        previewStage.minimumSize = [-1, 75];
        previewStage.maximumSize = [-1, 110];
        previewStage.alignment = ["fill", "top"];

        var currentBgKey = getPref("selectedBgKey", "tahoe-light.jpg");
        var currentCursorKey = getPref("selectedCursorKey", "tahoe");
        var currentZoomScale = parseFloat(getPref("selectedZoomScale", "1.80")) || 1.80;
        var currentCornerRadius = parseInt(getPref("selectedCornerRadius", "20"), 10) || 20;
        var currentRippleColor = getPref("selectedRippleColor", "#2563EB");
        var previewCursorImg = null;
        var previewBgImg = null;

        function refreshPreviewAssets() {
            var cF = getCursorPreviewFile(currentCursorKey);
            if (cF && cF.exists) {
                try { previewCursorImg = ScriptUI.newImage(cF); } catch (e) { previewCursorImg = null; }
            } else {
                previewCursorImg = null;
            }

            var wF = getWallpaperAssetFile(currentBgKey.indexOf(".") > 0 ? currentBgKey : (currentBgKey + ".jpg"));
            if (wF && wF.exists) {
                try { previewBgImg = ScriptUI.newImage(wF); } catch (e) { previewBgImg = null; }
            } else {
                previewBgImg = null;
            }
        }
        refreshPreviewAssets();

        var stageClickRipple = null; // { x, y, startTime }
        previewStage.onDraw = function () {
            var g = this.graphics;
            var w = this.size[0] || 320;
            var h = this.size[1] || 128;
            if (w <= 0 || h <= 0) return;

            // Draw Background
            if (currentBgKey === "none") {
                var bgB = g.newBrush(g.BrushType.SOLID_COLOR, [0.11, 0.12, 0.15, 1.0]);
                g.rectPath(0, 0, w, h);
                g.fillPath(bgB);
            } else if (previewBgImg) {
                try {
                    g.drawImage(previewBgImg, 0, 0, w, h);
                } catch (eImg) {
                    var fallbackB = g.newBrush(g.BrushType.SOLID_COLOR, [0.15, 0.25, 0.45, 1.0]);
                    g.rectPath(0, 0, w, h);
                    g.fillPath(fallbackB);
                }
            } else {
                var bgPr = BACKGROUND_PRESETS[currentBgKey] || BACKGROUND_PRESETS["tahoe-dawn"];
                var steps = 24;
                var sw = w / steps;
                for (var i = 0; i < steps; i++) {
                    var t = i / (steps - 1);
                    var r = bgPr.start[0] + (bgPr.end[0] - bgPr.start[0]) * t;
                    var gr = bgPr.start[1] + (bgPr.end[1] - bgPr.start[1]) * t;
                    var b = bgPr.start[2] + (bgPr.end[2] - bgPr.start[2]) * t;
                    var sBr = g.newBrush(g.BrushType.SOLID_COLOR, [r, gr, b, 1.0]);
                    g.rectPath(Math.floor(i * sw), 0, Math.ceil(sw) + 1, h);
                    g.fillPath(sBr);
                }
            }

            // Draw Centered Mock Screen Recording Window
            var winW = Math.round(w * 0.74);
            var winH = Math.round(h * 0.72);
            var winX = Math.round((w - winW) / 2);
            var winY = Math.round((h - winH) / 2);

            // Window Drop Shadow
            var shB = g.newBrush(g.BrushType.SOLID_COLOR, [0.0, 0.0, 0.0, 0.45]);
            g.rectPath(winX + 2, winY + 4, winW, winH);
            g.fillPath(shB);

            // Window Body
            var wBodyB = g.newBrush(g.BrushType.SOLID_COLOR, [0.08, 0.09, 0.11, 1.0]);
            g.rectPath(winX, winY, winW, winH);
            g.fillPath(wBodyB);

            var wBorderP = g.newPen(g.PenType.SOLID_COLOR, [1.0, 1.0, 1.0, 0.18], 1);
            g.rectPath(winX, winY, winW, winH);
            g.strokePath(wBorderP);

            // Mock macOS Titlebar
            var tBarB = g.newBrush(g.BrushType.SOLID_COLOR, [0.13, 0.14, 0.17, 1.0]);
            g.rectPath(winX, winY, winW, 14);
            g.fillPath(tBarB);

            // Titlebar Dots (Red, Yellow, Green)
            var dotRed = g.newBrush(g.BrushType.SOLID_COLOR, [1.0, 0.37, 0.34, 1.0]);
            g.rectPath(winX + 6, winY + 4, 5, 5); g.fillPath(dotRed);
            var dotYel = g.newBrush(g.BrushType.SOLID_COLOR, [1.0, 0.74, 0.18, 1.0]);
            g.rectPath(winX + 14, winY + 4, 5, 5); g.fillPath(dotYel);
            var dotGrn = g.newBrush(g.BrushType.SOLID_COLOR, [0.16, 0.78, 0.25, 1.0]);
            g.rectPath(winX + 22, winY + 4, 5, 5); g.fillPath(dotGrn);

            // Draw Click Ripple if triggered
            if (stageClickRipple && currentRippleColor !== "none") {
                var rHex = currentRippleColor.indexOf("#") === 0 ? currentRippleColor : "#2563EB";
                var rRgb = hexToRgb(rHex);
                var ripP = g.newPen(g.PenType.SOLID_COLOR, [rRgb[0], rRgb[1], rRgb[2], 0.8], 2);
                g.rectPath(stageClickRipple.x - 14, stageClickRipple.y - 14, 28, 28);
                g.strokePath(ripP);
            }

            // Draw Real Cursor Sprite
            var curX = winX + Math.round(winW * 0.52);
            var curY = winY + Math.round(winH * 0.48);
            if (previewCursorImg) {
                try {
                    g.drawImage(previewCursorImg, curX, curY, 22, 22);
                } catch (eC) {}
            } else {
                // Vector Arrow Fallback
                g.newPath();
                g.moveTo(curX, curY);
                g.lineTo(curX, curY + 14);
                g.lineTo(curX + 4, curY + 11);
                g.lineTo(curX + 8, curY + 16);
                g.lineTo(curX + 10, curY + 15);
                g.lineTo(curX + 6, curY + 10);
                g.lineTo(curX + 11, curY + 10);
                g.closePath();
                var cFill = g.newBrush(g.BrushType.SOLID_COLOR, [1.0, 1.0, 1.0, 1.0]);
                g.fillPath(cFill);
                var cPen = g.newPen(g.PenType.SOLID_COLOR, [0.08, 0.08, 0.10, 1.0], 1.2);
                g.strokePath(cPen);
            }

            // Top-left HUD Pill
            var hudB = g.newBrush(g.BrushType.SOLID_COLOR, [0.0, 0.0, 0.0, 0.55]);
            g.rectPath(8, 7, 115, 16);
            g.fillPath(hudB);
            var hudPen = g.newPen(g.PenType.SOLID_COLOR, [0.85, 0.88, 0.95, 1.0], 1);
            g.drawString("Click to test ripple", hudPen, 14, 19);

            // Top-right Zoom Badge
            g.rectPath(w - 74, 7, 66, 16);
            g.fillPath(hudB);
            var zPen = g.newPen(g.PenType.SOLID_COLOR, [0.35, 0.70, 1.0, 1.0], 1);
            g.drawString(currentZoomScale.toFixed(2) + "x Zoom", zPen, w - 68, 19);
        };

        previewStage.addEventListener("mousedown", function (e) {
            stageClickRipple = { x: e.clientX, y: e.clientY };
            previewStage.hide(); previewStage.show();
        });

        // 3. 3-Tab Segmented Pill Navigation Bar (Setup | Cursor | Frame - No Emojis)
        var tabBar = win.add("group");
        tabBar.orientation = "row";
        tabBar.alignment = ["fill", "top"];
        tabBar.spacing = 4;
        tabBar.margins = [0, 2, 0, 2];

        var btnTabSetup = tabBar.add("button", undefined, "Setup");
        btnTabSetup.alignment = ["fill", "center"];
        btnTabSetup.preferredSize.height = 28;

        var btnTabCursor = tabBar.add("button", undefined, "Cursor");
        btnTabCursor.alignment = ["fill", "center"];
        btnTabCursor.preferredSize.height = 28;

        var btnTabFrame = tabBar.add("button", undefined, "Frame");
        btnTabFrame.alignment = ["fill", "center"];
        btnTabFrame.preferredSize.height = 28;

        // Container holding the 3 Tab Panels
        var tabContainer = win.add("group");
        tabContainer.orientation = "column";
        tabContainer.alignment = ["fill", "top"];
        tabContainer.alignChildren = ["fill", "top"];
        tabContainer.spacing = 0;
        tabContainer.margins = 0;

        // =====================================================================
        // TAB 1: SETUP PANEL
        // =====================================================================
        var tabSetup = tabContainer.add("group");
        tabSetup.orientation = "column";
        tabSetup.alignment = ["fill", "top"];
        tabSetup.alignChildren = ["fill", "top"];
        tabSetup.spacing = 6;
        tabSetup.margins = [0, 4, 0, 4];

        // Capture Source Card
        var srcCard = tabSetup.add("panel", undefined, undefined, { borderStyle: "gray" });
        srcCard.orientation = "column";
        srcCard.alignChildren = ["fill", "top"];
        srcCard.spacing = 6;
        srcCard.margins = 8;

        var srcHeaderRow = srcCard.add("group");
        srcHeaderRow.orientation = "row";
        var srcTitle = srcHeaderRow.add("statictext", undefined, "Capture Source");
        try { srcTitle.graphics.font = ScriptUI.newFont("Verdana", "Bold", 10); } catch (e) {}
        try { srcTitle.graphics.foregroundColor = srcTitle.graphics.newPen(srcTitle.graphics.PenType.SOLID_COLOR, [0.7, 0.72, 0.8, 1], 1); } catch (e) {}

        var vidRow = srcCard.add("group");
        vidRow.orientation = "row";
        vidRow.alignChildren = ["fill", "center"];
        vidRow.spacing = 6;

        var videoPathInput = vidRow.add("edittext", undefined, "");
        videoPathInput.alignment = ["fill", "center"];
        videoPathInput.preferredSize.height = 24;

        var btnBrowseVid = vidRow.add("button", undefined, "Browse...");
        btnBrowseVid.preferredSize = [65, 24];

        var selectedVideoFile = null;
        var selectedJsonFile = null;

        // Auto-Paired Telemetry Sync Badge
        var syncBadgeRow = srcCard.add("group");
        syncBadgeRow.orientation = "row";
        syncBadgeRow.alignChildren = ["left", "center"];
        syncBadgeRow.spacing = 6;

        var syncDot = syncBadgeRow.add("statictext", undefined, "●");
        try { syncDot.graphics.foregroundColor = syncDot.graphics.newPen(syncDot.graphics.PenType.SOLID_COLOR, [0.2, 0.8, 0.4, 1], 1); } catch (e) {}

        var syncText = syncBadgeRow.add("statictext", undefined, "Auto-paired telemetry (.cursor.json)");
        syncText.alignment = ["fill", "center"];
        try { syncText.graphics.font = ScriptUI.newFont("Verdana", "Regular", 9); } catch (e) {}
        try { syncText.graphics.foregroundColor = syncText.graphics.newPen(syncText.graphics.PenType.SOLID_COLOR, [0.4, 0.8, 0.6, 1], 1); } catch (e) {}

        var btnRelinkJson = syncBadgeRow.add("button", undefined, "Relink");
        btnRelinkJson.preferredSize = [50, 20];

        btnBrowseVid.onClick = function () {
            var f = File.openDialog("Select Screen Recording Video", "Video Files:*.mp4;*.mov;*.webm;*.mkv;*.*");
            if (f) {
                selectedVideoFile = f;
                videoPathInput.text = f.fsName;
                var baseF = f.fsName.replace(/\.[^\.]+$/, "");
                var candidates = [
                    new File(f.fsName + ".cursor.json"),
                    new File(baseF + ".cursor.json"),
                    new File(baseF + ".tracemotion.json"),
                    new File(f.fsName + ".json")
                ];
                for (var ci = 0; ci < candidates.length; ci++) {
                    if (candidates[ci].exists) {
                        selectedJsonFile = candidates[ci];
                        syncText.text = "Paired: " + candidates[ci].name;
                        break;
                    }
                }
            }
        };

        btnRelinkJson.onClick = function () {
            var f = File.openDialog("Select Companion Mouse Telemetry JSON", "JSON Files:*.json");
            if (f) {
                selectedJsonFile = f;
                syncText.text = "Linked: " + f.name;
            }
        };

        // Camera Zoom Mode (Auto Zoom | Follow | Static)
        var zoomModeCard = tabSetup.add("group");
        zoomModeCard.orientation = "column";
        zoomModeCard.alignChildren = ["fill", "top"];
        zoomModeCard.spacing = 3;

        var zTitle = zoomModeCard.add("statictext", undefined, "Camera Zoom Mode");
        try { zTitle.graphics.font = ScriptUI.newFont("Verdana", "Bold", 10); } catch (e) {}

        var zoomRadioRow = zoomModeCard.add("group");
        zoomRadioRow.orientation = "row";
        zoomRadioRow.spacing = 4;

        var radAutoZoom = zoomRadioRow.add("radiobutton", undefined, "Auto Zoom");
        var radFollow = zoomRadioRow.add("radiobutton", undefined, "Follow");
        var radStatic = zoomRadioRow.add("radiobutton", undefined, "Static");
        radAutoZoom.value = true;

        // Zoom Depth Slider
        var zDepthRow = tabSetup.add("group");
        zDepthRow.orientation = "row";
        zDepthRow.alignChildren = ["fill", "center"];
        zDepthRow.spacing = 6;

        var zDepthLbl = zDepthRow.add("statictext", undefined, "Zoom Depth:");
        zDepthLbl.preferredSize.width = 75;

        var zDepthSlider = zDepthRow.add("slider", undefined, 180, 120, 320);
        zDepthSlider.alignment = ["fill", "center"];

        var zDepthValTxt = zDepthRow.add("statictext", undefined, "1.80x");
        zDepthValTxt.preferredSize.width = 45;

        zDepthSlider.onChanging = function () {
            currentZoomScale = zDepthSlider.value / 100.0;
            zDepthValTxt.text = currentZoomScale.toFixed(2) + "x";
            savePref("selectedZoomScale", currentZoomScale.toFixed(2));
            previewStage.hide(); previewStage.show();
        };

        // Motion Feel (Natural | Snappy | Silky | Raw)
        var feelGrp = tabSetup.add("group");
        feelGrp.orientation = "column";
        feelGrp.alignChildren = ["fill", "top"];
        feelGrp.spacing = 3;

        var feelTitle = feelGrp.add("statictext", undefined, "Motion Feel");
        try { feelTitle.graphics.font = ScriptUI.newFont("Verdana", "Bold", 10); } catch (e) {}

        var feelRadioRow = feelGrp.add("group");
        feelRadioRow.orientation = "row";
        feelRadioRow.spacing = 4;

        var radNatural = feelRadioRow.add("radiobutton", undefined, "Natural");
        var radSnappy = feelRadioRow.add("radiobutton", undefined, "Snappy");
        var radSilky = feelRadioRow.add("radiobutton", undefined, "Silky");
        var radRaw = feelRadioRow.add("radiobutton", undefined, "Raw");
        radNatural.value = true;

        // Fine-Tune Physics Accordion
        var accBtn = tabSetup.add("button", undefined, "Fine-Tune Physics (5/5 on) ▼");
        accBtn.alignment = ["fill", "center"];
        accBtn.preferredSize.height = 24;

        var accBody = tabSetup.add("group");
        accBody.orientation = "column";
        accBody.alignChildren = ["left", "top"];
        accBody.spacing = 3;
        accBody.margins = [8, 2, 8, 2];
        accBody.visible = false;

        var chkAutoStates = accBody.add("checkbox", undefined, "Auto Cursor States (I-beam, pointer, hand)");
        chkAutoStates.value = true;
        var chkVelocitySway = accBody.add("checkbox", undefined, "Velocity Tilt Sway (Dynamic angle)");
        chkVelocitySway.value = true;
        var chkClickBounce = accBody.add("checkbox", undefined, "Click Bounce (84% compression)");
        chkClickBounce.value = true;
        var chkMotionBlur = accBody.add("checkbox", undefined, "Motion Blur (AE composition shutter)");
        chkMotionBlur.value = true;
        var chkTypingSpeedup = accBody.add("checkbox", undefined, "Typing Speed-Up (2.0x playback & zoom)");
        chkTypingSpeedup.value = true;

        accBtn.onClick = function () {
            accBody.visible = !accBody.visible;
            accBtn.text = accBody.visible ? "Fine-Tune Physics ▲" : "Fine-Tune Physics (5/5 on) ▼";
            win.layout.resize();
        };

        // =====================================================================
        // TAB 2: CURSOR PANEL
        // =====================================================================
        var tabCursor = tabContainer.add("group");
        tabCursor.orientation = "column";
        tabCursor.alignment = ["fill", "top"];
        tabCursor.alignChildren = ["fill", "top"];
        tabCursor.spacing = 6;
        tabCursor.margins = [0, 4, 0, 4];
        tabCursor.visible = false;

        var cStyleLbl = tabCursor.add("statictext", undefined, "Cursor Pack (10 Multi-States)");
        try { cStyleLbl.graphics.font = ScriptUI.newFont("Verdana", "Bold", 10); } catch (e) {}

        var cursorItems = ["macOS Tahoe (Default)", "macOS Classic (Retina)", "Windows 11 (Fluent)", "Figma Minimal (Sharp)"];
        var cursorKeys = ["tahoe", "macos", "windows11", "custom"];
        var cursorDropdown = tabCursor.add("dropdownlist", undefined, cursorItems);
        var initCursorIdx = 0;
        for (var ci = 0; ci < cursorKeys.length; ci++) {
            if (cursorKeys[ci] === currentCursorKey) { initCursorIdx = ci; break; }
        }
        cursorDropdown.selection = initCursorIdx;

        cursorDropdown.onChange = function () {
            var sel = cursorDropdown.selection ? cursorDropdown.selection.index : 0;
            currentCursorKey = cursorKeys[sel];
            savePref("selectedCursorKey", currentCursorKey);
            refreshPreviewAssets();
            previewStage.hide(); previewStage.show();
        };

        // Cursor Size Slider
        var cSizeRow = tabCursor.add("group");
        cSizeRow.orientation = "row";
        cSizeRow.alignChildren = ["fill", "center"];
        cSizeRow.spacing = 6;

        var cSizeLbl = cSizeRow.add("statictext", undefined, "Cursor Size:");
        cSizeLbl.preferredSize.width = 75;

        var cSizeSlider = cSizeRow.add("slider", undefined, 100, 50, 200);
        cSizeSlider.alignment = ["fill", "center"];

        var cSizeValTxt = cSizeRow.add("statictext", undefined, "100%");
        cSizeValTxt.preferredSize.width = 45;

        cSizeSlider.onChanging = function () {
            var val = Math.round(cSizeSlider.value);
            cSizeValTxt.text = val + "%";
            savePref("selectedCursorSize", val.toString());
        };

        // Click Ripple Color Swatches (Cobalt | White | Emerald | Amber | Off)
        var ripLbl = tabCursor.add("statictext", undefined, "Click Ripple Color");
        try { ripLbl.graphics.font = ScriptUI.newFont("Verdana", "Bold", 10); } catch (e) {}

        var ripSwatchRow = tabCursor.add("group");
        ripSwatchRow.orientation = "row";
        ripSwatchRow.spacing = 4;

        var btnRipCobalt = ripSwatchRow.add("button", undefined, "Cobalt");
        var btnRipWhite = ripSwatchRow.add("button", undefined, "White");
        var btnRipEmerald = ripSwatchRow.add("button", undefined, "Emerald");
        var btnRipAmber = ripSwatchRow.add("button", undefined, "Amber");
        var btnRipOff = ripSwatchRow.add("button", undefined, "Off");

        btnRipCobalt.onClick = function () { currentRippleColor = "#2563EB"; savePref("selectedRippleColor", currentRippleColor); previewStage.hide(); previewStage.show(); };
        btnRipWhite.onClick = function () { currentRippleColor = "#FFFFFF"; savePref("selectedRippleColor", currentRippleColor); previewStage.hide(); previewStage.show(); };
        btnRipEmerald.onClick = function () { currentRippleColor = "#10B981"; savePref("selectedRippleColor", currentRippleColor); previewStage.hide(); previewStage.show(); };
        btnRipAmber.onClick = function () { currentRippleColor = "#F59E0B"; savePref("selectedRippleColor", currentRippleColor); previewStage.hide(); previewStage.show(); };
        btnRipOff.onClick = function () { currentRippleColor = "none"; savePref("selectedRippleColor", currentRippleColor); previewStage.hide(); previewStage.show(); };

        // =====================================================================
        // TAB 3: FRAME PANEL
        // =====================================================================
        var tabFrame = tabContainer.add("group");
        tabFrame.orientation = "column";
        tabFrame.alignment = ["fill", "top"];
        tabFrame.alignChildren = ["fill", "top"];
        tabFrame.spacing = 6;
        tabFrame.margins = [0, 4, 0, 4];
        tabFrame.visible = false;

        var bgSelectLbl = tabFrame.add("statictext", undefined, "Backdrop Wallpaper");
        try { bgSelectLbl.graphics.font = ScriptUI.newFont("Verdana", "Bold", 10); } catch (e) {}

        // Visual Backdrop Tiles (Tahoe | Midnight | Azure | Cherry | Studio | None)
        var tileRow1 = tabFrame.add("group");
        tileRow1.orientation = "row";
        tileRow1.spacing = 4;

        var btnBgTahoe = tileRow1.add("button", undefined, "Tahoe Light");
        var btnBgMidnight = tileRow1.add("button", undefined, "Midnight");
        var btnBgAzure = tileRow1.add("button", undefined, "Azure");

        var tileRow2 = tabFrame.add("group");
        tileRow2.orientation = "row";
        tileRow2.spacing = 4;

        var btnBgCherry = tileRow2.add("button", undefined, "Cherry Pop");
        var btnBgStudio = tileRow2.add("button", undefined, "Dark Studio");
        var btnBgNone = tileRow2.add("button", undefined, "None");

        btnBgTahoe.onClick = function () { currentBgKey = "tahoe-light.jpg"; refreshPreviewAssets(); savePref("selectedBgKey", currentBgKey); previewStage.hide(); previewStage.show(); };
        btnBgMidnight.onClick = function () { currentBgKey = "midnight-8.jpg"; refreshPreviewAssets(); savePref("selectedBgKey", currentBgKey); previewStage.hide(); previewStage.show(); };
        btnBgAzure.onClick = function () { currentBgKey = "sequoia-blue.jpg"; refreshPreviewAssets(); savePref("selectedBgKey", currentBgKey); previewStage.hide(); previewStage.show(); };
        btnBgCherry.onClick = function () { currentBgKey = "cherrypop.jpg"; refreshPreviewAssets(); savePref("selectedBgKey", currentBgKey); previewStage.hide(); previewStage.show(); };
        btnBgStudio.onClick = function () { currentBgKey = "dark-studio"; refreshPreviewAssets(); savePref("selectedBgKey", currentBgKey); previewStage.hide(); previewStage.show(); };
        btnBgNone.onClick = function () { currentBgKey = "none"; refreshPreviewAssets(); savePref("selectedBgKey", currentBgKey); previewStage.hide(); previewStage.show(); };

        // Full 39 Wallpapers Dropdown
        var bgItemsList = [];
        var bgKeysList = [];
        for (var wp = 0; wp < RECORDLY_WALLPAPERS.length; wp++) {
            bgItemsList.push(RECORDLY_WALLPAPERS[wp].label);
            bgKeysList.push(RECORDLY_WALLPAPERS[wp].filename);
        }
        var bgDropdown = tabFrame.add("dropdownlist", undefined, bgItemsList);
        bgDropdown.selection = 0;
        bgDropdown.onChange = function () {
            if (bgDropdown.selection) {
                currentBgKey = bgKeysList[bgDropdown.selection.index];
                savePref("selectedBgKey", currentBgKey);
                refreshPreviewAssets();
                previewStage.hide(); previewStage.show();
            }
        };

        // Corner Radius Slider
        var radRow = tabFrame.add("group");
        radRow.orientation = "row";
        radRow.alignChildren = ["fill", "center"];
        radRow.spacing = 6;

        var radLbl = radRow.add("statictext", undefined, "Corner Radius:");
        radLbl.preferredSize.width = 85;

        var radSlider = radRow.add("slider", undefined, currentCornerRadius, 0, 48);
        radSlider.alignment = ["fill", "center"];

        var radValTxt = radRow.add("statictext", undefined, currentCornerRadius + "px");
        radValTxt.preferredSize.width = 40;

        radSlider.onChanging = function () {
            currentCornerRadius = Math.round(radSlider.value);
            radValTxt.text = currentCornerRadius + "px";
            savePref("selectedCornerRadius", currentCornerRadius.toString());
            previewStage.hide(); previewStage.show();
        };

        // Window Margin Slider
        var marginRow = tabFrame.add("group");
        marginRow.orientation = "row";
        marginRow.alignChildren = ["fill", "center"];
        marginRow.spacing = 6;

        var marginLbl = marginRow.add("statictext", undefined, "Window Margin:");
        marginLbl.preferredSize.width = 85;

        var marginSlider = marginRow.add("slider", undefined, 12, 0, 25);
        marginSlider.alignment = ["fill", "center"];

        var marginValTxt = marginRow.add("statictext", undefined, "12%");
        marginValTxt.preferredSize.width = 40;

        marginSlider.onChanging = function () {
            var mVal = Math.round(marginSlider.value);
            marginValTxt.text = mVal + "%";
            savePref("selectedMargin", mVal.toString());
        };

        // Shadow Intensity Slider
        var shRow = tabFrame.add("group");
        shRow.orientation = "row";
        shRow.alignChildren = ["fill", "center"];
        shRow.spacing = 6;

        var shLbl = shRow.add("statictext", undefined, "Drop Shadow:");
        shLbl.preferredSize.width = 85;

        var shSlider = shRow.add("slider", undefined, 65, 0, 100);
        shSlider.alignment = ["fill", "center"];

        var shValTxt = shRow.add("statictext", undefined, "65%");
        shValTxt.preferredSize.width = 40;

        shSlider.onChanging = function () {
            var sVal = Math.round(shSlider.value);
            shValTxt.text = sVal + "%";
            savePref("selectedShadow", sVal.toString());
        };

        // =====================================================================
        // TAB SWITCHING LOGIC
        // =====================================================================
        function selectTab(tabName) {
            tabSetup.visible = (tabName === "setup");
            tabCursor.visible = (tabName === "cursor");
            tabFrame.visible = (tabName === "frame");
            win.layout.layout(true);
            win.layout.resize();
        }

        btnTabSetup.onClick = function () { selectTab("setup"); };
        btnTabCursor.onClick = function () { selectTab("cursor"); };
        btnTabFrame.onClick = function () { selectTab("frame"); };

        // =====================================================================
        // STICKY BOTTOM ACTION BAR (Generate Motion Comp)
        // =====================================================================
        var bottomBar = win.add("group");
        bottomBar.orientation = "row";
        bottomBar.alignment = ["fill", "top"];
        bottomBar.margins = [0, 8, 0, 0];

        var btnBuild = bottomBar.add("button", undefined, "Generate Motion Comp");
        btnBuild.alignment = ["fill", "center"];
        btnBuild.preferredSize.height = 34;

        btnBuild.onClick = function () {
            if (!selectedVideoFile || !selectedVideoFile.exists) {
                alert("Please select a valid screen recording video footage file first.", "Input Error");
                selectTab("setup");
                return;
            }

            if (!selectedJsonFile || !selectedJsonFile.exists) {
                // Check if companion exists alongside video
                var cand = new File(selectedVideoFile.fsName + ".cursor.json");
                if (!cand.exists) cand = new File(selectedVideoFile.fsName.replace(/\.[^\.]+$/, ".cursor.json"));
                if (!cand.exists) cand = new File(selectedVideoFile.fsName.replace(/\.[^\.]+$/, ".tracemotion.json"));
                if (cand.exists) {
                    selectedJsonFile = cand;
                } else {
                    alert("Companion mouse telemetry JSON file not found. Please browse and link the .cursor.json file.", "Input Error");
                    selectTab("setup");
                    return;
                }
            }

            var feelChoice = "natural";
            if (radSnappy.value) feelChoice = "snappy";
            else if (radSilky.value) feelChoice = "silky";
            else if (radRaw.value) feelChoice = "raw";

            var zModeChoice = "auto-cluster";
            if (radFollow.value) zModeChoice = "continuous";
            else if (radStatic.value) zModeChoice = "static";

            var opts = {
                zoomMode: zModeChoice,
                zoomDepthScale: currentZoomScale,
                motionFeel: feelChoice,
                enableAutoStates: chkAutoStates.value,
                enableVelocitySway: chkVelocitySway.value,
                enableClickBounce: chkClickBounce.value,
                enableMotionBlur: chkMotionBlur.value,
                enableTypingSpeedup: chkTypingSpeedup.value,
                cursorStyle: currentCursorKey,
                cursorScale: Math.round(cSizeSlider.value),
                clickEffect: currentRippleColor,
                wallpaper: currentBgKey,
                cornerRadius: currentCornerRadius,
                canvasMargin: Math.round(marginSlider.value),
                shadowIntensity: Math.round(shSlider.value),
                silent: false
            };

            try {
                buildTraceMotionRig(selectedVideoFile, selectedJsonFile, opts);
            } catch (err) {}
        };

        // Window Resize Handler
        win.onResizing = win.onResize = function () {
            win.layout.resize();
        };

        if (win instanceof Window) {
            win.center();
            win.show();
        } else {
            win.layout.layout(true);
        }

        return win;
    }

    // Export module functions for automation / headless pipeline execution
    var TM = {};
    try {
        if (typeof $.global !== "undefined" && $.global.TraceMotion) {
            TM = $.global.TraceMotion;
        }
    } catch (eGlobal) {}

    TM.buildRig = buildTraceMotionRig;
    TM.buildUI = buildUI;

    try {
        if (typeof $.global !== "undefined") {
            $.global.TraceMotion = TM;
        }
    } catch (eExp) {}

    // Auto-launch if executed directly in After Effects
    try {
        if (typeof app !== "undefined" && app.project) {
            return buildUI(thisObj);
        }
    } catch (launchErr) {}
    return TM;
})(this);
