const fs = require('fs');
const data = JSON.parse(fs.readFileSync('C:/Users/istiy/Videos/2026-11-19 01-56-53.mp4.cursor.json', 'utf8'));

// Run the exact detection logic from TraceMotionImporter.jsx
const rawSamples = data.samples;
const durationSec = 34.5;
const totalMs = durationSec * 1000.0;
const dragIntervals = [];
const typingIntervals = [];

for (let i = 0; i < rawSamples.length; i++) {
    const s = rawSamples[i];
    const it = s.interactionType;
    if (it === "click" || it === "double-click") {
        for (let j = i + 1; j < rawSamples.length && (rawSamples[j].timeMs - s.timeMs) <= 3000; j++) {
            const candidate = rawSamples[j];
            if (candidate.interactionType === "mouseup") {
                const dragDuration = candidate.timeMs - s.timeMs;
                const dragDx = Math.abs(candidate.cx - s.cx);
                const dragDy = Math.abs(candidate.cy - s.cy);
                const dragDist = Math.sqrt(dragDx * dragDx + dragDy * dragDy);
                if (dragDuration >= 140 && dragDist > 0.015) {
                    dragIntervals.push({
                        startMs: s.timeMs,
                        endMs: candidate.timeMs,
                        isText: dragDx > dragDy * 1.6 || s.cursorType === "text"
                    });
                }
                break;
            }
        }
    }
}

// Typing intervals
for (let c = 0; c < rawSamples.length; c++) {
    const clickS = rawSamples[c];
    if (clickS.interactionType === "click" || clickS.cursorType === "text") {
        const windowEnd = Math.min(totalMs, clickS.timeMs + 6000);
        let maxDisp = 0;
        let lastStationaryMs = clickS.timeMs;
        for (let w = c + 1; w < rawSamples.length && rawSamples[w].timeMs <= windowEnd; w++) {
            const sMove = rawSamples[w];
            const d = Math.sqrt(Math.pow(sMove.cx - clickS.cx, 2) + Math.pow(sMove.cy - clickS.cy, 2));
            if (d > maxDisp) maxDisp = d;
            if (maxDisp > 0.03) break;
            lastStationaryMs = sMove.timeMs;
        }
        const typingDur = lastStationaryMs - clickS.timeMs;
        if (typingDur >= 700) {
            typingIntervals.push({
                startMs: clickS.timeMs,
                endMs: lastStationaryMs,
                cx: clickS.cx,
                cy: clickS.cy
            });
        }
    }
}

console.log('Detected dragIntervals:', dragIntervals);
console.log('Detected typingIntervals count:', typingIntervals.length);
typingIntervals.forEach(t => console.log('Typing:', t.startMs, 'to', t.endMs, 'dur:', t.endMs - t.startMs));
