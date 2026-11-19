/**
 * TraceMotion Importer & Rig Generator for Adobe After Effects
 *
 * Ingests screen recordings and synchronized mouse telemetry (.cursor.json)
 * captured via OBS Studio or Recordly. Restores 100% of the original damped
 * harmonic oscillator spring smoothing, dynamic cursor velocity tilt/rotation,
 * click bounce, and auto-zoom physics, combined with crash-free AE reference
 * handling, additive typing auto-zoom + camera follow + 2x speed-up, scroll
 * auto-zoom + 2x speed-up with guaranteed zoom-out recovery, frame-accurate
 * time-remap sync, independent On/Off toggles, and a fully responsive ScriptUI
 * panel with live interactive preview.
 *
 * Compatible with Adobe After Effects CC 2020 through CC 2026+ (Strict ES3 ExtendScript)
 */

(function (thisObj) {
    "use strict";

    // =========================================================================
    // ExtendScript Polyfills & Helper Utilities (Strict ES3)
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

    function safeIsValid(obj) {
        if (!obj) return false;
        try {
            if (typeof isValid === "function") {
                return isValid(obj);
            }
        } catch (e) {}
        return true;
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

    var PREF_SECTION = "TraceMotion_Preferences_v7";
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
    function getBoolPref(key, defaultBool) {
        var raw = getPref(key, defaultBool ? "true" : "false");
        return String(raw) !== "false";
    }

    var SafeProp = {
        find: function (parent, matchNames, fallbackIndex) {
            if (!safeIsValid(parent)) return null;
            if (typeof matchNames === "string") matchNames = [matchNames];
            for (var i = 0; i < matchNames.length; i++) {
                try {
                    var p = parent.property(matchNames[i]);
                    if (safeIsValid(p)) return p;
                } catch (e) {}
            }
            if (fallbackIndex !== undefined) {
                try {
                    var pIdx = parent.property(fallbackIndex);
                    if (safeIsValid(pIdx)) return pIdx;
                } catch (e) {}
            }
            return null;
        },
        findFresh: function (root, pathNames) {
            if (!safeIsValid(root)) return null;
            var curr = root;
            for (var i = 0; i < pathNames.length; i++) {
                try {
                    curr = curr.property(pathNames[i]);
                    if (!safeIsValid(curr)) return null;
                } catch (e) {
                    return null;
                }
            }
            return curr;
        },
        setExpression: function (prop, expr) {
            if (!safeIsValid(prop)) return false;
            try {
                prop.expression = expr;
                return true;
            } catch (e) {
                return false;
            }
        },
        setValue: function (prop, val) {
            if (!safeIsValid(prop)) return;
            try { prop.setValue(val); } catch (e) {}
        },
        setValueAtTime: function (prop, time, val) {
            if (!safeIsValid(prop)) return;
            try { prop.setValueAtTime(time, val); } catch (e) {}
        },
        getNumKeys: function (prop) {
            if (!safeIsValid(prop)) return 0;
            try { return prop.numKeys || 0; } catch (e) { return 0; }
        },
        setTemporalEase: function (prop, keyIdx, inEase, outEase) {
            if (!safeIsValid(prop)) return;
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
            label: "macOS Tahoe (Default)",
            folder: "tahoe",
            sizeMultiplier: 1.0,
            cursors: {
                arrow: { filePng: "pointer-1__34-24.png", fileSvg: "pointer-1__34-24.svg", altPng: "pointer-1__14-6.png", anchorX: 0.34, anchorY: 0.24, altAnchorX: 0.14, altAnchorY: 0.06 },
                pointer: { filePng: "pointinghand-1__39-26.png", fileSvg: "pointinghand-1__39-26.svg", altPng: "pointinghand-1__40-10.png", anchorX: 0.39, anchorY: 0.26, altAnchorX: 0.40, altAnchorY: 0.10 },
                text: { filePng: "ibeam-1__50-50.png", fileSvg: "ibeam-1__50-50.svg", altPng: "ibeam-1__50-44.png", anchorX: 0.50, anchorY: 0.50, altAnchorX: 0.50, altAnchorY: 0.44 },
                crosshair: { filePng: "crosshair-1__50-50.png", fileSvg: "crosshair-1__50-50.svg", anchorX: 0.50, anchorY: 0.50 },
                "open-hand": { filePng: "openhand-1__50-50.png", fileSvg: "openhand-1__50-50.svg", altPng: "openhand-1__55-57.png", anchorX: 0.50, anchorY: 0.50, altAnchorX: 0.55, altAnchorY: 0.57 },
                "closed-hand": { filePng: "closedhand-1__50-50.png", fileSvg: "closedhand-1__50-50.svg", altPng: "closedhand-1__50-46.png", anchorX: 0.50, anchorY: 0.50, altAnchorX: 0.50, altAnchorY: 0.46 },
                "resize-ew": { filePng: "resizeeastwest-1__50-50.png", fileSvg: "resizeeastwest-1__50-50.svg", anchorX: 0.50, anchorY: 0.50 },
                "resize-ns": { filePng: "resizenorthsouth-1__50-50.png", fileSvg: "resizenorthsouth-1__50-50.svg", altPng: "resizenorthsouth-1__50-49.png", anchorX: 0.50, anchorY: 0.50, altAnchorX: 0.50, altAnchorY: 0.49 },
                "not-allowed": { filePng: "notallowed-1__23-0.png", fileSvg: "notallowed-1__23-0.svg", anchorX: 0.23, anchorY: 0.00 },
                wait: { filePng: "busybutclickable-1__23-0.png", fileSvg: "busybutclickable-1__23-0.svg", anchorX: 0.23, anchorY: 0.00 }
            }
        },
        macos: {
            id: "macos",
            label: "macOS Classic",
            folder: "macos",
            sizeMultiplier: 1.714,
            cursors: {
                arrow: { filePng: "pointer-1__34-24.png", fileSvg: "pointer-1__34-24.svg", anchorX: 0.34, anchorY: 0.24 },
                pointer: { filePng: "pointinghand-1__39-26.png", fileSvg: "pointinghand-1__39-26.svg", anchorX: 0.39, anchorY: 0.26 },
                text: { filePng: "ibeamstroke-1__50-50.png", fileSvg: "ibeamstroke-1__50-50.svg", anchorX: 0.50, anchorY: 0.50 },
                crosshair: { filePng: "crosshair-1__50-50.png", fileSvg: "crosshair-1__50-50.svg", anchorX: 0.50, anchorY: 0.50 },
                "open-hand": { filePng: "openhand-1__50-50.png", fileSvg: "openhand-1__50-50.svg", anchorX: 0.50, anchorY: 0.50 },
                "closed-hand": { filePng: "closedhand-1__50-50.png", fileSvg: "closedhand-1__50-50.svg", anchorX: 0.50, anchorY: 0.50 },
                "resize-ew": { filePng: "resizeeastwest-1__50-50.png", fileSvg: "resizeeastwest-1__50-50.svg", anchorX: 0.50, anchorY: 0.50 },
                "resize-ns": { filePng: "resizenorthsouth-1__50-50.png", fileSvg: "resizenorthsouth-1__50-50.svg", altPng: "resizenorthsouth-1__50-49.png", anchorX: 0.50, anchorY: 0.50, altAnchorX: 0.50, altAnchorY: 0.49 },
                "not-allowed": { filePng: "notallowed-1__23-0.png", fileSvg: "notallowed-1__23-0.svg", anchorX: 0.23, anchorY: 0.00 },
                wait: { filePng: "busybutclickable-1__23-0.png", fileSvg: "busybutclickable-1__23-0.svg", anchorX: 0.23, anchorY: 0.00 }
            }
        },
        windows11: {
            id: "windows11",
            label: "Windows 11 Fluent",
            folder: "windows11",
            sizeMultiplier: 1.6787,
            cursors: {
                arrow: { filePng: "arrow__50-50.png", fileSvg: "arrow__50-50.svg", altPng: "arrow__31-22.png", anchorX: 0.50, anchorY: 0.50, altAnchorX: 0.31, altAnchorY: 0.22 },
                pointer: { filePng: "pointer__54-35.png", fileSvg: "pointer__54-35.svg", anchorX: 0.54, anchorY: 0.35 },
                text: { filePng: "text__50-50.png", fileSvg: "text__50-50.svg", anchorX: 0.50, anchorY: 0.50 },
                crosshair: { filePng: "cross__50-50.png", fileSvg: "cross__50-50.svg", anchorX: 0.50, anchorY: 0.50 },
                "open-hand": { filePng: "grab__50-50.png", fileSvg: "grab__50-50.svg", anchorX: 0.50, anchorY: 0.50 },
                "closed-hand": { filePng: "grabbing__50-50.png", fileSvg: "grabbing__50-50.svg", anchorX: 0.50, anchorY: 0.50 },
                "resize-ew": { filePng: "resize-horizontal__51-49.png", fileSvg: "resize-horizontal__51-49.svg", anchorX: 0.51, anchorY: 0.49 },
                "resize-ns": { filePng: "resize-vertical__48-50.png", fileSvg: "resize-vertical__48-50.svg", anchorX: 0.48, anchorY: 0.50 },
                "not-allowed": { filePng: "block__50-50.png", fileSvg: "block__50-50.svg", anchorX: 0.50, anchorY: 0.50 },
                wait: { filePng: "wait__50-50.png", fileSvg: "wait__50-50.svg", anchorX: 0.50, anchorY: 0.50 }
            }
        },
        custom: {
            id: "custom",
            label: "Figma Minimal",
            folder: "custom",
            sizeMultiplier: 1.0,
            cursors: {
                arrow: { filePng: "minimal-cursor.png", fileSvg: "minimal-cursor.svg", anchorX: 0.1010, anchorY: 0.0508 },
                pointer: { filePng: "minimal-cursor.png", fileSvg: "minimal-cursor.svg", anchorX: 0.1010, anchorY: 0.0508 }
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

    var BACKGROUND_PRESETS = {
        "tahoe-dawn": { label: "Tahoe Dawn", start: [0.231, 0.510, 0.965], end: [0.545, 0.361, 0.965], isRadial: false },
        "dark-studio": { label: "Dark Studio", start: [0.153, 0.153, 0.165], end: [0.035, 0.035, 0.043], isRadial: true },
        "midnight-deep": { label: "Midnight Deep", start: [0.118, 0.161, 0.231], end: [0.035, 0.051, 0.086], isRadial: true },
        "sequoia-azure": { label: "Sequoia Azure", start: [0.145, 0.388, 0.922], end: [0.059, 0.090, 0.165], isRadial: false },
        "solid-charcoal": { label: "Clean Charcoal", start: [0.118, 0.118, 0.125], end: [0.118, 0.118, 0.125], isRadial: false },
        "none": { label: "Transparent / None", start: [0, 0, 0], end: [0, 0, 0], isRadial: false }
    };

    function getWallpaperMeta(key) {
        for (var i = 0; i < RECORDLY_WALLPAPERS.length; i++) {
            if (RECORDLY_WALLPAPERS[i].filename === key || RECORDLY_WALLPAPERS[i].id === key) {
                return RECORDLY_WALLPAPERS[i];
            }
        }
        if (BACKGROUND_PRESETS[key]) {
            return {
                id: key,
                filename: key,
                label: BACKGROUND_PRESETS[key].label,
                start: BACKGROUND_PRESETS[key].start,
                end: BACKGROUND_PRESETS[key].end
            };
        }
        return RECORDLY_WALLPAPERS[0];
    }

    function getWallpaperAssetFile(filename) {
        if (!filename || filename === "none" || filename === "dark-studio" || BACKGROUND_PRESETS[filename]) return null;
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

    // =========================================================================
    // Recordly Damped Harmonic Oscillator Spring Physics Solver (From main.jsx)
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
    // Ramer-Douglas-Peucker (RDP) Trajectory Simplification (From main.jsx)
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
    // Telemetry Interaction, Typing & Scroll Detection + Unified 2x Time-Remap
    // =========================================================================
    function isScrollSample(s) {
        if (!s) return false;
        var it = s.interactionType || "";
        if (it === "scroll" || it === "wheel" || it === "scroll-up" || it === "scroll-down") return true;
        if (s.isScrolling === true) return true;
        if (typeof s.scrollDelta === "number" && s.scrollDelta !== 0) return true;
        if (typeof s.wheelDelta === "number" && s.wheelDelta !== 0) return true;
        if (typeof s.deltaY === "number" && s.deltaY !== 0) return true;
        return false;
    }

    function isKeyTypingSample(s) {
        if (!s) return false;
        var it = s.interactionType || "";
        return (it === "key" || it === "typing" || it === "keydown" || s.isTyping === true);
    }

    function mergeTimeIntervals(intervals, maxGapMs, minDurMs, totalMs) {
        if (!intervals || intervals.length === 0) return [];
        var sorted = intervals.slice(0);
        sorted.sort(function (a, b) { return a.startMs - b.startMs; });

        var merged = [];
        var cur = {
            startMs: Math.max(0, sorted[0].startMs),
            endMs: Math.min(totalMs, sorted[0].endMs),
            cx: sorted[0].cx !== undefined ? sorted[0].cx : 0.5,
            cy: sorted[0].cy !== undefined ? sorted[0].cy : 0.5,
            points: sorted[0].points ? sorted[0].points.slice(0) : []
        };

        for (var i = 1; i < sorted.length; i++) {
            var nxt = sorted[i];
            var nxtStart = Math.max(0, nxt.startMs);
            var nxtEnd = Math.min(totalMs, nxt.endMs);
            if (nxtStart <= cur.endMs + maxGapMs) {
                cur.endMs = Math.max(cur.endMs, nxtEnd);
                if (nxt.points && nxt.points.length > 0) {
                    for (var p = 0; p < nxt.points.length; p++) {
                        cur.points.push(nxt.points[p]);
                    }
                }
            } else {
                if ((cur.endMs - cur.startMs) >= minDurMs) merged.push(cur);
                cur = {
                    startMs: nxtStart,
                    endMs: nxtEnd,
                    cx: nxt.cx !== undefined ? nxt.cx : 0.5,
                    cy: nxt.cy !== undefined ? nxt.cy : 0.5,
                    points: nxt.points ? nxt.points.slice(0) : []
                };
            }
        }
        if ((cur.endMs - cur.startMs) >= minDurMs) merged.push(cur);
        return merged;
    }

    function detectTelemetryInteractions(rawSamples, durationSec, speedupConfig) {
        var enableTypingSpeedup = true;
        var enableScrollSpeedup = true;
        if (typeof speedupConfig === "boolean") {
            enableTypingSpeedup = speedupConfig;
            enableScrollSpeedup = false;
        } else if (speedupConfig && typeof speedupConfig === "object") {
            enableTypingSpeedup = speedupConfig.enableTypingSpeedup !== false;
            enableScrollSpeedup = speedupConfig.enableScrollSpeedup !== false;
        }

        var totalMs = durationSec * 1000.0;
        var dragIntervals = [];
        var scrollIntervals = [];
        var typingIntervals = [];

        // 1. Detect drag & text-selection intervals
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

        // 2. Detect Scroll Intervals (explicit wheel/scroll events)
        var scRunStart = -1;
        var scRunEnd = -1;
        var scCx = 0.5;
        var scCy = 0.5;
        var scPoints = [];
        for (var si = 0; si < rawSamples.length; si++) {
            var scS = rawSamples[si];
            if (isScrollSample(scS)) {
                if (scRunStart < 0) {
                    scRunStart = scS.timeMs;
                    scCx = scS.cx;
                    scCy = scS.cy;
                    scPoints = [{ timeMs: scS.timeMs, cx: scS.cx, cy: scS.cy }];
                } else {
                    if (scPoints.length === 0 || (scS.timeMs - scPoints[scPoints.length - 1].timeMs) >= 200) {
                        scPoints.push({ timeMs: scS.timeMs, cx: scS.cx, cy: scS.cy });
                    }
                }
                scRunEnd = scS.timeMs;
            } else if (scRunStart >= 0 && (scS.timeMs - scRunEnd) > 750) {
                var scFinalEnd = Math.min(totalMs, Math.max(scRunEnd + 180, scRunStart + 350));
                scrollIntervals.push({
                    startMs: scRunStart,
                    endMs: scFinalEnd,
                    cx: scCx,
                    cy: scCy,
                    points: scPoints
                });
                scRunStart = -1;
                scPoints = [];
            }
        }
        if (scRunStart >= 0) {
            scrollIntervals.push({
                startMs: scRunStart,
                endMs: Math.min(totalMs, Math.max(scRunEnd + 180, scRunStart + 350)),
                cx: scCx,
                cy: scCy,
                points: scPoints
            });
        }
        var mergedScroll = mergeTimeIntervals(scrollIntervals, 650, 250, totalMs);

        function isScrollAtTime(tMs) {
            for (var sd = 0; sd < mergedScroll.length; sd++) {
                if (tMs >= mergedScroll[sd].startMs && tMs <= mergedScroll[sd].endMs) return true;
            }
            return false;
        }

        // 3. Detect explicit typing/key events with per-sample coordinates for camera follow
        var keyRunStart = -1;
        var keyRunEnd = -1;
        var keyRunCx = 0.5;
        var keyRunCy = 0.5;
        var keyPoints = [];
        for (var ke = 0; ke < rawSamples.length; ke++) {
            var ks = rawSamples[ke];
            if (isKeyTypingSample(ks)) {
                var kx = (typeof ks.typingX === "number") ? ks.typingX : ks.cx;
                var ky = (typeof ks.typingY === "number") ? ks.typingY : ks.cy;
                if (keyRunStart < 0) {
                    keyRunStart = ks.timeMs;
                    keyRunCx = kx;
                    keyRunCy = ky;
                    keyPoints = [{ timeMs: ks.timeMs, cx: kx, cy: ky }];
                } else {
                    if (keyPoints.length === 0 || (ks.timeMs - keyPoints[keyPoints.length - 1].timeMs) >= 220) {
                        keyPoints.push({ timeMs: ks.timeMs, cx: kx, cy: ky });
                    }
                }
                keyRunEnd = ks.timeMs;
            } else if (keyRunStart >= 0 && (ks.timeMs - keyRunEnd) > 1100) {
                if ((keyRunEnd - keyRunStart) >= 500) {
                    typingIntervals.push({
                        startMs: keyRunStart,
                        endMs: keyRunEnd,
                        cx: keyRunCx,
                        cy: keyRunCy,
                        points: keyPoints
                    });
                }
                keyRunStart = -1;
                keyPoints = [];
            }
        }
        if (keyRunStart >= 0 && (keyRunEnd - keyRunStart) >= 500) {
            typingIntervals.push({
                startMs: keyRunStart,
                endMs: keyRunEnd,
                cx: keyRunCx,
                cy: keyRunCy,
                points: keyPoints
            });
        }

        // 4. Heuristic typing intervals: click in text field + stationary dwell
        // Stops immediately on mouse movement, new click, or scroll event so scrolling NEVER mimics typing!
        for (var c = 0; c < rawSamples.length; c++) {
            var clickS = rawSamples[c];
            if (clickS.interactionType === "click" || clickS.interactionType === "double-click") {
                var isTextClick = (clickS.cursorType === "text");
                if (!isTextClick) {
                    for (var near = Math.max(0, c - 3); near < Math.min(rawSamples.length, c + 8); near++) {
                        if (Math.abs(rawSamples[near].timeMs - clickS.timeMs) <= 450 && rawSamples[near].cursorType === "text") {
                            isTextClick = true;
                            break;
                        }
                    }
                }
                if (isTextClick) {
                    var windowEnd = Math.min(totalMs, clickS.timeMs + 30000);
                    var maxDisp = 0;
                    var lastStationaryMs = clickS.timeMs;
                    var dwellPts = [{ timeMs: clickS.timeMs, cx: clickS.cx, cy: clickS.cy }];
                    for (var w = c + 1; w < rawSamples.length && rawSamples[w].timeMs <= windowEnd; w++) {
                        var sMove = rawSamples[w];
                        if (isScrollSample(sMove) || isScrollAtTime(sMove.timeMs)) break;
                        var mType = sMove.interactionType;
                        if (mType === "click" || mType === "right-click" || mType === "middle-click") {
                            var cDist = Math.sqrt(Math.pow(sMove.cx - clickS.cx, 2) + Math.pow(sMove.cy - clickS.cy, 2));
                            if (cDist > 0.03) break;
                        }
                        var d = Math.sqrt(Math.pow(sMove.cx - clickS.cx, 2) + Math.pow(sMove.cy - clickS.cy, 2));
                        if (d > maxDisp) maxDisp = d;
                        if (maxDisp > 0.03) break;
                        lastStationaryMs = sMove.timeMs;
                        if ((sMove.timeMs - dwellPts[dwellPts.length - 1].timeMs) >= 350) {
                            dwellPts.push({ timeMs: sMove.timeMs, cx: sMove.cx, cy: sMove.cy });
                        }
                    }
                    if ((lastStationaryMs - clickS.timeMs) >= 900) {
                        typingIntervals.push({
                            startMs: Math.max(0, clickS.timeMs),
                            endMs: Math.min(totalMs, lastStationaryMs),
                            cx: clickS.cx,
                            cy: clickS.cy,
                            points: dwellPts
                        });
                        while (c < rawSamples.length - 1 && rawSamples[c + 1].timeMs <= lastStationaryMs) {
                            c++;
                        }
                    }
                }
            }
        }
        var mergedTyping = mergeTimeIntervals(typingIntervals, 750, 300, totalMs);

        // 5. Build Unified 2.0x Speed-Up Interval List (Typing 2x + Scroll 2x independently toggled)
        var rawSpeedup = [];
        if (enableTypingSpeedup) {
            for (var ti = 0; ti < mergedTyping.length; ti++) {
                rawSpeedup.push({ startMs: mergedTyping[ti].startMs, endMs: mergedTyping[ti].endMs });
            }
        }
        if (enableScrollSpeedup) {
            for (var sci = 0; sci < mergedScroll.length; sci++) {
                rawSpeedup.push({ startMs: mergedScroll[sci].startMs, endMs: mergedScroll[sci].endMs });
            }
        }
        var speedupIntervals = mergeTimeIntervals(rawSpeedup, 150, 150, totalMs);

        var speedFactor = 2.0;
        var totalSavedSec = 0;
        for (var sp = 0; sp < speedupIntervals.length; sp++) {
            var segDurSec = (speedupIntervals[sp].endMs - speedupIntervals[sp].startMs) / 1000.0;
            totalSavedSec += segDurSec * (1.0 - 1.0 / speedFactor);
        }

        function timeMapFn(tSec) {
            var safeSec = Math.max(0, tSec);
            if (speedupIntervals.length === 0) {
                return { compSec: safeSec, isSpeedup: false };
            }
            var tMs = safeSec * 1000.0;
            var savedMs = 0;
            var inSpeed = false;
            for (var segI = 0; segI < speedupIntervals.length; segI++) {
                var seg = speedupIntervals[segI];
                if (tMs <= seg.startMs) {
                    break;
                } else if (tMs >= seg.endMs) {
                    savedMs += (seg.endMs - seg.startMs) * (1.0 - 1.0 / speedFactor);
                } else {
                    savedMs += (tMs - seg.startMs) * (1.0 - 1.0 / speedFactor);
                    inSpeed = true;
                    break;
                }
            }
            return {
                compSec: Math.max(0, (tMs - savedMs) / 1000.0),
                isSpeedup: inSpeed
            };
        }

        function isDragAtTime(tMs) {
            for (var d = 0; d < dragIntervals.length; d++) {
                if (tMs >= dragIntervals[d].startMs && tMs <= dragIntervals[d].endMs) return true;
            }
            return false;
        }

        return {
            dragIntervals: dragIntervals,
            typingIntervals: mergedTyping,
            scrollIntervals: mergedScroll,
            speedupIntervals: speedupIntervals,
            totalSavedSec: totalSavedSec,
            timeMapFn: timeMapFn,
            isDragAtTime: isDragAtTime,
            isScrollAtTime: isScrollAtTime
        };
    }

    // =========================================================================
    // Recordly Smart Zoom State Machine (Interval-Based Priority + main.jsx Base)
    // - When Typing/Scroll Zoom toggles are OFF: runs 100% of main.jsx base clusters untouched.
    // - When Typing/Scroll Zoom toggles are ON: active Typing/Scroll windows take strict
    //   priority (clipping/suppressing overlapping base click zooms so zoom never stacks
    //   or collides), then cleanly zoom back out and hand control back to main.jsx framing.
    // =========================================================================
    function subtractPriorityWindows(baseSegs, priorityWindows, guardMs) {
        if (!priorityWindows || priorityWindows.length === 0) return baseSegs;
        var out = [];
        for (var i = 0; i < baseSegs.length; i++) {
            var pieces = [baseSegs[i]];
            for (var p = 0; p < priorityWindows.length; p++) {
                var pw = priorityWindows[p];
                var cutStart = pw.startMs - guardMs;
                var cutEnd = pw.endMs + guardMs;
                var nextPieces = [];
                for (var j = 0; j < pieces.length; j++) {
                    var seg = pieces[j];
                    if (seg.endMs <= cutStart || seg.startMs >= cutEnd) {
                        nextPieces.push(seg);
                    } else {
                        if (seg.startMs < cutStart && (cutStart - seg.startMs) >= 250) {
                            nextPieces.push({
                                startMs: seg.startMs,
                                endMs: cutStart,
                                cx: seg.cx,
                                cy: seg.cy,
                                kind: seg.kind,
                                points: seg.points
                            });
                        }
                        if (seg.endMs > cutEnd && (seg.endMs - cutEnd) >= 250) {
                            nextPieces.push({
                                startMs: cutEnd,
                                endMs: seg.endMs,
                                cx: seg.cx,
                                cy: seg.cy,
                                kind: seg.kind,
                                points: seg.points
                            });
                        }
                    }
                }
                pieces = nextPieces;
            }
            for (var k = 0; k < pieces.length; k++) {
                out.push(pieces[k]);
            }
        }
        return out;
    }

    function buildRecordlyZoomClusters(rawSamples, durationSec, zoomScale, typingIntervals, scrollIntervals, zoomOpts) {
        var opts = zoomOpts || {};
        var includeBaseAutoZoom = opts.includeBaseAutoZoom !== false;
        var enableTypingZoom = opts.enableTypingZoom === true;
        var enableScrollZoom = opts.enableScrollZoom === true;

        var totalMs = durationSec * 1000.0;
        // Exact main.jsx baseline constants
        var mergeGapMs = 2500;
        var padMs = 500;
        var dwellMinMs = 450;
        var dwellMaxMs = 2600;
        var dwellMoveThresh = 0.02;

        // 1. Build Priority Windows for Enabled Typing / Scroll Auto-Zoom Toggles
        var typingWindows = [];
        if (enableTypingZoom && typingIntervals && typingIntervals.length > 0) {
            for (var tp = 0; tp < typingIntervals.length; tp++) {
                var tItem = typingIntervals[tp];
                if (tItem.endMs > tItem.startMs + 150) {
                    typingWindows.push({
                        startMs: Math.max(0, tItem.startMs),
                        endMs: Math.min(totalMs, tItem.endMs),
                        cx: tItem.cx,
                        cy: tItem.cy,
                        kind: "typing",
                        points: (tItem.points && tItem.points.length > 0) ? tItem.points.slice(0) : [{ timeMs: tItem.startMs, cx: tItem.cx, cy: tItem.cy }]
                    });
                }
            }
        }

        var rawScrollWindows = [];
        if (enableScrollZoom && scrollIntervals && scrollIntervals.length > 0) {
            for (var sc = 0; sc < scrollIntervals.length; sc++) {
                var scItem = scrollIntervals[sc];
                if (scItem.endMs > scItem.startMs + 150) {
                    rawScrollWindows.push({
                        startMs: Math.max(0, scItem.startMs),
                        endMs: Math.min(totalMs, scItem.endMs),
                        cx: scItem.cx,
                        cy: scItem.cy,
                        kind: "scroll",
                        points: (scItem.points && scItem.points.length > 0) ? scItem.points.slice(0) : []
                    });
                }
            }
        }
        // Typing takes priority over Scroll if both ever overlap
        var scrollWindows = subtractPriorityWindows(rawScrollWindows, typingWindows, 120);

        var priorityWindows = typingWindows.concat(scrollWindows);
        priorityWindows.sort(function (a, b) { return a.startMs - b.startMs; });

        function isInsidePriority(tMs, bufferMs) {
            for (var p = 0; p < priorityWindows.length; p++) {
                if (tMs >= priorityWindows[p].startMs - bufferMs && tMs <= priorityWindows[p].endMs + bufferMs) {
                    return true;
                }
            }
            return false;
        }

        // 2. Build main.jsx Original Click + Dwell Clusters (Untouched outside priority windows)
        var baseClusters = [];
        if (includeBaseAutoZoom) {
            var baseCandidates = [];

            // Explicit Clicks from Telemetry (main.jsx exact)
            for (var i = 0; i < rawSamples.length; i++) {
                var s = rawSamples[i];
                var it = s.interactionType;
                if (it === "click" || it === "double-click" || it === "right-click" || it === "middle-click") {
                    if (priorityWindows.length > 0 && isInsidePriority(s.timeMs, 150)) continue;
                    baseCandidates.push({
                        timeMs: s.timeMs,
                        cx: s.cx,
                        cy: s.cy,
                        strength: it === "double-click" ? 1500 : 1000
                    });
                }
            }

            // Dwell Heuristic Candidates (main.jsx exact)
            var runStart = 0;
            for (var j = 1; j < rawSamples.length; j++) {
                var prev = rawSamples[j - 1];
                var curr = rawSamples[j];
                var dist = Math.sqrt(Math.pow(curr.cx - prev.cx, 2) + Math.pow(curr.cy - prev.cy, 2));
                if (dist > dwellMoveThresh || (priorityWindows.length > 0 && isScrollSample(curr))) {
                    var rLen = j - runStart;
                    if (rLen >= 2) {
                        var startS = rawSamples[runStart];
                        var endS = rawSamples[j - 1];
                        var runDur = endS.timeMs - startS.timeMs;
                        if (runDur >= dwellMinMs && runDur <= dwellMaxMs) {
                            var midMs = Math.round((startS.timeMs + endS.timeMs) / 2);
                            if (priorityWindows.length === 0 || !isInsidePriority(midMs, 150)) {
                                var sumX = 0, sumY = 0;
                                for (var r = runStart; r < j; r++) {
                                    sumX += rawSamples[r].cx;
                                    sumY += rawSamples[r].cy;
                                }
                                baseCandidates.push({
                                    timeMs: midMs,
                                    cx: sumX / rLen,
                                    cy: sumY / rLen,
                                    strength: runDur
                                });
                            }
                        }
                    }
                    runStart = j;
                }
            }

            if (baseCandidates.length > 0) {
                baseCandidates.sort(function (a, b) { return a.timeMs - b.timeMs; });

                var curStart = baseCandidates[0].timeMs;
                var curEnd = baseCandidates[0].timeMs;
                var bestStrength = baseCandidates[0].strength;
                var bestCx = baseCandidates[0].cx;
                var bestCy = baseCandidates[0].cy;
                var sumCx = baseCandidates[0].cx;
                var sumCy = baseCandidates[0].cy;
                var count = 1;

                for (var k = 1; k < baseCandidates.length; k++) {
                    var c = baseCandidates[k];
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
                        baseClusters.push({
                            startMs: Math.max(0, curStart - padMs),
                            endMs: Math.min(totalMs, curEnd + padMs),
                            cx: bestCx !== undefined ? bestCx : (sumCx / count),
                            cy: bestCy !== undefined ? bestCy : (sumCy / count),
                            kind: "base",
                            points: []
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
                baseClusters.push({
                    startMs: Math.max(0, curStart - padMs),
                    endMs: Math.min(totalMs, curEnd + padMs),
                    cx: bestCx !== undefined ? bestCx : (sumCx / count),
                    cy: bestCy !== undefined ? bestCy : (sumCy / count),
                    kind: "base",
                    points: []
                });

                // Carve out any base cluster overlap with active Typing/Scroll priority windows
                if (priorityWindows.length > 0) {
                    baseClusters = subtractPriorityWindows(baseClusters, priorityWindows, 150);
                }
            }
        }

        // 3. Combine Strictly Disjoint Base Clusters + Priority Windows and Clamp to Viewport Bounds
        var allClusters = baseClusters.concat(priorityWindows);
        if (allClusters.length === 0) return [];
        allClusters.sort(function (a, b) { return a.startMs - b.startMs; });

        var marginX = 1.0 / (2.0 * zoomScale);
        var marginY = 1.0 / (2.0 * zoomScale);
        var result = [];
        for (var cl = 0; cl < allClusters.length; cl++) {
            var clItem = allClusters[cl];
            var sMs = Math.max(0, clItem.startMs);
            var eMs = Math.min(totalMs, clItem.endMs);
            if (eMs <= sMs + 100) continue;

            var clampedCx = Math.max(marginX, Math.min(1.0 - marginX, clItem.cx));
            var clampedCy = Math.max(marginY, Math.min(1.0 - marginY, clItem.cy));

            var clampedPts = [];
            if (clItem.points && clItem.points.length > 0) {
                for (var pi = 0; pi < clItem.points.length; pi++) {
                    clampedPts.push({
                        timeMs: clItem.points[pi].timeMs,
                        cx: Math.max(marginX, Math.min(1.0 - marginX, clItem.points[pi].cx)),
                        cy: Math.max(marginY, Math.min(1.0 - marginY, clItem.points[pi].cy))
                    });
                }
            }

            result.push({
                startMs: sMs,
                endMs: eMs,
                startSec: sMs / 1000.0,
                endSec: eMs / 1000.0,
                cx: clampedCx,
                cy: clampedCy,
                kind: clItem.kind,
                points: clampedPts
            });
        }
        return result;
    }

    // =========================================================================
    // Guaranteed Non-Stuck Zoom Keyframe Emitter (Comp-Time Priority State Machine)
    // =========================================================================
    function applyZoomSegmentsToController(controller, clusters, activeTimeMapFn, compDuration, footageW, footageH, targetZoomScale) {
        var zProp = controller.effect("Zoom Scale")("Slider");
        var pProp = controller.effect("Camera Focus")("Point");
        var centerPt = [footageW / 2, footageH / 2];

        pProp.setValueAtTime(0, centerPt);
        zProp.setValueAtTime(0, 100);

        if (!clusters || clusters.length === 0 || targetZoomScale <= 1.01) {
            return;
        }

        // Convert to comp-time and guarantee strict non-overlapping separation
        // Priority ("typing"/"scroll") windows NEVER get merged with or overridden by "base" segments!
        var compSegs = [];
        var minGapSec = 0.08;
        for (var i = 0; i < clusters.length; i++) {
            var cl = clusters[i];
            var tStart = Math.max(0.0, activeTimeMapFn(cl.startSec).compSec);
            var tEnd = Math.min(compDuration, activeTimeMapFn(cl.endSec).compSec);
            if (tEnd - tStart < 0.20) continue;

            if (compSegs.length > 0) {
                var prev = compSegs[compSegs.length - 1];
                if (tStart < prev.tEnd + minGapSec) {
                    var prevIsPrio = (prev.kind === "typing" || prev.kind === "scroll");
                    var curIsPrio = (cl.kind === "typing" || cl.kind === "scroll");
                    if (curIsPrio && !prevIsPrio) {
                        // Priority window trims preceding base segment cleanly
                        prev.tEnd = tStart - minGapSec;
                        if (prev.tEnd - prev.tStart < 0.20) {
                            compSegs.pop();
                        }
                    } else if (prevIsPrio && !curIsPrio) {
                        // Preceding priority window delays following base segment cleanly
                        tStart = prev.tEnd + minGapSec;
                        if (tEnd - tStart < 0.20) continue;
                    } else if (!prevIsPrio && !curIsPrio) {
                        // Two adjacent base segments merge cleanly
                        prev.tEnd = Math.max(prev.tEnd, tEnd);
                        continue;
                    } else {
                        // Two adjacent priority windows: trim start of second cleanly
                        tStart = prev.tEnd + minGapSec;
                        if (tEnd - tStart < 0.20) continue;
                    }
                }
            }
            compSegs.push({
                tStart: tStart,
                tEnd: tEnd,
                cx: cl.cx,
                cy: cl.cy,
                kind: cl.kind,
                points: cl.points ? cl.points.slice(0) : []
            });
        }

        var easeInOut = new KeyframeEase(0, 84.0);

        for (var s = 0; s < compSegs.length; s++) {
            var seg = compSegs[s];
            var tStart = seg.tStart;
            var tEnd = seg.tEnd;
            var span = tEnd - tStart;
            if (span < 0.20) continue;

            // main.jsx uses 0.95s smooth transition for base auto-zoom; crisp 0.65s for typing/scroll priority windows
            var baseTrans = (seg.kind === "base") ? 0.95 : 0.65;
            var transIn = Math.min(baseTrans, span * 0.35);
            var transOut = Math.min(baseTrans * 0.85, span * 0.35);
            var tInEnd = tStart + transIn;
            var tOutStart = tEnd - transOut;
            if (tOutStart <= tInEnd + 0.02) {
                var mid = (tStart + tEnd) * 0.5;
                tInEnd = mid - 0.01;
                tOutStart = mid + 0.01;
            }

            var startFocus = [seg.cx * footageW, seg.cy * footageH];
            var endFocus = startFocus;

            // Zoom In (100% -> targetZoom, never stacked or multiplied!)
            zProp.setValueAtTime(tStart, 100);
            pProp.setValueAtTime(tStart, startFocus);

            zProp.setValueAtTime(tInEnd, targetZoomScale * 100);
            pProp.setValueAtTime(tInEnd, startFocus);

            // Typing Camera Pan & Follow inside the zoomed hold window
            if (seg.kind === "typing" && seg.points && seg.points.length > 1) {
                var lastPtTime = tInEnd;
                for (var ptI = 0; ptI < seg.points.length; ptI++) {
                    var ptCompSec = activeTimeMapFn(seg.points[ptI].timeMs / 1000.0).compSec;
                    if (ptCompSec > lastPtTime + 0.12 && ptCompSec < tOutStart - 0.08) {
                        var followPt = [seg.points[ptI].cx * footageW, seg.points[ptI].cy * footageH];
                        pProp.setValueAtTime(ptCompSec, followPt);
                        endFocus = followPt;
                        lastPtTime = ptCompSec;
                    }
                }
            }

            // Guaranteed Zoom-Out Recovery (targetZoom -> 100%)
            zProp.setValueAtTime(tOutStart, targetZoomScale * 100);
            pProp.setValueAtTime(tOutStart, endFocus);

            zProp.setValueAtTime(tEnd, 100);
            pProp.setValueAtTime(tEnd, endFocus);
        }

        // Guaranteed final recovery anchor at comp end
        if (compSegs.length > 0 && compSegs[compSegs.length - 1].tEnd < compDuration - 0.05) {
            zProp.setValueAtTime(compDuration, 100);
            pProp.setValueAtTime(compDuration, centerPt);
        }

        for (var zk = 1; zk <= zProp.numKeys; zk++) {
            SafeProp.setTemporalEase(zProp, zk, easeInOut, easeInOut);
        }
        for (var pk = 1; pk <= pProp.numKeys; pk++) {
            SafeProp.setTemporalEase(pProp, pk, easeInOut, easeInOut);
            try {
                pProp.setSpatialContinuousAtKey(pk, false);
                pProp.setSpatialAutoBezierAtKey(pk, false);
                pProp.setInterpolationTypeAtKey(pk, KeyframeInterpolationType.LINEAR);
            } catch (e) {}
        }
    }

    // =========================================================================
    // Helper: Procedural Vector Cursor Fallback (if PNGs missing on disk)
    // =========================================================================
    function createProceduralCursorLayer(comp, cursorMaster, baseCursorHeight, enableMotionBlur) {
        var shapeLayer = comp.layers.addShape();
        shapeLayer.name = "Cursor_arrow";
        shapeLayer.parent = cursorMaster;
        shapeLayer.motionBlur = enableMotionBlur;
        shapeLayer.transform.anchorPoint.setValue([0, 0]);
        shapeLayer.transform.position.setValue([0, 0]);

        var scale = baseCursorHeight / 24.0;
        var grp = shapeLayer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
        grp.name = "Pointer Arrow";

        var pathGrp = SafeProp.findFresh(shapeLayer, ["ADBE Root Vectors Group", "Pointer Arrow", "ADBE Vectors Group"]).addProperty("ADBE Vector Shape - Group");
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

        var fill = SafeProp.findFresh(shapeLayer, ["ADBE Root Vectors Group", "Pointer Arrow", "ADBE Vectors Group"]).addProperty("ADBE Vector Graphic - Fill");
        fill.property("ADBE Vector Fill Color").setValue([1.0, 1.0, 1.0, 1.0]);

        var stroke = SafeProp.findFresh(shapeLayer, ["ADBE Root Vectors Group", "Pointer Arrow", "ADBE Vectors Group"]).addProperty("ADBE Vector Graphic - Stroke");
        stroke.property("ADBE Vector Stroke Color").setValue([0.07, 0.08, 0.10, 1.0]);
        stroke.property("ADBE Vector Stroke Width").setValue(Math.max(1.2, 1.6 * scale));

        return shapeLayer;
    }

    // =========================================================================
    // Helper: Update Active Rig Sliders In-Place
    // =========================================================================
    function updateActiveTraceMotionRig(comp, options) {
        if (!safeIsValid(comp)) return false;
        var controller = comp.layer("TraceMotion_Camera_Controller");
        if (!safeIsValid(controller)) return false;

        try {
            app.beginUndoGroup("Update TraceMotion Rig");
            if (options.canvasMargin !== undefined) SafeProp.setValue(controller.effect("Canvas Margin")("Slider"), options.canvasMargin);
            if (options.cornerRadius !== undefined) SafeProp.setValue(controller.effect("Corner Radius")("Slider"), options.cornerRadius);
            if (options.shadowIntensity !== undefined) SafeProp.setValue(controller.effect("Shadow Intensity")("Slider"), options.shadowIntensity);
            if (options.swayAmount !== undefined) SafeProp.setValue(controller.effect("Cursor Sway")("Slider"), options.swayAmount);
            if (options.syncOffsetMs !== undefined) {
                try { SafeProp.setValue(controller.effect("Cursor Sync Offset (ms)")("Slider"), options.syncOffsetMs); } catch (eS) {}
            }
            app.endUndoGroup();
            return true;
        } catch (e) {
            try { app.endUndoGroup(); } catch (ue) {}
            return false;
        }
    }

    // =========================================================================
    // Main Rig Generation Core (Restored main.jsx Physics + Crash-Free AE API)
    // =========================================================================
    function buildTraceMotionRig(videoFile, telemetryFile, options) {
        var proj = ensureProject();
        var undoStarted = false;
        var currentStep = "Initializing";

        try {
            app.beginUndoGroup("Build TraceMotion Rig");
            undoStarted = true;

            // 1. Read & Parse Telemetry JSON
            currentStep = "Reading telemetry JSON";
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
            currentStep = "Importing video footage";
            if (!videoFile || !videoFile.exists) {
                alert("Video footage file does not exist: " + (videoFile ? videoFile.fsName : "null"), "TraceMotion Error");
                return null;
            }
            var footageItem = proj.importFile(new ImportOptions(videoFile));
            if (!safeIsValid(footageItem)) {
                alert("Failed to import video footage into project.", "Import Error");
                return null;
            }

            var footageW = footageItem.width;
            var footageH = footageItem.height;
            var duration = footageItem.duration;
            var fps = footageItem.frameRate || 60;
            var frameDurSec = 1.0 / fps;

            var syncOffsetMs = parseFloat(options.syncOffsetMs) || 0;
            var rawSamples = [];
            for (var rs = 0; rs < rawSamplesOrig.length; rs++) {
                var origS = rawSamplesOrig[rs];
                rawSamples.push({
                    timeMs: Math.max(0, origS.timeMs),
                    cx: origS.cx,
                    cy: origS.cy,
                    cursorType: origS.cursorType || "arrow",
                    interactionType: origS.interactionType || "",
                    isTyping: origS.isTyping === true,
                    isScrolling: origS.isScrolling === true,
                    scrollDelta: origS.scrollDelta,
                    wheelDelta: origS.wheelDelta,
                    deltaY: origS.deltaY,
                    typingX: origS.typingX,
                    typingY: origS.typingY
                });
            }

            // Independent 4-toggle flags
            var enableTypingSpeedup = options.enableTypingSpeedup !== false;
            var enableTypingZoom = options.enableTypingZoom !== false;
            var enableScrollSpeedup = options.enableScrollSpeedup !== false;
            var enableScrollZoom = options.enableScrollZoom !== false;

            // Analyze drags, typing, scroll, and unified 2.0x time mapping
            currentStep = "Analyzing telemetry interactions";
            var telemetryAnalysis = detectTelemetryInteractions(rawSamples, duration, {
                enableTypingSpeedup: enableTypingSpeedup,
                enableScrollSpeedup: enableScrollSpeedup
            });
            var plannedCompDuration = Math.max(0.2, duration - telemetryAnalysis.totalSavedSec);

            // 3. Create Composition
            currentStep = "Creating composition";
            var marginPct = Math.max(0, Math.min(30, options.canvasMargin !== undefined ? options.canvasMargin : 12));
            var marginScaleFactor = 1.0 + (marginPct / 100.0) * 0.5;
            var compW = Math.round(footageW * marginScaleFactor);
            var compH = Math.round(footageH * marginScaleFactor);
            if (compW % 2 !== 0) compW++;
            if (compH % 2 !== 0) compH++;

            var baseName = footageItem.name.replace(/\.[^\.]+$/, "");
            var comp = proj.items.addComp(baseName + "_TraceMotion", compW, compH, 1.0, plannedCompDuration, fps);
            try { comp.openInViewer(); } catch (viewerErr) {}
            comp.motionBlur = options.enableMotionBlur !== false;

            // 4. Add Background Layer
            currentStep = "Creating background layer";
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
                    var ramp = bgLayer.property("ADBE Effect Parade").addProperty("ADBE Ramp");
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

            // 5. Create Master Camera Rig Null
            currentStep = "Creating camera rig";
            var cameraRig = comp.layers.addNull();
            cameraRig.name = "TraceMotion_Camera_Rig";
            cameraRig.guideLayer = true;
            cameraRig.transform.anchorPoint.setValue([0, 0]);
            cameraRig.transform.position.setValue([0, 0]);

            // 6. Create Master Camera Controller Null (Fresh lookups on every addProperty)
            currentStep = "Creating camera controller";
            var controller = comp.layers.addNull();
            controller.name = "TraceMotion_Camera_Controller";
            controller.guideLayer = true;

            controller.property("ADBE Effect Parade").addProperty("ADBE Slider Control").name = "Zoom Scale";
            controller.property("ADBE Effect Parade").addProperty("ADBE Slider Control").name = "Canvas Margin";
            controller.property("ADBE Effect Parade").addProperty("ADBE Slider Control").name = "Corner Radius";
            controller.property("ADBE Effect Parade").addProperty("ADBE Slider Control").name = "Shadow Intensity";
            controller.property("ADBE Effect Parade").addProperty("ADBE Slider Control").name = "Cursor Sway";
            controller.property("ADBE Effect Parade").addProperty("ADBE Slider Control").name = "Cursor Sync Offset (ms)";
            controller.property("ADBE Effect Parade").addProperty("ADBE Point Control").name = "Camera Focus";

            controller.effect("Zoom Scale")("Slider").setValue(100);
            controller.effect("Canvas Margin")("Slider").setValue(marginPct);
            controller.effect("Corner Radius")("Slider").setValue(options.cornerRadius !== undefined ? options.cornerRadius : 20);
            controller.effect("Shadow Intensity")("Slider").setValue(options.shadowIntensity !== undefined ? options.shadowIntensity : 65);
            controller.effect("Cursor Sway")("Slider").setValue(options.swayAmount !== undefined ? options.swayAmount : 0.4);
            controller.effect("Cursor Sync Offset (ms)")("Slider").setValue(syncOffsetMs);
            controller.effect("Camera Focus")("Point").setValue([footageW / 2, footageH / 2]);

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

            // 7. Create Window Drop Shadow Layer
            currentStep = "Creating window shadow layer";
            var shadowLayer = comp.layers.addShape();
            shadowLayer.name = "TraceMotion_Window_Shadow";
            shadowLayer.parent = cameraRig;
            shadowLayer.transform.anchorPoint.setValue([0, 0]);
            shadowLayer.transform.position.setValue([0, 0]);
            shadowLayer.transform.scale.setValue([100, 100]);

            var shGrp = shadowLayer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
            shGrp.name = "Shadow Bounds";

            var shRect = SafeProp.findFresh(shadowLayer, ["ADBE Root Vectors Group", "Shadow Bounds", "ADBE Vectors Group"]).addProperty("ADBE Vector Shape - Rect");
            shRect.property("ADBE Vector Rect Size").setValue([footageW, footageH]);
            shRect.property("ADBE Vector Rect Position").setValue([footageW / 2, footageH / 2]);
            shRect.property("ADBE Vector Rect Roundness").expression =
                "thisComp.layer('" + controller.name + "').effect('Corner Radius')('Slider');";

            var shFill = SafeProp.findFresh(shadowLayer, ["ADBE Root Vectors Group", "Shadow Bounds", "ADBE Vectors Group"]).addProperty("ADBE Vector Graphic - Fill");
            shFill.property("ADBE Vector Fill Color").setValue([1.0, 1.0, 1.0, 1.0]);

            var sh1 = shadowLayer.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
            sh1.name = "Window Drop Shadow (Ambient)";
            sh1.property("Distance").setValue(16);
            sh1.property("Softness").setValue(48);
            sh1.property("Direction").setValue(180);
            sh1.property("Opacity").expression = "thisComp.layer('" + controller.name + "').effect('Shadow Intensity')('Slider') * 0.70;";

            var sh2 = shadowLayer.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
            sh2.name = "Window Drop Shadow (Body)";
            sh2.property("Distance").setValue(6);
            sh2.property("Softness").setValue(16);
            sh2.property("Direction").setValue(180);
            sh2.property("Opacity").expression = "thisComp.layer('" + controller.name + "').effect('Shadow Intensity')('Slider') * 0.40;";

            var sh3 = shadowLayer.property("ADBE Effect Parade").addProperty("ADBE Drop Shadow");
            sh3.name = "Window Drop Shadow (Contact)";
            sh3.property("Distance").setValue(2);
            sh3.property("Softness").setValue(6);
            sh3.property("Direction").setValue(180);
            sh3.property("Opacity").expression = "thisComp.layer('" + controller.name + "').effect('Shadow Intensity')('Slider') * 0.25;";

            // 8. Add Clean Screen Capture Video Layer & Apply Unified 2.0x Time Remapping
            currentStep = "Adding video footage & time remapping";
            var videoLayer = comp.layers.add(footageItem);
            videoLayer.name = "Clean_Screen_Capture";
            videoLayer.parent = cameraRig;
            videoLayer.startTime = 0;
            videoLayer.transform.anchorPoint.setValue([0, 0]);
            videoLayer.transform.position.setValue([0, 0]);
            videoLayer.transform.scale.setValue([100, 100]);

            var timeRemapApplied = false;
            var activeTimeMapFn = function (tSec) { return { compSec: Math.max(0, tSec), isSpeedup: false }; };
            var compDuration = duration;

            if (telemetryAnalysis.speedupIntervals.length > 0 && telemetryAnalysis.totalSavedSec > 0.05) {
                try {
                    videoLayer.timeRemapEnabled = true;
                    var trProp = videoLayer.property("ADBE Time Remapping");
                    // Safe AE fix: never delete Key 1 (last remaining keyframe throws)
                    while (trProp.numKeys > 1) {
                        trProp.removeKey(trProp.numKeys);
                    }
                    trProp.setValueAtTime(0, 0);

                    for (var ty = 0; ty < telemetryAnalysis.speedupIntervals.length; ty++) {
                        var tSeg = telemetryAnalysis.speedupIntervals[ty];
                        var rawStartSec = Math.max(0, Math.min(duration, tSeg.startMs / 1000.0));
                        var rawEndSec = Math.max(rawStartSec, Math.min(duration, tSeg.endMs / 1000.0));
                        var mappedStart = telemetryAnalysis.timeMapFn(rawStartSec).compSec;
                        var mappedEnd = telemetryAnalysis.timeMapFn(rawEndSec).compSec;
                        if (mappedStart > 0.001) trProp.setValueAtTime(mappedStart, rawStartSec);
                        if (mappedEnd > mappedStart + 0.001) trProp.setValueAtTime(mappedEnd, rawEndSec);
                    }
                    trProp.setValueAtTime(plannedCompDuration, Math.max(0, duration - frameDurSec * 0.5));

                    for (var trk = 1; trk <= trProp.numKeys; trk++) {
                        try { trProp.setInterpolationTypeAtKey(trk, KeyframeInterpolationType.LINEAR); } catch (eLin) {}
                    }
                    videoLayer.outPoint = plannedCompDuration;
                    timeRemapApplied = true;
                    activeTimeMapFn = telemetryAnalysis.timeMapFn;
                    compDuration = plannedCompDuration;
                } catch (eTr) {
                    try { videoLayer.timeRemapEnabled = false; } catch (eOff) {}
                    comp.duration = duration;
                    compDuration = duration;
                    timeRemapApplied = false;
                }
            } else {
                comp.duration = duration;
                compDuration = duration;
            }

            // 9. Add Single Aligned Window Matte Shape Layer
            currentStep = "Creating window matte layer";
            var matteLayer = comp.layers.addShape();
            matteLayer.name = "TraceMotion_Window_Matte";
            matteLayer.parent = cameraRig;
            matteLayer.transform.anchorPoint.setValue([0, 0]);
            matteLayer.transform.position.setValue([0, 0]);
            matteLayer.transform.scale.setValue([100, 100]);

            var mGrp = matteLayer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
            mGrp.name = "Window Matte Shape";

            var mRect = SafeProp.findFresh(matteLayer, ["ADBE Root Vectors Group", "Window Matte Shape", "ADBE Vectors Group"]).addProperty("ADBE Vector Shape - Rect");
            mRect.property("ADBE Vector Rect Size").setValue([footageW, footageH]);
            mRect.property("ADBE Vector Rect Position").setValue([footageW / 2, footageH / 2]);
            mRect.property("ADBE Vector Rect Roundness").expression =
                "thisComp.layer('" + controller.name + "').effect('Corner Radius')('Slider');";

            var mFill = SafeProp.findFresh(matteLayer, ["ADBE Root Vectors Group", "Window Matte Shape", "ADBE Vectors Group"]).addProperty("ADBE Vector Graphic - Fill");
            mFill.property("ADBE Vector Fill Color").setValue([1.0, 1.0, 1.0, 1.0]);

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

            // 10. Original main.jsx Spring Physics Solver (Locked 1:1 to activeTimeMapFn)
            currentStep = "Simulating spring cursor trajectory";
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
                    xSpring.value = target.cx; xSpring.velocity = 0;
                    ySpring.value = target.cy; ySpring.velocity = 0;
                    smX = target.cx; smY = target.cy;
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

            // 11. Smart Zoom & Pan Trajectory (Guaranteed Smooth Zoom-Out Recovery!)
            currentStep = "Generating camera zoom keyframes";
            var targetZoomScale = Math.max(1.0, (options.zoomDepthScale || 1.8));

            if (options.zoomMode === "auto-cluster") {
                var clusters = buildRecordlyZoomClusters(
                    rawSamples,
                    duration,
                    targetZoomScale,
                    telemetryAnalysis.typingIntervals,
                    telemetryAnalysis.scrollIntervals,
                    {
                        includeBaseAutoZoom: true,
                        enableTypingZoom: enableTypingZoom,
                        enableScrollZoom: enableScrollZoom
                    }
                );
                applyZoomSegmentsToController(controller, clusters, activeTimeMapFn, compDuration, footageW, footageH, targetZoomScale);
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

                    // During typing with Typing Auto-Zoom & Follow enabled, pull focus directly to typing location
                    var inTypingFollow = false;
                    if (enableTypingZoom && telemetryAnalysis.typingIntervals.length > 0) {
                        for (var tf = 0; tf < telemetryAnalysis.typingIntervals.length; tf++) {
                            var tiSeg = telemetryAnalysis.typingIntervals[tf];
                            if (kPoint.timeMs >= tiSeg.startMs && kPoint.timeMs <= tiSeg.endMs) {
                                currentFocusX = ptX;
                                currentFocusY = ptY;
                                inTypingFollow = true;
                                break;
                            }
                        }
                    }

                    if (!inTypingFollow) {
                        var safeL = currentFocusX - halfSpanX + insetX;
                        var safeR = currentFocusX + halfSpanX - insetX;
                        var safeT = currentFocusY - halfSpanY + insetY;
                        var safeB = currentFocusY + halfSpanY - insetY;

                        if (ptX < safeL) currentFocusX = ptX + (halfSpanX - insetX);
                        else if (ptX > safeR) currentFocusX = ptX - (halfSpanX - insetX);
                        if (ptY < safeT) currentFocusY = ptY + (halfSpanY - insetY);
                        else if (ptY > safeB) currentFocusY = ptY - (halfSpanY - insetY);
                    }

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
                // Static mode: stays 100% unless additive Typing/Scroll Auto-Zoom is explicitly enabled
                if (enableTypingZoom || enableScrollZoom) {
                    var additiveClusters = buildRecordlyZoomClusters(
                        rawSamples,
                        duration,
                        targetZoomScale,
                        telemetryAnalysis.typingIntervals,
                        telemetryAnalysis.scrollIntervals,
                        {
                            includeBaseAutoZoom: false,
                            enableTypingZoom: enableTypingZoom,
                            enableScrollZoom: enableScrollZoom
                        }
                    );
                    applyZoomSegmentsToController(controller, additiveClusters, activeTimeMapFn, compDuration, footageW, footageH, targetZoomScale);
                } else {
                    controller.effect("Zoom Scale")("Slider").setValue(100);
                    controller.effect("Camera Focus")("Point").setValue([footageW / 2, footageH / 2]);
                }
            }

            // 12. Master Cursor Null (Restored main.jsx Position Curves, Velocity Sway & Click Bounce)
            currentStep = "Creating master cursor null";
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

            // Live Sync Offset expression on position
            masterPosProp.expression =
                "var off = thisComp.layer('" + controller.name + "').effect('Cursor Sync Offset (ms)')('Slider') / 1000.0;\n" +
                "valueAtTime(Math.max(0, time - off));";

            // Restored main.jsx Dynamic Velocity Sway (Tilt Rotation) — sync-offset safe!
            if (options.enableVelocitySway !== false) {
                cursorMaster.transform.rotation.expression =
                    "var ctrl = thisComp.layer('" + controller.name + "');\n" +
                    "var swayMaxDeg = 10.0 * ctrl.effect('Cursor Sway')('Slider');\n" +
                    "var off = ctrl.effect('Cursor Sync Offset (ms)')('Slider') / 1000.0;\n" +
                    "var tEval = Math.max(0, time - off);\n" +
                    "var vx = transform.position.velocityAtTime(tEval)[0];\n" +
                    "if (vx === 0 && tEval > thisComp.frameDuration) {\n" +
                    "    var dt = thisComp.frameDuration;\n" +
                    "    vx = (transform.position.valueAtTime(tEval)[0] - transform.position.valueAtTime(tEval - dt)[0]) / dt;\n" +
                    "}\n" +
                    "var normVx = Math.max(-1.0, Math.min(1.0, vx / 2200.0));\n" +
                    "-normVx * swayMaxDeg;";
            }

            // Restored main.jsx Click Bounce Compression (84% dip -> 104% overshoot -> 100%)
            if (options.enableClickBounce !== false && clickSamplesList.length > 0) {
                var scaleProp = cursorMaster.transform.scale;
                scaleProp.setValue([100, 100]);
                for (var ci = 0; ci < clickSamplesList.length; ci++) {
                    var cSample = clickSamplesList[ci];
                    var mappedClickSec = activeTimeMapFn(cSample.timeMs / 1000.0).compSec;
                    if (mappedClickSec > 0.02) scaleProp.setValueAtTime(mappedClickSec - 0.016, [100, 100]);
                    scaleProp.setValueAtTime(mappedClickSec, [100, 100]);
                    scaleProp.setValueAtTime(mappedClickSec + 0.045, [84.0, 84.0]);
                    scaleProp.setValueAtTime(mappedClickSec + 0.160, [104.0, 104.0]);
                    scaleProp.setValueAtTime(mappedClickSec + 0.350, [100, 100]);
                }
                scaleProp.expression =
                    "var off = thisComp.layer('" + controller.name + "').effect('Cursor Sync Offset (ms)')('Slider') / 1000.0;\n" +
                    "valueAtTime(Math.max(0, time - off));";
            }

            // 13. Multi-State Cursor Stack
            currentStep = "Building multi-state cursor stack";
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
                if (!assetFile || !assetFile.exists) assetFile = getCursorAssetFile(styleKey, "arrow", false);
                if (!assetFile || !assetFile.exists) continue;

                var cursorItem = proj.importFile(new ImportOptions(assetFile));
                var cLayer = comp.layers.add(cursorItem);
                cLayer.name = "Cursor_" + stateName;
                cLayer.parent = cursorMaster;
                cLayer.motionBlur = options.enableMotionBlur !== false;

                var anchorMeta = (styleDef.cursors && styleDef.cursors[stateName]) || { anchorX: 0.34, anchorY: 0.24 };
                var useAltAnchor = (anchorMeta.altPng && assetFile.name === anchorMeta.altPng && anchorMeta.altAnchorX !== undefined);
                var ax = useAltAnchor ? anchorMeta.altAnchorX : anchorMeta.anchorX;
                var ay = useAltAnchor ? anchorMeta.altAnchorY : anchorMeta.anchorY;
                cLayer.transform.anchorPoint.setValue([cursorItem.width * ax, cursorItem.height * ay]);
                cLayer.transform.position.setValue([0, 0]);

                var targetH = (stateName === "text" || stateName.indexOf("resize") >= 0) ? (baseCursorHeight * 1.15) : baseCursorHeight;
                var sPercent = (targetH / cursorItem.height) * 100.0;
                cLayer.transform.scale.setValue([sPercent, sPercent]);

                cursorStateLayers[stateName] = cLayer;
                cLayer.transform.opacity.setValueAtTime(0, (stateName === "arrow") ? 100.0 : 0.0);
            }

            if (getObjectKeys(cursorStateLayers).length === 0) {
                cursorStateLayers.arrow = createProceduralCursorLayer(comp, cursorMaster, baseCursorHeight, options.enableMotionBlur !== false);
            }

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

                var stateSyncExpr =
                    "var off = thisComp.layer('" + controller.name + "').effect('Cursor Sync Offset (ms)')('Slider') / 1000.0;\n" +
                    "valueAtTime(Math.max(0, time - off));";

                for (var runI = 0; runI < stateRuns.length; runI++) {
                    var run = stateRuns[runI];
                    var activeState = cursorStateLayers[run.state] ? run.state : "arrow";
                    for (var sKey in cursorStateLayers) {
                        if (cursorStateLayers.hasOwnProperty(sKey)) {
                            var opProp = cursorStateLayers[sKey].transform.opacity;
                            opProp.setValueAtTime(run.startSec, (sKey === activeState) ? 100.0 : 0.0);
                            try {
                                opProp.setInterpolationTypeAtKey(opProp.nearestKeyIndex(run.startSec), KeyframeInterpolationType.HOLD);
                            } catch (eHold) {}
                        }
                    }
                }
                for (var sKey2 in cursorStateLayers) {
                    if (cursorStateLayers.hasOwnProperty(sKey2)) {
                        SafeProp.setExpression(cursorStateLayers[sKey2].transform.opacity, stateSyncExpr);
                    }
                }
            }

            // 14. Two-Tier Studio Click Ripple VFX Layer (Zero Stale Refs, Synced to Time Remap)
            currentStep = "Generating click ripples";
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
                var syncExpr =
                    "var off = thisComp.layer('" + controller.name + "').effect('Cursor Sync Offset (ms)')('Slider') / 1000.0;\n" +
                    "valueAtTime(Math.max(0, time - off));";

                for (var rc = 0; rc < clickSamplesList.length; rc++) {
                    var clickSample = clickSamplesList[rc];
                    var mappedClickStart = activeTimeMapFn(clickSample.timeMs / 1000.0).compSec;
                    var isDouble = (clickSample.interactionType === "double-click");
                    var ringMaxDiam = isDouble ? (maxRadius * 2.4) : (maxRadius * 2.1);
                    var discMaxDiam = isDouble ? (maxRadius * 1.05) : (maxRadius * 0.9);
                    var tInnerEnd = mappedClickStart + 0.240;
                    var tOuterEnd = mappedClickStart + 0.520;

                    var simPos = interpolateCursorPosition(simulatedPath, clickSample.timeMs);
                    var rippleX = (simPos ? simPos.cx : clickSample.cx) * footageW;
                    var rippleY = (simPos ? simPos.cy : clickSample.cy) * footageH;

                    var rGroupName = "Ripple_" + (rc + 1);
                    var rGroup = rippleLayer.property("ADBE Root Vectors Group").addProperty("ADBE Vector Group");
                    rGroup.name = rGroupName;

                    var rTrans = SafeProp.findFresh(rippleLayer, ["ADBE Root Vectors Group", rGroupName, "ADBE Vector Transform Group"]);
                    rTrans.property("ADBE Vector Position").setValue([rippleX, rippleY]);
                    rTrans.property("ADBE Vector Anchor").setValue([0, 0]);

                    // Tier 1: Inner Soft Pop Disc
                    var innerGrp = SafeProp.findFresh(rippleLayer, ["ADBE Root Vectors Group", rGroupName, "ADBE Vectors Group"]).addProperty("ADBE Vector Group");
                    innerGrp.name = "Inner_Pop";

                    var inEll = SafeProp.findFresh(rippleLayer, ["ADBE Root Vectors Group", rGroupName, "ADBE Vectors Group", "Inner_Pop", "ADBE Vectors Group"]).addProperty("ADBE Vector Shape - Ellipse");
                    var inEllSize = inEll.property("ADBE Vector Ellipse Size");
                    inEllSize.setValueAtTime(0, [0, 0]);
                    if (mappedClickStart > frameDurSec) inEllSize.setValueAtTime(mappedClickStart - frameDurSec, [0, 0]);
                    inEllSize.setValueAtTime(mappedClickStart, [4, 4]);
                    inEllSize.setValueAtTime(tInnerEnd, [discMaxDiam, discMaxDiam]);
                    inEllSize.setValueAtTime(tInnerEnd + frameDurSec, [0, 0]);
                    try {
                        inEllSize.setInterpolationTypeAtKey(inEllSize.nearestKeyIndex(0), KeyframeInterpolationType.HOLD);
                        if (mappedClickStart > frameDurSec) inEllSize.setInterpolationTypeAtKey(inEllSize.nearestKeyIndex(mappedClickStart - frameDurSec), KeyframeInterpolationType.HOLD);
                        SafeProp.setTemporalEase(inEllSize, inEllSize.nearestKeyIndex(mappedClickStart), cubicEaseIn, cubicEaseOut);
                        SafeProp.setTemporalEase(inEllSize, inEllSize.nearestKeyIndex(tInnerEnd), cubicEaseOut, cubicEaseIn);
                        inEllSize.expression = syncExpr;
                    } catch (eInE) {}

                    var inFill = SafeProp.findFresh(rippleLayer, ["ADBE Root Vectors Group", rGroupName, "ADBE Vectors Group", "Inner_Pop", "ADBE Vectors Group"]).addProperty("ADBE Vector Graphic - Fill");
                    inFill.property("ADBE Vector Fill Color").setValue([rgbColor[0], rgbColor[1], rgbColor[2], 1.0]);
                    var inFillOp = inFill.property("ADBE Vector Fill Opacity");
                    inFillOp.setValueAtTime(0, 0.0);
                    if (mappedClickStart > frameDurSec) inFillOp.setValueAtTime(mappedClickStart - frameDurSec, 0.0);
                    inFillOp.setValueAtTime(mappedClickStart, 42.0);
                    inFillOp.setValueAtTime(tInnerEnd, 0.0);
                    inFillOp.setValueAtTime(tInnerEnd + frameDurSec, 0.0);
                    try {
                        inFillOp.setInterpolationTypeAtKey(inFillOp.nearestKeyIndex(0), KeyframeInterpolationType.HOLD);
                        if (mappedClickStart > frameDurSec) inFillOp.setInterpolationTypeAtKey(inFillOp.nearestKeyIndex(mappedClickStart - frameDurSec), KeyframeInterpolationType.HOLD);
                        inFillOp.expression = syncExpr;
                    } catch (eInO) {}

                    // Tier 2: Outer Expanding Shockwave Ring
                    var outerGrp = SafeProp.findFresh(rippleLayer, ["ADBE Root Vectors Group", rGroupName, "ADBE Vectors Group"]).addProperty("ADBE Vector Group");
                    outerGrp.name = "Outer_Ring";

                    var outEll = SafeProp.findFresh(rippleLayer, ["ADBE Root Vectors Group", rGroupName, "ADBE Vectors Group", "Outer_Ring", "ADBE Vectors Group"]).addProperty("ADBE Vector Shape - Ellipse");
                    var outEllSize = outEll.property("ADBE Vector Ellipse Size");
                    outEllSize.setValueAtTime(0, [0, 0]);
                    if (mappedClickStart > frameDurSec) outEllSize.setValueAtTime(mappedClickStart - frameDurSec, [0, 0]);
                    outEllSize.setValueAtTime(mappedClickStart, [6, 6]);
                    outEllSize.setValueAtTime(tOuterEnd, [ringMaxDiam, ringMaxDiam]);
                    outEllSize.setValueAtTime(tOuterEnd + frameDurSec, [0, 0]);
                    try {
                        outEllSize.setInterpolationTypeAtKey(outEllSize.nearestKeyIndex(0), KeyframeInterpolationType.HOLD);
                        if (mappedClickStart > frameDurSec) outEllSize.setInterpolationTypeAtKey(outEllSize.nearestKeyIndex(mappedClickStart - frameDurSec), KeyframeInterpolationType.HOLD);
                        SafeProp.setTemporalEase(outEllSize, outEllSize.nearestKeyIndex(mappedClickStart), cubicEaseIn, cubicEaseOut);
                        SafeProp.setTemporalEase(outEllSize, outEllSize.nearestKeyIndex(tOuterEnd), cubicEaseOut, cubicEaseIn);
                        outEllSize.expression = syncExpr;
                    } catch (eOutE) {}

                    var outStroke = SafeProp.findFresh(rippleLayer, ["ADBE Root Vectors Group", rGroupName, "ADBE Vectors Group", "Outer_Ring", "ADBE Vectors Group"]).addProperty("ADBE Vector Graphic - Stroke");
                    outStroke.property("ADBE Vector Stroke Color").setValue([rgbColor[0], rgbColor[1], rgbColor[2], 1.0]);
                    var outStrokeW = outStroke.property("ADBE Vector Stroke Width");
                    outStrokeW.setValueAtTime(mappedClickStart, 4.2);
                    outStrokeW.setValueAtTime(tOuterEnd, 0.5);
                    try { outStrokeW.expression = syncExpr; } catch (eSW) {}

                    var outStrokeOp = outStroke.property("ADBE Vector Stroke Opacity");
                    outStrokeOp.setValueAtTime(0, 0.0);
                    if (mappedClickStart > frameDurSec) outStrokeOp.setValueAtTime(mappedClickStart - frameDurSec, 0.0);
                    outStrokeOp.setValueAtTime(mappedClickStart, 92.0);
                    outStrokeOp.setValueAtTime(mappedClickStart + 0.140, 75.0);
                    outStrokeOp.setValueAtTime(tOuterEnd, 0.0);
                    outStrokeOp.setValueAtTime(tOuterEnd + frameDurSec, 0.0);
                    try {
                        outStrokeOp.setInterpolationTypeAtKey(outStrokeOp.nearestKeyIndex(0), KeyframeInterpolationType.HOLD);
                        if (mappedClickStart > frameDurSec) outStrokeOp.setInterpolationTypeAtKey(outStrokeOp.nearestKeyIndex(mappedClickStart - frameDurSec), KeyframeInterpolationType.HOLD);
                        outStrokeOp.expression = syncExpr;
                    } catch (eOutO) {}
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
                    (timeRemapApplied ? ("- 2.0x Speed-Up Applied: " + telemetryAnalysis.speedupIntervals.length + " segment(s) (Typing: " + (enableTypingSpeedup ? "On" : "Off") + ", Scroll: " + (enableScrollSpeedup ? "On" : "Off") + ")\n") : ""),
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
                    "TraceMotion Build Error at [" + currentStep + "]:\n" + e.toString() +
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
    // Helper: Draw Rounded Rectangle Path in ScriptUI Graphics (AE 2020+ Safe)
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
    // Fully Responsive ScriptUI Studio Panel (AE CC 2020 - 2026+)
    // =========================================================================
    function buildUI(thisObj) {
        var isPanel = (thisObj instanceof Panel) || (thisObj && typeof thisObj.toString === "function" && thisObj.toString().indexOf("Panel") >= 0);
        var win = isPanel
            ? thisObj
            : new Window("palette", "TraceMotion Studio", [0, 0, 350, 650], { resizeable: true });

        win.margins = 0;
        win.spacing = 0;

        try {
            var bgCol = [0.105, 0.110, 0.133, 1.0];
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

        var optTypingSpeedup = getBoolPref("enableTypingSpeedup", true);
        var optTypingZoom = getBoolPref("enableTypingZoom", true);
        var optScrollSpeedup = getBoolPref("enableScrollSpeedup", true);
        var optScrollZoom = getBoolPref("enableScrollZoom", true);

        var selectedVideoFile = null;
        var selectedJsonFile = null;
        var previewCursorImg = null;
        var previewBgImg = null;
        var bgImageCache = {};
        var isSyncingBg = false;
        var stageClickPos = { nx: 0.58, ny: 0.56, hasRipple: true };

        var hudFont = null;
        var tabFontBold = null;
        var tabFontReg = null;
        try {
            hudFont = ScriptUI.newFont("Verdana", "Bold", 9);
            tabFontBold = ScriptUI.newFont("Verdana", "Bold", 10);
            tabFontReg = ScriptUI.newFont("Verdana", "Regular", 10);
        } catch (eF) {}

        function refreshPreviewAssets() {
            var cF = getCursorPreviewFile(currentCursorKey);
            if (cF && cF.exists && cF.name.toLowerCase().indexOf(".png") > 0) {
                try { previewCursorImg = ScriptUI.newImage(cF); } catch (e) { previewCursorImg = null; }
            } else {
                previewCursorImg = null;
            }

            if (currentBgKey === "none" || currentBgKey === "dark-studio" || BACKGROUND_PRESETS[currentBgKey]) {
                previewBgImg = null;
            } else if (bgImageCache[currentBgKey] !== undefined) {
                previewBgImg = bgImageCache[currentBgKey];
            } else {
                var wF = getWallpaperAssetFile(currentBgKey.indexOf(".") > 0 ? currentBgKey : (currentBgKey + ".jpg"));
                if (wF && wF.exists) {
                    try {
                        previewBgImg = ScriptUI.newImage(wF);
                        bgImageCache[currentBgKey] = previewBgImg;
                    } catch (eBg) {
                        previewBgImg = null;
                        bgImageCache[currentBgKey] = null;
                    }
                } else {
                    previewBgImg = null;
                    bgImageCache[currentBgKey] = null;
                }
            }
        }
        refreshPreviewAssets();

        // ---------------------------------------------------------------------
        // BAND 1: STICKY HEADER
        // ---------------------------------------------------------------------
        var headerGrp = win.add("group", [10, 6, 340, 38]);
        headerGrp.orientation = "row";
        headerGrp.alignChildren = ["left", "center"];
        headerGrp.spacing = 8;
        headerGrp.margins = 0;

        var emblemBtn = headerGrp.add("button", [0, 0, 26, 26], "");
        emblemBtn.preferredSize = [26, 26];
        emblemBtn.minimumSize = [26, 26];
        emblemBtn.maximumSize = [26, 26];
        emblemBtn.onDraw = function () {
            try {
                var g = this.graphics;
                drawRoundedRectPath(g, 0, 0, 26, 26, 6);
                g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [0.145, 0.388, 0.922, 1.0]));
                g.newPath();
                g.moveTo(5, 6); g.lineTo(21, 6); g.lineTo(21, 18); g.lineTo(5, 18); g.closePath();
                g.strokePath(g.newPen(g.PenType.SOLID_COLOR, [1.0, 1.0, 1.0, 0.80], 1.4));
                g.newPath();
                g.moveTo(11, 10); g.lineTo(18, 13.5); g.lineTo(14.5, 15.2); g.lineTo(13, 19); g.closePath();
                g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [1.0, 1.0, 1.0, 1.0]));
            } catch (eEm) {}
        };

        var titleCol = headerGrp.add("group");
        titleCol.orientation = "column";
        titleCol.alignChildren = ["left", "center"];
        titleCol.alignment = ["fill", "center"];
        titleCol.spacing = 1;

        var titleTxt = titleCol.add("statictext", undefined, "TraceMotion Studio");
        try { titleTxt.graphics.font = ScriptUI.newFont("Verdana", "Bold", 12); } catch (e) {}
        try { titleTxt.graphics.foregroundColor = titleTxt.graphics.newPen(titleTxt.graphics.PenType.SOLID_COLOR, [0.96, 0.97, 0.99, 1.0], 1); } catch (e) {}

        var subTxt = titleCol.add("statictext", undefined, "Recordly Framing & Cursor Rig");
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
        // BAND 2: LIVE INTERACTIVE PREVIEW CANVAS (Owner-Drawn Button)
        // ---------------------------------------------------------------------
        var previewCanvas = win.add("button", [10, 44, 340, 168], "");

        function redrawPreview() {
            try { previewCanvas.notify("onDraw"); } catch (e1) {}
            try { win.update(); } catch (e2) {}
        }

        previewCanvas.onDraw = function () {
            try {
                var g = this.graphics;
                var w = (this.size && this.size[0] > 10) ? this.size[0] : (this.bounds ? (this.bounds[2] - this.bounds[0]) : 320);
                var h = (this.size && this.size[1] > 10) ? this.size[1] : (this.bounds ? (this.bounds[3] - this.bounds[1]) : 124);
                if (w < 20 || h < 20) return;

                var wpMeta = getWallpaperMeta(currentBgKey);
                var bgStart = wpMeta.start || [0.231, 0.510, 0.965];
                var bgEnd = wpMeta.end || [0.545, 0.361, 0.965];
                var activeFont = hudFont || g.font;

                // Compact Strip Mode when height <= 52px (short horizontal dock)
                if (h <= 52) {
                    drawRoundedRectPath(g, 0, 0, w - 1, h - 1, 6);
                    g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [0.145, 0.155, 0.185, 1.0]));
                    drawRoundedRectPath(g, 0, 0, w - 1, h - 1, 6);
                    g.strokePath(g.newPen(g.PenType.SOLID_COLOR, [1.0, 1.0, 1.0, 0.16], 1));

                    var swBrush = g.newBrush(g.BrushType.SOLID_COLOR, currentBgKey === "none" ? [0.22, 0.24, 0.28, 1.0] : [bgStart[0], bgStart[1], bgStart[2], 1.0]);
                    drawRoundedRectPath(g, 8, Math.round((h - 20) / 2), 20, 20, 4);
                    g.fillPath(swBrush);

                    var summaryStr = "Preview: " + wpMeta.label + " | " + (currentZoomMode === "static" ? "Static" : (currentZoomScale.toFixed(2) + "x")) + " | " + currentCornerRadius + "px";
                    var sm = g.measureString(summaryStr, activeFont);
                    var smY = Math.max(2, Math.round((h - sm[1]) / 2));
                    g.drawString(summaryStr, g.newPen(g.PenType.SOLID_COLOR, [0.92, 0.94, 0.98, 1.0], 1), 36, smY, activeFont);
                    return;
                }

                // 1. Background Render (Wallpaper Image -> Gradient -> Checkerboard for None)
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
                    var drewBgImg = false;
                    if (previewBgImg) {
                        try {
                            g.drawImage(previewBgImg, 0, 0, w, h);
                            drewBgImg = true;
                        } catch (eBgDraw) {
                            drewBgImg = false;
                        }
                    }
                    if (!drewBgImg) {
                        var steps = 28;
                        var sw = w / steps;
                        for (var si = 0; si < steps; si++) {
                            var t = si / (steps - 1);
                            var rCol = bgStart[0] + (bgEnd[0] - bgStart[0]) * t;
                            var gCol = bgStart[1] + (bgEnd[1] - bgStart[1]) * t;
                            var bCol = bgStart[2] + (bgEnd[2] - bgStart[2]) * t;
                            g.rectPath(Math.floor(si * sw), 0, Math.ceil(sw) + 1, h);
                            g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [rCol, gCol, bCol, 1.0]));
                        }
                    }
                }

                // 2. Floating Desktop Window (Reacts Live to Margin, Corner Radius & Drop Shadow)
                var topHudClearance = 24;
                var availH = Math.max(36, h - topHudClearance - 6);
                var marginFrac = 0.06 + (currentMargin / 100.0) * 0.65;
                var winW = Math.max(56, Math.round(w * (1.0 - marginFrac)));
                var winH = Math.max(34, Math.round(availH * (1.0 - marginFrac * 0.6)));
                var winX = Math.round((w - winW) / 2);
                var winY = topHudClearance + Math.round((availH - winH) / 2);
                var scaledRad = Math.round(currentCornerRadius * 0.36);

                if (currentShadow > 0) {
                    var shA1 = (currentShadow / 100.0) * 0.28;
                    var shA2 = (currentShadow / 100.0) * 0.44;
                    var shSp = Math.round(3 + (currentShadow / 100.0) * 5);
                    drawRoundedRectPath(g, winX - 2, winY + shSp, winW + 4, winH + 2, scaledRad + 2);
                    g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [0, 0, 0, shA1]));
                    drawRoundedRectPath(g, winX + 1, winY + Math.round(shSp * 0.55), winW, winH, scaledRad);
                    g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [0, 0, 0, shA2]));
                }

                drawRoundedRectPath(g, winX, winY, winW, winH, scaledRad);
                g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [0.082, 0.090, 0.114, 1.0]));

                var tbH = Math.min(13, Math.round(winH * 0.22));
                drawRoundedRectPath(g, winX, winY, winW, tbH, Math.min(scaledRad, 4));
                g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [0.130, 0.142, 0.176, 1.0]));

                var dotY = winY + Math.max(2, Math.round((tbH - 5) / 2));
                g.ellipsePath(winX + 7, dotY, 5, 5); g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [1.0, 0.37, 0.34, 1.0]));
                g.ellipsePath(winX + 15, dotY, 5, 5); g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [1.0, 0.74, 0.18, 1.0]));
                g.ellipsePath(winX + 23, dotY, 5, 5); g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [0.16, 0.78, 0.25, 1.0]));

                // Mock App UI Content
                var contentY = winY + tbH + 4;
                var contentH = Math.max(10, winH - tbH - 8);
                var sideW = Math.round(winW * 0.24);
                var cardBrush = g.newBrush(g.BrushType.SOLID_COLOR, [0.13, 0.145, 0.185, 1.0]);
                g.rectPath(winX + 6, contentY, sideW, contentH);
                g.fillPath(cardBrush);
                g.rectPath(winX + 10, contentY + 4, Math.max(6, sideW - 8), 3);
                g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [0.145, 0.388, 0.922, 0.65]));

                var mainX = winX + sideW + 10;
                var mainW = Math.max(18, winW - sideW - 16);
                g.rectPath(mainX, contentY, mainW, contentH);
                g.fillPath(cardBrush);
                var cardGap = 4;
                var subCardW = Math.max(8, Math.round((mainW - cardGap * 3) / 2));
                var subCardH = Math.max(6, Math.round(contentH * 0.48));
                var subCardY = contentY + Math.max(3, Math.round(contentH * 0.36));
                g.rectPath(mainX + cardGap, subCardY, subCardW, subCardH);
                g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [1.0, 1.0, 1.0, 0.07]));
                g.rectPath(mainX + cardGap * 2 + subCardW, subCardY, subCardW, subCardH);
                g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [0.145, 0.388, 0.922, 0.25]));

                drawRoundedRectPath(g, winX, winY, winW, winH, scaledRad);
                g.strokePath(g.newPen(g.PenType.SOLID_COLOR, [1.0, 1.0, 1.0, 0.22], 1));

                // 3. 2-Tier Concentric Click Ripple Preview
                var curX = Math.round(winX + winW * stageClickPos.nx);
                var curY = Math.round(winY + winH * stageClickPos.ny);
                var cScale = Math.max(0.6, Math.min(1.8, currentCursorSize / 100.0));

                if (stageClickPos.hasRipple && currentRippleColor !== "none") {
                    var rHex = currentRippleColor.indexOf("#") === 0 ? currentRippleColor : "#2563EB";
                    var rRgb = hexToRgb(rHex);
                    var innerD = Math.round(14 * cScale);
                    var outerD = Math.round(30 * cScale);
                    g.ellipsePath(curX - innerD / 2, curY - innerD / 2, innerD, innerD);
                    g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [rRgb[0], rRgb[1], rRgb[2], 0.35]));
                    g.ellipsePath(curX - outerD / 2, curY - outerD / 2, outerD, outerD);
                    g.strokePath(g.newPen(g.PenType.SOLID_COLOR, [rRgb[0], rRgb[1], rRgb[2], 0.92], 1.8));
                }

                // 4. Cursor Sprite Preview
                var drewPng = false;
                if (previewCursorImg) {
                    try {
                        var imgSz = Math.round(20 * cScale);
                        g.drawImage(previewCursorImg, curX - Math.round(imgSz * 0.25), curY - Math.round(imgSz * 0.15), imgSz, imgSz);
                        drewPng = true;
                    } catch (eImgC) { drewPng = false; }
                }
                if (!drewPng) {
                    var cs = cScale;
                    g.newPath();
                    if (currentCursorKey === "custom") {
                        g.moveTo(curX, curY);
                        g.lineTo(curX + 5.5 * cs, curY + 15.5 * cs);
                        g.lineTo(curX + 8.0 * cs, curY + 9.5 * cs);
                        g.lineTo(curX + 14.5 * cs, curY + 7.2 * cs);
                        g.closePath();
                    } else {
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
                    g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, isDarkFill ? [0.06, 0.07, 0.09, 1.0] : [1.0, 1.0, 1.0, 1.0]));
                    g.strokePath(g.newPen(g.PenType.SOLID_COLOR, isDarkFill ? [1.0, 1.0, 1.0, 1.0] : [0.08, 0.09, 0.12, 1.0], 1.4));
                }

                // 5. Cleanly Aligned Top Preview Header Pills (Never Overlap or Clip!)
                var pillY = 5;
                var pillH = 18;
                var hudBg = g.newBrush(g.BrushType.SOLID_COLOR, [0.04, 0.05, 0.08, 0.72]);

                var zBadgeStr = (currentZoomMode === "static") ? "1.00x Static" : (currentZoomScale.toFixed(2) + "x " + (currentZoomMode === "continuous" ? "Follow" : "Auto"));
                var zm = g.measureString(zBadgeStr, activeFont);
                var zBoxW = Math.min(Math.round(w * 0.44), Math.round(zm[0]) + 14);
                var zBoxX = w - zBoxW - 6;

                var leftLabel = (w >= 280) ? ("Preview: " + wpMeta.label) : "Preview";
                var lm = g.measureString(leftLabel, activeFont);
                var maxLeftW = Math.max(54, zBoxX - 12);
                var lBoxW = Math.min(maxLeftW, Math.round(lm[0]) + 14);
                if (lm[0] + 14 > maxLeftW) {
                    leftLabel = "Preview";
                    lm = g.measureString(leftLabel, activeFont);
                    lBoxW = Math.min(maxLeftW, Math.round(lm[0]) + 14);
                }

                drawRoundedRectPath(g, 6, pillY, lBoxW, pillH, 4);
                g.fillPath(hudBg);
                var lTextY = pillY + Math.max(1, Math.round((pillH - lm[1]) / 2));
                g.drawString(leftLabel, g.newPen(g.PenType.SOLID_COLOR, [0.95, 0.96, 1.0, 1.0], 1), 13, lTextY, activeFont);

                drawRoundedRectPath(g, zBoxX, pillY, zBoxW, pillH, 4);
                g.fillPath(hudBg);
                var zTextX = zBoxX + Math.max(4, Math.round((zBoxW - zm[0]) / 2));
                var zTextY = pillY + Math.max(1, Math.round((pillH - zm[1]) / 2));
                g.drawString(zBadgeStr, g.newPen(g.PenType.SOLID_COLOR, [0.42, 0.72, 1.0, 1.0], 1), zTextX, zTextY, activeFont);

                g.rectPath(0, 0, w - 1, h - 1);
                g.strokePath(g.newPen(g.PenType.SOLID_COLOR, [1.0, 1.0, 1.0, 0.16], 1));
            } catch (eStage) {}
        };

        previewCanvas.onClick = function () {
            stageClickPos.nx = 0.25 + Math.random() * 0.50;
            stageClickPos.ny = 0.35 + Math.random() * 0.45;
            stageClickPos.hasRipple = true;
            redrawPreview();
        };

        // ---------------------------------------------------------------------
        // BAND 3: 3-TAB BAR (Owner-Drawn Pills — Cleanly Centered, Zero Clipping!)
        // ---------------------------------------------------------------------
        var tabBar = win.add("group", [10, 174, 340, 202]);
        tabBar.margins = 0;
        tabBar.spacing = 0;

        var tabButtons = {};
        var tabOrder = ["setup", "cursor", "frame"];
        function createTabPill(id, label) {
            // Pass "" as native text so AE never renders overlapping native text behind onDraw
            var btn = tabBar.add("button", [0, 0, 100, 28], "");
            btn._tabId = id;
            btn._label = label;
            btn.onDraw = function () {
                try {
                    var g = this.graphics;
                    var w = (this.size && this.size[0] > 10) ? this.size[0] : (this.bounds ? (this.bounds[2] - this.bounds[0]) : 100);
                    var h = (this.size && this.size[1] > 10) ? this.size[1] : (this.bounds ? (this.bounds[3] - this.bounds[1]) : 28);
                    var isAct = (activeTab === this._tabId);
                    var fillCol = isAct ? [0.145, 0.388, 0.922, 1.0] : [0.165, 0.175, 0.205, 1.0];
                    var borderCol = isAct ? [0.40, 0.65, 1.0, 1.0] : [1.0, 1.0, 1.0, 0.14];
                    var txtCol = isAct ? [1.0, 1.0, 1.0, 1.0] : [0.80, 0.83, 0.90, 1.0];

                    drawRoundedRectPath(g, 0, 0, w - 1, h - 1, 5);
                    g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, fillCol));
                    drawRoundedRectPath(g, 0, 0, w - 1, h - 1, 5);
                    g.strokePath(g.newPen(g.PenType.SOLID_COLOR, borderCol, 1));

                    var fnt = (isAct ? tabFontBold : tabFontReg) || g.font;
                    var m = g.measureString(this._label, fnt);
                    var tx = Math.max(2, Math.round((w - m[0]) / 2));
                    var ty = Math.max(2, Math.round((h - m[1]) / 2));
                    g.drawString(this._label, g.newPen(g.PenType.SOLID_COLOR, txtCol, 1), tx, ty, fnt);
                } catch (ePill) {}
            };
            btn.onClick = function () {
                selectTab(id);
            };
            tabButtons[id] = btn;
            return btn;
        }

        createTabPill("setup", "Setup");
        createTabPill("cursor", "Cursor");
        createTabPill("frame", "Frame");

        // ---------------------------------------------------------------------
        // BAND 4: SCROLLABLE CLIPPED BODY VIEWPORT
        // ---------------------------------------------------------------------
        var bodyHost = win.add("group", [10, 208, 340, 600]);
        bodyHost.margins = 0;
        bodyHost.spacing = 0;

        var scrollViewport = bodyHost.add("group", [0, 0, 314, 392]);
        scrollViewport.margins = 0;
        scrollViewport.spacing = 0;

        var vScrollBar = bodyHost.add("scrollbar", [316, 0, 330, 392], 0, 0, 100);
        vScrollBar.visible = false;

        // =====================================================================
        // SECTION 1: SETUP CONTROLS
        // =====================================================================
        var tabSetup = scrollViewport.add("group", [0, 0, 314, 420]);
        tabSetup.orientation = "column";
        tabSetup.alignChildren = ["fill", "top"];
        tabSetup.spacing = 6;
        tabSetup.margins = [0, 2, 0, 8];

        var srcCard = tabSetup.add("panel", undefined, undefined, { borderStyle: "gray" });
        srcCard.orientation = "column";
        srcCard.alignChildren = ["fill", "top"];
        srcCard.spacing = 5;
        srcCard.margins = 8;

        var srcTitle = srcCard.add("statictext", undefined, "Capture Source");
        try { srcTitle.graphics.font = ScriptUI.newFont("Verdana", "Bold", 10); } catch (e) {}

        var vidRow = srcCard.add("group");
        vidRow.orientation = "row";
        vidRow.alignChildren = ["fill", "center"];
        vidRow.spacing = 6;

        var videoPathInput = vidRow.add("edittext", undefined, "");
        videoPathInput.alignment = ["fill", "center"];
        videoPathInput.preferredSize.height = 24;
        videoPathInput.minimumSize = [60, 24];

        var btnBrowseVid = vidRow.add("button", undefined, "Browse...");
        btnBrowseVid.preferredSize = [68, 24];
        btnBrowseVid.minimumSize = [58, 24];

        var syncBadgeRow = srcCard.add("group");
        syncBadgeRow.orientation = "row";
        syncBadgeRow.alignChildren = ["left", "center"];
        syncBadgeRow.spacing = 5;

        var syncText = syncBadgeRow.add("statictext", undefined, "Auto-pairs .cursor.json");
        syncText.alignment = ["fill", "center"];
        syncText.minimumSize = [50, 16];
        try { syncText.graphics.font = ScriptUI.newFont("Verdana", "Regular", 9); } catch (e) {}
        try { syncText.graphics.foregroundColor = syncText.graphics.newPen(syncText.graphics.PenType.SOLID_COLOR, [0.35, 0.85, 0.58, 1], 1); } catch (e) {}

        var btnRelinkJson = syncBadgeRow.add("button", undefined, "Relink");
        btnRelinkJson.preferredSize = [52, 20];
        btnRelinkJson.minimumSize = [46, 20];

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
        zoomRadioRow.spacing = 6;

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
        zDepthLbl.preferredSize.width = 74;

        var zDepthSlider = zDepthRow.add("slider", undefined, Math.round(currentZoomScale * 100), 120, 320);
        zDepthSlider.alignment = ["fill", "center"];
        zDepthSlider.minimumSize = [40, 18];

        var zDepthValTxt = zDepthRow.add("statictext", undefined, currentZoomScale.toFixed(2) + "x");
        zDepthValTxt.preferredSize.width = 40;

        function onZoomModeChanged() {
            if (radFollow.value) currentZoomMode = "continuous";
            else if (radStatic.value) currentZoomMode = "static";
            else currentZoomMode = "auto-cluster";
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
        feelRadioRow.spacing = 5;

        var radNatural = feelRadioRow.add("radiobutton", undefined, "Natural");
        var radSnappy = feelRadioRow.add("radiobutton", undefined, "Snappy");
        var radSilky = feelRadioRow.add("radiobutton", undefined, "Silky");
        var radRaw = feelRadioRow.add("radiobutton", undefined, "Raw");
        radNatural.value = (currentMotionFeel === "natural");
        radSnappy.value = (currentMotionFeel === "snappy");
        radSilky.value = (currentMotionFeel === "silky");
        radRaw.value = (currentMotionFeel === "raw");

        // Independent 4-Toggle Smart Automation Card (Typing & Scroll)
        var autoCard = tabSetup.add("panel", undefined, undefined, { borderStyle: "gray" });
        autoCard.orientation = "column";
        autoCard.alignChildren = ["fill", "top"];
        autoCard.spacing = 4;
        autoCard.margins = 8;

        var autoTitle = autoCard.add("statictext", undefined, "Typing & Scroll Automation");
        try { autoTitle.graphics.font = ScriptUI.newFont("Verdana", "Bold", 10); } catch (e) {}

        var chkTypingSpeedup = autoCard.add("checkbox", undefined, "Typing 2x Speed-Up (Time Remap)");
        chkTypingSpeedup.value = optTypingSpeedup;
        chkTypingSpeedup.onClick = function () {
            optTypingSpeedup = chkTypingSpeedup.value;
            savePref("enableTypingSpeedup", optTypingSpeedup);
        };

        var chkTypingZoom = autoCard.add("checkbox", undefined, "Typing Auto-Zoom & Camera Follow");
        chkTypingZoom.value = optTypingZoom;
        chkTypingZoom.onClick = function () {
            optTypingZoom = chkTypingZoom.value;
            savePref("enableTypingZoom", optTypingZoom);
        };

        var chkScrollSpeedup = autoCard.add("checkbox", undefined, "Scroll 2x Speed-Up (Time Remap)");
        chkScrollSpeedup.value = optScrollSpeedup;
        chkScrollSpeedup.onClick = function () {
            optScrollSpeedup = chkScrollSpeedup.value;
            savePref("enableScrollSpeedup", optScrollSpeedup);
        };

        var chkScrollZoom = autoCard.add("checkbox", undefined, "Scroll Auto-Zoom (Smooth Recovery)");
        chkScrollZoom.value = optScrollZoom;
        chkScrollZoom.onClick = function () {
            optScrollZoom = chkScrollZoom.value;
            savePref("enableScrollZoom", optScrollZoom);
        };

        // Fine-Tune Physics & Sync Accordion
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
        var chkVelocitySway = accBody.add("checkbox", undefined, "Velocity Tilt Sway (Dynamic cursor rotation)");
        chkVelocitySway.value = true;
        var chkClickBounce = accBody.add("checkbox", undefined, "Click Bounce (84% press compression)");
        chkClickBounce.value = true;
        var chkMotionBlur = accBody.add("checkbox", undefined, "Motion Blur (AE composition shutter)");
        chkMotionBlur.value = true;

        var syncOffRow = accBody.add("group");
        syncOffRow.orientation = "row";
        syncOffRow.alignChildren = ["fill", "center"];
        syncOffRow.spacing = 6;
        var syncOffLbl = syncOffRow.add("statictext", undefined, "Sync Offset:");
        syncOffLbl.preferredSize.width = 70;
        var syncOffSlider = syncOffRow.add("slider", undefined, currentSyncOffsetMs, -1000, 1000);
        syncOffSlider.alignment = ["fill", "center"];
        syncOffSlider.minimumSize = [40, 18];
        var syncOffVal = syncOffRow.add("statictext", undefined, currentSyncOffsetMs + "ms");
        syncOffVal.preferredSize.width = 44;
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
            layoutResponsive();
        };

        // =====================================================================
        // SECTION 2: CURSOR CONTROLS
        // =====================================================================
        var tabCursor = scrollViewport.add("group", [0, 0, 314, 210]);
        tabCursor.orientation = "column";
        tabCursor.alignChildren = ["fill", "top"];
        tabCursor.spacing = 8;
        tabCursor.margins = [0, 2, 0, 8];
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

        var cSizeRow = tabCursor.add("group");
        cSizeRow.orientation = "row";
        cSizeRow.alignChildren = ["fill", "center"];
        cSizeRow.spacing = 6;
        var cSizeLbl = cSizeRow.add("statictext", undefined, "Cursor Size:");
        cSizeLbl.preferredSize.width = 74;
        var cSizeSlider = cSizeRow.add("slider", undefined, currentCursorSize, 50, 200);
        cSizeSlider.alignment = ["fill", "center"];
        cSizeSlider.minimumSize = [40, 18];
        var cSizeValTxt = cSizeRow.add("statictext", undefined, currentCursorSize + "%");
        cSizeValTxt.preferredSize.width = 40;
        cSizeSlider.onChanging = function () {
            currentCursorSize = Math.round(cSizeSlider.value);
            cSizeValTxt.text = currentCursorSize + "%";
            savePref("selectedCursorSize", currentCursorSize.toString());
            redrawPreview();
        };

        var ripHeaderRow = tabCursor.add("group");
        ripHeaderRow.orientation = "row";
        ripHeaderRow.alignChildren = ["left", "center"];
        var ripLbl = ripHeaderRow.add("statictext", undefined, "Click Ripple Color");
        try { ripLbl.graphics.font = ScriptUI.newFont("Verdana", "Bold", 10); } catch (e) {}
        var ripValLbl = ripHeaderRow.add("statictext", undefined, currentRippleColor === "none" ? "Off" : currentRippleColor);
        ripValLbl.alignment = ["right", "center"];
        try { ripValLbl.graphics.foregroundColor = ripValLbl.graphics.newPen(ripValLbl.graphics.PenType.SOLID_COLOR, [0.42, 0.72, 1.0, 1.0], 1); } catch (e) {}

        var ripSwatchRow1 = tabCursor.add("group");
        ripSwatchRow1.orientation = "row";
        ripSwatchRow1.alignment = ["fill", "top"];
        ripSwatchRow1.spacing = 4;
        var btnRipCobalt = ripSwatchRow1.add("button", undefined, "Cobalt");
        var btnRipWhite = ripSwatchRow1.add("button", undefined, "White");
        var btnRipEmerald = ripSwatchRow1.add("button", undefined, "Emerald");
        btnRipCobalt.alignment = ["fill", "center"];
        btnRipWhite.alignment = ["fill", "center"];
        btnRipEmerald.alignment = ["fill", "center"];

        var ripSwatchRow2 = tabCursor.add("group");
        ripSwatchRow2.orientation = "row";
        ripSwatchRow2.alignment = ["fill", "top"];
        ripSwatchRow2.spacing = 4;
        var btnRipAmber = ripSwatchRow2.add("button", undefined, "Amber");
        var btnRipOff = ripSwatchRow2.add("button", undefined, "Off");
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
        // SECTION 3: FRAME & BACKDROP CONTROLS (Both BG Options Wired Live!)
        // =====================================================================
        var tabFrame = scrollViewport.add("group", [0, 0, 314, 270]);
        tabFrame.orientation = "column";
        tabFrame.alignChildren = ["fill", "top"];
        tabFrame.spacing = 7;
        tabFrame.margins = [0, 2, 0, 8];
        tabFrame.visible = false;

        var bgHeaderRow = tabFrame.add("group");
        bgHeaderRow.orientation = "row";
        bgHeaderRow.alignChildren = ["left", "center"];
        var bgSelectLbl = bgHeaderRow.add("statictext", undefined, "Backdrop Wallpaper");
        try { bgSelectLbl.graphics.font = ScriptUI.newFont("Verdana", "Bold", 10); } catch (e) {}
        var bgActiveValLbl = bgHeaderRow.add("statictext", undefined, getWallpaperMeta(currentBgKey).label);
        bgActiveValLbl.alignment = ["right", "center"];
        try { bgActiveValLbl.graphics.foregroundColor = bgActiveValLbl.graphics.newPen(bgActiveValLbl.graphics.PenType.SOLID_COLOR, [0.42, 0.72, 1.0, 1.0], 1); } catch (e) {}

        // BG Option 1: Quick Backdrop Preset Tiles
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

        // BG Option 2: Full Recordly Wallpapers Dropdown
        var bgItemsList = [];
        var bgKeysList = [];
        var initBgIdx = 0;
        for (var wp = 0; wp < RECORDLY_WALLPAPERS.length; wp++) {
            bgItemsList.push(RECORDLY_WALLPAPERS[wp].label);
            bgKeysList.push(RECORDLY_WALLPAPERS[wp].filename);
            if (RECORDLY_WALLPAPERS[wp].filename === currentBgKey || RECORDLY_WALLPAPERS[wp].id === currentBgKey) {
                initBgIdx = wp;
            }
        }
        var bgDropdown = tabFrame.add("dropdownlist", undefined, bgItemsList);
        bgDropdown.selection = initBgIdx;

        function setBackdropKey(key, fromDropdown) {
            if (isSyncingBg) return;
            isSyncingBg = true;
            try {
                currentBgKey = key;
                bgActiveValLbl.text = getWallpaperMeta(currentBgKey).label;
                if (!fromDropdown) {
                    for (var bi = 0; bi < bgKeysList.length; bi++) {
                        if (bgKeysList[bi] === key) {
                            bgDropdown.selection = bi;
                            break;
                        }
                    }
                }
                savePref("selectedBgKey", currentBgKey);
                refreshPreviewAssets();
                previewCanvas.notify("onDraw");
                try { win.update(); } catch (eUp) {}
            } finally {
                isSyncingBg = false;
            }
        }

        btnBgTahoe.onClick = function () { setBackdropKey("tahoe-light.jpg", false); };
        btnBgMidnight.onClick = function () { setBackdropKey("midnight-8.jpg", false); };
        btnBgAzure.onClick = function () { setBackdropKey("sequoia-blue.jpg", false); };
        btnBgCherry.onClick = function () { setBackdropKey("cherrypop.jpg", false); };
        btnBgStudio.onClick = function () { setBackdropKey("dark-studio", false); };
        btnBgNone.onClick = function () { setBackdropKey("none", false); };

        bgDropdown.onChange = function () {
            if (bgDropdown.selection) {
                setBackdropKey(bgKeysList[bgDropdown.selection.index], true);
            }
        };

        var radRow = tabFrame.add("group");
        radRow.orientation = "row";
        radRow.alignChildren = ["fill", "center"];
        radRow.spacing = 6;
        var radLbl = radRow.add("statictext", undefined, "Corner Radius:");
        radLbl.preferredSize.width = 84;
        var radSlider = radRow.add("slider", undefined, currentCornerRadius, 0, 48);
        radSlider.alignment = ["fill", "center"];
        radSlider.minimumSize = [40, 18];
        var radValTxt = radRow.add("statictext", undefined, currentCornerRadius + "px");
        radValTxt.preferredSize.width = 38;
        radSlider.onChanging = function () {
            currentCornerRadius = Math.round(radSlider.value);
            radValTxt.text = currentCornerRadius + "px";
            savePref("selectedCornerRadius", currentCornerRadius.toString());
            redrawPreview();
        };

        var marginRow = tabFrame.add("group");
        marginRow.orientation = "row";
        marginRow.alignChildren = ["fill", "center"];
        marginRow.spacing = 6;
        var marginLbl = marginRow.add("statictext", undefined, "Window Margin:");
        marginLbl.preferredSize.width = 84;
        var marginSlider = marginRow.add("slider", undefined, currentMargin, 0, 25);
        marginSlider.alignment = ["fill", "center"];
        marginSlider.minimumSize = [40, 18];
        var marginValTxt = marginRow.add("statictext", undefined, currentMargin + "%");
        marginValTxt.preferredSize.width = 38;
        marginSlider.onChanging = function () {
            currentMargin = Math.round(marginSlider.value);
            marginValTxt.text = currentMargin + "%";
            savePref("selectedMargin", currentMargin.toString());
            redrawPreview();
        };

        var shRow = tabFrame.add("group");
        shRow.orientation = "row";
        shRow.alignChildren = ["fill", "center"];
        shRow.spacing = 6;
        var shLbl = shRow.add("statictext", undefined, "Drop Shadow:");
        shLbl.preferredSize.width = 84;
        var shSlider = shRow.add("slider", undefined, currentShadow, 0, 100);
        shSlider.alignment = ["fill", "center"];
        shSlider.minimumSize = [40, 18];
        var shValTxt = shRow.add("statictext", undefined, currentShadow + "%");
        shValTxt.preferredSize.width = 38;
        shSlider.onChanging = function () {
            currentShadow = Math.round(shSlider.value);
            shValTxt.text = currentShadow + "%";
            savePref("selectedShadow", currentShadow.toString());
            redrawPreview();
        };

        // ---------------------------------------------------------------------
        // BAND 5: PINNED BOTTOM ACTION BAR (Generate Rig ALWAYS Visible!)
        // ---------------------------------------------------------------------
        var bottomBar = win.add("group", [10, 606, 340, 642]);
        bottomBar.margins = 0;
        bottomBar.spacing = 0;

        var btnBuild = bottomBar.add("button", [0, 0, 200, 34], "Generate Rig");
        var btnUpdateRig = bottomBar.add("button", [206, 0, 266, 34], "Update");
        btnUpdateRig.helpTip = "Update sliders on the currently active TraceMotion composition";
        var btnReset = bottomBar.add("button", [272, 0, 330, 34], "Reset");
        btnReset.helpTip = "Reset all parameters to Recordly defaults";

        // =====================================================================
        // FULL-RESPONSIVENESS PIXEL-EXACT LAYOUT ENGINE (EVERY WIDTH & HEIGHT)
        // =====================================================================
        function measureSectionHeight(grp, targetW, fallbackH) {
            try {
                grp.bounds = [0, 0, targetW, fallbackH];
                grp.layout.layout(true);
                if (grp.preferredSize && grp.preferredSize[1] > 24) {
                    return grp.preferredSize[1] + 6;
                }
            } catch (e) {}
            return fallbackH;
        }

        function applyScrollPosition() {
            var scrollY = vScrollBar.visible ? Math.round(vScrollBar.value) : 0;
            var vpW = scrollViewport.bounds ? (scrollViewport.bounds[2] - scrollViewport.bounds[0]) : 300;
            var isWide = (win.size && win.size[0] >= 560);

            if (isWide) {
                var gap = 10;
                var leftW = Math.floor((vpW - gap) * 0.50);
                var rightW = Math.max(120, vpW - gap - leftW);
                var hSetup = measureSectionHeight(tabSetup, leftW, accExpanded ? 490 : 350);
                var hCursor = measureSectionHeight(tabCursor, rightW, 195);
                var hFrame = measureSectionHeight(tabFrame, rightW, 240);

                tabSetup.bounds = [0, -scrollY, leftW, hSetup - scrollY];
                tabCursor.bounds = [leftW + gap, -scrollY, leftW + gap + rightW, hCursor - scrollY];
                tabFrame.bounds = [leftW + gap, hCursor + 8 - scrollY, leftW + gap + rightW, hCursor + 8 + hFrame - scrollY];
            } else {
                var hS = measureSectionHeight(tabSetup, vpW, accExpanded ? 490 : 350);
                var hC = measureSectionHeight(tabCursor, vpW, 195);
                var hF = measureSectionHeight(tabFrame, vpW, 240);

                tabSetup.bounds = [0, -scrollY, vpW, hS - scrollY];
                tabCursor.bounds = [0, -scrollY, vpW, hC - scrollY];
                tabFrame.bounds = [0, -scrollY, vpW, hF - scrollY];
            }

            try { tabSetup.layout.layout(true); } catch (e1) {}
            try { tabCursor.layout.layout(true); } catch (e2) {}
            try { tabFrame.layout.layout(true); } catch (e3) {}
        }

        function layoutResponsive() {
            try {
                var winW = (win.size && win.size[0] > 40) ? win.size[0] : (win.bounds ? (win.bounds[2] - win.bounds[0]) : 350);
                var winH = (win.size && win.size[1] > 40) ? win.size[1] : (win.bounds ? (win.bounds[3] - win.bounds[1]) : 650);
                var pad = (winW < 240) ? 6 : 10;
                var innerW = Math.max(140, winW - pad * 2);
                var isWide = (winW >= 560);
                var isShort = (winH < 390);

                // 1. Header pinned to top
                var headerH = 30;
                subTxt.visible = (winW >= 250);
                headerGrp.bounds = [pad, 6, pad + innerW, 6 + headerH];
                headerGrp.layout.layout(true);

                // 2. Preview Canvas below header (auto-compacts on short heights)
                var previewY = 6 + headerH + 6;
                var previewH = isShort ? 38 : (isWide ? 132 : 118);
                previewCanvas.bounds = [pad, previewY, pad + innerW, previewY + previewH];

                // 3. Tab Bar (exact equal-width pixel bounds on all 3 tabs — never clips!)
                var bodyY = previewY + previewH + 6;
                if (isWide) {
                    tabBar.visible = false;
                    tabBar.bounds = [pad, bodyY, pad + innerW, bodyY];
                } else {
                    tabBar.visible = true;
                    var tabBarH = 28;
                    tabBar.bounds = [pad, bodyY, pad + innerW, bodyY + tabBarH];
                    var tabGap = 4;
                    var tabW = Math.floor((innerW - tabGap * 2) / 3);
                    for (var ti = 0; ti < tabOrder.length; ti++) {
                        var tId = tabOrder[ti];
                        var tx0 = ti * (tabW + tabGap);
                        var tx1 = (ti === tabOrder.length - 1) ? innerW : (tx0 + tabW);
                        tabButtons[tId].bounds = [tx0, 0, tx1, tabBarH];
                    }
                    bodyY += tabBarH + 6;
                }

                // 4. Pinned Bottom Footer (Generate Rig ALWAYS visible & legible!)
                var footerH = 34;
                var footerY = Math.max(bodyY + 36, winH - footerH - 8);
                bottomBar.bounds = [pad, footerY, pad + innerW, footerY + footerH];
                var bGap = 5;
                var resetW = (innerW < 230) ? 44 : 52;
                var updW = (innerW < 230) ? 50 : 58;
                var buildW = Math.max(70, innerW - resetW - updW - bGap * 2);
                btnBuild.bounds = [0, 0, buildW, footerH];
                btnUpdateRig.bounds = [buildW + bGap, 0, buildW + bGap + updW, footerH];
                btnReset.bounds = [buildW + bGap * 2 + updW, 0, innerW, footerH];

                // 5. Middle Scrollable Body Viewport gets EXACT remaining height
                var bodyH = Math.max(36, footerY - bodyY - 6);
                bodyHost.bounds = [pad, bodyY, pad + innerW, bodyY + bodyH];

                if (isWide) {
                    tabSetup.visible = true;
                    tabCursor.visible = true;
                    tabFrame.visible = true;
                } else {
                    tabSetup.visible = (activeTab === "setup");
                    tabCursor.visible = (activeTab === "cursor");
                    tabFrame.visible = (activeTab === "frame");
                }

                // First-pass height measurement without scrollbar
                var testVpW = innerW;
                var contentH = 200;
                if (isWide) {
                    var gW = 10;
                    var lW = Math.floor((testVpW - gW) * 0.50);
                    var rW = Math.max(120, testVpW - gW - lW);
                    var hS0 = measureSectionHeight(tabSetup, lW, accExpanded ? 490 : 350);
                    var hC0 = measureSectionHeight(tabCursor, rW, 195);
                    var hF0 = measureSectionHeight(tabFrame, rW, 240);
                    contentH = Math.max(hS0, hC0 + hF0 + 8);
                } else {
                    var activeGrp = (activeTab === "cursor") ? tabCursor : ((activeTab === "frame") ? tabFrame : tabSetup);
                    var fbH = (activeTab === "cursor") ? 195 : ((activeTab === "frame") ? 240 : (accExpanded ? 490 : 350));
                    contentH = measureSectionHeight(activeGrp, testVpW, fbH);
                }

                var needsScroll = (contentH > bodyH + 2);
                var sbW = needsScroll ? 15 : 0;
                var vpW = Math.max(110, innerW - sbW - (needsScroll ? 3 : 0));

                scrollViewport.bounds = [0, 0, vpW, bodyH];
                if (needsScroll) {
                    vScrollBar.visible = true;
                    vScrollBar.bounds = [vpW + 3, 0, innerW, bodyH];
                    vScrollBar.minvalue = 0;
                    vScrollBar.maxvalue = Math.max(1, contentH - bodyH + 12);
                    if (vScrollBar.value > vScrollBar.maxvalue) vScrollBar.value = vScrollBar.maxvalue;
                } else {
                    vScrollBar.visible = false;
                    vScrollBar.value = 0;
                }

                applyScrollPosition();
                for (var tk = 0; tk < tabOrder.length; tk++) {
                    try { tabButtons[tabOrder[tk]].notify("onDraw"); } catch (eTb) {}
                }
                redrawPreview();
            } catch (eLay) {}
        }

        vScrollBar.onChanging = function () {
            applyScrollPosition();
        };

        function selectTab(tabName) {
            activeTab = tabName;
            vScrollBar.value = 0;
            layoutResponsive();
        }

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
                enableTypingZoom: chkTypingZoom.value,
                enableScrollSpeedup: chkScrollSpeedup.value,
                enableScrollZoom: chkScrollZoom.value,
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
                    if (cands[ci2].exists) { selectedJsonFile = cands[ci2]; break; }
                }
                if (!selectedJsonFile || !selectedJsonFile.exists) {
                    alert("Companion mouse telemetry JSON file not found. Please click Relink to select your .cursor.json file.", "Input Error");
                    selectTab("setup");
                    return;
                }
            }
            try {
                var builtComp = buildTraceMotionRig(selectedVideoFile, selectedJsonFile, gatherOptions());
                if (builtComp) statusTxt.text = "Rig Active";
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
            zDepthSlider.value = 180; zDepthValTxt.text = "1.80x";

            currentMotionFeel = "natural";
            radNatural.value = true; radSnappy.value = false; radSilky.value = false; radRaw.value = false;

            optTypingSpeedup = true; chkTypingSpeedup.value = true; savePref("enableTypingSpeedup", true);
            optTypingZoom = true; chkTypingZoom.value = true; savePref("enableTypingZoom", true);
            optScrollSpeedup = true; chkScrollSpeedup.value = true; savePref("enableScrollSpeedup", true);
            optScrollZoom = true; chkScrollZoom.value = true; savePref("enableScrollZoom", true);

            chkAutoStates.value = true;
            chkVelocitySway.value = true;
            chkClickBounce.value = true;
            chkMotionBlur.value = true;
            currentSyncOffsetMs = 0;
            syncOffSlider.value = 0; syncOffVal.text = "0ms";

            currentCursorKey = "tahoe";
            cursorDropdown.selection = 0;
            currentCursorSize = 100;
            cSizeSlider.value = 100; cSizeValTxt.text = "100%";
            setRippleColor("#2563EB");

            setBackdropKey("tahoe-light.jpg", false);
            currentCornerRadius = 20; radSlider.value = 20; radValTxt.text = "20px";
            currentMargin = 12; marginSlider.value = 12; marginValTxt.text = "12%";
            currentShadow = 65; shSlider.value = 65; shValTxt.text = "65%";

            refreshPreviewAssets();
            redrawPreview();
        };

        win.onResizing = win.onResize = function () {
            layoutResponsive();
        };

        if (win instanceof Window) {
            win.center();
            win.show();
            layoutResponsive();
        } else {
            layoutResponsive();
        }

        // Expose layout helper for automated testing
        win._layoutResponsive = layoutResponsive;
        win._selectTab = selectTab;
        win._refs = {
            previewCanvas: previewCanvas,
            tabBar: tabBar,
            bodyHost: bodyHost,
            scrollViewport: scrollViewport,
            vScrollBar: vScrollBar,
            tabSetup: tabSetup,
            tabCursor: tabCursor,
            tabFrame: tabFrame,
            bottomBar: bottomBar
        };

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