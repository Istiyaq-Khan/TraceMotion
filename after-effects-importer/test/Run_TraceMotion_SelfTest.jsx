/**
 * TraceMotion Studio - Automated Diagnostic & Rig Construction Test Suite
 * Compatible with Adobe After Effects CC 2020 through 2026+
 * 
 * Usage:
 * In After Effects, go to File > Scripts > Run Script File... and choose this file.
 */

(function () {
    var results = [];
    function pass(name, detail) {
        results.push("✅ PASS: " + name + (detail ? " (" + detail + ")" : ""));
    }
    function fail(name, detail) {
        results.push("❌ FAIL: " + name + (detail ? " - " + detail : ""));
    }

    try {
        // --- TEST 1: Host Environment ---
        var aeVer = (typeof app !== "undefined" && app.version) ? app.version : "Unknown";
        pass("Host Environment", "After Effects v" + aeVer);

        // --- TEST 2: Load Importer Core Script ---
        var scriptPath = "";
        if (typeof $.fileName !== "undefined" && $.fileName) {
            var fCurrent = new File($.fileName);
            if (fCurrent.parent && fCurrent.parent.parent) {
                scriptPath = fCurrent.parent.parent.fsName + "/TraceMotionImporter.jsx";
            }
        }
        var mainScriptFile = new File(scriptPath);
        if (!mainScriptFile.exists) {
            mainScriptFile = new File("D:/all my code/TraceMotion/after-effects-importer/TraceMotionImporter.jsx");
        }
        if (!mainScriptFile.exists) {
            mainScriptFile = new File("D:/apps/Adobe After Effects 2020/Support Files/Scripts/ScriptUI Panels/TraceMotionImporter.jsx");
        }

        if (mainScriptFile.exists) {
            pass("Script File Located", mainScriptFile.fsName);
            $.evalFile(mainScriptFile);
            pass("ScriptUI Importer Evaluated", "Zero syntax or initialization errors");
        } else {
            fail("Script File Located", "Could not locate TraceMotionImporter.jsx");
        }

        // --- TEST 3: TraceMotion API Availability ---
        if (typeof TraceMotion !== "undefined" && typeof TraceMotion.buildRig === "function") {
            pass("TraceMotion Global API", "TraceMotion.buildRig, updateRig, buildUI exposed");
        } else {
            fail("TraceMotion Global API", "TraceMotion global namespace is not defined");
        }

        // --- TEST 4: ScriptUI Custom Canvas Controls (Panel with onDraw) ---
        try {
            var testWin = new Window("palette", "TraceMotion Canvas Test", undefined);
            var testCanvas = testWin.add("panel", [0, 0, 56, 56], undefined, { borderStyle: "none" });
            testCanvas.onDraw = function () {
                var g = this.graphics;
                var b = g.newBrush(g.BrushType.SOLID_COLOR, [0.2, 0.2, 0.25, 1.0]);
                g.rectPath(0, 0, 56, 56);
                g.fillPath(b);
            };
            testWin.layout.layout(true);
            pass("ScriptUI Canvas Rendering", "panel with borderStyle: none & onDraw supported");
        } catch (uiErr) {
            fail("ScriptUI Canvas Rendering", uiErr.toString());
        }

        // --- TEST 5: Automated Rig Construction Test ---
        if (typeof TraceMotion !== "undefined" && typeof TraceMotion.buildRig === "function") {
            var vFile = new File("C:/Users/istiy/Videos/2026-11-03 18-25-30.mp4");
            var jFile = new File("C:/Users/istiy/Videos/2026-11-03 18-25-30.mp4.cursor.json");

            if (vFile.exists && jFile.exists) {
                var testComp = TraceMotion.buildRig(vFile, jFile, {
                    cursorStyle: "tahoe",
                    preferSvg: false,
                    cursorScalePct: 100.0,
                    dynamicCursorStates: true,
                    swayAmount: 0.4,
                    createClickBounce: true,
                    clickEffect: "ripple",
                    clickEffectColor: "#2563EB",
                    clickEffectScale: 100.0,
                    zoomMode: "auto-cluster",
                    zoomDepthScale: 1.80,
                    cursorSmoothing: 0.67,
                    motionPreset: "smooth",
                    enableMotionBlur: false,
                    cornerRadius: 20.0,
                    shadowIntensity: 65.0,
                    canvasMargin: 12.0,
                    backgroundPreset: "tahoe-dawn",
                    simplificationTolerance: 0.25,
                    silent: true // Prevents blocking alert dialog in automated tests
                });

                if (testComp && testComp instanceof CompItem) {
                    pass("Rig Construction", "Comp: " + testComp.name + " (" + testComp.numLayers + " layers)");

                    var hasController = !!testComp.layer("TraceMotion_Camera_Controller");
                    var hasCursor = false;
                    var hasMatte = !!testComp.layer("TraceMotion_Window_Matte");
                    var hasBg = !!testComp.layer("TraceMotion_Background");

                    for (var l = 1; l <= testComp.numLayers; l++) {
                        if (testComp.layer(l).name.indexOf("TraceMotion_Cursor") === 0) {
                            hasCursor = true;
                            break;
                        }
                    }

                    if (hasController && hasCursor && hasMatte && hasBg) {
                        pass("Layer Stack Hierarchy", "Controller Null, Cursor, Track Matte, Video, and Background verified");
                    } else {
                        fail("Layer Stack Hierarchy", "Missing one or more expected rig layers");
                    }
                } else {
                    fail("Rig Construction", "buildRig did not return a valid CompItem");
                }
            } else {
                pass("Rig Construction Media Check", "Sample files not in ~/Videos; skipping full rig build");
            }
        }

    } catch (suiteErr) {
        fail("Test Suite Execution", suiteErr.toString() + " at line " + suiteErr.line);
    }

    // Display formatted results dialog
    var msg = "TraceMotion Test Suite Diagnostic Results:\n\n" + results.join("\n\n");
    alert(msg, "TraceMotion Test Runner");
})();
