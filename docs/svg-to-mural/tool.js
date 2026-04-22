import * as svgControl from './svgControl.js';
import { throttle, show, hide } from './utils.js';

const el = (id) => document.getElementById(id);
const trigger = (el, name) => el.dispatchEvent(new Event(name, { bubbles: true }));

const HOME_Y_OFFSET_MM = 350;

let currentWorker = null;
let currentPreviewId = 0;
let rendererFn = null;
let convertedCommands = null;

function getDerivedState() {
    const anchorDistance = parseFloat(el("anchorDistance").value) || 1000;
    const safeWidth = anchorDistance * 0.6;
    return {
        topDistance: anchorDistance,
        safeWidth,
        homeX: safeWidth / 2,
        homeY: HOME_Y_OFFSET_MM,
    };
}

const paperSizes = {
    'full': null,
    'letter-p': { width: 216, height: 279 },
    'letter-l': { width: 279, height: 216 },
    'a4-p': { width: 210, height: 297 },
    'a4-l': { width: 297, height: 210 },
    'a3-p': { width: 297, height: 420 },
    'a3-l': { width: 420, height: 297 },
    'custom': null,
};

function updateDrawingAreaInfo() {
    const d = parseFloat(el("anchorDistance").value);
    const info = el("drawingAreaInfo");
    if (!isNaN(d) && d > 0) {
        info.textContent = `Drawing area: ${Math.round(d * 0.6)}mm wide.`;
    } else {
        info.textContent = '';
    }
}

function updatePaperSizeInfo() {
    const xOff = svgControl.getDrawingXOffset();
    const yOff = svgControl.getDrawingYOffset();
    const w = Math.round(svgControl.getTargetWidth());
    const h = Math.round(svgControl.getTargetHeight());
    if (w > 0 && h > 0) {
        el("paperSizeInfo").textContent = (xOff > 0 || yOff > 0)
            ? `Drawing: ${w} × ${h}mm, centered on home position`
            : `Drawing: ${w} × ${h}mm`;
    } else {
        el("paperSizeInfo").textContent = '';
    }
}

function applyPaperSize() {
    const val = el("paperSize").value;
    if (val === 'custom') {
        const w = parseFloat(el("customPaperWidth").value);
        const h = parseFloat(el("customPaperHeight").value);
        svgControl.setPaperSize(w, h);
    } else {
        const size = paperSizes[val];
        svgControl.setPaperSize(size ? size.width : null, size ? size.height : null);
    }
    reloadSvgIfLoaded();
}

function reloadSvgIfLoaded() {
    const files = el("uploadSvg").files;
    if (files && files.length > 0) {
        files[0].text().then(function (svgString) {
            svgControl.setSvgString(svgString, getDerivedState());
            updatePaperSizeInfo();
        });
    }
}

function updateMargin() {
    svgControl.setMargin(
        parseFloat(el("marginX").value) || 0,
        parseFloat(el("marginY").value) || 0,
    );
    reloadSvgIfLoaded();
}

function getUploadedSvgString() {
    const file = el("uploadSvg").files[0];
    return file ? file.text() : Promise.resolve(null);
}

function activateProgressBar() {
    const bar = el("progressBar");
    bar.classList.add("progress-bar-striped", "progress-bar-animated");
    bar.classList.remove("bg-success");
    bar.textContent = "";
}

function deactivateProgressBar() {
    const bar = el("progressBar");
    bar.classList.remove("progress-bar-striped", "progress-bar-animated");
    bar.classList.add("bg-success");
    bar.textContent = "Done";
}

async function render_VectorRasterVector() {
    if (currentWorker) currentWorker.terminate();
    currentPreviewId++;
    const thisId = currentPreviewId;

    const svgString = await getUploadedSvgString();
    if (!svgString) throw new Error('No SVG');

    el("progressBar").textContent = "Rasterizing";
    const raster = await svgControl.getCurrentSvgImageData();

    const vectorizeRequest = {
        type: 'vectorize',
        raster,
        turdSize: parseInt(el("turdSize").value),
    };

    if (thisId !== currentPreviewId) return;
    currentWorker = new Worker(`./worker/worker.js?v=${Date.now()}`);

    currentWorker.onmessage = (e) => {
        if (e.data.type === 'status') {
            el("progressBar").textContent = e.data.payload;
        } else if (e.data.type === 'vectorizer') {
            const vectorizedSvg = e.data.payload.svg;
            const scale = svgControl.getRenderScale();
            renderSvgInWorker(
                currentWorker,
                vectorizedSvg,
                svgControl.getTargetWidth() * scale,
                svgControl.getTargetHeight() * scale,
            );
        } else if (e.data.type === 'log') {
            console.log(`Worker: ${e.data.payload}`);
        }
    };

    currentWorker.postMessage(vectorizeRequest);
}

async function render_PathTracing() {
    if (currentWorker) currentWorker.terminate();
    currentPreviewId++;
    const thisId = currentPreviewId;

    const svgString = await getUploadedSvgString();
    if (!svgString) throw new Error('No SVG');

    if (thisId !== currentPreviewId) return;
    currentWorker = new Worker(`./worker/worker.js?v=${Date.now()}`);
    currentWorker.onmessage = (e) => {
        if (e.data.type === 'status') {
            el("progressBar").textContent = e.data.payload;
        } else if (e.data.type === 'log') {
            console.log(`Worker: ${e.data.payload}`);
        }
    };

    const renderSvg = svgControl.getRenderSvg();
    const renderSvgString = new XMLSerializer().serializeToString(renderSvg);
    renderSvgInWorker(
        currentWorker,
        renderSvgString,
        svgControl.getTargetWidth(),
        svgControl.getTargetHeight(),
    );
}

