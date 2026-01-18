/**
 * @author Bert Baron
 */
import * as fxp from './fxp.mjs'
import * as palette from './palette.js'
import * as favorites from './favorites.js'
import * as mgpu from './mandelbrotWebGPU.mjs'
import {WorkerContext} from "./workerContext.mjs";

const SQUARE_SIZE = 32 // must be even or -1 for full-frame tasks
const DEFAULT_ITERATIONS = 1000
const DEFAULT_WORKER_COUNT   = navigator.hardwareConcurrency || 4
// const DEFAULT_WORKER_COUNT = 1

const MIN_PIXEL_SIZE = 1
const MAX_PIXEL_SIZE = 16


const MIN_ZOOM = fxp.fromNumber(1)

class MyWorker {
    constructor(taskqueue, resulthandler) {
        this.taskqueue = taskqueue
        this.resulthandler = resulthandler
        this.worker = new Worker('worker.js', {type: 'module'})
        this.worker.onmessage = (msg) => {
            this.onAnswer(msg.data)
        }
        this.busy = false
    }

    pickTask() {
        if (!this.busy && this.taskqueue.length > 0) {
            this.busy = true
            this.worker.postMessage(this.taskqueue.pop())
        }
    }

    onAnswer(answer) {
        this.busy = false
        this.resulthandler(answer)
        this.pickTask()
    }
}

class Mandelbrot {
    constructor(canvas, progress, paletteSelector) {
        this.canvas = canvas
        this.progress = progress
        this.taskqueue = []
        this.workers = []
        const workerCount = DEFAULT_WORKER_COUNT
        for (let i = 0; i < workerCount; i++) {
            let worker = new MyWorker(this.taskqueue, (result) => {
                this.onResult(result)
            })
            this.workers.push(worker)
        }

        this.mandelbrotGpu = new mgpu.MandelbrotWebGPU(this, new WorkerContext(), error => this.gpuErrorCallback(error))

        this.zoom = fxp.fromNumber(1)
        this.center = [fxp.fromNumber(-0.5), fxp.fromNumber(0)]
        this.max_iter = DEFAULT_ITERATIONS
        this.smooth = true
        this.useGpu = false

        this.palette = []
        this.paletteSelector = paletteSelector
        this.initPallete(false)
        this.paletteSelector.addListener(() => {
            this.initPallete(true)
        })

        // current rendering tasks
        this.jobToken = null // hmm, should be something like jobLevelToken
        this.tasksLeft = 0
        this.jobId = 0
        this.jobLevel = 0

        this.resized()
        this.resetStats()
    }

    gpuErrorCallback(message) {
        console.log(`GPU error: ${message}`)
        this.useGpu = false
        gpuToggle.checked = false
        gpuToggle.disabled = true
        gpuToggle.parentElement.setAttribute('title', 'WebGPU not supported');
        new bootstrap.Tooltip(gpuToggle.parentElement);
        redraw()
    }

    resetStats() {
        this.stats = {
            time: 0,
            timeHighPrecision: 0,
            highPrecisionCalculations: 0,
            lowPrecisionMisses: 0,
        }
    }

    setCenter(center) {
        this.center = center
        this._updatePrecision()
    }

    setZoom(zoom) {
        this.zoom = zoom
        this._updatePrecision()
    }

    _updatePrecision() {
        this.requiredPrecision = this.zoom.multiply(fxp.fromNumber(this.width).withScale(this.zoom.scale)).bits() + 5
        if (this.useGpu) {
            this.precision = Math.max(64, Math.ceil(this.requiredPrecision / 8) * 8)
        } else {
            this.precision = Math.max(58, this.requiredPrecision)
        }
        this.zoom = this.zoom.withScale(this.precision)
        this.center[0] = this.center[0].withScale(this.precision)
        this.center[1] = this.center[1].withScale(this.precision)
    }

    resized() {
        this.initOffscreens();
        this._updatePrecision()
    }

    initOffscreens() {
        this.width = this.canvas.width
        this.height = this.canvas.height
        this.offscreens = []
        for (let scale = MAX_PIXEL_SIZE; scale >= MIN_PIXEL_SIZE; scale /= 2) {
            let offscreen = new Offscreen(this.canvas, scale, scale === MAX_PIXEL_SIZE, scale === MIN_PIXEL_SIZE)
            this.offscreens.push(offscreen)
        }
    }

    initPallete(redraw) {
        this.palette = palette.initPallet(this.paletteSelector.palette, this.paletteSelector.density, this.paletteSelector.rotate, this.paletteSelector.exp, this.max_iter)
        renderPalette(this.palette)
        if (redraw) {
            const lastScreenNr = this.jobLevel < 1 ? this.offscreens.length : this.jobLevel - 1
            for (let screenNr = 0; screenNr <= lastScreenNr; screenNr++) {
                this.offscreens[screenNr] && this.offscreens[screenNr].render(this.palette, this.max_iter, this.smooth)
            }
            updatePermalink()
        }
    }

    _revokeJobToken() {
        if (this.jobToken) {
            URL.revokeObjectURL(this.jobToken)
            this.jobToken = null
        }
    }

    _createJobToken() {
        this.jobToken = URL.createObjectURL(new Blob())
    }

