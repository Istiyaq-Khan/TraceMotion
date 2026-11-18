// Test Recordly 1:1 camera rig math
function testCameraRig() {
    const footageW = 1920;
    const footageH = 1080;
    const compW = 1920;
    const compH = 1080;
    const stageCenterX = compW / 2;
    const stageCenterY = compH / 2;
    const centerPt = [footageW / 2, footageH / 2];

    const targetZoomScale = 1.80;
    const marginPct = 12;
    const base = 1.0 - Math.min(0.4, marginPct / 100.0); // 0.88

    // Suppose user clicked at bottom right
    const focus = [1500, 800];

    console.log("Testing Zoom Trajectory:");
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps; // 0 to 1
        const z = 100 + (targetZoomScale * 100 - 100) * t; // 100 to 180
        const curScale = base * (z / 100.0);
        const progress = Math.max(0.0, Math.min(1.0, (z - 100.0) / ((targetZoomScale - 1.0) * 100.0)));

        const targetFocus = [
            centerPt[0] + (focus[0] - centerPt[0]) * progress,
            centerPt[1] + (focus[1] - centerPt[1]) * progress
        ];

        const rigPos = [
            stageCenterX - targetFocus[0] * curScale,
            stageCenterY - targetFocus[1] * curScale
        ];

        // Screen position of focus point
        const screenFocusX = rigPos[0] + focus[0] * curScale;
        const screenFocusY = rigPos[1] + focus[1] * curScale;

        // Screen position of footage center
        const screenCenterX = rigPos[0] + centerPt[0] * curScale;
        const screenCenterY = rigPos[1] + centerPt[1] * curScale;

        console.log(`t=${t.toFixed(1)}: z=${z.toFixed(0)}%, progress=${progress.toFixed(2)} | Focus on screen: (${screenFocusX.toFixed(1)}, ${screenFocusY.toFixed(1)}) | Center on screen: (${screenCenterX.toFixed(1)}, ${screenCenterY.toFixed(1)})`);
    }
}

testCameraRig();
