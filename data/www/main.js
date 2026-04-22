import * as client from './client.js';
import { httpGet, httpPost, httpUploadRaw, httpDownload, throttle, show, hide, hideAll } from './utils.js';

let currentState = null;
let uploadConvertedCommands = null;
let commandStats = null; // { drawDistance, travelDistance, penTransitions }

// Pulley geometry constants (from movement.h)
const CIRCUMFERENCE = 12.69 * Math.PI; // mm
const STEPS_PER_ROTATION = 200 * 8;    // 1/8 microstepping
const MOVE_SPEED_STEPS = 1500;

function stepsToMmPerSec(steps) {
    return steps * CIRCUMFERENCE / STEPS_PER_ROTATION;
}

function scanCommands(text) {
    const lines = text.split('\n');
    let penDown = false;
    let prevX = null, prevY = null;
    let drawDist = 0, travelDist = 0, transitions = 0;
    let isGcode = !text.startsWith('d');

    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        if (isGcode) {
            const upper = line.toUpperCase();
            if (upper.startsWith('M3') && !upper.startsWith('M30')) {
                if (!penDown) { penDown = true; transitions++; }
                continue;
            }
            if (upper.startsWith('M5')) {
                if (penDown) { penDown = false; transitions++; }
                continue;
            }
            const gMatch = upper.match(/^G([01])\b/);
            if (!gMatch) continue;
            const gCode = parseInt(gMatch[1]);
            const xMatch = upper.match(/X([-\d.]+)/);
            const yMatch = upper.match(/Y([-\d.]+)/);
            const x = xMatch ? parseFloat(xMatch[1]) : prevX;
            const y = yMatch ? parseFloat(yMatch[1]) : prevY;
            if (x === null || y === null) { prevX = x; prevY = y; continue; }

            const wantDown = (gCode === 1);
            if (wantDown !== penDown) {
                penDown = wantDown;
                transitions++;
            }

            if (prevX !== null && prevY !== null) {
                const d = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
                if (penDown) drawDist += d; else travelDist += d;
            }
            prevX = x;
            prevY = y;
        } else {
            if (line.startsWith('d') || line.startsWith('h')) continue;
            if (line.startsWith('p')) {
                const newDown = line.charAt(1) === '1';
                if (newDown !== penDown) { penDown = newDown; transitions++; }
                continue;
            }
            const spaceIdx = line.indexOf(' ');
            if (spaceIdx < 0) continue;
            const x = parseFloat(line.substring(0, spaceIdx));
            const y = parseFloat(line.substring(spaceIdx + 1));
            if (isNaN(x) || isNaN(y)) continue;

            if (prevX !== null && prevY !== null) {
                const d = Math.sqrt((x - prevX) ** 2 + (y - prevY) ** 2);
                if (penDown) drawDist += d; else travelDist += d;
            }
            prevX = x;
            prevY = y;
        }
    }

    return { drawDistance: drawDist, travelDistance: travelDist, penTransitions: transitions };
}

function updateTimeEstimate() {
    const display = el("timeEstimate");
    if (!display || !commandStats) {
        if (display) display.textContent = '';
        return;
    }

    const drawSpeed = parseInt(el("drawSpeedSlider").value) || 500;
    const servoDelay = parseInt(el("servoDelayMain").value) || 200;
    const penLift = currentState ? (currentState.penLiftAmount || 20) : 20;

    const drawSpeedMm = stepsToMmPerSec(drawSpeed);
    const travelSpeedMm = stepsToMmPerSec(MOVE_SPEED_STEPS);
    const servoMoveSec = penLift / 90;

    const drawTime = commandStats.drawDistance / drawSpeedMm;
    const travelTime = commandStats.travelDistance / travelSpeedMm;
    const penTime = commandStats.penTransitions * (servoMoveSec + servoDelay / 1000);

    const totalSec = drawTime + travelTime + penTime;
    const hours = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);

    let timeStr;
    if (hours > 0) {
        timeStr = `~${hours}h ${mins}m`;
    } else if (mins > 0) {
        timeStr = `~${mins}m`;
    } else {
        timeStr = '< 1m';
    }

    display.textContent = `Estimated draw time: ${timeStr}`;
}

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