    startNextJob(resetCaches) {
        if (this.useGpu) {
            this.startNextGpuJob(resetCaches)
            return
        }
        this.jobLevel++
        if (!this.permalinkUpdated && (this.jobLevel === this.offscreens.length || performance.now() > this.jobStartTime + 500)) {
            this.permalinkUpdated = true
            updatePermalink()
        }
        if (this.jobLevel === 0) {
            let totalTasks = 0
            for (let screen of this.offscreens) {
                const w = screen.buffer.width
                const h = screen.buffer.height
                const rowsPerTask = SQUARE_SIZE === -1 ? h : SQUARE_SIZE
                const colsPerTask = SQUARE_SIZE === -1 ? w : SQUARE_SIZE
                totalTasks += Math.ceil(h / rowsPerTask) * Math.ceil(w / colsPerTask)
            }
            this.progress.start(totalTasks)
        }

        this._revokeJobToken()
        let taskNumber = 0
        if (this.jobLevel < this.offscreens.length) {
            this._createJobToken();
            const screen = this.offscreens[this.jobLevel];
            const buffer = screen.buffer
            const w = buffer.width
            const h = buffer.height
            const paramHash = `${this.max_iter}-${this.smooth}`

            const frameTopLeft = this.canvas2complex(0, 0)
            // We need to adjust for the case that the width or height is not dividable by the pixel size
            const roundup = (value) => Math.ceil(value / screen.scale) * screen.scale
            const frameBottomRight = this.canvas2complex(roundup(this.width), roundup(this.height))

            // For the fast low-precision calculations we could render rows to make calculating and rendering even faster
            // for now we focus on optimizing the heavy calculations where squares may provide a benefit
            const rowsPerTask = SQUARE_SIZE === -1 ? h : SQUARE_SIZE
            const colsPerTask = SQUARE_SIZE === -1 ? w : SQUARE_SIZE
            for (let i = 0; i < Math.ceil(h / rowsPerTask); i++) {
                const firstRow = i * rowsPerTask
                const lastRow = Math.min((i + 1) * rowsPerTask, h)
                for (let j = 0; j < Math.ceil(w / colsPerTask); j++) {
                    const firstCol = j * colsPerTask
                    const lastCol = Math.min((j + 1) * colsPerTask, w)
                    let task = {
                        type: 'task',
                        jobId: this.jobId,
                        jobToken: this.jobToken,
                        pixelSize: screen.scale,
                        taskNumber: taskNumber++,
                        xOffset: firstCol,
                        yOffset: firstRow,
                        w: lastCol - firstCol,
                        h: lastRow - firstRow,
                        frameWidth: w,
                        frameHeight: h,
                        frameTopLeft: frameTopLeft,
                        frameBottomRight: frameBottomRight,
                        paramHash: paramHash,
                        resetCaches: resetCaches,
                        skipTopLeft: this.jobLevel > 0,
                        smooth: this.smooth,
                        maxIter: this.max_iter,
                        precision: this.precision,
                        requiredPrecision: this.requiredPrecision
                    }
                    this.taskqueue.push(task)
                }
            }
            this.tasksLeft = this.taskqueue.length
            for (let worker of this.workers) {
                worker.pickTask()
            }
        } else {
            if (this.stats.time !== 0) {
                const time = this.stats.time
                const hpPercent = this.stats.timeHighPrecision / time * 100
                console.log(`Calculation time: ${this.stats.time.toFixed(0)}ms (${hpPercent.toFixed(0)}% in ${this.stats.highPrecisionCalculations} high precision points), ${this.stats.lowPrecisionMisses} low precision misses`)
            }
        }
    }

    onResult(answer) {
        if (this.useGpu) {
            this.onGpuResult(answer)
            return
        }
        // console.log(`Received answer from worker`)
        const task = answer.task
        if (task.jobToken !== this.jobToken) {
            return // ignore results from old render jobs
        }
        this.progress.update()
        if (answer.stats) {
            this.stats.time += answer.stats.time
            this.stats.timeHighPrecision += answer.stats.timeHighPrecision
            this.stats.highPrecisionCalculations += answer.stats.highPrecisionCalculations
            this.stats.lowPrecisionMisses += answer.stats.lowPrecisionMisses
        }

        // copy the result buffer into the screen buffer
        // TODO optimize for full-width tasks (fast floating-point rendered part)
        // let offset = task.offset
        // this.offscreens[this.jobLevel].values.set(answer.values, offset)
        // if (this.smooth) {
        //     this.offscreens[this.jobLevel].smooth.set(answer.smooth, offset)
        // }
        let offscreen = this.offscreens[this.jobLevel];
        for (let row = 0; row < task.h; row++) {
            let offset = (task.yOffset + row) * offscreen.buffer.width + task.xOffset
            offscreen.values.set(answer.values.subarray(row * task.w, (row + 1) * task.w), offset)
            if (this.smooth) {
                offscreen.smooth.set(answer.smooth.subarray(row * task.w, (row + 1) * task.w), offset)
            }
        }

        this.tasksLeft--
        if (this.tasksLeft === 0) {
            // const start = performance.now()
            offscreen.render(this.palette, this.max_iter, this.smooth)
            // const end = performance.now()
            // console.log(`Rendering@1/${this.offscreens[this.jobLevel].scale} total: ${(end-start).toFixed(1)}ms`)
            // if (this.jobLevel === 0) {
            //     console.log('l1')
            // }
            this.startNextJob()
        }
    }

    startNextGpuJob(resetCaches) {
        this._revokeJobToken()
        this._createJobToken();

        const screen = this.offscreens[this.offscreens.length - 1]
        const w = screen.buffer.width
        const h = screen.buffer.height

        this.progress.start(w * h)
        const paramHash = `${this.max_iter}-${this.smooth}`
        const frameTopLeft = this.canvas2complex(0, 0)
        // We need to adjust for the case that the width or height is not dividable by the pixel size
        const roundup = (value) => Math.ceil(value / screen.scale) * screen.scale
        const frameBottomRight = this.canvas2complex(roundup(this.width), roundup(this.height))

        const task = {
            type: 'task',
            jobId: this.jobId,
            jobToken: this.jobToken,
            pixelSize: screen.scale,
            taskNumber: 0,
            xOffset: 0,
            yOffset: 0,
            w: w,
            h: h,
            frameWidth: w,
            frameHeight: h,
            frameTopLeft: frameTopLeft,
            frameBottomRight: frameBottomRight,
            paramHash: paramHash,
            resetCaches: resetCaches,
            skipTopLeft: false,
            smooth: this.smooth,
            maxIter: this.max_iter,
            precision: this.precision,
            requiredPrecision: this.requiredPrecision
        }
        this.mandelbrotGpu.process(task)
    }

    onGpuResult(answer) {
        console.log(`Received worker answer`)
    }

