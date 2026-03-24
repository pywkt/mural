import * as svgControl from './svgControl.js';
import * as client from './client.js';
import { httpGet, httpPost, httpUpload, httpUploadRaw, httpDownload, throttle, show, hide, hideAll } from './utils.js';

let currentState = null;
let currentWorker = null;
let uploadConvertedCommands = null;

const el = (id) => document.getElementById(id);
const trigger = (element, eventName) => element.dispatchEvent(new Event(eventName, { bubbles: true }));

window.onload = function () {
    init();
};

async function checkIfExtendedToHome(extendToHomeTime) {
    await new Promise(r => setTimeout(r, extendToHomeTime * 1000));

    const waitPeriod = 2000;
    let done = false;
    while (!done) {
        try {
            const state = await httpGet("/getState");
            if (state.phase !== 'ExtendToHome') {
                adaptToState(state);
                done = true;
            } else {
                await new Promise(r => setTimeout(r, waitPeriod));
            }
        } catch (err) {
            alert("Failed to get current phase: " + err);
            location.reload();
        }
    }
}

function init() {
    async function doneWithPhase(custom) {
        hideAll(".muralSlide");
        show("loadingSlide");
        if (!custom) {
            custom = {
                url: "/doneWithPhase",
                data: {},
                commandName: "Done With Phase",
            };
        }

        try {
            const state = await httpPost(custom.url, custom.data || {});
            adaptToState(state);
        } catch {
            alert(`${custom.commandName} command failed`);
            location.reload();
        }
    }

    el("beltsRetracted").addEventListener("click", async function() {
        await client.leftRetractUp();
        await client.rightRetractUp();
        doneWithPhase();
    });

    el("distanceInput").addEventListener("input", function() {
        const val = parseInt(this.value);
        if (!isNaN(val) && val > 0) {
            const drawWidth = Math.round(val * 0.6);
            el("drawingAreaInfo").textContent = `Drawing area: ${drawWidth}mm wide`;
        } else {
            el("drawingAreaInfo").textContent = '';
        }
    });

    el("setDistance").addEventListener("click", function() {
        const inputValue = parseInt(el("distanceInput").value);
        if (isNaN(inputValue)) {
            throw new Error("input value is not a number");
        }

        doneWithPhase({
            url: "/setTopDistance",
            data: {distance: inputValue},
            commandName: "Set Top Distance",
        });
    });

    el("quickStart").addEventListener("click", function() {
        const savedDistance = currentState.savedTopDistance;
        if (!savedDistance || savedDistance <= 0) {
            return;
        }
        doneWithPhase({
            url: "/resume",
            data: {distance: savedDistance},
            commandName: "Quick Start",
        });
    });

    el("leftMotorToggle").addEventListener("change", function() {
        if (this.checked) {
            client.leftRetractDown();
        } else {
            client.leftRetractUp();
        }
    });

    el("rightMotorToggle").addEventListener("change", function() {
        if (this.checked) {
            client.rightRetractDown();
        } else {
            client.rightRetractUp();
        }
    });

    el("extendToHome").addEventListener("click", async function() {
        this.disabled = true;
        el("extendingSpinner").style.visibility = 'visible';
        try {
            const res = await httpPost("/extendToHome");
            const extendToHomeTime = parseInt(res);
            await checkIfExtendedToHome(extendToHomeTime);
        } catch {}
    });

    function getServoValueFromInputValue() {
        const inputValue = parseInt(el("servoRange").value);
        const value = 90 - inputValue;
        return Math.max(0, Math.min(90, value));
    }

    el("servoRange").addEventListener("input", throttle(250, function () {
        const servoValue = getServoValueFromInputValue();
        httpPost("/setServo", {angle: servoValue});
    }));

    const stepValue = 5;
    el("penMinus").addEventListener("click", function() {
        el("servoRange").stepDown(stepValue);
        trigger(el("servoRange"), 'input');
    });

    el("penPlus").addEventListener("click", function() {
        el("servoRange").stepUp(stepValue);
        trigger(el("servoRange"), 'input');
    });

    el("setPenDistance").addEventListener("click", function () {
        const inputValue = getServoValueFromInputValue();
        doneWithPhase({
            url: "/setPenDistance",
            data: {angle: inputValue},
            commandName: "Set Pen Distance",
        });
    });

    const paperSizes = {
        'full': null,
        'letter-p': {width: 216, height: 279},
        'letter-l': {width: 279, height: 216},
        'a4-p': {width: 210, height: 297},
        'a4-l': {width: 297, height: 210},
        'a3-p': {width: 297, height: 420},
        'a3-l': {width: 420, height: 297},
        'custom': null,
    };

    function updatePaperSizeInfo() {
        const xOff = svgControl.getDrawingXOffset();
        const yOff = svgControl.getDrawingYOffset();
        const w = Math.round(svgControl.getTargetWidth());
        const h = Math.round(svgControl.getTargetHeight());
        if (xOff > 0 || yOff > 0) {
            el("paperSizeInfo").textContent = `Drawing: ${w} \u00d7 ${h}mm, centered on home position`;
        } else {
            el("paperSizeInfo").textContent = `Drawing: ${w} \u00d7 ${h}mm`;
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
            if (size) {
                svgControl.setPaperSize(size.width, size.height);
            } else {
                svgControl.setPaperSize(null, null);
            }
        }
        reloadSvgIfLoaded();
    }

    function reloadSvgIfLoaded() {
        const files = el("uploadSvg").files;
        if (files && files.length > 0) {
            files[0].text().then(function(svgString) {
                svgControl.setSvgString(svgString, currentState);
                updatePaperSizeInfo();
            });
        }
    }

    function centerRawCommands(text, state) {
        const lines = text.split('\n');
        const safeWidth = state.safeWidth;
        const homeY = state.homeY;

        const paperVal = el("paperSize").value;
        let paperSize = paperSizes[paperVal];
        if (paperVal === 'custom') {
            const w = parseFloat(el("customPaperWidth").value);
            const h = parseFloat(el("customPaperHeight").value);
            if (w > 0 && h > 0) paperSize = {width: w, height: h};
        }

        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const line of lines) {
            if (/^[\d.-]/.test(line)) {
                const parts = line.split(' ');
                if (parts.length === 2) {
                    const x = parseFloat(parts[0]);
                    const y = parseFloat(parts[1]);
                    if (!isNaN(x) && !isNaN(y)) {
                        minX = Math.min(minX, x);
                        maxX = Math.max(maxX, x);
                        minY = Math.min(minY, y);
                        maxY = Math.max(maxY, y);
                    }
                }
            }
        }

        if (minX === Infinity) return text;

        const drawingWidth = maxX - minX;
        const drawingHeight = maxY - minY;

        const mx = parseFloat(el("marginX").value) || 0;
        const my = parseFloat(el("marginY").value) || 0;

        let maxWidth = safeWidth - 2 * mx;
        if (paperSize) maxWidth = Math.min(paperSize.width - 2 * mx, safeWidth - 2 * mx);

        const xOffset = (maxWidth - drawingWidth) / 2 + (safeWidth - maxWidth) / 2 - minX;

        let yOffset = -minY + my;
        if (paperSize && homeY) {
            yOffset = homeY - drawingHeight / 2 - minY;
            if (yOffset + minY < my) yOffset = -minY + my;
        }

        return lines.map(function(line) {
            if (/^[\d.-]/.test(line)) {
                const parts = line.split(' ');
                if (parts.length === 2) {
                    const x = parseFloat(parts[0]);
                    const y = parseFloat(parts[1]);
                    if (!isNaN(x) && !isNaN(y)) {
                        return (x + xOffset) + ' ' + (y + yOffset);
                    }
                }
            }
            return line;
        }).join('\n');
    }

    el("paperSize").addEventListener("change", function() {
        if (this.value === 'custom') {
            show("customPaperInputs");
        } else {
            hide("customPaperInputs");
            applyPaperSize();
        }
    });

    el("customPaperWidth").addEventListener("change", applyPaperSize);
    el("customPaperHeight").addEventListener("change", applyPaperSize);

    el("marginX").addEventListener("change", updateMargin);
    el("marginY").addEventListener("change", updateMargin);
    function updateMargin() {
        svgControl.setMargin(
            parseFloat(el("marginX").value) || 0,
            parseFloat(el("marginY").value) || 0
        );
        reloadSvgIfLoaded();
    }

    function getUploadedSvgString() {
        const file = el("uploadSvg").files[0];
        return file ? file.text() : Promise.resolve(null);
    }

    function updateUploadProgress(evt) {
        if (evt.lengthComputable) {
            const pct = parseInt(evt.loaded / evt.total * 100);
            const bar = el("uploadProgressBar");
            if (bar) bar.style.width = pct + '%';
        }
    }

    el("uploadRawCommands").addEventListener("change", async function() {
        const file = this.files[0];
        if (!file) return;

        let text = await file.text();
        const ext = file.name.split('.').pop().toLowerCase();
        const isGcode = ['gcode', 'nc', 'ngc'].includes(ext);

        if (!isGcode && !text.startsWith('d')) {
            alert('Invalid command file: must start with a distance header (d...)');
            this.value = '';
            return;
        }

        // Centering only applies to mural format files
        if (!isGcode && el("centerRawCommands").checked && currentState) {
            text = centerRawCommands(text, currentState);
        }

        uploadConvertedCommands = text;

        hideAll(".muralSlide");
        show("uploadProgressSlide");

        try {
            const data = await httpUploadRaw("/uploadCommandsRaw", text, updateUploadProgress);
            verifyUpload(data);
        } catch (err) {
            alert('Upload to Mural failed! ' + err);
            window.location.reload();
        }
    });

    el("uploadSvg").addEventListener("change", async function() {
        const svgString = await getUploadedSvgString();
        if (svgString) {
            svgControl.setSvgString(svgString, currentState);
            updatePaperSizeInfo();

            document.querySelectorAll(".svg-control").forEach(e => e.style.display = '');
            el("preview").disabled = false;
        } else {
            el("preview").disabled = true;
            document.querySelectorAll(".svg-control").forEach(e => e.style.display = 'none');
            el("turdSize").value = 2;
            el("paperSizeInfo").textContent = '';
        }
    });

    let currentPreviewId = 0;
    let rendererFn = null;

    async function render_VectorRasterVector() {
        if (currentWorker) {
            currentWorker.terminate();
        }
        currentPreviewId++;
        const thisPreviewId = currentPreviewId;

        const svgString = await getUploadedSvgString();
        if (!svgString) throw new Error('No SVG string');

        el("progressBar").textContent = "Rasterizing";
        const raster = await svgControl.getCurrentSvgImageData();

        const vectorizeRequest = {
            type: 'vectorize',
            raster,
            turdSize: getTurdSize(),
        };

        if (currentPreviewId == thisPreviewId) {
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
                }
                else if (e.data.type === 'log') {
                    console.log(`Worker: ${e.data.payload}`);
                }
            }

            currentWorker.postMessage(vectorizeRequest);
        }
    }

    async function render_PathTracing() {
        if (currentWorker) {
            currentWorker.terminate();
        }
        currentPreviewId++;
        const thisPreviewId = currentPreviewId;

        const svgString = await getUploadedSvgString();
        if (!svgString) throw new Error('No SVG string');

        if (currentPreviewId == thisPreviewId) {
            currentWorker = new Worker(`./worker/worker.js?v=${Date.now()}`);
            currentWorker.onmessage = (e) => {
                if (e.data.type === 'status') {
                    el("progressBar").textContent = e.data.payload;
                }
                else if (e.data.type === 'log') {
                    console.log(`Worker: ${e.data.payload}`);
                }
            }

            const renderSvg = svgControl.getRenderSvg();
            const renderSvgString = new XMLSerializer().serializeToString(renderSvg);
            renderSvgInWorker(currentWorker, renderSvgString, svgControl.getTargetWidth(), svgControl.getTargetHeight());
        }
    }

    function renderSvgInWorker(worker, svg, svgWidth, svgHeight) {
        const svgJson = svgControl.getSvgJson(svg);

        const renderRequest = {
            type: "renderSvg",
            svgJson,
            width: svgControl.getTargetWidth(),
            height: svgControl.getTargetHeight(),
            svgWidth,
            svgHeight,
            homeX: currentState.homeX - svgControl.getDrawingXOffset(),
            homeY: currentState.homeY - svgControl.getDrawingYOffset(),
            infillDensity: getInfillDensity(),
            infillPattern: getInfillPattern(),
            infillSpacing: getInfillSpacing(),
            flattenPaths: getFlattenPaths(),
        }

        worker.onmessage = (e) => {
            if (e.data.type === 'status') {
                el("progressBar").textContent = e.data.payload;
            } else if (e.data.type === 'renderer') {
                console.log("Worker finished!");

                const xOffset = svgControl.getDrawingXOffset();
                const yOffset = svgControl.getDrawingYOffset();
                const hasOffset = xOffset > 0 || yOffset > 0;
                const offsetCommands = hasOffset
                    ? e.data.payload.commands.map(function(cmd) {
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
                uploadConvertedCommands = offsetCommands.join('\n');
                const resultSvgJson = e.data.payload.svgJson;
                const resultDataUrl = svgControl.convertJsonToDataURL(resultSvgJson, svgControl.getTargetWidth(), svgControl.getTargetHeight());

                const totalDistanceM = +(e.data.payload.distance / 1000).toFixed(1);
                const drawDistanceM = +(e.data.payload.drawDistance / 1000).toFixed(1);

                deactivateProgressBar();
                el("previewSvg").src = resultDataUrl;
                el("distances").textContent = `Total: ${totalDistanceM}m / Draw: ${drawDistanceM}m`;
                document.querySelectorAll(".svg-preview").forEach(e => e.style.display = '');
                el("acceptSvg").disabled = false;
            }
        };

        worker.postMessage(renderRequest);
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
        bar.textContent = "Success";
    }

    el("infillPattern").addEventListener("change", function() {
        if (this.value === 'none') {
            document.querySelectorAll(".infillSpacingControl").forEach(e => e.style.display = 'none');
        } else {
            document.querySelectorAll(".infillSpacingControl").forEach(e => e.style.display = '');
        }
    });

    el("infillSpacing").addEventListener("input", function() {
        el("infillSpacingValue").textContent = this.value;
    });

    ["infillPattern", "infillSpacing", "turdSize", "flattenPathsCheckbox"].forEach(function(id) {
        el(id).addEventListener("input", rerenderPreview);
        el(id).addEventListener("change", rerenderPreview);
    });
    async function rerenderPreview() {
        if (!rendererFn) return;
        activateProgressBar();
        el("acceptSvg").disabled = true;
        await rendererFn();
    }

    el("preview").addEventListener("click", function() {
        hide("svgUploadSlide");
        show("chooseRendererSlide");
    });

    el("pathTracing").addEventListener("click", async function() {
        el("turdSizeLabel").style.display = 'none';
        el("turdSize").style.display = 'none';
        el("flattenPathsLabel").style.display = '';
        el("flattenPathsCheckbox").style.display = '';

        hide("chooseRendererSlide");
        show("drawingPreviewSlide");
        rendererFn = render_PathTracing;
        await rendererFn();
    });

    el("vectorRasterVector").addEventListener("click", async function() {
        el("flattenPathsCheckbox").checked = false;
        el("turdSizeLabel").style.display = '';
        el("turdSize").style.display = '';
        el("flattenPathsLabel").style.display = 'none';
        el("flattenPathsCheckbox").style.display = 'none';

        hide("chooseRendererSlide");
        show("drawingPreviewSlide");
        rendererFn = render_VectorRasterVector;
        await rendererFn();
    });

    document.querySelectorAll(".backToSvgSelect").forEach(function(btn) {
        btn.addEventListener("click", function() {
            uploadConvertedCommands = null;

            document.querySelectorAll(".loading").forEach(e => e.style.display = '');
            activateProgressBar();
            el("previewSvg").removeAttribute("src");
            document.querySelectorAll(".svg-preview").forEach(e => e.style.display = 'none');
            el("acceptSvg").disabled = true;

            show("svgUploadSlide");
            hide("drawingPreviewSlide");
            hide("chooseRendererSlide");
        });
    });

    el("acceptSvg").addEventListener("click", async function() {
        if (!uploadConvertedCommands) {
            throw new Error('Commands are empty');
        }
        el("acceptSvg").disabled = true;

        hideAll(".muralSlide");
        show("uploadProgressSlide");

        try {
            const data = await httpUploadRaw("/uploadCommandsRaw", uploadConvertedCommands, updateUploadProgress);
            verifyUpload(data);
        } catch (err) {
            alert('Upload to Mural failed! ' + err);
            window.location.reload();
        }
    });

    el("drawSpeedSlider").addEventListener("input", function() {
        el("drawSpeedValue").textContent = this.value;
    });

    el("drawSpeedSlider").addEventListener("change", throttle(250, function() {
        httpPost("/setDrawSpeed", {speed: this.value});
    }));

    el("resetDrawSpeed").addEventListener("click", function() {
        const defaultSpeed = currentState ? currentState.defaultDrawSpeed : 500;
        el("drawSpeedSlider").value = defaultSpeed;
        el("drawSpeedValue").textContent = defaultSpeed;
        httpPost("/setDrawSpeed", {speed: defaultSpeed});
    });

    el("beginDrawing").addEventListener("click", function() {
        hideAll(".muralSlide");
        show("drawingBegan");
        httpPost("/run");

        const pollInterval = setInterval(async function() {
            try {
                const state = await httpGet("/getState");
                if (state.phase !== "BeginDrawing") {
                    clearInterval(pollInterval);
                    el("drawingStatusTitle").textContent = "Drawing Complete";
                    el("drawingStatusText").textContent = "The drawing has finished and the plotter has returned to the home position.";
                    show("newDrawing");
                    currentState = state;
                }
            } catch {
                // ESP may be busy or restarting, keep polling
            }
        }, 5000);
    });

    el("reset").addEventListener("click", function() {
        doneWithPhase();
        location.reload();
    });

    // Tools modal
    el("leftMotorTool").addEventListener("input", function() {
        const leftMotorDir = parseInt(this.value);
        if (leftMotorDir <= -1) {
            client.leftRetractDown();
        } else if (leftMotorDir >= 1) {
            client.leftExtendDown();
        } else {
            client.leftRetractUp();
        }
    });

    el("rightMotorTool").addEventListener("input", function() {
        const rightMotorDir = parseInt(this.value);
        if (rightMotorDir <= -1) {
            client.rightRetractDown();
        } else if (rightMotorDir >= 1) {
            client.rightExtendDown();
        } else {
            client.rightRetractUp();
        }
    });

    el("servoRangeTool").addEventListener("input", throttle(250, function () {
        const angle = 90 - parseInt(this.value);
        httpPost("/setServo", {angle: Math.max(0, Math.min(90, angle))});
    }));

    const servoToolStep = 5;
    el("servoMinusTool").addEventListener("click", function() {
        el("servoRangeTool").stepDown(servoToolStep);
        trigger(el("servoRangeTool"), 'input');
    });

    el("servoPlusTool").addEventListener("click", function() {
        el("servoRangeTool").stepUp(servoToolStep);
        trigger(el("servoRangeTool"), 'input');
    });

    el("parkServoTool").addEventListener("click", function() {
        el("servoRangeTool").value = 0;
        trigger(el("servoRangeTool"), 'input');
    });

    el("estepsTool").addEventListener("click", function() {
        httpPost("/estepsCalibration");
    });

    el("invertLeftMotor").addEventListener("change", function() {
        httpPost("/setMotorInversion", {left: this.checked});
    });

    el("invertRightMotor").addEventListener("change", function() {
        httpPost("/setMotorInversion", {right: this.checked});
    });

    el("invertServo").addEventListener("change", function() {
        httpPost("/setServoInversion", {inverted: this.checked});
    });

    el("penLiftAmount").addEventListener("input", function() {
        el("penLiftValue").textContent = this.value;
    });

    el("penLiftAmount").addEventListener("change", throttle(250, function() {
        httpPost("/setPenLift", {amount: this.value});
    }));

    document.querySelectorAll(".phaseBack").forEach(function(btn) {
        btn.addEventListener("click", async function() {
            const phase = this.dataset.phase;
            hideAll(".muralSlide");
            show("loadingSlide");
            try {
                const state = await httpPost("/setPhase", {phase});
                adaptToState(state);
            } catch {
                alert("Failed to go back");
                location.reload();
            }
        });
    });

    // Modal open/close
    el("openToolsModal").addEventListener("click", function() {
        el("toolsModal").classList.add("open");
    });

    el("closeToolsModal").addEventListener("click", closeToolsModal);

    el("toolsModalBackdrop").addEventListener("click", closeToolsModal);

    function closeToolsModal() {
        el("toolsModal").classList.remove("open");
        client.rightRetractUp();
        client.leftRetractUp();
    }

    svgControl.initSvgControl();

    show("loadingSlide");

    httpGet("/getState").then(function(data) {
        adaptToState(data);
    }).catch(function() {
        alert("Failed to retrieve state");
    });
}

async function verifyUpload(state) {
    // state may be a string (from httpUpload), try to parse it
    if (typeof state === 'string') {
        try { state = JSON.parse(state); } catch {}
    }

    try {
        const data = await httpDownload("/downloadCommands", function(evt) {
            if (evt.lengthComputable) {
                const pct = parseInt(evt.loaded / evt.total * 100);
                const bar = el("verificationBar");
                if (bar) bar.style.width = pct + '%';
            }
        });

        const receivedData = data.split('\n');
        const sentData = uploadConvertedCommands.split('\n');
        if (receivedData.length !== sentData.length) {
            alert("Data verification failed");
            window.location.reload();
            return;
        }
        for (let i = 0; i < receivedData.length; i++) {
            if (receivedData[i] !== sentData[i]) {
                alert("Data verification failed");
                window.location.reload();
                return;
            }
        }
        setTimeout(function() {
            adaptToState(state);
        }, 1000);
    } catch (err) {
        alert('Failed to download commands from Mural! ' + err);
        window.location.reload();
    }
}

function adaptToState(state) {
    hideAll(".muralSlide");
    currentState = state;

    if (state.leftMotorInverted !== undefined) {
        el("invertLeftMotor").checked = state.leftMotorInverted;
    }
    if (state.rightMotorInverted !== undefined) {
        el("invertRightMotor").checked = state.rightMotorInverted;
    }
    if (state.servoInverted !== undefined) {
        el("invertServo").checked = state.servoInverted;
    }
    if (state.penLiftAmount !== undefined) {
        el("penLiftAmount").value = state.penLiftAmount;
        el("penLiftValue").textContent = state.penLiftAmount;
    }

    switch(state.phase) {
        case "RetractBelts":
            show("retractBeltsSlide");
            break;
        case "SetTopDistance":
            if (state.topDistance > 0) {
                el("distanceInput").value = state.topDistance;
                el("drawingAreaInfo").textContent = `Drawing area: ${Math.round(state.topDistance * 0.6)}mm wide`;
            } else if (state.savedTopDistance > 0) {
                el("distanceInput").value = state.savedTopDistance;
                el("drawingAreaInfo").textContent = `Drawing area: ${Math.round(state.savedTopDistance * 0.6)}mm wide`;
            }
            if (state.savedTopDistance > 0) {
                show("quickStartSection");
            }
            show("distanceBetweenAnchorsSlide");
            break;
        case "ExtendToHome":
            show("extendToHomeSlide");
            if (state.moving || state.startedHoming) {
                el("extendToHome").disabled = true;
                el("extendingSpinner").style.visibility = 'visible';
                checkIfExtendedToHome();
            }
            break;
        case "PenCalibration":
            if (state.servoInverted) {
                httpPost("/setServo", {angle: 0});
                el("servoRange").value = 90;
            } else {
                httpPost("/setServo", {angle: 90});
                el("servoRange").value = 0;
            }
            show("penCalibrationSlide");
            break;
        case "SvgSelect":
            show("svgUploadSlide");
            break;
        case "BeginDrawing":
            if (state.drawSpeed !== undefined) {
                el("drawSpeedSlider").value = state.drawSpeed;
                el("drawSpeedValue").textContent = state.drawSpeed;
            }
            show("beginDrawingSlide");
            break;
        default:
            alert("Unrecognized phase");
    }
}

function getInfillDensity() {
    return getInfillPattern() === 'none' ? 0 : 1;
}

function getInfillPattern() {
    return el("infillPattern").value;
}

function getInfillSpacing() {
    return parseInt(el("infillSpacing").value);
}

function getTurdSize() {
    return parseInt(el("turdSize").value);
}

function getFlattenPaths() {
    return el("flattenPathsCheckbox").checked;
}
