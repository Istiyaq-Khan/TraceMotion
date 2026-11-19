const fs = require('fs');
const path = require('path');
const jsxPath = path.resolve(__dirname, '../after-effects-importer/TraceMotionImporter.jsx');
const code = fs.readFileSync(jsxPath, 'utf8');

// Mock AE DOM
class MockProp {
    constructor(name) {
        this.name = name;
        this.numKeys = 0;
        this.keys = [];
        this.value = null;
        this.expression = "";
    }
    setValue(v) { this.value = v; }
    setValueAtTime(t, v) {
        this.numKeys++;
        this.keys.push({ t, v });
        this.value = v;
    }
    nearestKeyIndex(t) { return 1; }
    setInterpolationTypeAtKey() {}
    setTemporalEaseAtKey() {}
    setSpatialContinuousAtKey() {}
    setSpatialAutoBezierAtKey() {}
    removeKey() {}
    property(name) { return this.addProperty(name); }
    addProperty(name) {
        const p = new MockProp(name);
        return p;
    }
}

class MockLayer {
    constructor(name) {
        this.name = name;
        this.parent = null;
        this.guideLayer = false;
        this.motionBlur = false;
        this.timeRemapEnabled = false;
        this.width = 1920;
        this.height = 1080;
        this.transform = {
            anchorPoint: new MockProp("Anchor Point"),
            position: new MockProp("Position"),
            scale: new MockProp("Scale"),
            rotation: new MockProp("Rotation"),
            opacity: new MockProp("Opacity")
        };
        this.effects = {};
    }
    property(name) {
        return new MockProp(name);
    }
    effect(name) {
        if (!this.effects[name]) {
            this.effects[name] = (propName) => new MockProp(propName);
        }
        return this.effects[name];
    }
    moveBefore() {}
    setTrackMatte() {}
}

class MockComp {
    constructor() {
        this.name = "Test Comp";
        this.width = 1920;
        this.height = 1080;
        this.duration = 34.5;
        this.layers = {
            addNull: () => new MockLayer("Null"),
            addShape: () => new MockLayer("Shape"),
            addSolid: () => new MockLayer("Solid"),
            add: (item) => new MockLayer(item ? item.name : "Layer")
        };
    }
}

const fallbackTelemetryJson = JSON.stringify({
    samples: [
        { timeMs: 0, cx: 0.5, cy: 0.5, interactionType: "move", cursorType: "arrow" },
        { timeMs: 500, cx: 0.52, cy: 0.51, interactionType: "click", cursorType: "arrow" },
        { timeMs: 516, cx: 0.52, cy: 0.51, interactionType: "mouseup", cursorType: "arrow" },
        { timeMs: 1200, cx: 0.43, cy: 0.34, interactionType: "click", cursorType: "text" },
        { timeMs: 2500, cx: 0.43, cy: 0.34, interactionType: "move", cursorType: "text" },
        { timeMs: 4000, cx: 0.65, cy: 0.72, interactionType: "move", cursorType: "arrow" }
    ]
});

const mockContext = {
    Array: Array,
    Math: Math,
    String: String,
    Number: Number,
    Boolean: Boolean,
    RegExp: RegExp,
    Date: Date,
    JSON: JSON,
    File: function(name) {
        const fileExists = fs.existsSync(name);
        return {
            name: path.basename(name),
            fsName: name,
            exists: true, // Always true for mock testing
            open: function() {},
            read: function() {
                if (fileExists) return fs.readFileSync(name, 'utf8');
                return fallbackTelemetryJson;
            },
            close: function() {}
        };
    },
    Folder: function(name) {
        return {
            name: path.basename(name),
            fsName: name,
            exists: fs.existsSync(name),
            getFiles: function() { return []; }
        };
    },
    KeyframeEase: function(s, i) { this.speed = s; this.influence = i; },
    KeyframeInterpolationType: { LINEAR: 1, BEZIER: 2, HOLD: 3 },
    TrackMatteType: { ALPHA: 1 },
    ImportOptions: function(f) { this.file = f; },
    ScriptUI: {
        newFont: function() { return {}; },
        newImage: function() { return {}; }
    },
    Panel: function() {},
    Window: function() {
        return {
            add: function() {
                return {
                    add: function() { return { preferredSize: {}, graphics: {} }; },
                    preferredSize: {},
                    size: [320, 100],
                    graphics: {},
                    addEventListener: function() {}
                };
            },
            graphics: {},
            layout: { resize: function() {}, layout: function() {} },
            center: function() {},
            show: function() {}
        };
    },
    app: {
        project: {
            items: { addComp: () => new MockComp() },
            importFile: (opts) => ({ name: "Video", width: 1920, height: 1080, duration: 34.5, frameRate: 60 })
        },
        beginUndoGroup: function() {},
        endUndoGroup: function() {}
    },
    alert: function(msg, title) { console.log(`[ALERT: ${title}] ${msg}`); },
    confirm: function() { return true; },
    $: {
        global: {}
    }
};

const fn = new Function('window', 'app', 'File', 'Folder', 'KeyframeEase', 'KeyframeInterpolationType', 'TrackMatteType', 'ImportOptions', 'ScriptUI', 'Panel', 'Window', 'alert', 'confirm', '$', code);
fn.call({}, mockContext, mockContext.app, mockContext.File, mockContext.Folder, mockContext.KeyframeEase, mockContext.KeyframeInterpolationType, mockContext.TrackMatteType, mockContext.ImportOptions, mockContext.ScriptUI, mockContext.Panel, mockContext.Window, mockContext.alert, mockContext.confirm, mockContext.$);

const TM = mockContext.$.global.TraceMotion;
console.log("TraceMotion exports:", Object.keys(TM));

// Now run buildRig
try {
    const videoF = new mockContext.File("mock_video.mp4");
    const jsonF = new mockContext.File("mock_video.mp4.cursor.json");
    const opts = {
        zoomMode: "auto-cluster",
        zoomDepthScale: 1.80,
        motionFeel: "natural",
        enableAutoStates: true,
        enableVelocitySway: true,
        enableClickBounce: true,
        enableMotionBlur: true,
        enableTypingSpeedup: true,
        cursorStyle: "tahoe",
        cursorScale: 100,
        clickEffect: "#2563EB",
        wallpaper: "tahoe-light.jpg",
        cornerRadius: 20,
        canvasMargin: 12,
        shadowIntensity: 65,
        silent: true
    };
    TM.buildRig(videoF, jsonF, opts);
    console.log("buildTraceMotionRig executed flawlessly with 0 errors!");
} catch (e) {
    console.error("buildTraceMotionRig error:", e);
    process.exit(1);
}