    onGpuUpdate(answer) {
        if (answer.jobToken !== this.jobToken) {
            console.log("Outdated job")
            return
        }

        const screen = this.offscreens[this.offscreens.length - 1]
        screen.values.set(answer.values)
        if (this.smooth) {
            screen.smooth.set(answer.smooth)
        }
        let progress = answer.isFinished ? this.progress.tasks : Math.round((this.progress.tasks - this.progress.done) / 2)
        this.progress.update(progress)
        screen.render(this.palette, this.max_iter, this.smooth)

        if (!this.permalinkUpdated && (answer.isFinished || performance.now() > this.jobStartTime + 500)) {
            this.permalinkUpdated = true
            updatePermalink()
        }
    }

    async render(resetCaches) {
        this.taskqueue.length = 0
        this.jobId++
        this.jobLevel = -1
        this.jobStartTime = performance.now()
        this.permalinkUpdated = false
        this.resetStats()
        // console.log('Rendering...')
        this.startNextJob(resetCaches)
    }

    // x and y are canvas integer, returns a fixed-point complex number
    canvas2complex(x, y) {
        // Make sure x and y are integers because FxP.fromNumber(value, scale) will fail currently when the scale becomes very large
        x = Math.round(x)
        y = Math.round(y)
        const w = fxp.fromNumber(this.width, this.precision)
        const h = fxp.fromNumber(this.height, this.precision)
        let scale = this.zoom.multiply(w).divide(fxp.fromNumber(4, this.precision))
        let center = this.center
        let r = fxp.fromNumber(x, this.precision).subtract(w.divide(fxp.fromNumber(2, this.precision))).divide(scale)
        let i = fxp.fromNumber(y, this.precision).subtract(h.divide(fxp.fromNumber(2, this.precision))).divide(scale)
        return [r.add(center[0]), i.add(center[1])]
    }
}

class PaletteConfig {
    constructor(palette, density, rotate, exp) {
        this.palette = palette
        this.density = density
        this.rotate = rotate
        this.exp = exp
    }
}

class Offscreen {
    constructor(canvas, scale, first, last) {
        this.canvas = canvas
        this.scale = scale
        this.first = first
        this.last = last
        this.maincontext = canvas.getContext('2d')

        this.offscreen = document.createElement('canvas')
        this.offscreen.width = Math.ceil(this.canvas.width / scale)
        this.offscreen.height = Math.ceil(this.canvas.height / scale)
        this.offscreencontext = this.offscreen.getContext('2d')
        this.buffer = this.offscreencontext.createImageData(this.offscreen.width, this.offscreen.height)
        this.values = new Int32Array(this.buffer.width * this.buffer.height)
        this.smooth = new Uint8Array(this.buffer.width * this.buffer.height)

        this.smoothscreen = document.createElement('canvas')
        this.smoothscreen.width = this.offscreen.width
        this.smoothscreen.height = this.offscreen.height
        this.smoothscreencontext = this.smoothscreen.getContext('2d')
        this.smoothbuffer = this.smoothscreencontext.createImageData(this.smoothscreen.width, this.smoothscreen.height)
    }

    render(palette, max_iter, withSmooth) {
        const bufferData = this.buffer.data // Uint8ClampedArray
        const smoothData = this.smoothbuffer.data // Uint8ClampedArray
        const values = this.values // Float32Array
        const smooth = this.smooth // Uint8Array

        for (let i = 0; i < values.length; i++) {
            const iter = values[i]
            bufferData[i * 4] = palette[iter * 4]
            bufferData[i * 4 + 1] = palette[iter * 4 + 1]
            bufferData[i * 4 + 2] = palette[iter * 4 + 2]
            bufferData[i * 4 + 3] = palette[iter * 4 + 3]

            if (withSmooth) {
                smoothData[i * 4] = palette[iter * 4 + 4]
                smoothData[i * 4 + 1] = palette[iter * 4 + 5]
                smoothData[i * 4 + 2] = palette[iter * 4 + 6]
                smoothData[i * 4 + 3] = smooth[i]
            }
        }

        this.offscreencontext.putImageData(this.buffer, 0, 0)
        this.maincontext.imageSmoothingEnabled = false
        this.maincontext.drawImage(this.offscreen, 0, 0, this.offscreen.width * this.scale, this.offscreen.height * this.scale)
        if (withSmooth) {
            this.smoothscreencontext.putImageData(this.smoothbuffer, 0, 0)
            this.maincontext.drawImage(this.smoothscreen, 0, 0, this.smoothscreen.width * this.scale, this.smoothscreen.height * this.scale)
        }
    }
}

class ProgressMonitor {
    constructor(canvas) {
        this.canvas = canvas
        this.ctx = canvas.getContext('2d')
        this.ctx.fillStyle = 'black'
        this.ctx.fillRect(0, 0, canvas.width, canvas.height)
        this.tasks = 0
        this.done = 0
        this.lastUpdate = 0
        this.startTime = 0
    }

    start(tasks) {
        this.tasks = tasks
        this.done = 0
        this.lastUpdate = performance.now()
        this.startTime = this.lastUpdate
        this._draw(0)
        this.canvas.style.display = 'block'
    }

    update(amount = 1) {
        this.done = Math.min(this.done + amount, this.tasks)
        const now = performance.now()
        if (now - this.lastUpdate > 100) {
            const percent = this.done / this.tasks * 100
            // console.log(`Rendering ${percent.toFixed(0)}%`)
            this.lastUpdate = now
            this._draw(percent)
        }
        if (this.done === this.tasks) {
            this._draw(100)
            const jobTime = now - this.startTime
            // console.log(`Rendering completed in ${jobTime.toFixed(0)}ms`)
            document.getElementById('renderTimeValue').innerText = `${jobTime.toFixed(0)}ms`
            this.canvas.style.display = 'none'
        }
    }

    finish() {
        this.update(this.tasks)
    }

    _draw(percentage) {
        // draw a red arc on a white circle with a transparent background
        const ctx = this.ctx
        const width = this.canvas.width
        const height = this.canvas.height
        const radius = Math.min(width, height) / 2
        const centerX = width / 2
        const centerY = height / 2
        ctx.clearRect(0, 0, width, height)
        ctx.fillStyle = 'white'
        ctx.beginPath()
        ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI)
        ctx.fill()
        ctx.fillStyle = 'red'
        ctx.beginPath()
        ctx.arc(centerX, centerY, radius, 0, (1 - percentage / 100) * 2 * Math.PI)
        ctx.lineTo(centerX, centerY)
        ctx.fill()
    }
}

