const fs = require('fs');
const path = require('path');
const jsxPath = path.resolve(__dirname, '../after-effects-importer/TraceMotionImporter.jsx');
let code = fs.readFileSync(jsxPath, 'utf8');

// Test ES3 compatibility by deleting Object.keys before executing
const mockContext = {
    Array: Array,
    Math: Math,
    String: String,
    Number: Number,
    Boolean: Boolean,
    RegExp: RegExp,
    Date: Date,
    JSON: JSON,
    File: function(name) { return { name: name, exists: false }; },
    Folder: function(name) { return { name: name, exists: false }; },
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
        project: null
    }
};

// Test with mocked environment
try {
    const fn = new Function('thisObj', 'window', 'app', 'Panel', 'Window', 'ScriptUI', 'File', 'Folder', code);
    const result = fn.call(new mockContext.Panel(), new mockContext.Panel(), mockContext, mockContext.app, mockContext.Panel, mockContext.Window, mockContext.ScriptUI, mockContext.File, mockContext.Folder);
    console.log("ES3 Execution Test with Panel passed successfully!");
} catch (e) {
    console.error("ES3 Execution Test Failed:", e);
    process.exit(1);
}