function init() {
    async function doneWithPhase(custom) {
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
            await checkIfExtendedToHome(res.extendTime);
        } catch {}
    });

    el("skipExtend").addEventListener("click", async function() {
        try {
            const state = await httpPost("/setPhase", {phase: "PenCalibration"});
            adaptToState(state);
        } catch {
            alert("Failed to continue");
            location.reload();
        }
    });

    el("continueArtwork").addEventListener("click", async function() {
        try {
            const targetPhase = PHASE_ORDER[maxPhaseIdx] || "RetractBelts";
            const state = await httpPost("/setPhase", {phase: targetPhase});
            adaptToState(state);
        } catch {
            alert("Failed to continue");
            location.reload();
        }
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

    el("paperSize").addEventListener("change", function() {
        if (this.value === 'custom') {
            show("customPaperInputs");
        } else {
            hide("customPaperInputs");
        }
    });

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

        if (!isGcode && el("centerRawCommands").checked && currentState) {
            text = centerRawCommands(text, currentState);
        }

        uploadConvertedCommands = text;
        commandStats = scanCommands(text);

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

    function updateUploadProgress(evt) {
        if (evt.lengthComputable) {
            const pct = parseInt(evt.loaded / evt.total * 100);
            const bar = el("uploadProgressBar");
            if (bar) bar.style.width = pct + '%';
        }
    }

    el("drawSpeedSlider").addEventListener("input", function() {
        el("drawSpeedValue").textContent = this.value;
        updateTimeEstimate();
    });

    el("drawSpeedSlider").addEventListener("change", throttle(250, function() {
        httpPost("/setDrawSpeed", {speed: this.value});
    }));

    el("resetDrawSpeed").addEventListener("click", function() {
        const defaultSpeed = currentState ? currentState.defaultDrawSpeed : 500;
        el("drawSpeedSlider").value = defaultSpeed;
        el("drawSpeedValue").textContent = defaultSpeed;
        httpPost("/setDrawSpeed", {speed: defaultSpeed});
        updateTimeEstimate();
    });

    el("beginDrawing").addEventListener("click", function() {
        hideAll(".muralSlide");
        show("drawingBegan");
        el("stopDrawing").disabled = false;
        el("stopDrawing").style.display = '';
        // No polling during a draw — each /getState response briefly steals main-loop
        // CPU from the stepper task and causes visible motion stutter. User reloads
        // manually once the plot finishes (or the plotter restarts post-stop).
        httpPost("/run");
    });

    el("stopDrawing").addEventListener("click", async function() {
        if (!confirm("Stop the drawing and return to the home position?")) return;
        this.disabled = true;
        el("drawingStatusTitle").textContent = "Stopping...";
        el("drawingStatusText").textContent = "Finishing the current move, lifting the pen, and returning home. The plotter will restart when it reaches home — wait ~15 seconds, then reload to start a new drawing.";
        try {
            await httpPost("/stop");
        } catch {
            // ESP may reboot mid-request; the user will reload manually
        }
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

    function updateServoDelay(value) {
        el("servoDelay").value = value;
        el("servoDelayMain").value = value;
        httpPost("/setServoDelay", {delay: value});
        updateTimeEstimate();
    }

    el("servoDelay").addEventListener("change", function() {
        updateServoDelay(this.value);
    });

    el("servoDelayMain").addEventListener("change", function() {
        updateServoDelay(this.value);
    });

    el("resetServoDelay").addEventListener("click", function() {
        updateServoDelay(200);
    });

    el("resetServoDelayMain").addEventListener("click", function() {
        updateServoDelay(200);
    });

    async function loadDebugInfo() {
        const content = el("debugInfoContent");
        content.textContent = 'Loading...';
        try {
            const info = await httpGet("/debug");
            const uptime = info.uptimeSeconds;
            const hours = Math.floor(uptime / 3600);
            const mins = Math.floor((uptime % 3600) / 60);
            const secs = uptime % 60;

            const freeHeapPct = Math.round(info.freeHeap / info.heapSize * 100);
            const fsFreePct = Math.round((info.fsTotal - info.fsUsed) / info.fsTotal * 100);

            content.innerHTML =
                `<b>Last Reset:</b> ${info.resetReason}<br>` +
                `<b>Uptime:</b> ${hours}h ${mins}m ${secs}s<br>` +
                `<b>Free Heap:</b> ${(info.freeHeap / 1024).toFixed(1)}KB / ${(info.heapSize / 1024).toFixed(1)}KB (${freeHeapPct}%)<br>` +
                `<b>Min Free Heap:</b> ${(info.minFreeHeap / 1024).toFixed(1)}KB<br>` +
                `<b>WiFi RSSI:</b> ${info.wifiRSSI} dBm<br>` +
                `<b>IP:</b> ${info.wifiIP}<br>` +
                `<b>Filesystem:</b> ${(info.fsUsed / 1024).toFixed(1)}KB / ${(info.fsTotal / 1024).toFixed(1)}KB (${fsFreePct}% free)`;
        } catch (err) {
            content.textContent = 'Failed to load debug info: ' + err;
        }
    }

    function closeDebugModal() {
        el("debugModal").classList.remove("open");
    }

    el("openDebugModal").addEventListener("click", function() {
        el("debugModal").classList.add("open");
        loadDebugInfo();
    });
    el("closeDebugModal").addEventListener("click", closeDebugModal);
    el("closeDebugModalFooter").addEventListener("click", closeDebugModal);

    document.querySelectorAll(".phaseBack").forEach(function(btn) {
        btn.addEventListener("click", async function() {
            const phase = this.dataset.phase;
            try {
                const state = await httpPost("/setPhase", {phase});
                adaptToState(state);
            } catch {
                alert("Failed to go back");
                location.reload();
            }
        });
    });

    el("openToolsModal").addEventListener("click", function() {
        el("toolsModal").classList.add("open");
    });

    el("closeToolsModal").addEventListener("click", closeToolsModal);

    el("toolsModalBackdrop").addEventListener("click", function() {
        if (el("toolsModal").classList.contains("open")) closeToolsModal();
        if (el("debugModal").classList.contains("open")) closeDebugModal();
    });

    function closeToolsModal() {
        el("toolsModal").classList.remove("open");
        client.rightRetractUp();
        client.leftRetractUp();
    }

    httpGet("/getState").then(function(data) {
        adaptToState(data);
    }).catch(function() {
        alert("Failed to retrieve state");
    });
}

async function verifyUpload(state) {
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

const PHASE_ORDER = ["SetTopDistance", "SvgSelect", "RetractBelts", "ExtendToHome", "PenCalibration", "BeginDrawing"];
const CARD_BY_PHASE = {
    SetTopDistance: "distanceCard",
    SvgSelect: "artworkCard",
    RetractBelts: "retractCard",
    ExtendToHome: "extendCard",
    PenCalibration: "penCard",
    BeginDrawing: "beginCard",
};

let maxPhaseIdx = -1;

function setCardStates(currentPhase) {
    const currentIdx = PHASE_ORDER.indexOf(currentPhase);
    if (currentIdx > maxPhaseIdx) maxPhaseIdx = currentIdx;
    PHASE_ORDER.forEach(function(phase, idx) {
        const card = document.getElementById(CARD_BY_PHASE[phase]);
        if (!card) return;
        card.classList.remove("locked", "active", "completed");
        if (idx < currentIdx) card.classList.add("completed");
        else if (idx === currentIdx) card.classList.add("active");
        else card.classList.add("locked");
    });
}

function updateSummaries(state) {
    const dist = state.topDistance > 0 ? state.topDistance : state.savedTopDistance;
    if (dist > 0) {
        el("distanceSummary").textContent = `${dist}mm (${Math.round(dist * 0.6)}mm wide)`;
    }
}

function adaptToState(state) {
    currentState = state;

    if (state.leftMotorInverted !== undefined) el("invertLeftMotor").checked = state.leftMotorInverted;
    if (state.rightMotorInverted !== undefined) el("invertRightMotor").checked = state.rightMotorInverted;
    if (state.servoInverted !== undefined) el("invertServo").checked = state.servoInverted;
    if (state.penLiftAmount !== undefined) {
        el("penLiftAmount").value = state.penLiftAmount;
        el("penLiftValue").textContent = state.penLiftAmount;
    }
    if (state.servoDelay !== undefined) {
        el("servoDelay").value = state.servoDelay;
        el("servoDelayMain").value = state.servoDelay;
    }

    setCardStates(state.phase);
    updateSummaries(state);

    switch(state.phase) {
        case "RetractBelts":
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
            break;
        case "ExtendToHome": {
            const isHoming = state.moving || state.startedHoming;
            el("extendToHome").disabled = isHoming;
            el("extendingSpinner").style.visibility = isHoming ? 'visible' : 'hidden';
            const extendIdx = PHASE_ORDER.indexOf("ExtendToHome");
            el("skipExtend").style.display = (maxPhaseIdx > extendIdx && !isHoming) ? "" : "none";
            if (isHoming) checkIfExtendedToHome();
            break;
        }
        case "PenCalibration":
            if (state.servoInverted) {
                httpPost("/setServo", {angle: 0});
                el("servoRange").value = 90;
            } else {
                httpPost("/setServo", {angle: 90});
                el("servoRange").value = 0;
            }
            break;
        case "SvgSelect": {
            hideAll(".muralSlide");
            show("commandsUploadSlide");
            const svgIdx = PHASE_ORDER.indexOf("SvgSelect");
            el("continueArtwork").style.display = (maxPhaseIdx > svgIdx) ? "" : "none";
            break;
        }
        case "BeginDrawing":
            if (state.drawSpeed !== undefined) {
                el("drawSpeedSlider").value = state.drawSpeed;
                el("drawSpeedValue").textContent = state.drawSpeed;
            }
            updateTimeEstimate();
            hideAll(".muralSlide");
            show("beginDrawingSlide");
            break;
        default:
            alert("Unrecognized phase");
    }
}