function renderPalette(palette) {
    const ctx = paletteCanvasElement.getContext('2d')
    const width = paletteCanvasElement.offsetWidth
    const height = paletteCanvasElement.offsetHeight
    paletteCanvasElement.width = width
    paletteCanvasElement.height = height
    const offset = 4
    const paletteSize = palette.length / 4 - offset
    for (let i = 0; i < paletteSize; i++) {
        const colorIndex = i + offset
        const pos = Math.floor(i * width / paletteSize)
        const w = Math.floor((i + 1) * width / paletteSize) - pos
        const r = palette[colorIndex * 4]
        const g = palette[colorIndex * 4 + 1]
        const b = palette[colorIndex * 4 + 2]
        ctx.fillStyle = `rgb(${r},${g},${b})`
        ctx.fillRect(pos, 0, w, height)
    }
}

function initMenu() {
    const menuToggle = document.getElementById("menu-toggle");
    menuToggle.addEventListener("click", function (e) {
        const menu = document.getElementById("settings")
        menu.classList.toggle("hidden")
        menuToggle.classList.toggle("hidden")
    })
}

initMenu()

const canvasElement = document.getElementById("mandelbrot-canvas")
const progressElement = document.getElementById("progress-canvas")
const paletteCanvasElement = document.getElementById("palette-canvas")

const tempCanvas = document.createElement('canvas');

class PaletteSelector {
    constructor() {
        this.listeners = []
        this.palette = palette.getPalette('original')
        this.density = 1
        this.rotate = 0
    }

    init() {
        const paletteMenu = document.getElementById("palette-menu");
        paletteMenu.innerHTML = "";
        // Populate the dropdown dynamically
        palette.palettes().forEach(p => {
            const listItem = document.createElement("li");
            listItem.classList.add('d-flex', 'align-items-center');
            const anchor = document.createElement("a");
            anchor.classList.add("dropdown-item");
            anchor.href = "#";
            anchor.dataset.paletteId = p.id
            anchor.classList.add('flex-grow-1', 'd-flex', 'align-items-center');
            if (p.id === this.palette.id) {
                anchor.classList.add("active")
            }

            // Palette preview canvas
            const preview = document.createElement("canvas");
            preview.width = 40;
            preview.height = 12;
            preview.style.verticalAlign = "middle";
            preview.style.marginRight = "8px";
            const ctx = preview.getContext("2d");
            for (let x = 0; x < preview.width; x++) {
                let color = p.getColor(x / preview.width * 100, 0);
                ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
                ctx.fillRect(x, 0, 1, preview.height);
            }

            anchor.appendChild(preview);
            // Palette name
            const nameSpan = document.createElement("span");
            nameSpan.textContent = p.name;
            anchor.appendChild(nameSpan);

            // Action buttons (edit / delete) - placed as sibling to the anchor so we don't nest interactive elements
            const actionsSpan = document.createElement('span');
            actionsSpan.className = 'palette-actions';
            // Only show edit/delete for custom palettes
            if (p.isCustom && p.isCustom()) {
                const editBtn = document.createElement('button');
                editBtn.type = 'button';
                editBtn.className = 'palette-action palette-edit';
                editBtn.title = 'Edit palette';
                editBtn.setAttribute('aria-label', 'Edit palette');
                editBtn.textContent = '✎';
                editBtn.dataset.paletteId = p.id;
                editBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    customPaletteComponent.editingId = p.id;
                    this.setPalette(palette.getPalette(p.id));
                    showCustomPaletteContainer();
                });
                actionsSpan.appendChild(editBtn);

                const deleteBtn = document.createElement('button');
                deleteBtn.type = 'button';
                deleteBtn.className = 'palette-action palette-delete';
                deleteBtn.title = 'Delete palette';
                deleteBtn.setAttribute('aria-label', 'Delete palette');
                deleteBtn.textContent = '🗑';
                deleteBtn.dataset.paletteId = p.id;
                deleteBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!confirm(`Delete palette "${p.name}"?`)) return;
                    palette.deleteCustomPalette(p.id);
                    // rebuild menu and pick a safe palette
                    paletteSelector.init();
                    // if the deleted palette was currently selected, pick the first available
                    if (paletteSelector.palette && paletteSelector.palette.id === p.id) {
                        const all = palette.palettes();
                        paletteSelector.setPalette(all[0]);
                    }
                    this.notifyListeners()
                });
                actionsSpan.appendChild(deleteBtn);
            }

            anchor.addEventListener("click", () => {
                this.setPalette(palette.getPalette(p.id))
                this.notifyListeners()
            });
            listItem.appendChild(anchor);
            listItem.appendChild(actionsSpan);
            paletteMenu.appendChild(listItem);
        });
        // Add custom palette option
        const addCustomLi = document.createElement("li");
        const addCustomAnchor = document.createElement("a");
        addCustomAnchor.classList.add("dropdown-item");
        addCustomAnchor.href = "#";
        addCustomAnchor.innerHTML = '<span style="font-weight:bold;">＋</span> Add custom palette';
        addCustomAnchor.addEventListener("click", () => {
            showCustomPaletteContainer();
        });
        addCustomLi.appendChild(addCustomAnchor);
        paletteMenu.appendChild(addCustomLi);

        this.densitySlider = document.getElementById("palette-density");
        this.densitySlider.addEventListener("input", () => {
            this.setDensity(this.densitySlider.value, true)
        });

        this.rotateSlider = document.getElementById("palette-rotate");
        this.rotateSlider.addEventListener("input", () => {
            this.setRotate(this.rotateSlider.value, true)
        });
    }

    setPalette(palette) {
        this.palette = palette
        const paletteMenu = document.getElementById("palette-menu")
        for (let child of paletteMenu.children) {
            const anchor = child.children[0]
            if (anchor.dataset.paletteId === palette.id) {
                anchor.classList.add("active")
            } else {
                anchor.classList.remove("active")
            }
        }
        // set the palette name as the button text
        document.getElementById("palette-dropdown").innerText = palette.name
    }

    setEmbeddedPalette(colors, mirror) {
        let paletteObject = palette.createPaletteFromColors('embedded', '<embedded>', colors, mirror)
        // loop trough all palettes. If there is a custom palette with the same colors, use that one instead
        for (let p of palette.palettes()) {
            if (p.isSamePalette(paletteObject)) {
                paletteObject = p
            }
        }
        this.setPalette(paletteObject)
    }

    setAnonymousPalette(palette) {
        this.palette = palette
    }

    setDensity(density, skipControl) {
        this.density = density
        // document.getElementById("palette-density-label").innerText = "Density (" + density + ")"
        skipControl || (this.densitySlider.value = this.density)
        this.notifyListeners()
    }

    setRotate(rotate, skipControl) {
        this.rotate = rotate
        // document.getElementById("palette-rotate-label").innerText = "Rotate (" + rotate + ")"
        skipControl || (this.rotateSlider.value = this.rotate)
        this.notifyListeners()
    }

    addListener(listener) {
        this.listeners.push(listener)
    }

    notifyListeners() {
        for (let listener of this.listeners) {
            listener(this.palette)
        }
    }
}

