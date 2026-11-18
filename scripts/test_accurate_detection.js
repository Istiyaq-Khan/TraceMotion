const fs = require('fs');
const data = JSON.parse(fs.readFileSync('C:/Users/istiy/Videos/2026-11-19 01-56-53.mp4.cursor.json', 'utf8'));

const rawSamples = data.samples;
const durationSec = 34.5;
const totalMs = durationSec * 1000.0;
const dragIntervals = [];
const typingIntervals = [];

for (let i = 0; i < rawSamples.length; i++) {
    const s = rawSamples[i];
    const it = s.interactionType;
    if (it === "click" || it === "double-click") {
        for (let j = i + 1; j < rawSamples.length && (rawSamples[j].timeMs - s.timeMs) <= 4000; j++) {
            const candidate = rawSamples[j];
            if (candidate.interactionType === "mouseup") {
                const dragDuration = candidate.timeMs - s.timeMs;
                const dragDx = Math.abs(candidate.cx - s.cx);
                const dragDy = Math.abs(candidate.cy - s.cy);
                const dragDist = Math.sqrt(dragDx * dragDx + dragDy * dragDy);
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

let textRunStart = -1;
let textRunStartPos = null;
for (let k = 0; k < rawSamples.length; k++) {
    const smp = rawSamples[k];
    if (smp.cursorType === "text") {
        if (textRunStart < 0) {
            textRunStart = smp.timeMs;
            textRunStartPos = [smp.cx, smp.cy];
        }
    } else {
        if (textRunStart >= 0 && textRunStartPos) {
            const lastS = rawSamples[k - 1];
            const tDur = lastS.timeMs - textRunStart;
            const tDx = Math.abs(lastS.cx - textRunStartPos[0]);
            const tDy = Math.abs(lastS.cy - textRunStartPos[1]);
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

for (let c = 0; c < rawSamples.length; c++) {
    const clickS = rawSamples[c];
    if ((clickS.interactionType === "click" || clickS.interactionType === "double-click") && clickS.cursorType === "text") {
        const windowEnd = Math.min(totalMs, clickS.timeMs + 8000);
        let maxDisp = 0;
        let lastStationaryMs = clickS.timeMs;
        for (let w = c + 1; w < rawSamples.length && rawSamples[w].timeMs <= windowEnd; w++) {
            const sMove = rawSamples[w];
            const d = Math.sqrt(Math.pow(sMove.cx - clickS.cx, 2) + Math.pow(sMove.cy - clickS.cy, 2));
            if (d > maxDisp) maxDisp = d;
            if (maxDisp > 0.025) break;
            lastStationaryMs = sMove.timeMs;
        }
        const typingDur = lastStationaryMs - clickS.timeMs;
        if (typingDur >= 1000) {
            typingIntervals.push({
                startMs: clickS.timeMs,
                endMs: lastStationaryMs,
                cx: clickS.cx,
                cy: clickS.cy
            });
            while (c < rawSamples.length - 1 && rawSamples[c + 1].timeMs <= lastStationaryMs) {
                c++;
            }
        }
    }
}

console.log("Accurate dragIntervals:", dragIntervals);
console.log("Accurate typingIntervals count:", typingIntervals.length);
typingIntervals.forEach(t => console.log(`  Typing: ${t.startMs}ms to ${t.endMs}ms (${t.endMs - t.startMs}ms)`));
