const fs = require('fs');
const path = require('path');
const sharp = require('D:/all my code/Recordly/node_modules/sharp');

const srcBase = 'D:/all my code/Recordly/src/assets/cursors';
const destBase = 'D:/all my code/TraceMotion/after-effects-importer/assets/cursors';

// Hotspot definitions extracted from Recordly uploadedCursorAssets.ts and render-tahoe-cursor-atlas.cjs
const HOTSPOTS = {
    tahoe: {
        arrow: { file: 'pointer-1__14-6.svg', anchorX: 0.14, anchorY: 0.06 },
        text: { file: 'ibeam-1__50-44.svg', anchorX: 0.50, anchorY: 0.44 },
        pointer: { file: 'pointinghand-1__40-10.svg', anchorX: 0.40, anchorY: 0.10 },
        crosshair: { file: 'crosshair-1__50-50.svg', anchorX: 0.50, anchorY: 0.50 },
        'open-hand': { file: 'openhand-1__55-57.svg', anchorX: 0.55, anchorY: 0.57 },
        'closed-hand': { file: 'closedhand-1__50-46.svg', anchorX: 0.50, anchorY: 0.46 },
        'resize-ew': { file: 'resizeeastwest-1__50-50.svg', anchorX: 0.50, anchorY: 0.50 },
        'resize-ns': { file: 'resizenorthsouth-1__50-49.svg', anchorX: 0.50, anchorY: 0.49 },
        'not-allowed': { file: 'notallowed-1__23-0.svg', anchorX: 0.23, anchorY: 0.00 },
        sizeMultiplier: 1.0
    },
    macos: {
        arrow: { file: 'pointer-1__34-24.svg', anchorX: 0.34, anchorY: 0.24 },
        text: { file: 'ibeamstroke-1__50-50.svg', anchorX: 0.50, anchorY: 0.50 },
        pointer: { file: 'pointinghand-1__39-26.svg', anchorX: 0.39, anchorY: 0.26 },
        crosshair: { file: 'crosshair-1__50-50.svg', anchorX: 0.50, anchorY: 0.50 },
        'open-hand': { file: 'openhand-1__50-50.svg', anchorX: 0.50, anchorY: 0.50 },
        'closed-hand': { file: 'closedhand-1__50-50.svg', anchorX: 0.50, anchorY: 0.50 },
        'resize-ew': { file: 'resizeeastwest-1__50-50.svg', anchorX: 0.50, anchorY: 0.50 },
        'resize-ns': { file: 'resizenorthsouth-1__50-50.svg', anchorX: 0.50, anchorY: 0.50 },
        'not-allowed': { file: 'notallowed-1__23-0.svg', anchorX: 0.23, anchorY: 0.00 },
        sizeMultiplier: 1.714
    },
    windows11: {
        arrow: { file: 'arrow__31-22.svg', anchorX: 0.00, anchorY: 0.00 },
        text: { file: 'text__50-50.svg', anchorX: 0.50, anchorY: 0.50 },
        pointer: { file: 'pointer__54-35.svg', anchorX: 6/32, anchorY: 0.00 },
        crosshair: { file: 'cross__50-50.svg', anchorX: 0.50, anchorY: 0.50 },
        'open-hand': { file: 'grab__50-50.svg', anchorX: 0.50, anchorY: 0.50 },
        'closed-hand': { file: 'grabbing__50-50.svg', anchorX: 0.50, anchorY: 0.50 },
        'resize-ew': { file: 'resize-horizontal__51-49.svg', anchorX: 11/32, anchorY: 4/32 },
        'resize-ns': { file: 'resize-vertical__48-50.svg', anchorX: 4/32, anchorY: 11/32 },
        'not-allowed': { file: 'block__50-50.svg', anchorX: 8/32, anchorY: 8/32 },
        sizeMultiplier: 1.6787
    },
    custom: {
        arrow: { file: 'minimal-cursor.svg', anchorX: 40/396, anchorY: 22/433 },
        pointer: { file: 'minimal-cursor.svg', anchorX: 40/396, anchorY: 22/433 },
        sizeMultiplier: 1.0
    }
};

async function processAll() {
    if (!fs.existsSync(destBase)) {
        fs.mkdirSync(destBase, { recursive: true });
    }

    const manifest = {
        generatedAt: new Date().toISOString(),
        sets: {}
    };

    const folders = ['tahoe', 'macos', 'windows11', 'custom'];
    for (const folder of folders) {
        const srcFolder = path.join(srcBase, folder);
        const destFolder = path.join(destBase, folder);
        if (!fs.existsSync(destFolder)) fs.mkdirSync(destFolder, { recursive: true });

        const files = fs.readdirSync(srcFolder).filter(f => f.endsWith('.svg'));
        console.log(`Processing folder: ${folder} (${files.length} svgs)`);

        manifest.sets[folder] = {
            id: folder,
            sizeMultiplier: HOTSPOTS[folder]?.sizeMultiplier || 1.0,
            cursors: {}
        };

        for (const file of files) {
            const srcPath = path.join(srcFolder, file);
            const destSvgPath = path.join(destFolder, file);
            fs.copyFileSync(srcPath, destSvgPath);

            const pngName = file.replace(/\.svg$/, '.png');
            const destPngPath = path.join(destFolder, pngName);

            // Rasterize to crisp high-res transparent PNG (height 512px)
            const meta = await sharp(srcPath).metadata();
            const naturalW = meta.width || 512;
            const naturalH = meta.height || 512;
            const targetH = 512;
            const targetW = Math.round((naturalW / naturalH) * targetH);

            await sharp(srcPath, { density: 300 })
                .resize({ width: targetW, height: targetH })
                .png()
                .toFile(destPngPath);

            // Infer hotspot from filename if not explicitly defined
            let anchorX = 0.5;
            let anchorY = 0.5;
            const match = file.match(/__(\d+)-(\d+)\.svg$/);
            if (match) {
                anchorX = parseInt(match[1], 10) / 100.0;
                anchorY = parseInt(match[2], 10) / 100.0;
            }

            // Check if explicitly mapped in HOTSPOTS
            let mappedType = null;
            if (HOTSPOTS[folder]) {
                for (const [ctype, cinfo] of Object.entries(HOTSPOTS[folder])) {
                    if (cinfo.file === file) {
                        mappedType = ctype;
                        anchorX = cinfo.anchorX;
                        anchorY = cinfo.anchorY;
                        break;
                    }
                }
            }

            const cursorEntry = {
                svgFile: file,
                pngFile: pngName,
                width: targetW,
                height: targetH,
                naturalWidth: naturalW,
                naturalHeight: naturalH,
                anchorX: Math.round(anchorX * 10000) / 10000,
                anchorY: Math.round(anchorY * 10000) / 10000
            };

            if (mappedType) {
                manifest.sets[folder].cursors[mappedType] = cursorEntry;
            }
            manifest.sets[folder].cursors[file.replace(/\.svg$/, '')] = cursorEntry;
        }
    }

    const manifestPath = path.join(destBase, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    console.log('Successfully written cursor manifest to:', manifestPath);
}

processAll().catch(err => {
    console.error('Error during asset porting:', err);
    process.exit(1);
});