const paletteSelector = new PaletteSelector();

const fractal = new Mandelbrot(canvasElement, new ProgressMonitor(progressElement), paletteSelector)

let redrawTimeout = null;

async function redraw(resetCaches, cooldown) {
    showZoomFactor()
    if (redrawTimeout) {
        clearTimeout(redrawTimeout)
        redrawTimeout = null
    }

    if (cooldown) {
        redrawTimeout = setTimeout(() => {
            fractal.render(resetCaches)
            redrawTimeout = null;
        }, cooldown)
    } else {
        await fractal.render(resetCaches)
    }
}

function showZoomFactor() {
    const zoom = fractal.zoom.bigIntValue()
    const zoomStr = zoom.toString()
    const zoomExp = zoomStr.length - 1
    const zoomMantissa = zoomStr[0] + '.' + zoomStr.substring(1, 3)
    document.getElementById('zoomValue').innerText = `${zoomMantissa}e${zoomExp}`
}

let lastX = canvasElement.width / 2
let lastY = canvasElement.height / 2
let dragStart = null
// let dragged = false

const scaleFactor = 1.1;

function zoomWithClicks(clicks, cooldown) {
    zoomWithFactor(Math.pow(scaleFactor, clicks), cooldown)
}

function zoomWithFactor(factor, cooldown) {
    const lowerBound = MIN_ZOOM.withScale(fractal.precision)
    if (fractal.zoom.leq(lowerBound) && factor < 1) return
    let bigFactor = fxp.fromNumber(factor, fractal.precision);
    const ptr = fractal.canvas2complex(lastX, lastY)
    fractal.setCenter(ptr)
    fractal.setZoom(fractal.zoom.multiply(bigFactor).max(lowerBound))
    const newPtr = fractal.canvas2complex(lastX, lastY)
    fractal.setCenter([fractal.center[0].add(ptr[0].subtract(newPtr[0])), fractal.center[1].add(ptr[1].subtract(newPtr[1]))])
    scaleCanvas(factor, lastX, lastY)
    redraw(false, cooldown);
}

function handleScroll(evt) {
    updateMousePos(evt)
    const delta = evt.wheelDelta ? evt.wheelDelta / 40 : (evt.detail ? -evt.detail : 0)
    if (delta) zoomWithClicks(delta, 0) // TODO only apply a cooldown when rendering takes long
    evt.preventDefault()
}

function updateIterations(delta) {
    setIterations(fractal.max_iter + delta)
}

function setIterations(value) {
    const newIter = Math.min(100000, Math.max(100, value))
    if (newIter !== fractal.max_iter) {
        fractal.max_iter = newIter
        console.log(`max_iter: ${fractal.max_iter}`)
        fractal.initPallete()
        iterationsElement.value = fractal.max_iter
        redraw()
        return true
    }
    return false
}

function onMouseDown(evt) {
    updateMousePos(evt)
    dragStart = [lastX, lastY]
}

function onMouseMove(evt) {
    updateMousePos(evt)
    if (evt.type === "mousemove" && (evt.buttons & 1) === 0) {
        // Avoid dragging whem the mouse is hovered onto the canvas from the outside
        dragStart = null
        return
    }

    if (dragStart) {
        const ptr = fractal.canvas2complex(lastX, lastY)
        const startPtr = fractal.canvas2complex(dragStart[0], dragStart[1])
        fractal.center = [fractal.center[0].add(startPtr[0].subtract(ptr[0])), fractal.center[1].add(startPtr[1].subtract(ptr[1]))]
        panCanvas(lastX - dragStart[0], lastY - dragStart[1])
        dragStart = [lastX, lastY]
        redraw()
    }
}

// scales the current canvas image by the given factor around the given point
// This gives immediate feedback to the user, while the fractal is being rendered in the background
function scaleCanvas(factor, x, y) {
    // console.log(`Scaling canvas by ${factor} around (${x}, ${y})`)
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.drawImage(canvasElement, 0, 0);
    const ctx = canvasElement.getContext('2d');
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(factor, factor);
    ctx.translate(-x, -y);
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(canvasElement, 0, 0) //, -x, -y, canvasElement.width, canvasElement.height);
    ctx.restore();
}

function panCanvas(dx, dy) {
    const ctx = canvasElement.getContext('2d');
    ctx.save();
    ctx.translate(dx, dy);
    ctx.drawImage(canvasElement, 0, 0);
    ctx.restore();
}

function onMouseUp(evt) {
    updateMousePos(evt)
    dragStart = null
}

