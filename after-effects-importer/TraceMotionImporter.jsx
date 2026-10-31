/**
 * TraceMotion Importer & Rig Generator for Adobe After Effects
 * 
 * Ingests pristine screen recordings and synchronized mouse telemetry (.cursor.json)
 * captured via OBS Studio or Recordly. Reconstructs dynamic camera zooms, deadband
 * safe zones, cubic-bezier easing, vector cursors, and click ripple VFX inside native AE comps.
 *
 * Compatible with Adobe After Effects CC 2020 through 2026+
 */

(function (thisObj) {
    "use strict";

    // =========================================================================
    // Mini JSON Parser for ExtendScript Compatibility
    // =========================================================================
    var JSONParser = {
        parse: function (jsonStr) {
            if (typeof JSON !== "undefined" && typeof JSON.parse === "function") {
                try {
                    return JSON.parse(jsonStr);
                } catch (e) {}
            }
            // Safe JSON fallback using sanitized evaluation
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

    // =========================================================================
    // Ramer-Douglas-Peucker (RDP) Keyframe Decimation Algorithm
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
            // Critical click events must never be pruned
            if (points[i].interactionType && points[i].interactionType !== "move") {
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
            var recResults1 = rdpSimplify(points.slice(0, index + 1), epsilon);
            var recResults2 = rdpSimplify(points.slice(index), epsilon);
            return recResults1.slice(0, recResults1.length - 1).concat(recResults2);
        } else {
            return [points[0], points[end]];
        }
    }

    // =========================================================================
    // Main Import & Rig Builder Function
    // =========================================================================
    function buildTraceMotionRig(videoFile, telemetryFile, options) {
        app.beginUndoGroup("Generate TraceMotion Camera & Cursor Rig");

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

            // 3. Create or Match Composition
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

            // 4. Add Clean Video Layer
            var videoLayer = comp.layers.add(footageItem);
            videoLayer.name = "Clean_Screen_Capture";
            videoLayer.motionBlur = options.enableMotionBlur;

            // 5. Decimate Telemetry Points using RDP
            var epsilonNormalized = options.simplificationTolerance / Math.max(compW, compH);
            var simplifiedSamples = rdpSimplify(rawSamples, epsilonNormalized);

            // 6. Create Master Controller Null
            var controller = comp.layers.addNull();
            controller.name = "TraceMotion_Camera_Controller";
            controller.guideLayer = true;

            // Add Slider Controls
            var fxParade = controller.property("ADBE Effect Parade");
            var zoomSlider = fxParade.addProperty("ADBE Slider Control");
            zoomSlider.name = "Zoom Scale";
            zoomSlider.property("Slider").setValue(100);

            var marginSlider = fxParade.addProperty("ADBE Slider Control");
            marginSlider.name = "Deadband Margin Pct";
            marginSlider.property("Slider").setValue(options.deadbandMargin);

            var tensionSlider = fxParade.addProperty("ADBE Slider Control");
            tensionSlider.name = "Spring Tension";
            tensionSlider.property("Slider").setValue(options.springTension);

            // 7. Calculate Deadband Camera Path and Keyframes
            var camFocusXProp = fxParade.addProperty("ADBE Point Control");
            camFocusXProp.name = "Camera Focus";
            var pointProp = camFocusXProp.property("Point");

            var currentFocusX = compW / 2;
            var currentFocusY = compH / 2;
            var halfSpanX = (compW / 2) / (options.defaultZoomDepth / 100);
            var halfSpanY = (compH / 2) / (options.defaultZoomDepth / 100);
            var deadbandRatio = options.deadbandMargin / 100.0;
            var insetX = (halfSpanX * 2) * deadbandRatio;
            var insetY = (halfSpanY * 2) * deadbandRatio;

            for (var i = 0; i < simplifiedSamples.length; i++) {
                var s = simplifiedSamples[i];
                var t = s.timeMs / 1000.0;
                var targetPxX = s.cx * compW;
                var targetPxY = s.cy * compH;

                var safeL = currentFocusX - halfSpanX + insetX;
                var safeR = currentFocusX + halfSpanX - insetX;
                var safeT = currentFocusY - halfSpanY + insetY;
                var safeB = currentFocusY + halfSpanY - insetY;

                if (targetPxX < safeL) currentFocusX = targetPxX + (halfSpanX - insetX);
                else if (targetPxX > safeR) currentFocusX = targetPxX - (halfSpanX - insetX);

                if (targetPxY < safeT) currentFocusY = targetPxY + (halfSpanY - insetY);
                else if (targetPxY > safeB) currentFocusY = targetPxY - (halfSpanY - insetY);

                currentFocusX = Math.max(halfSpanX, Math.min(compW - halfSpanX, currentFocusX));
                currentFocusY = Math.max(halfSpanY, Math.min(compH - halfSpanY, currentFocusY));

                pointProp.setValueAtTime(t, [currentFocusX, currentFocusY]);
            }

            // Apply Cubic Bezier Easing (0.16, 1.0, 0.30, 1.0)
            var easeOut = new KeyframeEase(0, 16.0); // Outflow influence
            var easeIn = new KeyframeEase(0, 85.0);  // Inflow influence
            for (var k = 1; k <= pointProp.numKeys; k++) {
                pointProp.setTemporalEaseAtKey(k, [easeIn], [easeOut]);
                pointProp.setSpatialContinuousAtKey(k, true);
                pointProp.setSpatialAutoBezierAtKey(k, true);
            }

            // 8. Dynamic Parenting / Expression Binding on Video Layer
            var anchorExpr = 
                "var ctrl = thisComp.layer('" + controller.name + "');\n" +
                "var focus = ctrl.effect('Camera Focus')('Point');\n" +
                "focus;";
            var posExpr = "[thisComp.width / 2, thisComp.height / 2];";
            var scaleExpr = 
                "var ctrl = thisComp.layer('" + controller.name + "');\n" +
                "var z = ctrl.effect('Zoom Scale')('Slider');\n" +
                "[z, z];";

            videoLayer.transform.anchorPoint.expression = anchorExpr;
            videoLayer.transform.position.expression = posExpr;
            videoLayer.transform.scale.expression = scaleExpr;

            // 9. Generate Vector Cursor Layer (Optional)
            if (options.createCursor) {
                var cursorLayer = comp.layers.addShape();
                cursorLayer.name = "TraceMotion_Cursor";
                cursorLayer.motionBlur = options.enableMotionBlur;

                // Draw standard clean cursor arrow
                var contents = cursorLayer.property("ADBE Root Vectors Group");
                var shapeGroup = contents.addProperty("ADBE Vector Group");
                shapeGroup.name = "Cursor Arrow";
                var groupVectors = shapeGroup.property("ADBE Vectors Group");

                var pathShape = new Shape();
                pathShape.vertices = [
                    [0, 0],
                    [0, 24],
                    [6, 18],
                    [11, 28],
                    [14, 26],
                    [9, 16],
                    [17, 16]
                ];
                pathShape.closed = true;

                var pathProp = groupVectors.addProperty("ADBE Vector Shape - Group");
                pathProp.property("Path").setValue(pathShape);

                var fillProp = groupVectors.addProperty("ADBE Vector Graphic - Fill");
                fillProp.property("Color").setValue([0.05, 0.05, 0.05, 1.0]); // Dark fill

                var strokeProp = groupVectors.addProperty("ADBE Vector Graphic - Stroke");
                strokeProp.property("Color").setValue([1.0, 1.0, 1.0, 1.0]); // White border
                strokeProp.property("Stroke Width").setValue(2.0);

                // Populate Cursor Movement Keyframes
                var cursorPosProp = cursorLayer.transform.position;
                var cursorScaleProp = cursorLayer.transform.scale;

                for (var j = 0; j < simplifiedSamples.length; j++) {
                    var curSample = simplifiedSamples[j];
                    var timeSec = curSample.timeMs / 1000.0;
                    var screenPx = [curSample.cx * compW, curSample.cy * compH];
                    cursorPosProp.setValueAtTime(timeSec, screenPx);
                }

                // Add Cursor Sway Expression
                cursorLayer.transform.rotation.expression = 
                    "var v = transform.position.velocity;\n" +
                    "var angle = -v[0] * 0.035;\n" +
                    "clamp(angle, -25, 25);";

                // Add Click Scale Bounce & Ripples
                if (options.createClickRipples) {
                    var rippleLayer = comp.layers.addShape();
                    rippleLayer.name = "TraceMotion_Click_Ripples";
                    rippleLayer.guideLayer = true;

                    for (var c = 0; c < rawSamples.length; c++) {
                        var rawS = rawSamples[c];
                        if (rawS.interactionType === "click" || rawS.interactionType === "double-click") {
                            var clickTime = rawS.timeMs / 1000.0;
                            // Click bounce keyframes on cursor layer
                            cursorScaleProp.setValueAtTime(clickTime, [100, 100]);
                            cursorScaleProp.setValueAtTime(clickTime + 0.04, [82, 82]);
                            cursorScaleProp.setValueAtTime(clickTime + 0.12, [100, 100]);
                        }
                    }
                }
            }

            alert(
                "TraceMotion Rig Generated Successfully!\n\n" +
                "• Comp: " + comp.name + " (" + compW + "x" + compH + " @ " + fps + " FPS)\n" +
                "• Raw Telemetry Points: " + rawSamples.length + "\n" +
                "• Decimated Keyframes: " + simplifiedSamples.length + " (" + 
                Math.round((1 - simplifiedSamples.length / rawSamples.length) * 100) + "% reduction)\n" +
                "• Controller Null: 'TraceMotion_Camera_Controller'",
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
        var subtitle = headerGroup.add("statictext", undefined, "Automated camera tracking, deadband zooms, and cursor VFX for After Effects.");

        // File Selection Panel
        var filePanel = win.add("panel", undefined, "1. Source Footage & Telemetry");
        filePanel.orientation = "column";
        filePanel.alignChildren = ["fill", "top"];
        filePanel.spacing = 8;
        filePanel.margins = 12;

        var videoGroup = filePanel.add("group");
        videoGroup.add("statictext", undefined, "Video File:");
        var videoPathInput = videoGroup.add("edittext", undefined, "");
        videoPathInput.characters = 36;
        var videoBrowseBtn = videoGroup.add("button", undefined, "Browse...");

        var jsonGroup = filePanel.add("group");
        jsonGroup.add("statictext", undefined, "Sidecar JSON:");
        var jsonPathInput = jsonGroup.add("edittext", undefined, "");
        jsonPathInput.characters = 36;
        var jsonBrowseBtn = jsonGroup.add("button", undefined, "Browse...");

        var selectedVideoFile = null;
        var selectedJsonFile = null;

        videoBrowseBtn.onClick = function () {
            var f = File.openDialog("Select Screen Recording Video", "Video Files:*.mp4;*.mov;*.webm;*.mkv;*.*");
            if (f) {
                selectedVideoFile = f;
                videoPathInput.text = f.fsName;
                // Auto-detect adjacent .cursor.json
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

        // Animation Tuning Panel
        var tuningPanel = win.add("panel", undefined, "2. Camera & Animation Parameters");
        tuningPanel.orientation = "column";
        tuningPanel.alignChildren = ["fill", "top"];
        tuningPanel.spacing = 8;
        tuningPanel.margins = 12;

        var zoomGroup = tuningPanel.add("group");
        zoomGroup.add("statictext", undefined, "Default Zoom Depth (%):");
        var zoomInput = zoomGroup.add("edittext", undefined, "160");
        zoomInput.characters = 6;

        var marginGroup = tuningPanel.add("group");
        marginGroup.add("statictext", undefined, "Deadband Margin (%):");
        var marginInput = marginGroup.add("edittext", undefined, "25");
        marginInput.characters = 6;

        var rdpGroup = tuningPanel.add("group");
        rdpGroup.add("statictext", undefined, "Keyframe Pruning Tolerance (px):");
        var rdpInput = rdpGroup.add("edittext", undefined, "2.0");
        rdpInput.characters = 6;

        // Visual FX Options
        var fxPanel = win.add("panel", undefined, "3. Visual FX Layers");
        fxPanel.orientation = "column";
        fxPanel.alignChildren = ["fill", "top"];
        fxPanel.spacing = 6;
        fxPanel.margins = 12;

        var chkCursor = fxPanel.add("checkbox", undefined, "Generate Synthetic Vector Cursor Layer");
        chkCursor.value = true;
        var chkRipples = fxPanel.add("checkbox", undefined, "Generate Click Scale Bounces & Ripples");
        chkRipples.value = true;
        var chkMotionBlur = fxPanel.add("checkbox", undefined, "Enable Native Composition Motion Blur");
        chkMotionBlur.value = true;

        // Action Buttons
        var btnGroup = win.add("group");
        btnGroup.alignment = ["right", "bottom"];
        var cancelBtn = btnGroup.add("button", undefined, "Cancel");
        var buildBtn = btnGroup.add("button", undefined, "Build TraceMotion Rig");
        buildBtn.preferredSize.width = 160;

        cancelBtn.onClick = function () {
            win.close();
        };

        buildBtn.onClick = function () {
            if (!selectedVideoFile || !selectedVideoFile.exists) {
                alert("Please select a valid screen recording video file.", "Missing Video");
                return;
            }
            if (!selectedJsonFile || !selectedJsonFile.exists) {
                alert("Please select a valid .cursor.json telemetry file.", "Missing Telemetry");
                return;
            }

            var options = {
                defaultZoomDepth: parseFloat(zoomInput.text) || 160,
                deadbandMargin: parseFloat(marginInput.text) || 25,
                simplificationTolerance: parseFloat(rdpInput.text) || 2.0,
                springTension: 0.5,
                createCursor: chkCursor.value,
                createClickRipples: chkRipples.value,
                enableMotionBlur: chkMotionBlur.value
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
