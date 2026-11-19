/**
 * TraceMotion Importer & Rig Generator for Adobe After Effects
 *
 * Ingests screen recordings and synchronized mouse telemetry (.cursor.json)
 * captured via OBS Studio or Recordly. Reconstructs dynamic camera zooms, deadband
 * safe zones, damped harmonic oscillator spring smoothing, authentic system cursor assets
 * (macOS Tahoe, macOS Classic, Windows 11 Fluent, Figma), automatic macOS window framing,
 * rounded corner track mattes, multi-stage soft drop shadows, 2.0x typing speed-up & zoom,
 * and two-tier studio click ripple VFX.
 *
 * Compatible with Adobe After Effects CC 2020 through CC 2026+ (Pure ES3 ExtendScript)
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
                .replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, "]")
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
        if (isNaN(num)) return [0.145, 0.388, 0.922];
        var r = ((num >> 16) & 255) / 255.0;
        var g = ((num >> 8) & 255) / 255.0;
        var b = (num & 255) / 255.0;
        return [r, g, b];
    }

    var PREF_SECTION = "TraceMotion_Preferences_v5";
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
    // Matched 1:1 to after-effects-importer/assets/cursors/ filenames
    // =========================================================================
    var CURSOR_MANIFEST = {
        tahoe: {
            id: "tahoe",
            label: "macOS Tahoe (Default)",
            folder: "tahoe",
            sizeMultiplier: 1.0,
            cursors: {
                arrow: {
                    filePng: "pointer-1__34-24.png",
                    fileSvg: "pointer-1__34-24.svg",
                    altPng: "pointer-1__14-6.png",
                    anchorX: 0.34,
                    anchorY: 0.24
                },
                pointer: {
                    filePng: "pointinghand-1__39-26.png",
                    fileSvg: "pointinghand-1__39-26.svg",
                    altPng: "pointinghand-1__40-10.png",
                    anchorX: 0.39,
                    anchorY: 0.26
                },
                text: {
                    filePng: "ibeam-1__50-50.png",
                    fileSvg: "ibeam-1__50-50.svg",
                    altPng: "ibeam-1__50-44.png",
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
                    altPng: "openhand-1__55-57.png",
                    anchorX: 0.50,
                    anchorY: 0.50
                },
                "closed-hand": {
                    filePng: "closedhand-1__50-50.png",
                    fileSvg: "closedhand-1__50-50.svg",
                    altPng: "closedhand-1__50-46.png",
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
                    altPng: "resizenorthsouth-1__50-49.png",
                    anchorX: 0.50,
                    anchorY: 0.50
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
                    filePng: "arrow__50-50.png",
                    fileSvg: "arrow__50-50.svg",
                    altPng: "arrow__31-22.png",
                    anchorX: 0.50,
                    anchorY: 0.50
                },
                pointer: {
                    filePng: "pointer__54-35.png",
                    fileSvg: "pointer__54-35.svg",
                    anchorX: 0.54,
                    anchorY: 0.35
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
                    anchorX: 0.51,
                    anchorY: 0.49
                },
                "resize-ns": {
                    filePng: "resize-vertical__48-50.png",
                    fileSvg: "resize-vertical__48-50.svg",
                    anchorX: 0.48,
                    anchorY: 0.50
                },
                "not-allowed": {
                    filePng: "block__50-50.png",
                    fileSvg: "block__50-50.svg",
                    anchorX: 0.50,
                    anchorY: 0.50
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
            label: "Figma Minimal",
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
        }
    };

    function getCursorAssetFile(styleId, cursorType, preferSvg) {
        var style = CURSOR_MANIFEST[styleId] || CURSOR_MANIFEST.tahoe;
        if (!style || !style.folder) return null;
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
            var primaryName = preferSvg ? cData.fileSvg : cData.filePng;
            var altName = preferSvg ? cData.filePng : cData.fileSvg;
            var primaryFile = new File(baseDir + primaryName);
            if (primaryFile && primaryFile.exists) return primaryFile;

            if (cData.altPng) {
                var altPngFile = new File(baseDir + cData.altPng);
                if (altPngFile && altPngFile.exists) return altPngFile;
            }

            var altFile = new File(baseDir + altName);
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
                    searchDirs.push(scriptF.parent.fsName + "/assets/cursors/previews/" + styleId + "_preview.png");
                }
            }
        } catch (e) {}
        searchDirs.push("D:/all my code/TraceMotion/after-effects-importer/assets/cursors/previews/" + styleId + ".png");
        searchDirs.push("D:/all my code/TraceMotion/after-effects-importer/assets/cursors/previews/" + styleId + "_preview.png");

        for (var d = 0; d < searchDirs.length; d++) {
            var f = new File(searchDirs[d]);
            if (f.exists) return f;
        }
        return getCursorAssetFile(styleId, "arrow", false);
    }

    // =========================================================================
    // Recordly Wallpapers Asset Library (Exact Match to assets/wallpapers/)
    // Each entry includes rich preview gradient colors for instant ScriptUI rendering
    // =========================================================================
    var RECORDLY_WALLPAPERS = [
        { id: "tahoe-light", filename: "tahoe-light.jpg", label: "Tahoe Light", start: [0.231, 0.510, 0.965], end: [0.545, 0.361, 0.965] },
        { id: "tahoe-dark", filename: "tahoe-dark.jpg", label: "Tahoe Dark", start: [0.110, 0.190, 0.380], end: [0.055, 0.065, 0.140] },
        { id: "midnight-8", filename: "midnight-8.jpg", label: "Midnight Deep", start: [0.118, 0.161, 0.231], end: [0.035, 0.051, 0.086] },
        { id: "sequoia-blue", filename: "sequoia-blue.jpg", label: "Sequoia Azure", start: [0.145, 0.388, 0.922], end: [0.059, 0.090, 0.165] },
        { id: "sequoia-blue-orange", filename: "sequoia-blue-orange.jpg", label: "Sequoia Sunset", start: [0.145, 0.450, 0.850], end: [0.920, 0.420, 0.180] },
        { id: "cherrypop", filename: "cherrypop.jpg", label: "Cherry Pop", start: [0.957, 0.247, 0.369], end: [0.486, 0.227, 0.929] },
        { id: "dark-studio", filename: "dark-studio", label: "Dark Studio (Gradient)", start: [0.153, 0.153, 0.165], end: [0.035, 0.035, 0.043] },
        { id: "none", filename: "none", label: "Transparent / None", start: [0.0, 0.0, 0.0], end: [0.0, 0.0, 0.0] },
        { id: "sonoma-horizon", filename: "sonoma-horizon.jpg", label: "Sonoma Horizon", start: [0.960, 0.620, 0.043], end: [0.118, 0.106, 0.294] },
        { id: "sonoma-light", filename: "sonoma-light.jpg", label: "Sonoma Light", start: [0.220, 0.680, 0.860], end: [0.940, 0.680, 0.350] },
        { id: "sonoma-dark", filename: "sonoma-dark.jpg", label: "Sonoma Dark", start: [0.100, 0.240, 0.380], end: [0.070, 0.090, 0.150] },
        { id: "sonoma-clouds", filename: "sonoma-clouds.jpg", label: "Sonoma Clouds", start: [0.480, 0.640, 0.880], end: [0.850, 0.600, 0.650] },
        { id: "sonoma-evening", filename: "sonoma-evening.jpg", label: "Sonoma Evening", start: [0.420, 0.220, 0.540], end: [0.120, 0.140, 0.280] },
        { id: "ventura", filename: "ventura.jpg", label: "Ventura", start: [0.160, 0.560, 0.940], end: [0.960, 0.520, 0.180] },
        { id: "ventura-dark", filename: "ventura-dark.jpg", label: "Ventura Dark", start: [0.120, 0.240, 0.460], end: [0.480, 0.180, 0.120] },
        { id: "bluerays", filename: "bluerays.jpeg", label: "Blue Rays", start: [0.050, 0.360, 0.860], end: [0.030, 0.120, 0.340] },
        { id: "cityscape", filename: "cityscape.jpg", label: "Cityscape", start: [0.180, 0.220, 0.360], end: [0.080, 0.090, 0.160] },
        { id: "energy-17", filename: "energy-17.jpg", label: "Energy 17", start: [0.024, 0.714, 0.831], end: [0.388, 0.400, 0.945] },
        { id: "energy-19", filename: "energy-19.jpg", label: "Energy 19", start: [0.880, 0.280, 0.620], end: [0.240, 0.200, 0.720] },
        { id: "farmvalley", filename: "farmvalley.jpg", label: "Farm Valley", start: [0.280, 0.580, 0.420], end: [0.140, 0.260, 0.220] },
        { id: "glassmorphism-3", filename: "glassmorphism-3.jpg", label: "Glassmorphism 3", start: [0.320, 0.480, 0.960], end: [0.760, 0.340, 0.880] },
        { id: "glassmorphism-4", filename: "glassmorphism-4.jpg", label: "Glassmorphism 4", start: [0.100, 0.720, 0.780], end: [0.350, 0.320, 0.880] },
        { id: "ipad-17-light", filename: "ipad-17-light.jpg", label: "iPad 17 Light", start: [0.340, 0.640, 0.960], end: [0.780, 0.560, 0.960] },
        { id: "ipad-17-dark", filename: "ipad-17-dark.jpg", label: "iPad 17 Dark", start: [0.140, 0.220, 0.460], end: [0.280, 0.140, 0.380] },
        { id: "iridescent-9", filename: "iridescent-9.jpg", label: "Iridescent 9", start: [0.460, 0.360, 0.920], end: [0.140, 0.760, 0.820] },
        { id: "lemonade", filename: "lemonade.jpeg", label: "Lemonade", start: [0.960, 0.760, 0.220], end: [0.940, 0.380, 0.460] },
        { id: "levels", filename: "levels.jpg", label: "Levels", start: [0.160, 0.260, 0.440], end: [0.060, 0.100, 0.200] },
        { id: "luisdelrio", filename: "luisdelrio.jpg", label: "Luis Del Rio", start: [0.220, 0.440, 0.580], end: [0.080, 0.160, 0.240] },
        { id: "mountaintrees", filename: "mountaintrees.jpg", label: "Mountain Trees", start: [0.180, 0.360, 0.320], end: [0.080, 0.140, 0.180] },
        { id: "wallpaper1", filename: "wallpaper1.jpg", label: "Wallpaper 1", start: [0.220, 0.380, 0.860], end: [0.480, 0.220, 0.720] },
        { id: "wallpaper2", filename: "wallpaper2.jpg", label: "Wallpaper 2", start: [0.140, 0.580, 0.640], end: [0.080, 0.220, 0.380] },
        { id: "wallpaper3", filename: "wallpaper3.jpg", label: "Wallpaper 3", start: [0.840, 0.360, 0.420], end: [0.260, 0.160, 0.440] },
        { id: "wallpaper4", filename: "wallpaper4.jpg", label: "Wallpaper 4", start: [0.260, 0.320, 0.540], end: [0.100, 0.120, 0.220] },
        { id: "wallpaper7", filename: "wallpaper7.jpg", label: "Wallpaper 7", start: [0.180, 0.460, 0.780], end: [0.100, 0.180, 0.360] },
        { id: "wallpaper9", filename: "wallpaper9.jpg", label: "Wallpaper 9", start: [0.560, 0.320, 0.780], end: [0.160, 0.140, 0.340] },
        { id: "wallpaper10", filename: "wallpaper10.jpg", label: "Wallpaper 10", start: [0.200, 0.520, 0.620], end: [0.100, 0.200, 0.280] },
        { id: "wallpaper11", filename: "wallpaper11.jpg", label: "Wallpaper 11", start: [0.780, 0.440, 0.260], end: [0.240, 0.140, 0.280] },
        { id: "wallpaper12", filename: "wallpaper12.jpg", label: "Wallpaper 12", start: [0.160, 0.340, 0.620], end: [0.060, 0.120, 0.240] },
        { id: "wallpaper13", filename: "wallpaper13.jpg", label: "Wallpaper 13", start: [0.360, 0.280, 0.680], end: [0.120, 0.100, 0.260] },
        { id: "wallpaper15", filename: "wallpaper15.jpg", label: "Wallpaper 15", start: [0.240, 0.480, 0.820], end: [0.120, 0.180, 0.380] }
    ];

    function getWallpaperMeta(key) {
        for (var i = 0; i < RECORDLY_WALLPAPERS.length; i++) {
            if (RECORDLY_WALLPAPERS[i].filename === key || RECORDLY_WALLPAPERS[i].id === key) {
                return RECORDLY_WALLPAPERS[i];
            }
        }
        return RECORDLY_WALLPAPERS[0];
    }

    function getWallpaperAssetFile(filename) {
        if (!filename || filename === "none" || filename === "dark-studio") return null;
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
            start: [0.231, 0.510, 0.965],
            end: [0.545, 0.361, 0.965],
            solid: "#1E1B4B",
            isRadial: false
        },
        "dark-studio": {
            label: "Dark Studio (Charcoal / Deep Black)",
            start: [0.153, 0.153, 0.165],
            end: [0.035, 0.035, 0.043],
            solid: "#0F0F12",
            isRadial: true
        },
        "midnight-deep": {
            label: "Midnight Deep (Slate Navy / Indigo)",
            start: [0.118, 0.161, 0.231],
            end: [0.035, 0.051, 0.086],
            solid: "#0A0E1C",
            isRadial: true
        },
        "sequoia-azure": {
            label: "Sequoia Azure (Vibrant Azure Cobalt)",
            start: [0.145, 0.388, 0.922],
            end: [0.059, 0.090, 0.165],
            solid: "#10234E",
            isRadial: false
        },
        "solid-charcoal": {
            label: "Clean Charcoal Solid",
            start: [0.118, 0.118, 0.125],
            end: [0.118, 0.118, 0.125],
            solid: "#1E1E20",
            isRadial: false
        },
        "none": {
            label: "Transparent / None",
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
        if (!samples || samples.length === 0) return { cx: 0.5, cy: 0.5 };
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
        var maxDist = 0;
        var index = 0;
        var end = points.length - 1;

        for (var i = 1; i < end; i++) {
            if (points[i].isClick) {
                maxDist = epsilon + 1;
                index = i;
                break;
            }
            var dist = getPerpendicularDistance(points[i], points[0], points[end]);
            if (dist > maxDist) {
                index = i;
                maxDist = dist;
            }
        }

        if (maxDist > epsilon) {
            var left = rdpSimplify(points.slice(0, index + 1), epsilon);
            var right = rdpSimplify(points.slice(index), epsilon);
            return left.slice(0, left.length - 1).concat(right);
        } else {
            return [points[0], points[end]];
        }
    }

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

        // 2. Detect explicit typing/key events if emitted by telemetry
        var keyRunStart = -1;
        var keyRunEnd = -1;
        var keyRunCx = 0.5;
        var keyRunCy = 0.5;
        for (var ke = 0; ke < rawSamples.length; ke++) {
            var ks = rawSamples[ke];
            var isKeySample = (ks.interactionType === "key" || ks.interactionType === "typing" || ks.isTyping === true);
            if (isKeySample) {
                if (keyRunStart < 0) {
                    keyRunStart = ks.timeMs;
                    keyRunCx = ks.cx;
                    keyRunCy = ks.cy;
                }
                keyRunEnd = ks.timeMs;
            } else if (keyRunStart >= 0 && (ks.timeMs - keyRunEnd) > 1200) {
                if ((keyRunEnd - keyRunStart) >= 600) {
                    typingIntervals.push({
                        startMs: keyRunStart,
                        endMs: keyRunEnd,
                        cx: keyRunCx,
                        cy: keyRunCy
                    });
                }
                keyRunStart = -1;
            }
        }
        if (keyRunStart >= 0 && (keyRunEnd - keyRunStart) >= 600) {
            typingIntervals.push({
                startMs: keyRunStart,
                endMs: keyRunEnd,
                cx: keyRunCx,
                cy: keyRunCy
            });
        }

        // 3. Detect typing intervals via click into text field + stationary dwell
        // Supports both direct text-cursor clicks and clicks that transition to text cursor within 500ms
        for (var c = 0; c < rawSamples.length; c++) {
            var clickS = rawSamples[c];
            if (clickS.interactionType === "click" || clickS.interactionType === "double-click") {
                var isTextClick = (clickS.cursorType === "text");
                if (!isTextClick) {
                    // Check if cursor switched to I-beam text cursor immediately before or after click
                    for (var near = Math.max(0, c - 3); near < Math.min(rawSamples.length, c + 8); near++) {
                        if (Math.abs(rawSamples[near].timeMs - clickS.timeMs) <= 500 && rawSamples[near].cursorType === "text") {
                            isTextClick = true;
                            break;
                        }
                    }
                }
                if (isTextClick) {
                    // Allow typing sessions up to 60 seconds (not capped at 8s)
                    var windowEnd = Math.min(totalMs, clickS.timeMs + 60000);
                    var maxDisp = 0;
                    var lastStationaryMs = clickS.timeMs;
                    for (var w = c + 1; w < rawSamples.length && rawSamples[w].timeMs <= windowEnd; w++) {
                        var sMove = rawSamples[w];
                        var d = Math.sqrt(Math.pow(sMove.cx - clickS.cx, 2) + Math.pow(sMove.cy - clickS.cy, 2));
                        if (d > maxDisp) maxDisp = d;
                        if (maxDisp > 0.03) break; // User moved mouse away
                        lastStationaryMs = sMove.timeMs;
                    }
                    var typingDur = lastStationaryMs - clickS.timeMs;
                    if (typingDur >= 900) {
                        typingIntervals.push({
                            startMs: Math.max(0, clickS.timeMs),
                            endMs: Math.min(totalMs, lastStationaryMs),
                            cx: clickS.cx,
                            cy: clickS.cy
                        });
                        while (c < rawSamples.length - 1 && rawSamples[c + 1].timeMs <= lastStationaryMs) {
                            c++;
                        }
                    }
                }
            }
        }

        // Merge overlapping or adjacent typing intervals
        var mergedTyping = [];
        if (typingIntervals.length > 0) {
            typingIntervals.sort(function (a, b) { return a.startMs - b.startMs; });
            var curTyping = {
                startMs: Math.max(0, typingIntervals[0].startMs),
                endMs: Math.min(totalMs, typingIntervals[0].endMs),
                cx: typingIntervals[0].cx,
                cy: typingIntervals[0].cy
            };
            for (var m = 1; m < typingIntervals.length; m++) {
                var nextT = typingIntervals[m];
                if (nextT.startMs <= curTyping.endMs + 800) {
                    curTyping.endMs = Math.min(totalMs, Math.max(curTyping.endMs, nextT.endMs));
                } else {
                    if (curTyping.endMs > curTyping.startMs + 200) {
                        mergedTyping.push(curTyping);
                    }
                    curTyping = {
                        startMs: Math.max(0, nextT.startMs),
                        endMs: Math.min(totalMs, nextT.endMs),
                        cx: nextT.cx,
                        cy: nextT.cy
                    };
                }
            }
            if (curTyping.endMs > curTyping.startMs + 200) {
                mergedTyping.push(curTyping);
            }
        }

        // 4. Build 2.0x Time-Mapping Function for Typing Speed-Up
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
                return { compSec: Math.max(0, tSec), isTyping: false };
            }
            var tMs = tSec * 1000.0;
            var savedMs = 0;
            var inTyping = false;
            for (var segI = 0; segI < mergedTyping.length; segI++) {
                var seg = mergedTyping[segI];
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
    // Recordly Smart Zoom & Cluster Detection Engine (Full-Span Typing Zoom)
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
                    startMs: s.timeMs,
                    endMs: s.timeMs,
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
                            startMs: startS.timeMs,
                            endMs: endS.timeMs,
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

        // 3. Typing Intervals as High-Priority Full-Span Focus Candidates
        // Preserves full [startMs, endMs] so camera stays zoomed on the typing position the entire time
        if (typingIntervals && typingIntervals.length > 0) {
            for (var tp = 0; tp < typingIntervals.length; tp++) {
                var tItem = typingIntervals[tp];
                candidates.push({
                    startMs: tItem.startMs,
                    endMs: tItem.endMs,
                    timeMs: tItem.startMs,
                    cx: tItem.cx,
                    cy: tItem.cy,
                    strength: 3000,
                    isExplicit: true,
                    isTyping: true
                });
            }
        }

        if (candidates.length === 0) return [];

        candidates.sort(function (a, b) { return a.startMs - b.startMs; });

        // Merge Clusters within mergeGapMs
        var clusters = [];
        var curStart = candidates[0].startMs;
        var curEnd = candidates[0].endMs;
        var bestStrength = candidates[0].strength;
        var bestCx = candidates[0].cx;
        var bestCy = candidates[0].cy;
        var sumCx = candidates[0].cx;
        var sumCy = candidates[0].cy;
        var count = 1;

        for (var k = 1; k < candidates.length; k++) {
            var c = candidates[k];
            var gap = c.startMs - curEnd;
            if (gap <= mergeGapMs) {
                curEnd = Math.max(curEnd, c.endMs);
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
                curStart = c.startMs;
                curEnd = c.endMs;
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
    // Helper: Create Procedural Vector Cursor Fallback (if PNGs missing)
    // =========================================================================
    function createProceduralCursorLayer(comp, cursorMaster, baseCursorHeight, enableMotionBlur) {
        var shapeLayer = comp.layers.addShape();
        shapeLayer.name = "Cursor_arrow";
        shapeLayer.parent = cursorMaster;
        shapeLayer.motionBlur = enableMotionBlur;
        shapeLayer.transform.anchorPoint.setValue([0, 0]);
        shapeLayer.transform.position.setValue([0, 0]);

        var scale = baseCursorHeight / 24.0;
        var root = shapeLayer.property("ADBE Root Vectors Group");
        var grp = root.addProperty("ADBE Vector Group");
        grp.name = "Pointer Arrow";
        var vecs = grp.property("ADBE Vectors Group");

        var pathGrp = vecs.addProperty("ADBE Vector Shape - Group");
        var arrowShape = new Shape();
        arrowShape.vertices = [
            [0, 0],
            [0, 20 * scale],
            [5.2 * scale, 15.6 * scale],
            [8.8 * scale, 22.8 * scale],
            [11.4 * scale, 21.4 * scale],
            [7.8 * scale, 14.2 * scale],
            [14.2 * scale, 14.2 * scale]
        ];
        arrowShape.closed = true;
        pathGrp.property("ADBE Vector Shape").setValue(arrowShape);

        var fill = vecs.addProperty("ADBE Vector Graphic - Fill");
        fill.property("ADBE Vector Fill Color").setValue([1.0, 1.0, 1.0, 1.0]);

        var stroke = vecs.addProperty("ADBE Vector Graphic - Stroke");
        stroke.property("ADBE Vector Stroke Color").setValue([0.07, 0.08, 0.10, 1.0]);
        stroke.property("ADBE Vector Stroke Width").setValue(Math.max(1.2, 1.6 * scale));

        return shapeLayer;
    }

    // =========================================================================
    // Helper: Update Active Rig Sliders In-Place Without Rebuilding
    // =========================================================================
    function updateActiveTraceMotionRig(comp, options) {
        if (!comp) return false;
        var controller = comp.layer("TraceMotion_Camera_Controller");
        if (!controller) return false;

        try {
            app.beginUndoGroup("Update TraceMotion Rig");
            if (options.canvasMargin !== undefined) {
                SafeProp.setValue(controller.effect("Canvas Margin")("Slider"), options.canvasMargin);
            }
            if (options.cornerRadius !== undefined) {
                SafeProp.setValue(controller.effect("Corner Radius")("Slider"), options.cornerRadius);
            }
            if (options.shadowIntensity !== undefined) {
                SafeProp.setValue(controller.effect("Shadow Intensity")("Slider"), options.shadowIntensity);
            }
            if (options.swayAmount !== undefined) {
                SafeProp.setValue(controller.effect("Cursor Sway")("Slider"), options.swayAmount);
            }
            app.endUndoGroup();
            return true;
        } catch (e) {
            try { app.endUndoGroup(); } catch (ue) {}
            return false;
        }
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
                return null;
            }
            telemetryFile.open("r");
            var jsonContent = telemetryFile.read();
            telemetryFile.close();

            var telemetryData = JSONParser.parse(jsonContent);
            var rawSamplesOrig = telemetryData.samples || [];
            if (!rawSamplesOrig || rawSamplesOrig.length === 0) {
                alert("No telemetry samples found in the provided JSON file.", "TraceMotion Error");
                return null;
            }

            // 2. Import Video Footage
            if (!videoFile || !videoFile.exists) {
                alert("Video footage file does not exist: " + (videoFile ? videoFile.fsName : "null"), "TraceMotion Error");
                return null;
            }
            var importOpts = new ImportOptions(videoFile);
            var footageItem = proj.importFile(importOpts);
            if (!footageItem) {
                alert("Failed to import video footage into project.", "Import Error");
                return null;
            }

            var footageW = footageItem.width;
            var footageH = footageItem.height;
            var duration = footageItem.duration;
            var fps = footageItem.frameRate || 60;
            var frameDurSec = 1.0 / fps;

            // Apply optional user sync offset (ms) to align OBS telemetry with first video frame
            // Positive offset delays cursor (fixes cursor moving before video); negative advances cursor
            var syncOffsetMs = parseFloat(options.syncOffsetMs) || 0;
            var rawSamples = [];
            for (var rs = 0; rs < rawSamplesOrig.length; rs++) {
                var origS = rawSamplesOrig[rs];
                rawSamples.push({
                    timeMs: Math.max(0, origS.timeMs + syncOffsetMs),
                    cx: origS.cx,
                    cy: origS.cy,
                    cursorType: origS.cursorType || "arrow",
                    interactionType: origS.interactionType || "",
                    isTyping: origS.isTyping === true
                });
            }

            // Analyze telemetry for drags, text selection, and typing speedup
            var enableTypingSpeedup = options.enableTypingSpeedup !== false;
            var telemetryAnalysis = detectTelemetryInteractions(rawSamples, duration, enableTypingSpeedup);
            var plannedCompDuration = Math.max(0.2, duration - telemetryAnalysis.totalSavedSec);

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
                plannedCompDuration,
                fps
            );
            try { comp.openInViewer(); } catch (viewerErr) {}
            comp.motionBlur = options.enableMotionBlur !== false;

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
                    var wpMeta = getWallpaperMeta(wpKey);
                    var bgData = BACKGROUND_PRESETS[wpKey] || {
                        start: wpMeta.start,
                        end: wpMeta.end,
                        isRadial: (wpKey === "dark-studio" || wpKey === "midnight-8.jpg")
                    };
                    bgLayer = comp.layers.addSolid(bgData.start, "TraceMotion_Background", compW, compH, 1.0, plannedCompDuration);
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

            // Connect Camera Rig Null transforms to Camera Controller
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

            // 8. Create Window Drop Shadow Layer (Underneath Video, Never Clipped by Track Matte)
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

            // Apply 2.0x Time Remapping during typing intervals BEFORE keyframing cursor/camera
            // CRITICAL FIX: Never delete the last keyframe on ADBE Time Remapping (AE throws!)
            // Keep Key 1 at t=0, remove only Key 2 at t=duration, then set exact remap keys.
            // If time remap cannot be applied, fall back to identity timeMapFn so video & cursor NEVER desync!
            var timeRemapApplied = false;
            var activeTimeMapFn = function (tSec) { return { compSec: Math.max(0, tSec), isTyping: false }; };
            var compDuration = duration;

            if (enableTypingSpeedup && telemetryAnalysis.typingIntervals.length > 0 && telemetryAnalysis.totalSavedSec > 0.05) {
                try {
                    videoLayer.timeRemapEnabled = true;
                    var trProp = videoLayer.property("ADBE Time Remapping");
                    // AE creates 2 keys by default: Key 1 at 0, Key 2 at duration.
                    // Remove trailing keys down to 1 (never 0!)
                    while (trProp.numKeys > 1) {
                        trProp.removeKey(trProp.numKeys);
                    }
                    trProp.setValueAtTime(0, 0);

                    for (var ty = 0; ty < telemetryAnalysis.typingIntervals.length; ty++) {
                        var tSeg = telemetryAnalysis.typingIntervals[ty];
                        var rawStartSec = Math.max(0, Math.min(duration, tSeg.startMs / 1000.0));
                        var rawEndSec = Math.max(rawStartSec, Math.min(duration, tSeg.endMs / 1000.0));
                        var mappedStart = telemetryAnalysis.timeMapFn(rawStartSec).compSec;
                        var mappedEnd = telemetryAnalysis.timeMapFn(rawEndSec).compSec;

                        if (mappedStart > 0.001) {
                            trProp.setValueAtTime(mappedStart, rawStartSec);
                        }
                        if (mappedEnd > mappedStart + 0.001) {
                            trProp.setValueAtTime(mappedEnd, rawEndSec);
                        }
                    }
                    trProp.setValueAtTime(plannedCompDuration, Math.max(0, duration - frameDurSec * 0.5));

                    for (var trk = 1; trk <= trProp.numKeys; trk++) {
                        try {
                            trProp.setInterpolationTypeAtKey(trk, KeyframeInterpolationType.LINEAR);
                        } catch (eLin) {}
                    }
                    videoLayer.outPoint = plannedCompDuration;
                    timeRemapApplied = true;
                    activeTimeMapFn = telemetryAnalysis.timeMapFn;
                    compDuration = plannedCompDuration;
                } catch (eTr) {
                    // Roll back cleanly so video and cursor stay 100% locked at 1x
                    try { videoLayer.timeRemapEnabled = false; } catch (eOff) {}
                    comp.duration = duration;
                    compDuration = duration;
                    timeRemapApplied = false;
                }
            } else {
                comp.duration = duration;
                compDuration = duration;
            }

            // 10. Add Window Matte Shape Layer (Single Clean Alpha Track Matte for Video Footage)
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

            // Set Video Footage Track Matte to Alpha Matte
            matteLayer.moveBefore(videoLayer);
            try {
                if (typeof videoLayer.setTrackMatte === "function" && typeof TrackMatteType !== "undefined") {
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

                if (isDrag || feel === "raw") {
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

                var mappedCompSec = activeTimeMapFn(timeMs / 1000.0).compSec;
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

            // 12. Recordly Smart Zoom & Pan Trajectory (Strict Straight-Line Easing + Full Typing Zoom)
            var targetZoomScale = Math.max(1.0, (options.zoomDepthScale || 1.8));

            if (options.zoomMode === "auto-cluster") {
                var clusters = buildRecordlyZoomClusters(rawSamples, duration, targetZoomScale, telemetryAnalysis.typingIntervals);
                var easeInOut = new KeyframeEase(0, 84.0);

                controller.effect("Camera Focus")("Point").setValueAtTime(0, [footageW / 2, footageH / 2]);
                controller.effect("Zoom Scale")("Slider").setValueAtTime(0, 100);

                var zoomTransitionSec = 0.85;
                for (var cl = 0; cl < clusters.length; cl++) {
                    var cluster = clusters[cl];
                    var tStart = activeTimeMapFn(cluster.startSec).compSec;
                    var tEnd = activeTimeMapFn(cluster.endSec).compSec;
                    var spanSec = Math.max(0.25, tEnd - tStart);
                    var transIn = Math.min(zoomTransitionSec, spanSec * 0.35);
                    var transOut = Math.min(zoomTransitionSec * 0.85, spanSec * 0.35);
                    var tInEnd = tStart + transIn;
                    var tOutStart = Math.max(tInEnd + 0.05, tEnd - transOut);

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
                for (var kp = 1; kp <= contPProp.numKeys; kp++) {
                    SafeProp.setTemporalEase(contPProp, kp, easeIn, easeOut);
                    try {
                        contPProp.setSpatialContinuousAtKey(kp, false);
                        contPProp.setSpatialAutoBezierAtKey(kp, false);
                        contPProp.setInterpolationTypeAtKey(kp, KeyframeInterpolationType.LINEAR);
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
                    var mappedClickSec = activeTimeMapFn(cSample.timeMs / 1000.0).compSec;
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
            var preferSvg = false;
            try {
                if (typeof app !== "undefined" && app.version && parseFloat(app.version) >= 24.0) {
                    preferSvg = false; // PNG 512px Retina is universally crisp and zero-issue across AE 2020-2026
                }
            } catch (eVer) {}

            var cursorStateLayers = {};
            var cursorStateNames = [
                "arrow", "pointer", "text", "crosshair",
                "open-hand", "closed-hand", "resize-ew", "resize-ns",
                "not-allowed", "wait"
            ];

            for (var st = 0; st < cursorStateNames.length; st++) {
                var stateName = cursorStateNames[st];
                var assetFile = getCursorAssetFile(styleKey, stateName, preferSvg);
                if (!assetFile || !assetFile.exists) {
                    assetFile = getCursorAssetFile(styleKey, "arrow", preferSvg);
                }
                if (!assetFile || !assetFile.exists) continue;

                var cursorItem = proj.importFile(new ImportOptions(assetFile));
                var cLayer = comp.layers.add(cursorItem);
                cLayer.name = "Cursor_" + stateName;
                cLayer.parent = cursorMaster;
                cLayer.motionBlur = options.enableMotionBlur !== false;

                var anchorMeta = (styleDef.cursors && styleDef.cursors[stateName]) || { anchorX: 0.34, anchorY: 0.24 };
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

            // Silent procedural vector cursor fallback if PNG assets are not found on disk
            if (getObjectKeys(cursorStateLayers).length === 0) {
                cursorStateLayers.arrow = createProceduralCursorLayer(comp, cursorMaster, baseCursorHeight, options.enableMotionBlur !== false);
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
                            startSec: activeTimeMapFn(currentRunStart / 1000.0).compSec,
                            endSec: activeTimeMapFn(rawSamples[rIdx].timeMs / 1000.0).compSec
                        });
                        currentRunState = sType;
                        currentRunStart = rawSamples[rIdx].timeMs;
                    }
                }
                stateRuns.push({
                    state: currentRunState,
                    startSec: activeTimeMapFn(currentRunStart / 1000.0).compSec,
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

            // 15. Create Two-Tier Studio Click Ripple VFX Layer (Zero Stale-Ref Crashes & Zero Top-Left Artifacts!)
            var rippleOption = options.clickEffect || "#2563EB";
            if (rippleOption !== "none" && clickSamplesList.length > 0) {
                var rippleLayer = comp.layers.addShape();
                rippleLayer.name = "TraceMotion_Click_Ripples";
                rippleLayer.parent = cameraRig;
                rippleLayer.transform.anchorPoint.setValue([0, 0]);
                rippleLayer.transform.position.setValue([0, 0]);
                rippleLayer.transform.scale.setValue([100, 100]);
                rippleLayer.motionBlur = options.enableMotionBlur !== false;

                var rippleHex = (rippleOption.indexOf("#") === 0) ? rippleOption : "#2563EB";
                if (rippleOption === "white") rippleHex = "#FFFFFF";
                else if (rippleOption === "emerald") rippleHex = "#10B981";
                else if (rippleOption === "amber") rippleHex = "#F59E0B";

                var rgbColor = hexToRgb(rippleHex);
                var maxRadius = Math.max(40, baseCursorHeight * 1.9);
                var cubicEaseOut = new KeyframeEase(0, 88.0);
                var cubicEaseIn = new KeyframeEase(0, 20.0);

                for (var rc = 0; rc < clickSamplesList.length; rc++) {
                    var clickSample = clickSamplesList[rc];
                    var mappedClickStart = activeTimeMapFn(clickSample.timeMs / 1000.0).compSec;
                    var isDouble = (clickSample.interactionType === "double-click");
                    var ringMaxDiam = (isDouble ? maxRadius * 2.4 : maxRadius * 2.1);
                    var discMaxDiam = (isDouble ? maxRadius * 1.05 : maxRadius * 0.9);
                    var tInnerEnd = mappedClickStart + 0.240;
                    var tOuterEnd = mappedClickStart + 0.520;

                    // Lock ripple position to smoothed cursor position at click time so it emanates from the exact cursor tip
                    var simPos = interpolateCursorPosition(simulatedPath, clickSample.timeMs);
                    var rippleX = (simPos ? simPos.cx : clickSample.cx) * footageW;
                    var rippleY = (simPos ? simPos.cy : clickSample.cy) * footageH;

                    // Re-fetch root fresh every iteration to prevent ExtendScript reference invalidation
                    var rRootFresh = rippleLayer.property("ADBE Root Vectors Group");
                    var rGroupName = "Ripple_" + (rc + 1);
                    var rGroup = rRootFresh.addProperty("ADBE Vector Group");
                    rGroup.name = rGroupName;

                    // Set group position immediately
                    var rTrans = rGroup.property("ADBE Vector Transform Group");
                    rTrans.property("ADBE Vector Position").setValue([rippleX, rippleY]);
                    rTrans.property("ADBE Vector Anchor").setValue([0, 0]);

                    // Create two ISOLATED sub-groups inside Ripple_N:
                    // (A) Inner_Pop (Fill only) and (B) Outer_Ring (Stroke only)
                    // Configure each property immediately upon creation so no addProperty() ever invalidates an earlier reference!
                    var rParentVecs = rGroup.property("ADBE Vectors Group");

                    // --- TIER 1: Inner Soft Pop Disc ---
                    var innerGrp = rParentVecs.addProperty("ADBE Vector Group");
                    innerGrp.name = "Inner_Pop";
                    var innerVecs = innerGrp.property("ADBE Vectors Group");

                    var inEll = innerVecs.addProperty("ADBE Vector Shape - Ellipse");
                    var inEllSize = inEll.property("ADBE Vector Ellipse Size");
                    inEllSize.setValueAtTime(0, [0, 0]);
                    if (mappedClickStart > frameDurSec) {
                        inEllSize.setValueAtTime(mappedClickStart - frameDurSec, [0, 0]);
                    }
                    inEllSize.setValueAtTime(mappedClickStart, [4, 4]);
                    inEllSize.setValueAtTime(tInnerEnd, [discMaxDiam, discMaxDiam]);
                    inEllSize.setValueAtTime(tInnerEnd + frameDurSec, [0, 0]);
                    try {
                        var kIn0 = inEllSize.nearestKeyIndex(0);
                        inEllSize.setInterpolationTypeAtKey(kIn0, KeyframeInterpolationType.HOLD);
                        if (mappedClickStart > frameDurSec) {
                            inEllSize.setInterpolationTypeAtKey(inEllSize.nearestKeyIndex(mappedClickStart - frameDurSec), KeyframeInterpolationType.HOLD);
                        }
                        SafeProp.setTemporalEase(inEllSize, inEllSize.nearestKeyIndex(mappedClickStart), cubicEaseIn, cubicEaseOut);
                        SafeProp.setTemporalEase(inEllSize, inEllSize.nearestKeyIndex(tInnerEnd), cubicEaseOut, cubicEaseIn);
                    } catch (eInEase) {}

                    var inFill = innerVecs.addProperty("ADBE Vector Graphic - Fill");
                    inFill.property("ADBE Vector Fill Color").setValue([rgbColor[0], rgbColor[1], rgbColor[2], 1.0]);
                    var inFillOp = inFill.property("ADBE Vector Fill Opacity");
                    inFillOp.setValueAtTime(0, 0.0);
                    if (mappedClickStart > frameDurSec) {
                        inFillOp.setValueAtTime(mappedClickStart - frameDurSec, 0.0);
                    }
                    inFillOp.setValueAtTime(mappedClickStart, 42.0);
                    inFillOp.setValueAtTime(tInnerEnd, 0.0);
                    inFillOp.setValueAtTime(tInnerEnd + frameDurSec, 0.0);
                    try {
                        inFillOp.setInterpolationTypeAtKey(inFillOp.nearestKeyIndex(0), KeyframeInterpolationType.HOLD);
                        if (mappedClickStart > frameDurSec) {
                            inFillOp.setInterpolationTypeAtKey(inFillOp.nearestKeyIndex(mappedClickStart - frameDurSec), KeyframeInterpolationType.HOLD);
                        }
                    } catch (eInOp) {}

                    // --- TIER 2: Outer Expanding Shockwave Ring ---
                    // Re-fetch rParentVecs fresh from rippleLayer before adding second sub-group
                    var rParentVecs2 = SafeProp.findFresh(rippleLayer, ["ADBE Root Vectors Group", rGroupName, "ADBE Vectors Group"]);
                    var outerGrp = rParentVecs2.addProperty("ADBE Vector Group");
                    outerGrp.name = "Outer_Ring";
                    var outerVecs = outerGrp.property("ADBE Vectors Group");

                    var outEll = outerVecs.addProperty("ADBE Vector Shape - Ellipse");
                    var outEllSize = outEll.property("ADBE Vector Ellipse Size");
                    outEllSize.setValueAtTime(0, [0, 0]);
                    if (mappedClickStart > frameDurSec) {
                        outEllSize.setValueAtTime(mappedClickStart - frameDurSec, [0, 0]);
                    }
                    outEllSize.setValueAtTime(mappedClickStart, [6, 6]);
                    outEllSize.setValueAtTime(tOuterEnd, [ringMaxDiam, ringMaxDiam]);
                    outEllSize.setValueAtTime(tOuterEnd + frameDurSec, [0, 0]);
                    try {
                        outEllSize.setInterpolationTypeAtKey(outEllSize.nearestKeyIndex(0), KeyframeInterpolationType.HOLD);
                        if (mappedClickStart > frameDurSec) {
                            outEllSize.setInterpolationTypeAtKey(outEllSize.nearestKeyIndex(mappedClickStart - frameDurSec), KeyframeInterpolationType.HOLD);
                        }
                        SafeProp.setTemporalEase(outEllSize, outEllSize.nearestKeyIndex(mappedClickStart), cubicEaseIn, cubicEaseOut);
                        SafeProp.setTemporalEase(outEllSize, outEllSize.nearestKeyIndex(tOuterEnd), cubicEaseOut, cubicEaseIn);
                    } catch (eOutEase) {}

                    var outStroke = outerVecs.addProperty("ADBE Vector Graphic - Stroke");
                    outStroke.property("ADBE Vector Stroke Color").setValue([rgbColor[0], rgbColor[1], rgbColor[2], 1.0]);
                    var outStrokeW = outStroke.property("ADBE Vector Stroke Width");
                    outStrokeW.setValueAtTime(mappedClickStart, 4.2);
                    outStrokeW.setValueAtTime(tOuterEnd, 0.5);

                    var outStrokeOp = outStroke.property("ADBE Vector Stroke Opacity");
                    outStrokeOp.setValueAtTime(0, 0.0);
                    if (mappedClickStart > frameDurSec) {
                        outStrokeOp.setValueAtTime(mappedClickStart - frameDurSec, 0.0);
                    }
                    outStrokeOp.setValueAtTime(mappedClickStart, 92.0);
                    outStrokeOp.setValueAtTime(mappedClickStart + 0.140, 75.0);
                    outStrokeOp.setValueAtTime(tOuterEnd, 0.0);
                    outStrokeOp.setValueAtTime(tOuterEnd + frameDurSec, 0.0);
                    try {
                        outStrokeOp.setInterpolationTypeAtKey(outStrokeOp.nearestKeyIndex(0), KeyframeInterpolationType.HOLD);
                        if (mappedClickStart > frameDurSec) {
                            outStrokeOp.setInterpolationTypeAtKey(outStrokeOp.nearestKeyIndex(mappedClickStart - frameDurSec), KeyframeInterpolationType.HOLD);
                        }
                    } catch (eOutOp) {}
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
                    "- Comp: " + comp.name + " (" + compW + "x" + compH + " @ " + fps + " FPS)\n" +
                    "- Window Framing: " + (options.cornerRadius !== undefined ? options.cornerRadius : 20) + "px corners & soft drop shadows\n" +
                    "- Background: " + (bgLayer ? bgLayer.name : "None") + "\n" +
                    "- Cursor: " + styleDef.label + " (" + getObjectKeys(cursorStateLayers).length + " states)\n" +
                    "- Smart Zoom: " + targetZoomScale.toFixed(2) + "x (" + options.zoomMode + ")\n" +
                    "- Click Ripples: " + (rippleOption !== "none" ? (clickSamplesList.length + " animated 2-tier ripples") : "Off") + "\n" +
                    (timeRemapApplied ? ("- Typing Speed-Up: 2.0x playback & zoom on " + telemetryAnalysis.typingIntervals.length + " typing segment(s)\n") : ""),
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
    // Helper: Draw Rounded Rectangle Path in ScriptUI Graphics
    // =========================================================================
    function drawRoundedRectPath(g, x, y, w, h, r) {
        var rad = Math.max(0, Math.min(r, Math.min(w, h) / 2));
        g.newPath();
        if (rad < 1) {
            g.moveTo(x, y);
            g.lineTo(x + w, y);
            g.lineTo(x + w, y + h);
            g.lineTo(x, y + h);
            g.closePath();
            return;
        }
        // Smooth 8-point chamfered-arc approximation (100% safe across AE 2020-2026 ScriptUI)
        var k = rad * 0.42;
        g.moveTo(x + rad, y);
        g.lineTo(x + w - rad, y);
        g.lineTo(x + w - k, y + k * 0.35);
        g.lineTo(x + w - k * 0.35, y + k);
        g.lineTo(x + w, y + rad);
        g.lineTo(x + w, y + h - rad);
        g.lineTo(x + w - k * 0.35, y + h - k);
        g.lineTo(x + w - k, y + h - k * 0.35);
        g.lineTo(x + w - rad, y + h);
        g.lineTo(x + rad, y + h);
        g.lineTo(x + k, y + h - k * 0.35);
        g.lineTo(x + k * 0.35, y + h - k);
        g.lineTo(x, y + h - rad);
        g.lineTo(x, y + rad);
        g.lineTo(x + k * 0.35, y + k);
        g.lineTo(x + k, y + k * 0.35);
        g.closePath();
    }

    // =========================================================================
    // Responsive ScriptUI Studio Panel (AE CC 2020 - 2026+ Dockable Panel)
    // - Crisp Live Preview Stage (never black!)
    // - Stacked Tabs (Setup | Cursor | Frame) with zero dead space
    // - Always-Visible Sticky Footer with Build/Update Rig + Reset
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
            var bgCol = [0.105, 0.110, 0.133, 1.0]; // #1b1c22
            win.graphics.backgroundColor = win.graphics.newBrush(win.graphics.BrushType.SOLID_COLOR, bgCol);
        } catch (e) {}

        // Shared UI State
        var activeTab = "setup";
        var currentBgKey = getPref("selectedBgKey", "tahoe-light.jpg");
        var currentCursorKey = getPref("selectedCursorKey", "tahoe");
        var currentZoomScale = parseFloat(getPref("selectedZoomScale", "1.80")) || 1.80;
        var currentZoomMode = getPref("selectedZoomMode", "auto-cluster");
        var currentMotionFeel = getPref("selectedMotionFeel", "natural");
        var currentCursorSize = parseInt(getPref("selectedCursorSize", "100"), 10) || 100;
        var currentCornerRadius = parseInt(getPref("selectedCornerRadius", "20"), 10);
        if (isNaN(currentCornerRadius)) currentCornerRadius = 20;
        var currentMargin = parseInt(getPref("selectedMargin", "12"), 10);
        if (isNaN(currentMargin)) currentMargin = 12;
        var currentShadow = parseInt(getPref("selectedShadow", "65"), 10);
        if (isNaN(currentShadow)) currentShadow = 65;
        var currentRippleColor = getPref("selectedRippleColor", "#2563EB");
        var currentSyncOffsetMs = parseInt(getPref("selectedSyncOffsetMs", "0"), 10) || 0;

        var selectedVideoFile = null;
        var selectedJsonFile = null;
        var previewCursorImg = null;
        var stageClickPos = { nx: 0.56, ny: 0.54, hasRipple: true };

        function refreshPreviewAssets() {
            var cF = getCursorPreviewFile(currentCursorKey);
            if (cF && cF.exists && cF.name.toLowerCase().indexOf(".png") > 0) {
                try { previewCursorImg = ScriptUI.newImage(cF); } catch (e) { previewCursorImg = null; }
            } else {
                previewCursorImg = null;
            }
        }
        refreshPreviewAssets();

        // ---------------------------------------------------------------------
        // 1. STICKY HEADER
        // ---------------------------------------------------------------------
        var headerGrp = win.add("group");
        headerGrp.orientation = "row";
        headerGrp.alignChildren = ["left", "center"];
        headerGrp.alignment = ["fill", "top"];
        headerGrp.spacing = 8;
        headerGrp.margins = [0, 0, 0, 2];

        var emblemBox = headerGrp.add("group");
        emblemBox.preferredSize = [26, 26];
        emblemBox.minimumSize = [26, 26];
        emblemBox.maximumSize = [26, 26];
        emblemBox.onDraw = function () {
            try {
                var g = this.graphics;
                var bgB = g.newBrush(g.BrushType.SOLID_COLOR, [0.145, 0.388, 0.922, 1.0]);
                drawRoundedRectPath(g, 0, 0, 26, 26, 6);
                g.fillPath(bgB);

                var pen = g.newPen(g.PenType.SOLID_COLOR, [1.0, 1.0, 1.0, 0.75], 1.4);
                g.newPath();
                g.moveTo(5, 6); g.lineTo(21, 6); g.lineTo(21, 18); g.lineTo(5, 18); g.closePath();
                g.strokePath(pen);

                g.newPath();
                g.moveTo(11, 10); g.lineTo(18, 13.5); g.lineTo(14.5, 15.2); g.lineTo(13, 19); g.closePath();
                var fillW = g.newBrush(g.BrushType.SOLID_COLOR, [1.0, 1.0, 1.0, 1.0]);
                g.fillPath(fillW);
            } catch (eDraw) {}
        };

        var titleCol = headerGrp.add("group");
        titleCol.orientation = "column";
        titleCol.alignChildren = ["left", "center"];
        titleCol.alignment = ["fill", "center"];
        titleCol.spacing = 1;

        var titleTxt = titleCol.add("statictext", undefined, "TraceMotion Studio");
        try { titleTxt.graphics.font = ScriptUI.newFont("Verdana", "Bold", 12); } catch (e) {}
        try { titleTxt.graphics.foregroundColor = titleTxt.graphics.newPen(titleTxt.graphics.PenType.SOLID_COLOR, [0.96, 0.97, 0.99, 1.0], 1); } catch (e) {}

        var subTxt = titleCol.add("statictext", undefined, "Recordly Smart Framing & Cursor Rig");
        try { subTxt.graphics.font = ScriptUI.newFont("Verdana", "Regular", 9); } catch (e) {}
        try { subTxt.graphics.foregroundColor = subTxt.graphics.newPen(subTxt.graphics.PenType.SOLID_COLOR, [0.62, 0.66, 0.74, 1.0], 1); } catch (e) {}

        var activeCompInit = getActiveComp();
        var hasActiveRig = !!(activeCompInit && activeCompInit.layer("TraceMotion_Camera_Controller"));
        var statusTxt = headerGrp.add("statictext", undefined, hasActiveRig ? "Rig Active" : "AE 2020+");
        statusTxt.alignment = ["right", "center"];
        try { statusTxt.graphics.font = ScriptUI.newFont("Verdana", "Bold", 9); } catch (e) {}
        try {
            var stCol = hasActiveRig ? [0.22, 0.85, 0.50, 1.0] : [0.40, 0.65, 1.0, 1.0];
            statusTxt.graphics.foregroundColor = statusTxt.graphics.newPen(statusTxt.graphics.PenType.SOLID_COLOR, stCol, 1);
        } catch (e) {}

        // ---------------------------------------------------------------------
        // 2. LIVE INTERACTIVE COMPOSITION PREVIEW STAGE (Uses Group, Never Black!)
        // ---------------------------------------------------------------------
        var previewStage = win.add("group");
        previewStage.preferredSize = [300, 132];
        previewStage.minimumSize = [200, 96];
        previewStage.alignment = ["fill", "top"];

        var hudFont = null;
        try { hudFont = ScriptUI.newFont("Verdana", "Bold", 9); } catch (eF) {}

        function redrawPreview() {
            try {
                previewStage.notify("onDraw");
            } catch (eNot) {
                try {
                    previewStage.visible = false;
                    previewStage.visible = true;
                } catch (eVis) {}
            }
        }

        previewStage.onDraw = function () {
            try {
                var g = this.graphics;
                var w = (this.size && this.size[0] > 10) ? this.size[0] : (this.bounds ? (this.bounds[2] - this.bounds[0]) : 300);
                var h = (this.size && this.size[1] > 10) ? this.size[1] : (this.bounds ? (this.bounds[3] - this.bounds[1]) : 132);
                if (w < 20 || h < 20) return;

                // 1. Draw Backdrop (Checkerboard for None, or Smooth 28-Step Gradient for All Presets/Wallpapers)
                if (currentBgKey === "none") {
                    var c1 = g.newBrush(g.BrushType.SOLID_COLOR, [0.13, 0.14, 0.17, 1.0]);
                    var c2 = g.newBrush(g.BrushType.SOLID_COLOR, [0.19, 0.21, 0.25, 1.0]);
                    g.rectPath(0, 0, w, h);
                    g.fillPath(c1);
                    var tile = 10;
                    for (var cy = 0; cy < h; cy += tile) {
                        for (var cx = ((Math.floor(cy / tile) % 2) * tile); cx < w; cx += tile * 2) {
                            g.rectPath(cx, cy, tile, tile);
                            g.fillPath(c2);
                        }
                    }
                } else {
                    var wpMeta = getWallpaperMeta(currentBgKey);
                    var bgStart = wpMeta.start || [0.231, 0.510, 0.965];
                    var bgEnd = wpMeta.end || [0.545, 0.361, 0.965];
                    var steps = 28;
                    var sw = w / steps;
                    for (var si = 0; si < steps; si++) {
                        var t = si / (steps - 1);
                        var rCol = bgStart[0] + (bgEnd[0] - bgStart[0]) * t;
                        var gCol = bgStart[1] + (bgEnd[1] - bgStart[1]) * t;
                        var bCol = bgStart[2] + (bgEnd[2] - bgStart[2]) * t;
                        var stripBrush = g.newBrush(g.BrushType.SOLID_COLOR, [rCol, gCol, bCol, 1.0]);
                        g.rectPath(Math.floor(si * sw), 0, Math.ceil(sw) + 1, h);
                        g.fillPath(stripBrush);
                    }
                }

                // 2. Floating Desktop Window (Reacts Live to Margin, Corner Radius & Drop Shadow!)
                var marginFrac = 0.06 + (currentMargin / 100.0) * 0.72;
                var winW = Math.max(60, Math.round(w * (1.0 - marginFrac)));
                var winH = Math.max(44, Math.round(h * (1.0 - marginFrac)));
                var winX = Math.round((w - winW) / 2);
                var winY = Math.round((h - winH) / 2) + 4;
                var scaledRad = Math.round(currentCornerRadius * 0.38);

                // Multi-stage soft drop shadow
                if (currentShadow > 0) {
                    var shAlpha1 = (currentShadow / 100.0) * 0.28;
                    var shAlpha2 = (currentShadow / 100.0) * 0.42;
                    var shSpread = Math.round(3 + (currentShadow / 100.0) * 5);
                    var shBrush1 = g.newBrush(g.BrushType.SOLID_COLOR, [0.0, 0.0, 0.0, shAlpha1]);
                    drawRoundedRectPath(g, winX - 2, winY + shSpread, winW + 4, winH + 2, scaledRad + 2);
                    g.fillPath(shBrush1);

                    var shBrush2 = g.newBrush(g.BrushType.SOLID_COLOR, [0.0, 0.0, 0.0, shAlpha2]);
                    drawRoundedRectPath(g, winX + 1, winY + Math.round(shSpread * 0.55), winW, winH, scaledRad);
                    g.fillPath(shBrush2);
                }

                // Window Body
                var bodyBrush = g.newBrush(g.BrushType.SOLID_COLOR, [0.082, 0.090, 0.114, 1.0]);
                drawRoundedRectPath(g, winX, winY, winW, winH, scaledRad);
                g.fillPath(bodyBrush);

                // Window Titlebar
                var tbH = Math.min(14, Math.round(winH * 0.20));
                var tbBrush = g.newBrush(g.BrushType.SOLID_COLOR, [0.130, 0.142, 0.176, 1.0]);
                drawRoundedRectPath(g, winX, winY, winW, tbH, Math.min(scaledRad, 4));
                g.fillPath(tbBrush);

                // Traffic Light Dots
                var dotY = winY + Math.max(3, Math.round((tbH - 5) / 2));
                var dRed = g.newBrush(g.BrushType.SOLID_COLOR, [1.0, 0.37, 0.34, 1.0]);
                g.ellipsePath(winX + 7, dotY, 5, 5); g.fillPath(dRed);
                var dYel = g.newBrush(g.BrushType.SOLID_COLOR, [1.0, 0.74, 0.18, 1.0]);
                g.ellipsePath(winX + 15, dotY, 5, 5); g.fillPath(dYel);
                var dGrn = g.newBrush(g.BrushType.SOLID_COLOR, [0.16, 0.78, 0.25, 1.0]);
                g.ellipsePath(winX + 23, dotY, 5, 5); g.fillPath(dGrn);

                // Mock App UI Content Inside Window
                var contentY = winY + tbH + 5;
                var contentH = Math.max(12, winH - tbH - 10);
                var sideW = Math.round(winW * 0.24);
                var cardBrush = g.newBrush(g.BrushType.SOLID_COLOR, [0.13, 0.145, 0.185, 1.0]);
                var accentBarBrush = g.newBrush(g.BrushType.SOLID_COLOR, [0.145, 0.388, 0.922, 0.55]);
                var lineBrush = g.newBrush(g.BrushType.SOLID_COLOR, [1.0, 1.0, 1.0, 0.12]);

                // Sidebar mock
                g.rectPath(winX + 6, contentY, sideW, contentH);
                g.fillPath(cardBrush);
                g.rectPath(winX + 10, contentY + 5, Math.max(8, sideW - 8), 4);
                g.fillPath(accentBarBrush);
                if (contentH > 20) {
                    g.rectPath(winX + 10, contentY + 13, Math.max(6, Math.round((sideW - 8) * 0.75)), 3);
                    g.fillPath(lineBrush);
                }

                // Main pane mock cards
                var mainX = winX + sideW + 12;
                var mainW = Math.max(20, winW - sideW - 18);
                g.rectPath(mainX, contentY, mainW, contentH);
                g.fillPath(cardBrush);
                var cardGap = 5;
                var subCardW = Math.max(10, Math.round((mainW - cardGap * 3) / 2));
                var subCardH = Math.max(8, Math.round(contentH * 0.48));
                var subCardY = contentY + Math.max(4, Math.round(contentH * 0.38));
                var subCardB1 = g.newBrush(g.BrushType.SOLID_COLOR, [1.0, 1.0, 1.0, 0.06]);
                var subCardB2 = g.newBrush(g.BrushType.SOLID_COLOR, [0.145, 0.388, 0.922, 0.22]);
                g.rectPath(mainX + cardGap, subCardY, subCardW, subCardH);
                g.fillPath(subCardB1);
                g.rectPath(mainX + cardGap * 2 + subCardW, subCardY, subCardW, subCardH);
                g.fillPath(subCardB2);

                // Crisp Window Border
                var winBorder = g.newPen(g.PenType.SOLID_COLOR, [1.0, 1.0, 1.0, 0.22], 1);
                drawRoundedRectPath(g, winX, winY, winW, winH, scaledRad);
                g.strokePath(winBorder);

                // 3. Click Ripple Preview (2-Tier Concentric Circle at Cursor Position!)
                var curX = Math.round(w * stageClickPos.nx);
                var curY = Math.round(h * stageClickPos.ny);
                var cScale = Math.max(0.6, Math.min(1.8, currentCursorSize / 100.0));

                if (stageClickPos.hasRipple && currentRippleColor !== "none") {
                    var rHex = currentRippleColor.indexOf("#") === 0 ? currentRippleColor : "#2563EB";
                    var rRgb = hexToRgb(rHex);
                    var innerD = Math.round(16 * cScale);
                    var outerD = Math.round(34 * cScale);

                    // Tier 1: Soft inner pop disc
                    var popBrush = g.newBrush(g.BrushType.SOLID_COLOR, [rRgb[0], rRgb[1], rRgb[2], 0.32]);
                    g.ellipsePath(curX - innerD / 2, curY - innerD / 2, innerD, innerD);
                    g.fillPath(popBrush);

                    // Tier 2: Crisp outer shockwave ring
                    var ringPen = g.newPen(g.PenType.SOLID_COLOR, [rRgb[0], rRgb[1], rRgb[2], 0.90], 2.0);
                    g.ellipsePath(curX - outerD / 2, curY - outerD / 2, outerD, outerD);
                    g.strokePath(ringPen);
                }

                // 4. Crisp Live Cursor Preview (Styled per Cursor Pack & Scaled by Cursor Size!)
                var drewCursorPng = false;
                if (previewCursorImg) {
                    try {
                        var imgSz = Math.round(22 * cScale);
                        g.drawImage(previewCursorImg, curX - Math.round(imgSz * 0.25), curY - Math.round(imgSz * 0.15), imgSz, imgSz);
                        drewCursorPng = true;
                    } catch (eImgC) {
                        drewCursorPng = false;
                    }
                }
                if (!drewCursorPng) {
                    var cs = cScale;
                    g.newPath();
                    if (currentCursorKey === "custom") {
                        // Figma sharp minimal pointer
                        g.moveTo(curX, curY);
                        g.lineTo(curX + 5.5 * cs, curY + 15.5 * cs);
                        g.lineTo(curX + 8.0 * cs, curY + 9.5 * cs);
                        g.lineTo(curX + 14.5 * cs, curY + 7.2 * cs);
                        g.closePath();
                    } else {
                        // macOS / Windows 11 pointer silhouette
                        g.moveTo(curX, curY);
                        g.lineTo(curX, curY + 15 * cs);
                        g.lineTo(curX + 3.8 * cs, curY + 11.6 * cs);
                        g.lineTo(curX + 6.6 * cs, curY + 17.2 * cs);
                        g.lineTo(curX + 9.0 * cs, curY + 16.0 * cs);
                        g.lineTo(curX + 6.2 * cs, curY + 10.6 * cs);
                        g.lineTo(curX + 11.2 * cs, curY + 10.6 * cs);
                        g.closePath();
                    }
                    var isDarkFill = (currentCursorKey === "macos" || currentCursorKey === "custom");
                    var cFill = g.newBrush(g.BrushType.SOLID_COLOR, isDarkFill ? [0.06, 0.07, 0.09, 1.0] : [1.0, 1.0, 1.0, 1.0]);
                    g.fillPath(cFill);
                    var cStroke = g.newPen(g.PenType.SOLID_COLOR, isDarkFill ? [1.0, 1.0, 1.0, 1.0] : [0.08, 0.09, 0.12, 1.0], 1.4);
                    g.strokePath(cStroke);
                }

                // 5. Top HUD Badges (Preset Summary + Zoom Mode Badge)
                var hudBg = g.newBrush(g.BrushType.SOLID_COLOR, [0.04, 0.05, 0.07, 0.65]);
                var hudPen = g.newPen(g.PenType.SOLID_COLOR, [0.92, 0.94, 0.98, 1.0], 1);
                var zPen = g.newPen(g.PenType.SOLID_COLOR, [0.42, 0.72, 1.0, 1.0], 1);

                var leftLabel = (CURSOR_MANIFEST[currentCursorKey] ? CURSOR_MANIFEST[currentCursorKey].id.toUpperCase() : "TAHOE") + "  |  Click to preview";
                drawRoundedRectPath(g, 6, 6, Math.min(152, Math.round(w * 0.56)), 16, 4);
                g.fillPath(hudBg);
                g.drawString(leftLabel, hudPen, 11, 8, hudFont);

                var zBadgeStr = (currentZoomMode === "static")
                    ? "1.00x Static"
                    : (currentZoomScale.toFixed(2) + "x " + (currentZoomMode === "continuous" ? "Follow" : "Auto"));
                var zBoxW = 82;
                drawRoundedRectPath(g, w - zBoxW - 6, 6, zBoxW, 16, 4);
                g.fillPath(hudBg);
                g.drawString(zBadgeStr, zPen, w - zBoxW - 1, 8, hudFont);

                // Outer frame border
                var stageBorder = g.newPen(g.PenType.SOLID_COLOR, [1.0, 1.0, 1.0, 0.14], 1);
                g.rectPath(0, 0, w - 1, h - 1);
                g.strokePath(stageBorder);
            } catch (eStage) {}
        };

        previewStage.addEventListener("mousedown", function (e) {
            var w = (previewStage.size && previewStage.size[0] > 10) ? previewStage.size[0] : 300;
            var h = (previewStage.size && previewStage.size[1] > 10) ? previewStage.size[1] : 132;
            stageClickPos.nx = Math.max(0.12, Math.min(0.88, e.clientX / w));
            stageClickPos.ny = Math.max(0.22, Math.min(0.85, e.clientY / h));
            stageClickPos.hasRipple = true;
            redrawPreview();
        });

        // ---------------------------------------------------------------------
        // 3. 3-TAB SEGMENTED NAVIGATION BAR (Setup | Cursor | Frame)
        // Custom-drawn Cobalt-accented tab pills so active tab is unmistakably clear
        // ---------------------------------------------------------------------
        var tabBar = win.add("group");
        tabBar.orientation = "row";
        tabBar.alignment = ["fill", "top"];
        tabBar.spacing = 4;
        tabBar.margins = [0, 2, 0, 2];

        var tabButtons = {};
        function createTabPill(id, label) {
            var pill = tabBar.add("group");
            pill.alignment = ["fill", "center"];
            pill.preferredSize = [80, 26];
            pill.minimumSize = [56, 26];
            pill._tabId = id;
            pill._label = label;
            pill.onDraw = function () {
                try {
                    var g = this.graphics;
                    var w = (this.size && this.size[0] > 10) ? this.size[0] : 84;
                    var h = (this.size && this.size[1] > 10) ? this.size[1] : 26;
                    var isAct = (activeTab === this._tabId);
                    var fillCol = isAct ? [0.145, 0.388, 0.922, 1.0] : [0.155, 0.165, 0.195, 1.0];
                    var borderCol = isAct ? [0.35, 0.58, 1.0, 1.0] : [1.0, 1.0, 1.0, 0.12];
                    var txtCol = isAct ? [1.0, 1.0, 1.0, 1.0] : [0.72, 0.75, 0.82, 1.0];

                    drawRoundedRectPath(g, 0, 0, w - 1, h - 1, 5);
                    g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, fillCol));
                    drawRoundedRectPath(g, 0, 0, w - 1, h - 1, 5);
                    g.strokePath(g.newPen(g.PenType.SOLID_COLOR, borderCol, 1));

                    var tFont = ScriptUI.newFont("Verdana", isAct ? "Bold" : "Regular", 10);
                    var m = g.measureString(this._label, tFont);
                    var tx = Math.max(4, Math.round((w - m[0]) / 2));
                    var ty = Math.max(4, Math.round((h - m[1]) / 2));
                    g.drawString(this._label, g.newPen(g.PenType.SOLID_COLOR, txtCol, 1), tx, ty, tFont);
                } catch (ePill) {}
            };
            pill.addEventListener("mousedown", function () {
                selectTab(id);
            });
            tabButtons[id] = pill;
            return pill;
        }

        createTabPill("setup", "Setup");
        createTabPill("cursor", "Cursor");
        createTabPill("frame", "Frame");

        // ---------------------------------------------------------------------
        // 4. SCROLLABLE STACKED TAB BODY (Fills middle space; NEVER pushes footer off!)
        // CRITICAL FIX: tabContainer.orientation = "stack" eliminates blank space!
        // ---------------------------------------------------------------------
        var bodyHost = win.add("group");
        bodyHost.orientation = "row";
        bodyHost.alignment = ["fill", "fill"];
        bodyHost.alignChildren = ["fill", "fill"];
        bodyHost.spacing = 4;
        bodyHost.margins = 0;

        var scrollViewport = bodyHost.add("group");
        scrollViewport.orientation = "stack";
        scrollViewport.alignment = ["fill", "fill"];
        scrollViewport.alignChildren = ["fill", "top"];
        scrollViewport.margins = 0;

        var tabContainer = scrollViewport.add("group");
        tabContainer.orientation = "stack"; // <-- FIX: All 3 tabs share exact top origin!
        tabContainer.alignment = ["fill", "top"];
        tabContainer.alignChildren = ["fill", "top"];
        tabContainer.spacing = 0;
        tabContainer.margins = 0;

        var vScrollBar = bodyHost.add("scrollbar", undefined, 0, 0, 100);
        vScrollBar.alignment = ["right", "fill"];
        vScrollBar.preferredSize.width = 14;
        vScrollBar.visible = false;

        // =====================================================================
        // TAB 1: SETUP PANEL
        // =====================================================================
        var tabSetup = tabContainer.add("group");
        tabSetup.orientation = "column";
        tabSetup.alignment = ["fill", "top"];
        tabSetup.alignChildren = ["fill", "top"];
        tabSetup.spacing = 7;
        tabSetup.margins = [0, 4, 0, 4];

        // Capture Source Card
        var srcCard = tabSetup.add("panel", undefined, undefined, { borderStyle: "gray" });
        srcCard.orientation = "column";
        srcCard.alignChildren = ["fill", "top"];
        srcCard.spacing = 5;
        srcCard.margins = 8;

        var srcTitle = srcCard.add("statictext", undefined, "Capture Source");
        try { srcTitle.graphics.font = ScriptUI.newFont("Verdana", "Bold", 10); } catch (e) {}
        try { srcTitle.graphics.foregroundColor = srcTitle.graphics.newPen(srcTitle.graphics.PenType.SOLID_COLOR, [0.78, 0.82, 0.90, 1], 1); } catch (e) {}

        var vidRow = srcCard.add("group");
        vidRow.orientation = "row";
        vidRow.alignChildren = ["fill", "center"];
        vidRow.spacing = 6;

        var videoPathInput = vidRow.add("edittext", undefined, "");
        videoPathInput.alignment = ["fill", "center"];
        videoPathInput.preferredSize.height = 24;

        var btnBrowseVid = vidRow.add("button", undefined, "Browse...");
        btnBrowseVid.preferredSize = [68, 24];

        var syncBadgeRow = srcCard.add("group");
        syncBadgeRow.orientation = "row";
        syncBadgeRow.alignChildren = ["left", "center"];
        syncBadgeRow.spacing = 5;

        var syncText = syncBadgeRow.add("statictext", undefined, "Auto-pairs companion .cursor.json");
        syncText.alignment = ["fill", "center"];
        try { syncText.graphics.font = ScriptUI.newFont("Verdana", "Regular", 9); } catch (e) {}
        try { syncText.graphics.foregroundColor = syncText.graphics.newPen(syncText.graphics.PenType.SOLID_COLOR, [0.35, 0.85, 0.58, 1], 1); } catch (e) {}

        var btnRelinkJson = syncBadgeRow.add("button", undefined, "Relink");
        btnRelinkJson.preferredSize = [52, 20];

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
                var found = false;
                for (var ci = 0; ci < candidates.length; ci++) {
                    if (candidates[ci].exists) {
                        selectedJsonFile = candidates[ci];
                        syncText.text = "Paired: " + candidates[ci].name;
                        found = true;
                        break;
                    }
                }
                if (!found) {
                    selectedJsonFile = null;
                    syncText.text = "No .cursor.json found — click Relink";
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

        // Camera Zoom Mode
        var zoomModeCard = tabSetup.add("group");
        zoomModeCard.orientation = "column";
        zoomModeCard.alignChildren = ["fill", "top"];
        zoomModeCard.spacing = 3;

        var zTitle = zoomModeCard.add("statictext", undefined, "Camera Zoom Mode");
        try { zTitle.graphics.font = ScriptUI.newFont("Verdana", "Bold", 10); } catch (e) {}

        var zoomRadioRow = zoomModeCard.add("group");
        zoomRadioRow.orientation = "row";
        zoomRadioRow.spacing = 8;

        var radAutoZoom = zoomRadioRow.add("radiobutton", undefined, "Auto Zoom");
        var radFollow = zoomRadioRow.add("radiobutton", undefined, "Follow");
        var radStatic = zoomRadioRow.add("radiobutton", undefined, "Static");
        radAutoZoom.value = (currentZoomMode === "auto-cluster");
        radFollow.value = (currentZoomMode === "continuous");
        radStatic.value = (currentZoomMode === "static");

        // Zoom Depth Slider
        var zDepthRow = tabSetup.add("group");
        zDepthRow.orientation = "row";
        zDepthRow.alignChildren = ["fill", "center"];
        zDepthRow.spacing = 6;

        var zDepthLbl = zDepthRow.add("statictext", undefined, "Zoom Depth:");
        zDepthLbl.preferredSize.width = 76;

        var zDepthSlider = zDepthRow.add("slider", undefined, Math.round(currentZoomScale * 100), 120, 320);
        zDepthSlider.alignment = ["fill", "center"];
        zDepthSlider.enabled = (currentZoomMode !== "static");

        var zDepthValTxt = zDepthRow.add("statictext", undefined, currentZoomScale.toFixed(2) + "x");
        zDepthValTxt.preferredSize.width = 44;

        function onZoomModeChanged() {
            if (radFollow.value) currentZoomMode = "continuous";
            else if (radStatic.value) currentZoomMode = "static";
            else currentZoomMode = "auto-cluster";
            zDepthSlider.enabled = (currentZoomMode !== "static");
            savePref("selectedZoomMode", currentZoomMode);
            redrawPreview();
        }
        radAutoZoom.onClick = onZoomModeChanged;
        radFollow.onClick = onZoomModeChanged;
        radStatic.onClick = onZoomModeChanged;

        zDepthSlider.onChanging = function () {
            currentZoomScale = zDepthSlider.value / 100.0;
            zDepthValTxt.text = currentZoomScale.toFixed(2) + "x";
            savePref("selectedZoomScale", currentZoomScale.toFixed(2));
            redrawPreview();
        };

        // Motion Feel
        var feelGrp = tabSetup.add("group");
        feelGrp.orientation = "column";
        feelGrp.alignChildren = ["fill", "top"];
        feelGrp.spacing = 3;

        var feelTitle = feelGrp.add("statictext", undefined, "Motion Feel");
        try { feelTitle.graphics.font = ScriptUI.newFont("Verdana", "Bold", 10); } catch (e) {}

        var feelRadioRow = feelGrp.add("group");
        feelRadioRow.orientation = "row";
        feelRadioRow.spacing = 6;

        var radNatural = feelRadioRow.add("radiobutton", undefined, "Natural");
        var radSnappy = feelRadioRow.add("radiobutton", undefined, "Snappy");
        var radSilky = feelRadioRow.add("radiobutton", undefined, "Silky");
        var radRaw = feelRadioRow.add("radiobutton", undefined, "Raw");
        radNatural.value = (currentMotionFeel === "natural");
        radSnappy.value = (currentMotionFeel === "snappy");
        radSilky.value = (currentMotionFeel === "silky");
        radRaw.value = (currentMotionFeel === "raw");

        // Fine-Tune Physics Accordion (Properly Collapses Height!)
        var accExpanded = false;
        var accBtn = tabSetup.add("button", undefined, "Fine-Tune Physics & Sync  [+]");
        accBtn.alignment = ["fill", "center"];
        accBtn.preferredSize.height = 24;

        var accBody = tabSetup.add("group");
        accBody.orientation = "column";
        accBody.alignChildren = ["fill", "top"];
        accBody.spacing = 4;
        accBody.margins = [6, 2, 6, 4];
        accBody.visible = false;
        accBody.maximumSize.height = 0;

        var chkAutoStates = accBody.add("checkbox", undefined, "Auto Cursor States (I-beam, pointer, hand)");
        chkAutoStates.value = true;
        var chkVelocitySway = accBody.add("checkbox", undefined, "Velocity Tilt Sway (Dynamic angle)");
        chkVelocitySway.value = true;
        var chkClickBounce = accBody.add("checkbox", undefined, "Click Bounce (84% press compression)");
        chkClickBounce.value = true;
        var chkMotionBlur = accBody.add("checkbox", undefined, "Motion Blur (AE composition shutter)");
        chkMotionBlur.value = true;
        var chkTypingSpeedup = accBody.add("checkbox", undefined, "Typing Speed-Up (2.0x playback & zoom)");
        chkTypingSpeedup.value = true;

        var syncOffRow = accBody.add("group");
        syncOffRow.orientation = "row";
        syncOffRow.alignChildren = ["fill", "center"];
        syncOffRow.spacing = 6;
        var syncOffLbl = syncOffRow.add("statictext", undefined, "Sync Offset:");
        syncOffLbl.preferredSize.width = 72;
        var syncOffSlider = syncOffRow.add("slider", undefined, currentSyncOffsetMs, -1000, 1000);
        syncOffSlider.alignment = ["fill", "center"];
        var syncOffVal = syncOffRow.add("statictext", undefined, currentSyncOffsetMs + "ms");
        syncOffVal.preferredSize.width = 48;
        syncOffSlider.onChanging = function () {
            currentSyncOffsetMs = Math.round(syncOffSlider.value / 10) * 10;
            syncOffVal.text = currentSyncOffsetMs + "ms";
            savePref("selectedSyncOffsetMs", currentSyncOffsetMs.toString());
        };

        accBtn.onClick = function () {
            accExpanded = !accExpanded;
            accBody.visible = accExpanded;
            accBody.maximumSize.height = accExpanded ? 1000 : 0;
            accBtn.text = accExpanded ? "Fine-Tune Physics & Sync  [-]" : "Fine-Tune Physics & Sync  [+]";
            updateScrollLayout();
        };

        // =====================================================================
        // TAB 2: CURSOR PANEL
        // =====================================================================
        var tabCursor = tabContainer.add("group");
        tabCursor.orientation = "column";
        tabCursor.alignment = ["fill", "top"];
        tabCursor.alignChildren = ["fill", "top"];
        tabCursor.spacing = 8;
        tabCursor.margins = [0, 4, 0, 4];
        tabCursor.visible = false;

        var cStyleLbl = tabCursor.add("statictext", undefined, "Cursor Pack (10 Multi-States)");
        try { cStyleLbl.graphics.font = ScriptUI.newFont("Verdana", "Bold", 10); } catch (e) {}

        var cursorItems = ["macOS Tahoe (Default)", "macOS Classic (Retina)", "Windows 11 (Fluent)", "Figma Minimal (Sharp)"];
        var cursorKeys = ["tahoe", "macos", "windows11", "custom"];
        var cursorDropdown = tabCursor.add("dropdownlist", undefined, cursorItems);
        var initCursorIdx = 0;
        for (var ciIdx = 0; ciIdx < cursorKeys.length; ciIdx++) {
            if (cursorKeys[ciIdx] === currentCursorKey) { initCursorIdx = ciIdx; break; }
        }
        cursorDropdown.selection = initCursorIdx;

        cursorDropdown.onChange = function () {
            var sel = cursorDropdown.selection ? cursorDropdown.selection.index : 0;
            currentCursorKey = cursorKeys[sel];
            savePref("selectedCursorKey", currentCursorKey);
            refreshPreviewAssets();
            redrawPreview();
        };

        // Cursor Size Slider
        var cSizeRow = tabCursor.add("group");
        cSizeRow.orientation = "row";
        cSizeRow.alignChildren = ["fill", "center"];
        cSizeRow.spacing = 6;

        var cSizeLbl = cSizeRow.add("statictext", undefined, "Cursor Size:");
        cSizeLbl.preferredSize.width = 76;

        var cSizeSlider = cSizeRow.add("slider", undefined, currentCursorSize, 50, 200);
        cSizeSlider.alignment = ["fill", "center"];

        var cSizeValTxt = cSizeRow.add("statictext", undefined, currentCursorSize + "%");
        cSizeValTxt.preferredSize.width = 44;

        cSizeSlider.onChanging = function () {
            currentCursorSize = Math.round(cSizeSlider.value);
            cSizeValTxt.text = currentCursorSize + "%";
            savePref("selectedCursorSize", currentCursorSize.toString());
            redrawPreview();
        };

        // Click Ripple Color Swatches
        var ripHeaderRow = tabCursor.add("group");
        ripHeaderRow.orientation = "row";
        ripHeaderRow.alignChildren = ["left", "center"];
        var ripLbl = ripHeaderRow.add("statictext", undefined, "Click Ripple Color");
        try { ripLbl.graphics.font = ScriptUI.newFont("Verdana", "Bold", 10); } catch (e) {}
        var ripValLbl = ripHeaderRow.add("statictext", undefined, currentRippleColor === "none" ? "Off" : currentRippleColor);
        ripValLbl.alignment = ["right", "center"];
        try { ripValLbl.graphics.foregroundColor = ripValLbl.graphics.newPen(ripValLbl.graphics.PenType.SOLID_COLOR, [0.42, 0.72, 1.0, 1.0], 1); } catch (e) {}

        var ripSwatchRow = tabCursor.add("group");
        ripSwatchRow.orientation = "row";
        ripSwatchRow.alignment = ["fill", "top"];
        ripSwatchRow.spacing = 4;

        var btnRipCobalt = ripSwatchRow.add("button", undefined, "Cobalt");
        var btnRipWhite = ripSwatchRow.add("button", undefined, "White");
        var btnRipEmerald = ripSwatchRow.add("button", undefined, "Emerald");
        var btnRipAmber = ripSwatchRow.add("button", undefined, "Amber");
        var btnRipOff = ripSwatchRow.add("button", undefined, "Off");
        btnRipCobalt.alignment = ["fill", "center"];
        btnRipWhite.alignment = ["fill", "center"];
        btnRipEmerald.alignment = ["fill", "center"];
        btnRipAmber.alignment = ["fill", "center"];
        btnRipOff.alignment = ["fill", "center"];

        function setRippleColor(hex) {
            currentRippleColor = hex;
            ripValLbl.text = (hex === "none") ? "Off" : hex;
            stageClickPos.hasRipple = (hex !== "none");
            savePref("selectedRippleColor", currentRippleColor);
            redrawPreview();
        }
        btnRipCobalt.onClick = function () { setRippleColor("#2563EB"); };
        btnRipWhite.onClick = function () { setRippleColor("#FFFFFF"); };
        btnRipEmerald.onClick = function () { setRippleColor("#10B981"); };
        btnRipAmber.onClick = function () { setRippleColor("#F59E0B"); };
        btnRipOff.onClick = function () { setRippleColor("none"); };

        // =====================================================================
        // TAB 3: FRAME PANEL
        // =====================================================================
        var tabFrame = tabContainer.add("group");
        tabFrame.orientation = "column";
        tabFrame.alignment = ["fill", "top"];
        tabFrame.alignChildren = ["fill", "top"];
        tabFrame.spacing = 8;
        tabFrame.margins = [0, 4, 0, 4];
        tabFrame.visible = false;

        var bgSelectLbl = tabFrame.add("statictext", undefined, "Backdrop Wallpaper");
        try { bgSelectLbl.graphics.font = ScriptUI.newFont("Verdana", "Bold", 10); } catch (e) {}

        var tileRow1 = tabFrame.add("group");
        tileRow1.orientation = "row";
        tileRow1.alignment = ["fill", "top"];
        tileRow1.spacing = 4;

        var btnBgTahoe = tileRow1.add("button", undefined, "Tahoe Light");
        var btnBgMidnight = tileRow1.add("button", undefined, "Midnight");
        var btnBgAzure = tileRow1.add("button", undefined, "Azure");
        btnBgTahoe.alignment = ["fill", "center"];
        btnBgMidnight.alignment = ["fill", "center"];
        btnBgAzure.alignment = ["fill", "center"];

        var tileRow2 = tabFrame.add("group");
        tileRow2.orientation = "row";
        tileRow2.alignment = ["fill", "top"];
        tileRow2.spacing = 4;

        var btnBgCherry = tileRow2.add("button", undefined, "Cherry Pop");
        var btnBgStudio = tileRow2.add("button", undefined, "Dark Studio");
        var btnBgNone = tileRow2.add("button", undefined, "None");
        btnBgCherry.alignment = ["fill", "center"];
        btnBgStudio.alignment = ["fill", "center"];
        btnBgNone.alignment = ["fill", "center"];

        // Full Wallpapers Dropdown (Exact match to user's assets/wallpapers/)
        var bgItemsList = [];
        var bgKeysList = [];
        var initBgIdx = 0;
        for (var wp = 0; wp < RECORDLY_WALLPAPERS.length; wp++) {
            bgItemsList.push(RECORDLY_WALLPAPERS[wp].label);
            bgKeysList.push(RECORDLY_WALLPAPERS[wp].filename);
            if (RECORDLY_WALLPAPERS[wp].filename === currentBgKey) {
                initBgIdx = wp;
            }
        }
        var bgDropdown = tabFrame.add("dropdownlist", undefined, bgItemsList);
        bgDropdown.selection = initBgIdx;

        function setBackdropKey(key) {
            currentBgKey = key;
            for (var bi = 0; bi < bgKeysList.length; bi++) {
                if (bgKeysList[bi] === key) {
                    bgDropdown.selection = bi;
                    break;
                }
            }
            savePref("selectedBgKey", currentBgKey);
            redrawPreview();
        }

        btnBgTahoe.onClick = function () { setBackdropKey("tahoe-light.jpg"); };
        btnBgMidnight.onClick = function () { setBackdropKey("midnight-8.jpg"); };
        btnBgAzure.onClick = function () { setBackdropKey("sequoia-blue.jpg"); };
        btnBgCherry.onClick = function () { setBackdropKey("cherrypop.jpg"); };
        btnBgStudio.onClick = function () { setBackdropKey("dark-studio"); };
        btnBgNone.onClick = function () { setBackdropKey("none"); };

        bgDropdown.onChange = function () {
            if (bgDropdown.selection) {
                currentBgKey = bgKeysList[bgDropdown.selection.index];
                savePref("selectedBgKey", currentBgKey);
                redrawPreview();
            }
        };

        // Corner Radius Slider
        var radRow = tabFrame.add("group");
        radRow.orientation = "row";
        radRow.alignChildren = ["fill", "center"];
        radRow.spacing = 6;

        var radLbl = radRow.add("statictext", undefined, "Corner Radius:");
        radLbl.preferredSize.width = 86;

        var radSlider = radRow.add("slider", undefined, currentCornerRadius, 0, 48);
        radSlider.alignment = ["fill", "center"];

        var radValTxt = radRow.add("statictext", undefined, currentCornerRadius + "px");
        radValTxt.preferredSize.width = 40;

        radSlider.onChanging = function () {
            currentCornerRadius = Math.round(radSlider.value);
            radValTxt.text = currentCornerRadius + "px";
            savePref("selectedCornerRadius", currentCornerRadius.toString());
            redrawPreview();
        };

        // Window Margin Slider
        var marginRow = tabFrame.add("group");
        marginRow.orientation = "row";
        marginRow.alignChildren = ["fill", "center"];
        marginRow.spacing = 6;

        var marginLbl = marginRow.add("statictext", undefined, "Window Margin:");
        marginLbl.preferredSize.width = 86;

        var marginSlider = marginRow.add("slider", undefined, currentMargin, 0, 25);
        marginSlider.alignment = ["fill", "center"];

        var marginValTxt = marginRow.add("statictext", undefined, currentMargin + "%");
        marginValTxt.preferredSize.width = 40;

        marginSlider.onChanging = function () {
            currentMargin = Math.round(marginSlider.value);
            marginValTxt.text = currentMargin + "%";
            savePref("selectedMargin", currentMargin.toString());
            redrawPreview();
        };

        // Shadow Intensity Slider
        var shRow = tabFrame.add("group");
        shRow.orientation = "row";
        shRow.alignChildren = ["fill", "center"];
        shRow.spacing = 6;

        var shLbl = shRow.add("statictext", undefined, "Drop Shadow:");
        shLbl.preferredSize.width = 86;

        var shSlider = shRow.add("slider", undefined, currentShadow, 0, 100);
        shSlider.alignment = ["fill", "center"];

        var shValTxt = shRow.add("statictext", undefined, currentShadow + "%");
        shValTxt.preferredSize.width = 40;

        shSlider.onChanging = function () {
            currentShadow = Math.round(shSlider.value);
            shValTxt.text = currentShadow + "%";
            savePref("selectedShadow", currentShadow.toString());
            redrawPreview();
        };

        // =====================================================================
        // 5. STICKY BOTTOM ACTION BAR (ALWAYS FLOATS AT BOTTOM AT EVERY HEIGHT!)
        // =====================================================================
        var bottomBar = win.add("group");
        bottomBar.orientation = "row";
        bottomBar.alignment = ["fill", "bottom"];
        bottomBar.alignChildren = ["fill", "center"];
        bottomBar.spacing = 6;
        bottomBar.margins = [0, 6, 0, 0];

        var btnBuild = bottomBar.add("button", undefined, "Build TraceMotion Rig");
        btnBuild.alignment = ["fill", "center"];
        btnBuild.preferredSize.height = 34;

        var btnUpdateRig = bottomBar.add("button", undefined, "Update");
        btnUpdateRig.preferredSize = [62, 34];
        btnUpdateRig.helpTip = "Update sliders on the currently active TraceMotion composition";

        var btnReset = bottomBar.add("button", undefined, "Reset");
        btnReset.preferredSize = [54, 34];
        btnReset.helpTip = "Reset all parameters to Recordly defaults";

        // =====================================================================
        // TAB SWITCHING & SCROLLABLE VIEWPORT LAYOUT ENGINE
        // =====================================================================
        function getActiveTabGroup() {
            if (activeTab === "cursor") return tabCursor;
            if (activeTab === "frame") return tabFrame;
            return tabSetup;
        }

        function updateScrollLayout() {
            try {
                win.layout.layout(true);
                win.layout.resize();

                var activeGrp = getActiveTabGroup();
                var vpH = scrollViewport.size ? scrollViewport.size[1] : 220;
                var contentH = activeGrp.preferredSize ? activeGrp.preferredSize[1] : 220;

                if (contentH > vpH + 4 && vpH > 40) {
                    vScrollBar.visible = true;
                    vScrollBar.minvalue = 0;
                    vScrollBar.maxvalue = Math.max(1, contentH - vpH + 12);
                    vScrollBar.value = Math.min(vScrollBar.value, vScrollBar.maxvalue);
                    tabContainer.location = [0, -Math.round(vScrollBar.value)];
                } else {
                    vScrollBar.visible = false;
                    vScrollBar.value = 0;
                    tabContainer.location = [0, 0];
                }
            } catch (eSc) {}
        }

        vScrollBar.onChanging = function () {
            try {
                tabContainer.location = [0, -Math.round(vScrollBar.value)];
            } catch (eScr) {}
        };

        function selectTab(tabName) {
            activeTab = tabName;
            tabSetup.visible = (tabName === "setup");
            tabCursor.visible = (tabName === "cursor");
            tabFrame.visible = (tabName === "frame");
            vScrollBar.value = 0;
            tabContainer.location = [0, 0];

            for (var tk in tabButtons) {
                if (tabButtons.hasOwnProperty(tk)) {
                    try { tabButtons[tk].notify("onDraw"); } catch (eTb) {}
                }
            }
            updateScrollLayout();
            redrawPreview();
        }

        // Gather current options helper
        function gatherOptions() {
            var feelChoice = "natural";
            if (radSnappy.value) feelChoice = "snappy";
            else if (radSilky.value) feelChoice = "silky";
            else if (radRaw.value) feelChoice = "raw";

            var zModeChoice = "auto-cluster";
            if (radFollow.value) zModeChoice = "continuous";
            else if (radStatic.value) zModeChoice = "static";

            return {
                zoomMode: zModeChoice,
                zoomDepthScale: currentZoomScale,
                motionFeel: feelChoice,
                enableAutoStates: chkAutoStates.value,
                enableVelocitySway: chkVelocitySway.value,
                enableClickBounce: chkClickBounce.value,
                enableMotionBlur: chkMotionBlur.value,
                enableTypingSpeedup: chkTypingSpeedup.value,
                swayAmount: chkVelocitySway.value ? 0.4 : 0.0,
                syncOffsetMs: currentSyncOffsetMs,
                cursorStyle: currentCursorKey,
                cursorScale: currentCursorSize,
                clickEffect: currentRippleColor,
                wallpaper: currentBgKey,
                cornerRadius: currentCornerRadius,
                canvasMargin: currentMargin,
                shadowIntensity: currentShadow,
                silent: false
            };
        }

        btnBuild.onClick = function () {
            if (!selectedVideoFile || !selectedVideoFile.exists) {
                if (videoPathInput.text && videoPathInput.text.length > 0) {
                    var typedF = new File(videoPathInput.text);
                    if (typedF.exists) selectedVideoFile = typedF;
                }
            }
            if (!selectedVideoFile || !selectedVideoFile.exists) {
                alert("Please select a valid screen recording video file first.", "Input Error");
                selectTab("setup");
                return;
            }

            if (!selectedJsonFile || !selectedJsonFile.exists) {
                var baseF = selectedVideoFile.fsName.replace(/\.[^\.]+$/, "");
                var cands = [
                    new File(selectedVideoFile.fsName + ".cursor.json"),
                    new File(baseF + ".cursor.json"),
                    new File(baseF + ".tracemotion.json"),
                    new File(selectedVideoFile.fsName + ".json")
                ];
                for (var ci2 = 0; ci2 < cands.length; ci2++) {
                    if (cands[ci2].exists) {
                        selectedJsonFile = cands[ci2];
                        break;
                    }
                }
                if (!selectedJsonFile || !selectedJsonFile.exists) {
                    alert("Companion mouse telemetry JSON file not found. Please click Relink to select your .cursor.json file.", "Input Error");
                    selectTab("setup");
                    return;
                }
            }

            try {
                var builtComp = buildTraceMotionRig(selectedVideoFile, selectedJsonFile, gatherOptions());
                if (builtComp) {
                    statusTxt.text = "Rig Active";
                }
            } catch (err) {}
        };

        btnUpdateRig.onClick = function () {
            var compNow = getActiveComp();
            if (!compNow || !compNow.layer("TraceMotion_Camera_Controller")) {
                alert("Open a TraceMotion composition first to update its sliders in-place.", "No Active Rig");
                return;
            }
            if (updateActiveTraceMotionRig(compNow, gatherOptions())) {
                statusTxt.text = "Rig Updated";
            }
        };

        btnReset.onClick = function () {
            currentZoomMode = "auto-cluster";
            radAutoZoom.value = true; radFollow.value = false; radStatic.value = false;
            currentZoomScale = 1.80;
            zDepthSlider.value = 180; zDepthSlider.enabled = true; zDepthValTxt.text = "1.80x";

            currentMotionFeel = "natural";
            radNatural.value = true; radSnappy.value = false; radSilky.value = false; radRaw.value = false;

            chkAutoStates.value = true;
            chkVelocitySway.value = true;
            chkClickBounce.value = true;
            chkMotionBlur.value = true;
            chkTypingSpeedup.value = true;
            currentSyncOffsetMs = 0;
            syncOffSlider.value = 0; syncOffVal.text = "0ms";

            currentCursorKey = "tahoe";
            cursorDropdown.selection = 0;
            currentCursorSize = 100;
            cSizeSlider.value = 100; cSizeValTxt.text = "100%";
            setRippleColor("#2563EB");

            setBackdropKey("tahoe-light.jpg");
            currentCornerRadius = 20; radSlider.value = 20; radValTxt.text = "20px";
            currentMargin = 12; marginSlider.value = 12; marginValTxt.text = "12%";
            currentShadow = 65; shSlider.value = 65; shValTxt.text = "65%";

            refreshPreviewAssets();
            redrawPreview();
        };

        // Window Resize Handler (Keeps preview crisp, active tab at top, and footer pinned to bottom)
        win.onResizing = win.onResize = function () {
            updateScrollLayout();
            redrawPreview();
        };

        if (win instanceof Window) {
            win.center();
            win.show();
            updateScrollLayout();
            redrawPreview();
        } else {
            win.layout.layout(true);
            updateScrollLayout();
            redrawPreview();
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
    TM.updateRig = updateActiveTraceMotionRig;
    TM.buildUI = buildUI;
    TM.detectTelemetryInteractions = detectTelemetryInteractions;
    TM.buildRecordlyZoomClusters = buildRecordlyZoomClusters;

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