function updateMousePos(evt) {
    let x, y
    if (evt.touches && evt.touches.length > 0) {
        x = evt.touches[0].pageX - canvasElement.offsetLeft
        y = evt.touches[0].pageY - canvasElement.offsetTop
    } else {
        x = evt.offsetX || (evt.pageX - canvasElement.offsetLeft)
        y = evt.offsetY || (evt.pageY - canvasElement.offsetTop)
    }
    [lastX, lastY] = toGraphicsCoordinates(x, y)
}

function toGraphicsCoordinates(x, y) {
    return [x / canvasElement.offsetWidth * canvasElement.width, y / canvasElement.offsetHeight * canvasElement.height]
}

let devicePixelBoxSize = null

function onResize(entries) {
    // let debugText = `${canvasElement.offsetWidth}x${canvasElement.offsetHeight}`

    devicePixelBoxSize = null
    if (entries && entries.length > 0) {
        const entry = entries[0]
        if (entry.devicePixelContentBoxSize) {
            const w = entry.devicePixelContentBoxSize[0].inlineSize
            const h = entry.devicePixelContentBoxSize[0].blockSize
            if (w !== canvasElement.offsetWidth || h !== canvasElement.offsetHeight) {
                devicePixelBoxSize = [w, h]
            }
        }
    }
    fullResToggle.disabled = devicePixelBoxSize == null
    resizeToCanvasSize()
}

function resizeToCanvasSize() {
    let width = canvasElement.offsetWidth
    let height = canvasElement.offsetHeight

    if (fullResToggle.checked && devicePixelBoxSize != null) {
        [width, height] = devicePixelBoxSize
    }

    document.getElementById('sizeValue').innerText = `${width}x${height}`


    canvasElement.width = width
    canvasElement.height = height

    resizeTmpCanvas()
    fractal.resized()
    showZoomFactor()
    redraw()
}

function toggleFullScreen() {
    if (document.fullscreenElement) {
        document.exitFullscreen()
    } else {
        document.getElementById('main').requestFullscreen()
    }
}

const ELEMENTS_WITH_FS_CLASS = ['mandelbrot', 'palette-canvas', 'settings', 'footer', 'menu-toggle']

function resizeTmpCanvas() {
    tempCanvas.width = canvasElement.width
    tempCanvas.height = canvasElement.height
}

const debugElement = document.getElementById('debug')

const appElement = document.getElementById('app')
const iterationsElement = document.getElementById('max-iterations')
const fullScreenButton = document.getElementById('fullscreen')
const smoothToggle = document.getElementById('smooth')
const resetElement = document.getElementById('reset')
const fullResToggle = document.getElementById('fullres')
const gpuToggle = document.getElementById('gpu')
//const gpuLabel = document.querySelector('label[for="gpu"]');
// parent element of the gpuToggle
//const gpuParent = gpuToggle.parentElement


let lastTouchDistance = null
let lastTouchCenter = null

function initListeners() {
    addEventListener("fullscreenchange", (event) => {
        if (document.fullscreenElement) {
            for (let element of ELEMENTS_WITH_FS_CLASS) {
                document.getElementById(element).classList.add('fullscreen')
            }
            document.documentElement.setAttribute('data-bs-theme', 'dark')
            // Don't auto-hide the menu in full-screen mode for now because users may not be aware
            // of the hidden menu toggle button
            // document.getElementById('menu-toggle').classList.add('hidden')
            // document.getElementById('settings').classList.add('hidden')

        } else {
            for (let element of ELEMENTS_WITH_FS_CLASS) {
                document.getElementById(element).classList.remove('fullscreen')
            }
            document.documentElement.setAttribute('data-bs-theme', 'light')
        }
    });

    const tooltipList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]')).map(function (tooltipTriggerEl) {
        return new bootstrap.Tooltip(tooltipTriggerEl);
    });

    new ResizeObserver(onResize).observe(canvasElement)

    canvasElement.addEventListener('mousedown', onMouseDown)
    canvasElement.addEventListener('mousemove', onMouseMove)
    canvasElement.addEventListener('mouseup', onMouseUp)

    canvasElement.addEventListener('DOMMouseScroll', handleScroll, false)
    canvasElement.addEventListener('mousewheel', handleScroll, false)

    canvasElement.addEventListener('touchstart', (evt) => {
        if (evt.touches.length === 1) {
            onMouseDown(evt)
        }
        if (evt.touches.length === 2) {
            lastTouchDistance = Math.hypot(evt.touches[0].pageX - evt.touches[1].pageX, evt.touches[0].pageY - evt.touches[1].pageY)
            lastTouchCenter = [(evt.touches[0].pageX + evt.touches[1].pageX) / 2, (evt.touches[0].pageY + evt.touches[1].pageY) / 2]
        }
        evt.preventDefault()
    })
    canvasElement.addEventListener('touchmove', (evt) => {
        if (evt.touches.length === 1) {
            onMouseMove(evt)
            if (document.fullscreenElement != null) {
                // no preventDefault in full-screen mode because this may be used to exit full-screen
                evt.preventDefault()
            }
        }
        if (evt.touches.length === 2) {
            const newTouchDistance = Math.hypot(evt.touches[0].pageX - evt.touches[1].pageX, evt.touches[0].pageY - evt.touches[1].pageY)
            const newTouchCenter = [(evt.touches[0].pageX + evt.touches[1].pageX) / 2, (evt.touches[0].pageY + evt.touches[1].pageY) / 2]
            const factor = newTouchDistance / lastTouchDistance;

            [lastX, lastY] = toGraphicsCoordinates(newTouchCenter[0] - canvasElement.offsetLeft, newTouchCenter[1] - canvasElement.offsetTop)
            const [newX, newY] = toGraphicsCoordinates(lastTouchCenter[0] - canvasElement.offsetLeft, lastTouchCenter[1] - canvasElement.offsetTop)

            // Pan the canvas based on the movement of the center of the two fingers
            const ptr = fractal.canvas2complex(lastX, lastY)
            const startPtr = fractal.canvas2complex(newX, newY)
            fractal.center = [fractal.center[0].add(startPtr[0].subtract(ptr[0])), fractal.center[1].add(startPtr[1].subtract(ptr[1]))]
            panCanvas(lastX - newX, lastY - newY)

            zoomWithFactor(factor, 0)
            lastTouchDistance = newTouchDistance
            lastTouchCenter = newTouchCenter
            evt.preventDefault()
        }
    })
    canvasElement.addEventListener('touchend', (evt) => {
        onMouseUp(evt)
        lastTouchDistance = null
        lastTouchCenter = null
        // evt.preventDefault()
    })

    iterationsElement.addEventListener('change', (event) => {
        setIterations(parseInt(event.target.value))
    })
    iterationsElement.addEventListener('keydown', (event) => {
        event.stopPropagation()
    })
    smoothToggle.addEventListener('change', (event) => {
        fractal.smooth = event.target.checked
        redraw()
    })
    gpuToggle.addEventListener('change', (event) => {
        fractal.useGpu = event.target.checked
        redraw()
    })
    fullScreenButton.addEventListener('click', (event) => {
        toggleFullScreen()
    })
    fullResToggle.addEventListener('change', (event) => {
        resizeToCanvasSize()
        redraw()
    })

    resetElement.addEventListener('click', (event) => {
        reset();
    })
    document.getElementById("lucky-button").addEventListener('click', (event) => {
        iFeelLucky();
    })
    appElement.addEventListener('keydown', (event) => {
        activeComponent.onKeydown(event)
    })
}