function renderSvgInWorker(worker, svg, svgWidth, svgHeight) {
    const svgJson = svgControl.getSvgJson(svg);
    const state = getDerivedState();

    const renderRequest = {
        type: "renderSvg",
        svgJson,
        width: svgControl.getTargetWidth(),
        height: svgControl.getTargetHeight(),
        svgWidth,
        svgHeight,
        homeX: state.homeX - svgControl.getDrawingXOffset(),
        homeY: state.homeY - svgControl.getDrawingYOffset(),
        infillDensity: el("infillPattern").value === 'none' ? 0 : 1,
        infillPattern: el("infillPattern").value,
        infillSpacing: parseInt(el("infillSpacing").value),
        flattenPaths: el("flattenPathsCheckbox").checked,
    };

    worker.onmessage = (e) => {
        if (e.data.type === 'status') {
            el("progressBar").textContent = e.data.payload;
        } else if (e.data.type === 'renderer') {
            const xOffset = svgControl.getDrawingXOffset();
            const yOffset = svgControl.getDrawingYOffset();
            const hasOffset = xOffset > 0 || yOffset > 0;
            const offsetCommands = hasOffset
                ? e.data.payload.commands.map(function (cmd) {
                    if (typeof cmd === 'string' && /^[\d.-]/.test(cmd)) {
                        const parts = cmd.split(' ');
                        if (parts.length === 2) {
                            const x = parseFloat(parts[0]) + xOffset;
                            const y = parseFloat(parts[1]) + yOffset;
                            return x + ' ' + y;
                        }
                    }
                    return cmd;
                })
                : e.data.payload.commands;
            convertedCommands = offsetCommands.join('\n');

            const resultSvgJson = e.data.payload.svgJson;
            const resultDataUrl = svgControl.convertJsonToDataURL(
                resultSvgJson,
                svgControl.getTargetWidth(),
                svgControl.getTargetHeight(),
            );

            const totalM = (e.data.payload.distance / 1000).toFixed(1);
            const drawM = (e.data.payload.drawDistance / 1000).toFixed(1);

            deactivateProgressBar();
            el("previewSvg").src = resultDataUrl;
            el("distances").textContent = `Total: ${totalM}m / Draw: ${drawM}m`;
            document.querySelectorAll(".svg-preview").forEach(e => e.style.display = '');
            el("download").disabled = false;
        }
    };

    worker.postMessage(renderRequest);
}

async function rerenderPreview() {
    if (!rendererFn) return;
    activateProgressBar();
    el("download").disabled = true;
    await rendererFn();
}

function suggestedFilename() {
    const f = el("uploadSvg").files[0];
    if (!f) return 'drawing.mural';
    return f.name.replace(/\.svg$/i, '') + '.mural';
}

function triggerDownload() {
    if (!convertedCommands) return;
    const blob = new Blob([convertedCommands], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedFilename();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function init() {
    svgControl.initSvgControl();
    updateDrawingAreaInfo();

    el("anchorDistance").addEventListener("input", function () {
        updateDrawingAreaInfo();
        reloadSvgIfLoaded();
    });

    el("paperSize").addEventListener("change", function () {
        if (this.value === 'custom') {
            show("customPaperInputs");
        } else {
            hide("customPaperInputs");
        }
        applyPaperSize();
    });
    el("customPaperWidth").addEventListener("change", applyPaperSize);
    el("customPaperHeight").addEventListener("change", applyPaperSize);

    el("marginX").addEventListener("change", updateMargin);
    el("marginY").addEventListener("change", updateMargin);

    el("uploadSvg").addEventListener("change", async function () {
        const svgString = await getUploadedSvgString();
        if (svgString) {
            svgControl.setSvgString(svgString, getDerivedState());
            updatePaperSizeInfo();
            document.querySelectorAll(".svg-control").forEach(e => e.style.display = '');
            show("rendererSection");
        } else {
            document.querySelectorAll(".svg-control").forEach(e => e.style.display = 'none');
            hide("rendererSection");
            hide("previewSection");
            el("paperSizeInfo").textContent = '';
        }
    });

    el("pathTracing").addEventListener("click", async function () {
        el("turdSizeLabel").style.display = 'none';
        el("turdSize").style.display = 'none';
        el("flattenPathsLabel").style.display = '';
        el("flattenPathsCheckbox").style.display = '';

        show("previewSection");
        rendererFn = render_PathTracing;
        await rerenderPreview();
    });

    el("vectorRasterVector").addEventListener("click", async function () {
        el("flattenPathsCheckbox").checked = false;
        el("turdSizeLabel").style.display = '';
        el("turdSize").style.display = '';
        el("flattenPathsLabel").style.display = 'none';
        el("flattenPathsCheckbox").style.display = 'none';

        show("previewSection");
        rendererFn = render_VectorRasterVector;
        await rerenderPreview();
    });

    el("infillPattern").addEventListener("change", function () {
        const show = this.value !== 'none';
        document.querySelectorAll(".infillSpacingControl").forEach(e => e.style.display = show ? '' : 'none');
    });

    el("infillSpacing").addEventListener("input", function () {
        el("infillSpacingValue").textContent = this.value;
    });

    ["infillPattern", "infillSpacing", "turdSize", "flattenPathsCheckbox"].forEach(function (id) {
        el(id).addEventListener("input", rerenderPreview);
        el(id).addEventListener("change", rerenderPreview);
    });

    el("download").addEventListener("click", triggerDownload);
}

window.onload = init;
