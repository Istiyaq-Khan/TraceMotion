const fs = require('fs');
const path = 'C:/Users/istiy/Videos/2026-11-19 01-56-53.mp4.cursor.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));
console.log('Total samples:', data.samples.length);

const cursorCounts = {};
const interactCounts = {};

data.samples.forEach(s => {
    cursorCounts[s.cursorType] = (cursorCounts[s.cursorType] || 0) + 1;
    interactCounts[s.interactionType] = (interactCounts[s.interactionType] || 0) + 1;
});

console.log('Cursor types:', cursorCounts);
console.log('Interaction types:', interactCounts);

// Find when text selection happened
let textRanges = [];
let range = null;
data.samples.forEach((s, idx) => {
    if (s.cursorType === 'text') {
        if (!range) range = { start: s.timeMs, startIdx: idx, startPos: [s.cx, s.cy] };
        range.end = s.timeMs;
        range.endIdx = idx;
        range.endPos = [s.cx, s.cy];
    } else {
        if (range) {
            textRanges.push(range);
            range = null;
        }
    }
});
if (range) textRanges.push(range);

console.log('\nText ranges (count = ' + textRanges.length + '):');
textRanges.forEach(r => {
    const dur = r.end - r.start;
    const dx = Math.abs(r.endPos[0] - r.startPos[0]);
    const dy = Math.abs(r.endPos[1] - r.startPos[1]);
    console.log(`  Start: ${r.start}ms, End: ${r.end}ms, Dur: ${dur}ms, dx: ${dx.toFixed(4)}, dy: ${dy.toFixed(4)}`);
});