function reset() {
    fractal.setZoom(fxp.fromNumber(1))
    fractal.setCenter([fxp.fromNumber(-0.5), fxp.fromNumber(0)])
    paletteSelector.setDensity(1)
    paletteSelector.setRotate(0)
    // paletteSelector.setExp(0.9)
    if (!setIterations(DEFAULT_ITERATIONS)) {
        redraw()
    }
}

function iFeelLucky() {
    const favorite = favorites.getRandomFavorite()
    initFromParams(favorite)
    fractal.initPallete()
    redraw()
}

function updatePermalink() {
    const url = new URL(window.location)
    const p = url.searchParams
    let palette = {
        id: paletteSelector.palette.id,
        density: paletteSelector.density,
        rotate: paletteSelector.rotate,
    }
    if (paletteSelector.palette.isCustom()) {
        palette.id = undefined
        const exported = paletteSelector.palette.export()
        palette.colors = exported.colors
        palette.mirror = exported.mirror
    }
    const params = {
        center: fractal.center,
        zoom: fractal.zoom,
        max_iter: fractal.max_iter,
        smooth: fractal.smooth,
        palette: palette
    }
    p.set('params', btoa(JSON.stringify(params)))

    window.history.replaceState({}, '', url)
}

function initUI() {
    paletteSelector.init();
}

// on load, check if there is a permalink in the url
function init() {
    initUI()
    const url = new URL(window.location)
    const params = url.searchParams.get('params')
    if (params) {
        initFromParams(params)
    }
    // resizeTmpCanvas()
    onResize()
    iterationsElement.value = fractal.max_iter
    smoothToggle.checked = fractal.smooth
    fractal.initPallete()
    for (let component of components) {
        component.init()
    }
    showSettingsContainer()
    initListeners()
    redraw()
}

function initFromParams(params) {
    const p = JSON.parse(atob(params))
    fractal.setZoom(fxp.fromJSON(p.zoom))
    fractal.setCenter(p.center.map(fxp.fromJSON))
    fractal.max_iter = p.max_iter
    fractal.smooth = p.smooth
    if (p.palette) {
        if (p.palette.colors) {
            paletteSelector.setEmbeddedPalette(p.palette.colors, p.palette.mirror)
        } else {
            paletteSelector.setPalette(palette.getPalette(p.palette.id))
        }
        paletteSelector.setDensity(p.palette.density)
        paletteSelector.setRotate(p.palette.rotate)
    }
    iterationsElement.value = fractal.max_iter
    smoothToggle.checked = fractal.smooth
}

class SettingsComponent {
    constructor() {
    }

    init() {
    }

    show() {
        const settingsContainer = document.getElementById('settings-container')
        settingsContainer.hidden = false
    }

    hide() {
        const settingsContainer = document.getElementById('settings-container')
        settingsContainer.hidden = true
    }

    onKeydown(event) {
        if (event.key === 'r') {
            // console.log('redraw')
            redraw(true)
        }
        if (event.key === 'Backspace') {
            reset()
        }

        if (event.key === '+' || event.key === '=') {
            updateIterations(100)
        }
        if (event.key === '-') {
            updateIterations(-100)
        }
        if (event.key === 's') {
            fractal.smooth = !fractal.smooth
            smoothToggle.checked = fractal.smooth
            redraw()
        }
        if (event.key === 'f') {
            toggleFullScreen()
        }
    }
}

class CustomPaletteComponent {
    constructor() {
        this.draggedElement = null;
        this.dropIndicator = document.createElement('div');
        this.dropIndicator.className = 'custom-palette-drop-indicator';
    }

    init() {
        const saveButton = document.getElementById('custom-palette-save')
        saveButton.addEventListener('click', this.save.bind(this))

        const cancelButton = document.getElementById('custom-palette-cancel')
        cancelButton.addEventListener('click', this.cancel.bind(this))

        const addColorButton = document.getElementById('add-custom-palette-color');
        addColorButton.addEventListener('click', () => {
            this.addColorInput('#ffffff');
            this.updated();
        });

        const mirrorCheckbox = document.getElementById('custom-palette-mirror');
        if (mirrorCheckbox) {
            mirrorCheckbox.addEventListener('change', () => {
                this.updated();
            });
        }
    }

