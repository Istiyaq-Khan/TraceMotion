const fs = require('fs');
const data = JSON.parse(fs.readFileSync('C:/Users/istiy/Videos/2026-11-19 01-56-53.mp4.cursor.json', 'utf8'));

console.log('Samples between 16500ms and 19500ms:');
data.samples.filter(s => s.timeMs >= 16500 && s.timeMs <= 19500).forEach(s => {
    if (s.interactionType !== 'move' || s.cursorType === 'text') {
        console.log(`t: ${s.timeMs}ms, cx: ${s.cx.toFixed(4)}, cy: ${s.cy.toFixed(4)}, itype: ${s.interactionType}, ctype: ${s.cursorType}`);
    }
});
