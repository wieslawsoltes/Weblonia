/** Browser pixel comparisons against the same browser's Canvas2D text shaper.
 * This qualifies the browser-system-font -> Skia upload/composition path, not
 * equivalence between browser and native SkParagraph font engines.
 */
import * as A from '@wieslawsoltes/avalonia';

export async function RunTextQuality() {
    const platform = await A.SkiaPlatform.Initialize({
        assetBaseUrl: new URL('../vendor/', import.meta.resolve('@wieslawsoltes/skiasharpweb/browser')).href,
        TextTileSize: 128, TextCacheBytes: 4 * 1024 * 1024,
    });
    const S = platform.Api, results = [], gallery = document.getElementById('gallery');
    function assert(condition, message) { if (!condition) throw new Error(message); }
    function execute(name, fn) {
        try { const details = fn(); results.push({ Name: name, Passed: true, ...details }); }
        catch (error) { results.push({ Name: name, Passed: false, Error: error.stack }); }
    }
    function compare(name, { text, size = 24, family = 'serif', style = 'Normal', scale = 1, scaleY = scale, spacing = 0, width = 760, snapshot = false, x = 14.37, y = 20.21, color = '#000000', referenceComposition = 'direct' }) {
        const w = Math.ceil(width * scale), h = Math.ceil(125 * scaleY), origin = new A.Point(x, y), before = platform.GetDiagnostics();
        const surface = S.SKSurface.Create(new S.SKImageInfo(w, h)), context = new A.SkiaDrawingContext(platform, surface.Canvas, scale);
        const ref = document.createElement('canvas'); ref.width = w; ref.height = h;
        const r = ref.getContext('2d', { willReadFrequently: true }); r.fillStyle = 'white'; r.fillRect(0, 0, w, h);
        const layout = new A.TextLayout(text, new A.Typeface(family, style), size, A.Brush.Parse(color), { LetterSpacing: spacing });
        try {
            surface.Canvas.Clear(S.SKColors.White); surface.Canvas.Translate(.31, .63); surface.Canvas.Scale(scale, scaleY);
            context.DrawTextLayout(layout, origin);
            r.setTransform(scale, 0, 0, scaleY, .31, .63); A.ConfigureCanvasText(r, layout.Typeface, size, layout); r.fillStyle = color;
            for (const line of layout.TextLines) r.fillText(line.Text, origin.X + line.X, origin.Y + line.Y + line.Baseline);
            let directReference = null;
            if (referenceComposition === 'isolated-lines') {
                // The production system-font path caches one transparent layer per
                // line. Compare the SAME compositing boundary, independently: a
                // full-viewport Canvas2D layer, no production culling, tile planner,
                // phase rebasing or native Skia API. Repeated overlapping marks
                // accumulate different 8-bit rounding when drawn directly onto
                // opaque white versus first onto transparent black (Chromium 152).
                // Keep direct output as diagnostic evidence; NEVER raise tolerance.
                directReference = r.getImageData(0, 0, w, h).data;
                r.resetTransform(); r.fillStyle = 'white'; r.fillRect(0, 0, w, h);
                const layer = document.createElement('canvas'); layer.width = w; layer.height = h;
                const l = layer.getContext('2d', { willReadFrequently: true });
                A.ConfigureCanvasText(l, layout.Typeface, size, layout); l.fillStyle = color;
                for (const line of layout.TextLines) {
                    l.resetTransform(); l.clearRect(0, 0, w, h);
                    l.setTransform(scale, 0, 0, scaleY, .31, .63);
                    l.fillText(line.Text, origin.X + line.X, origin.Y + line.Y + line.Baseline);
                    r.drawImage(layer, 0, 0);
                }
            } else assert(referenceComposition === 'direct', 'Unknown reference compositing mode');
            const image = surface.Snapshot(); let actual;
            try { actual = image.ReadPixels(new S.SKImageInfo(w, h, S.SKColorType.Rgba8888, S.SKAlphaType.Unpremul)); }
            finally { image.Dispose(); }
            assert(actual?.length === w * h * 4, 'Missing native Skia pixel data');
            const expected = r.getImageData(0, 0, w, h).data;
            let max = 0, sum = 0, differences = 0, ink = 0, missingInk = 0, directMaximum = 0;
            for (let i = 0; i < expected.length; i += 4) {
                let pixelDelta = 0;
                for (let channel = 0; channel < 4; channel++) {
                    const delta = Math.abs(actual[i + channel] - expected[i + channel]);
                    if (directReference) directMaximum = Math.max(directMaximum, Math.abs(expected[i + channel] - directReference[i + channel]));
                    max = Math.max(max, delta); pixelDelta = Math.max(pixelDelta, delta); sum += delta;
                }
                if (pixelDelta > 2) ++differences;
                if (Math.min(expected[i], expected[i + 1], expected[i + 2]) < 250) {
                    ++ink;
                    if (Math.min(actual[i], actual[i + 1], actual[i + 2]) > 252) ++missingInk;
                }
            }
            assert(ink > 40, 'Reference text has no meaningful ink');
            // A two-level allowance covers RGBA premultiplication/unpremultiplication
            // rounding. Geometry or extra interpolation errors are substantially larger.
            assert(max <= 2, `${name}: maximum channel error ${max}, ${differences} pixels >2, missing ink ${missingInk}/${ink}`);
            if (snapshot) {
                const card = document.createElement('section'), caption = document.createElement('h2'); caption.textContent = name;
                const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; canvas.style.width = `${width}px`; canvas.style.maxWidth = '100%';
                canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(actual), w, h), 0, 0);
                card.append(caption, canvas); gallery.append(card);
            }
            return { ReferenceComposition: referenceComposition, DirectVersusIsolatedMaximum: directReference ? directMaximum : null, Lines: layout.TextLines.length, TextLinesVisited: platform.GetDiagnostics().TextLinesVisited - before.TextLinesVisited, DeviceScaleX: scale, DeviceScaleY: scaleY, MaximumChannelError: max, ComparedChannels: 4, MeanChannelError: sum / (w * h * 4), PixelsAboveTolerance: differences, ReferenceInkPixels: ink, MissingInkPixels: missingInk };
        } finally { layout.Dispose(); surface.Dispose(); }
    }
    for (const scale of [1, 1.25, 1.5, 2, 3]) {
        execute(`fractional origin / italic overhang / ${scale}x`, () => compare('Italic overhang · ' + scale + '×', { text: 'f fj Åg Élévation office affinity — 0123456789', style: 'Italic', scale, snapshot: scale === 1.25 }));
        execute(`combining marks and browser shaping / ${scale}x`, () => compare('Combining marks and mixed scripts · ' + scale + '×', { text: 'a\u0301\u0302\u0303\u0308  e\u0323\u0301  سلام  אבג  👨‍👩‍👧‍👦', family: 'sans-serif', size: 27, scale, snapshot: scale === 2 }));
        execute(`letter spacing / ${scale}x`, () => compare('Letter spacing · ' + scale + '×', { text: 'Render at the device grid, not on a scaled bitmap.', family: 'sans-serif', size: 16, spacing: 1.25, scale, color: '#335bb5', snapshot: scale === 1 }));
    }
    execute('nonuniform device scale preserves separate horizontal and vertical resolution', () => compare('Nonuniform scale', { text: 'Distinct device scales — italic fj', style: 'Italic', scale: 1.25, scaleY: 1.75 }));
    execute('long shaped line crosses many independently cached tile boundaries', () => compare('Long-line tiling · 128px tiles', { text: 'affinity office ffi fi fj '.repeat(30), style: 'Italic', scale: 1.5, width: 920, snapshot: true }));
    execute('deep horizontal scrolling preserves phase and skips offscreen tile planning', () => compare('Far-scrolled text', { text: 'affinity office fj '.repeat(1500), size: 18, style: 'Italic', scale: 1.25, width: 820, x: -20142.37 }));
    execute('10000-line document paints only visible lines after deep vertical scrolling', () => {
        const details = compare('Deeply scrolled document', { text: 'Readable document line — 0123456789\n'.repeat(10000), family: 'sans-serif', size: 14, scale: 1.25, y: -140000.43, width: 640, color: '#3156a5' });
        assert(details.TextLinesVisited <= 10, `Visited ${details.TextLinesVisited} of ${details.Lines} lines`);
        return details;
    });
    execute('ink-aware line culling preserves combining marks above their line boxes', () => {
        const lines = Array.from({length:2000}, () => 'text line');
        lines[1002] = 'a' + '\u0301'.repeat(18) + ' e' + '\u0308'.repeat(18);
        return compare('Overhanging line ink', { text: lines.join('\n'), family: 'serif', size: 24, scale: 1.5, y: -33600.4, width: 500, snapshot: true, referenceComposition: 'isolated-lines' });
    });
    for (const color of ['#335bb5', 'rgba(51,91,181,0.5)']) execute(`overlapping combining marks retain isolated RGBA composition ${color}`, () => {
        const text = 'a' + '\u0301'.repeat(18) + ' e' + '\u0308'.repeat(18);
        return compare('Isolated overlapping ink', { text, family: 'serif', size: 24, scale: 1.5, y: 88.4, width: 500,
            color, referenceComposition: 'isolated-lines' });
    });
    for (const scale of [1, 1.25, 1.5, 2, 3]) execute(`caret remains pixel-aligned and one nominal DIP / ${scale}x`, () => {
        const w = Math.ceil(100 * scale), h = Math.ceil(60 * scale), rect = new A.Rect(12.37, 8.11, 1, 20.18);
        const surface = S.SKSurface.Create(new S.SKImageInfo(w,h)), c = new A.SkiaDrawingContext(platform,surface.Canvas,scale);
        try {
            surface.Canvas.Clear(S.SKColors.White);surface.Canvas.Translate(.31,.63);surface.Canvas.Scale(scale,scale);
            // Native Skia stores its matrix as float32; derive the independent pixel
            // rectangle from that transform, including values near half-pixel ties.
            const matrix=surface.Canvas.TotalMatrix.Values;
            const left=Math.round(rect.X*matrix[0]+matrix[2]),top=Math.round(rect.Y*matrix[4]+matrix[5]);
            const right=left+Math.max(1,Math.round(rect.Width*matrix[0])),bottom=Math.round(rect.Bottom*matrix[4]+matrix[5]);
            c.DrawCaret(A.Brushes.Black,rect);
            const image=surface.Snapshot();let pixels;try{pixels=image.ReadPixels(new S.SKImageInfo(w,h,S.SKColorType.Rgba8888,S.SKAlphaType.Unpremul));}finally{image.Dispose();}
            let error=0;
            for(let y=0;y<h;y++)for(let x=0;x<w;x++){
                const expected=x>=left&&x<right&&y>=top&&y<bottom?0:255,offset=(y*w+x)*4;
                for(let ch=0;ch<3;ch++)error=Math.max(error,Math.abs(pixels[offset+ch]-expected));
                error=Math.max(error,Math.abs(pixels[offset+3]-255));
            }
            assert(error<=1,`Caret was filtered or misplaced; maximum channel error ${error}`);
            return {DeviceScaleX:scale,NominalWidth:1,DevicePixelWidth:right-left,MaximumChannelError:error,ComparedChannels:4};
        } finally {surface.Dispose();}
    });
    execute('offscreen portions do not rasterize or upload', () => {
        platform.TextImages.Clear(); const before = platform.GetDiagnostics();
        const layout = new A.TextLayout('Wide line '.repeat(1000), new A.Typeface('sans-serif'), 18);
        const surface = S.SKSurface.Create(new S.SKImageInfo(400, 120)), c = new A.SkiaDrawingContext(platform, surface.Canvas);
        try { c.DrawTextLayout(layout, new A.Point(5.4, 15.3)); }
        finally { layout.Dispose(); surface.Dispose(); }
        const after = platform.GetDiagnostics(), rasterized = after.TextRasterizations - before.TextRasterizations;
        const visited = after.TextTilesVisited - before.TextTilesVisited;
        assert(visited <= 5, `Visited ${visited} tiles for a 400px viewport`);
        assert(rasterized <= 5, `Rasterized ${rasterized} tiles for a 400px viewport`);
        return { VisitedTiles: visited, RasterizedVisibleTiles: rasterized, LineCharacters: 10000, ViewportWidth: 400 };
    });
    execute('1000 warm TextBlock redraws do not build layouts, rasterize, upload or measure', () => {
        const block = new A.TextBlock('Retained redraw: crisp text, unchanged content.'); block.FontFamily = 'sans-serif'; block.FontSize = 18;
        block.Measure(new A.Size(700, 80)); block.Arrange(new A.Rect(0, 0, 700, 80));
        const surface = S.SKSurface.Create(new S.SKImageInfo(700, 80)), c = new A.SkiaDrawingContext(platform, surface.Canvas);
        try {
            block.Render(c); const before = platform.GetDiagnostics(), count = A.GetTextLayoutStatistics().Created, start = performance.now();
            for (let i = 0; i < 1000; ++i) block.Render(c);
            const ms = performance.now() - start, after = platform.GetDiagnostics();
            const delta = Object.fromEntries(['TextRasterizations', 'TextUploads', 'TextMeasurements'].map(k => [k, after[k] - before[k]]));
            delta.TextLayouts = A.GetTextLayoutStatistics().Created - count;
            assert(Object.values(delta).every(n => n === 0), JSON.stringify(delta));
            return { Redraws: 1000, Milliseconds: ms, WorkDelta: delta };
        } finally { block.Dispose(); surface.Dispose(); }
    });
    const report = { Scope: 'Native Skia raster backend; browser-system-font shaping; positive affine device scales', PhysicalGPUQualified: false, PixelChannelTolerance: 2,
        Tests: results, Passed: results.filter(x => x.Passed).length, Failed: results.filter(x => !x.Passed).length, Renderer: platform.GetDiagnostics() };
    platform.Dispose(); return report;
}