    show() {
        this.previousPalette = paletteSelector.palette
        const customContainer = document.getElementById('custom-palette-container')
        customContainer.hidden = false

        const currentPalette = paletteSelector.palette
        let basePalette = palette.MANDELBROT
        if (currentPalette instanceof palette.IndexedPalette) {
            basePalette = currentPalette
        }
        const paletteData = basePalette.export()
        let paletteName = basePalette.name
        if (!this.editingId) {
            const basename = basePalette.name.replace(/ Copy( \(\d+\))?$/, '')
            let copyIndex = 1
            const palettes = palette.palettes();
            while (true) {
                const testName = `${basename} Copy${copyIndex > 1 ? ' (' + copyIndex + ')' : ''}`
                const exists = palettes.some(p => p.name === testName)
                if (!exists) {
                    paletteName = testName
                    break
                }
                copyIndex++
            }
        }
        document.getElementById('custom-palette-name').value = paletteName

        const colorsDiv = document.getElementById('custom-palette-colors');
        colorsDiv.innerHTML = '';
        paletteData.colors.forEach((color, idx) => {
            this.addColorInput(color, colorsDiv);
        });
        document.getElementById('custom-palette-mirror').checked = basePalette.mirror
    }

    addColorInput(color, parentDiv) {
        const colorsDiv = parentDiv || document.getElementById('custom-palette-colors');
        const wrapper = document.createElement('div');
        wrapper.className = 'input-group mb-1 custom-palette-row';
        wrapper.draggable = true;

        // Drag handle
        const handle = document.createElement('span');
        handle.className = 'input-group-text custom-palette-drag-handle';
        handle.title = 'Drag to reorder';
        handle.innerHTML = '&#x2630;'; // Unicode hamburger icon
        handle.setAttribute('tabindex', '0');
        wrapper.appendChild(handle);

        // Drag events
        handle.addEventListener('mousedown', (e) => {
            wrapper.classList.add('dragging');
        });
        handle.addEventListener('mouseup', (e) => {
            wrapper.classList.remove('dragging');
        });
        wrapper.addEventListener('dragstart', (e) => {
            this.draggedElement = wrapper;
            e.dataTransfer.effectAllowed = 'move';
            setTimeout(() => { wrapper.classList.add('hidden-drag'); }, 0);
        });
        wrapper.addEventListener('dragend', (e) => {
            this.draggedElement = null;
            wrapper.classList.remove('hidden-drag');
            wrapper.classList.remove('dragging');
            this.removeDropIndicator();
        });
        wrapper.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            // Show drop indicator above or below based on mouse position
            const rect = wrapper.getBoundingClientRect();
            const offset = e.clientY - rect.top;
            const insertAbove = offset < rect.height / 2;
            this.showDropIndicator(colorsDiv, wrapper, insertAbove);
        });
        wrapper.addEventListener('dragleave', (e) => {
            // Only remove if leaving the row entirely
            if (!wrapper.contains(e.relatedTarget)) {
                this.removeDropIndicator();
            }
        });
        wrapper.addEventListener('drop', (e) => {
            e.preventDefault();
            if (this.draggedElement && this.draggedElement !== wrapper) {
                const children = Array.from(colorsDiv.children).filter(el => !el.classList.contains('custom-palette-drop-indicator'));
                const dropIndex = children.indexOf(wrapper);
                const insertAbove = this.dropIndicator.parentNode === colorsDiv && this.dropIndicator.nextSibling === wrapper;
                if (insertAbove) {
                    colorsDiv.insertBefore(this.draggedElement, wrapper);
                } else {
                    colorsDiv.insertBefore(this.draggedElement, wrapper.nextSibling);
                }
                this.updated();
            }
            this.removeDropIndicator();
            this.updated();
        });

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = color;
        colorInput.className = 'form-control form-control-color custom-palette-color-input';
        colorInput.title = color;
        colorInput.addEventListener('input', () => {
            this.updated();
        });
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn btn-outline-danger btn-sm custom-palette-remove-btn';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => {
            colorsDiv.removeChild(wrapper);
            this.updated();
        });
        wrapper.appendChild(colorInput);
        wrapper.appendChild(removeBtn);
        colorsDiv.appendChild(wrapper);
    }

    showDropIndicator(colorsDiv, wrapper, insertAbove) {
        this.removeDropIndicator();
        if (insertAbove) {
            colorsDiv.insertBefore(this.dropIndicator, wrapper);
        } else {
            colorsDiv.insertBefore(this.dropIndicator, wrapper.nextSibling);
        }
    }

    removeDropIndicator() {
        if (this.dropIndicator.parentNode) {
            this.dropIndicator.parentNode.removeChild(this.dropIndicator);
        }
    }

    updated() {
        const customPalette = this.toPalette()
        paletteSelector.setAnonymousPalette(customPalette)
        paletteSelector.notifyListeners()
    }

    toPalette() {
        const colorInputs = document.querySelectorAll('#custom-palette-colors input[type="color"]');
        const colors = Array.from(colorInputs)
            .map(input => input.value)
        const name = document.getElementById('custom-palette-name').value || 'Custom Palette';
        const mirrored = document.getElementById('custom-palette-mirror').checked
        return palette.createPaletteFromColors("<tmp>", name, colors, mirrored)
    }

    save() {
        const customPalette = this.toPalette()
        if (this.editingId) {
            const exported = customPalette.export()
            palette.updateCustomPalette(this.editingId, exported)
            paletteSelector.init()
            paletteSelector.setPalette(palette.getPalette(this.editingId))
            this.previousPalette = palette.getPalette(this.editingId)
        } else {
            palette.addCustomPalette(customPalette)
            paletteSelector.init()
            paletteSelector.setPalette(customPalette)
            this.previousPalette = customPalette // avoid resetting on hide
        }
        showSettingsContainer()
    }

    cancel() {
        showSettingsContainer()
    }

    hide() {
        this.editingId = null
        const customContainer = document.getElementById('custom-palette-container')
        customContainer.hidden = true
        paletteSelector.setPalette(this.previousPalette)
        paletteSelector.notifyListeners()
    }

    onKeydown(event) {
        if (event.key === 'Escape') {
            showSettingsContainer();
        }
    }
}

let activeComponent = null;
const settingsComponent = new SettingsComponent();
const customPaletteComponent = new CustomPaletteComponent();
const components = [settingsComponent, customPaletteComponent];

function showSettingsContainer() {
    showComponent(settingsComponent)
}

function showCustomPaletteContainer() {
    showComponent(customPaletteComponent)
}

function showComponent(component) {
    if (activeComponent) {
        activeComponent.hide()
    }
    activeComponent = component
    component.show()
}

window.onload = init
