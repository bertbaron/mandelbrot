import * as fxp from './fxp.mjs'

const SQUARE_SIZE = 30 // must be even!
const DEFAULT_ITERATIONS = 1000
const DEFAULT_WORKER_COUNT = navigator.hardwareConcurrency || 4
// const DEFAULT_WORKER_COUNT = 1

const MIN_PIXEL_SIZE = 1
const MAX_PIXEL_SIZE = 16


const MIN_ZOOM = fxp.fromNumber(1)

//                                         253895167634803.88

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
    constructor(canvas, progress) {
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

        this.zoom = fxp.fromNumber(1)
        this.center = [fxp.fromNumber(-0.5), fxp.fromNumber(0)]
        this.max_iter = DEFAULT_ITERATIONS
        this.smooth = true

        this.palette = []
        this.initPallet()

        // current rendering tasks
        this.jobToken = null // hmm, should be something like jobLevelToken
        this.tasksLeft = 0
        this.jobId = 0
        this.jobLevel = 0

        this.resized()
        this.resetStats()
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
        this.requiredPrecision = Math.ceil(Math.log2(this.zoom.toNumber() * this.width)) + 4
        this.precision = Math.max(58, this.requiredPrecision)
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

    initPallet() {
        this.palette = initPallet(this.max_iter)
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
        this.jobLevel++
        if (!this.permalinkUpdated && (this.jobLevel === this.offscreens.length || performance.now() > this.jobStartTime + 500)) {
            this.permalinkUpdated = true
            updatePermalink()
            // console.log(`Required precision: ${this.requiredPrecision} bits (zoom=${this.zoom.toNumber().toExponential(2)})`)
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
        if (this.jobLevel < this.offscreens.length) {
            this._createJobToken();
            let screen = this.offscreens[this.jobLevel];
            let buffer = screen.buffer
            let w = buffer.width
            let h = buffer.height
            const paramHash = `${this.max_iter}-${this.smooth}`

            const frameTopLeft = this.canvas2complex(0, 0)
            const frameBottomRight = this.canvas2complex(this.width, this.height)

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
                        xOffset: firstCol,
                        yOffset: firstRow,
                        w: lastCol - firstCol,
                        h: lastRow - firstRow,
                        topleft: this.canvas2complex(firstCol * screen.scale, firstRow * screen.scale),
                        bottomright: this.canvas2complex(lastCol * screen.scale, lastRow * screen.scale),
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
        for (let row=0; row<task.h; row++) {
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

    async render(resetCaches) {
        this.taskqueue.length = 0
        this.jobId++
        this.jobLevel = -1
        this.jobStartTime = performance.now()
        this.permalinkUpdated = false
        this.resetStats()
        console.log('Rendering...')
        this.startNextJob(resetCaches)
    }

    // returns the last calculated value from the buffer, during rendering this may be inaccurate
    valueAt(x, y) {
        // todo fallback on higher layer when transparent
        const offscreen = this.offscreens[this.offscreens.length - 1]
        const index = y * this.width + x
        return offscreen.values[index]
    }

    // x and y are canvas integer, returns a fixed-point complex number
    canvas2complex(x, y) {
        const w = fxp.fromNumber(this.width, this.precision)
        const h = fxp.fromNumber(this.height, this.precision)
        let scale = this.zoom.multiply(w).divide(fxp.fromNumber(4, this.precision))
        let center = this.center
        let r = fxp.fromNumber(x, this.precision).subtract(w.divide(fxp.fromNumber(2, this.precision))).divide(scale)
        let i = fxp.fromNumber(y, this.precision).subtract(h.divide(fxp.fromNumber(2, this.precision))).divide(scale)
        return [r.add(center[0]), i.add(center[1])]
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

    update() {
        this.done++
        const now = performance.now()
        if (now - this.lastUpdate > 100) {
            const percent = this.done / this.tasks * 100
            // console.log(`Rendering ${percent.toFixed(0)}%`)
            this.lastUpdate = now
            this._draw(percent)
        }
        if (this.done === this.tasks) {
            const jobTime = now - this.startTime
            console.log(`Rendering completed in ${jobTime.toFixed(0)}ms`)
            this.canvas.style.display = 'none'
        }
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
        ctx.arc(centerX, centerY, radius, 0, (1-percentage/100) * 2 * Math.PI)
        ctx.lineTo(centerX, centerY)
        ctx.fill()
    }
}

function initPallet(max_iter) {
    const rgbaBuffer = new Uint8ClampedArray(max_iter * 4 + 20)
    // 0 and 1 = transparent (skipped), 2 and 3 = black (in set)
    // the first elements are doubled because we shift the palette by one for smoothing
    rgbaBuffer[11] = 255
    rgbaBuffer[15] = 255

    const palettes = [
        [[80, 81, 85], 610], // gold/blue
    ]
    const PAL = 0
    const wavelengths = palettes[PAL][0]
    const mirrorPosition = palettes[PAL][1]

    for (let i = 0; i <= max_iter; i++) {
        const adjusted = Math.pow(i, 0.9)
        // mirror i every mirrorPosition positions
        let idx = adjusted % (mirrorPosition * 2)
        if (idx >= mirrorPosition) {
            idx = mirrorPosition - (idx - mirrorPosition)
        }

        let r = Math.round(Math.sin(idx / wavelengths[0] * Math.PI) * 127) + 127
        let g = Math.round(Math.sin(idx / wavelengths[1] * Math.PI) * 127) + 127
        let b = Math.round(Math.sin(idx / wavelengths[2] * Math.PI) * 127) + 127

        // convert above srgb to linear rgb
        r /= 255
        g /= 255
        b /= 255
        r = r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4)
        g = g <= 0.04045 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4)
        b = b <= 0.04045 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4)
        rgbaBuffer[(i + 4) * 4] = Math.round(r * 255)
        rgbaBuffer[(i + 4) * 4 + 1] = Math.round(g * 255)
        rgbaBuffer[(i + 4) * 4 + 2] = Math.round(b * 255)
        rgbaBuffer[(i + 4) * 4 + 3] = 255
    }
    renderPalette(rgbaBuffer)
    return rgbaBuffer
}

function renderPalette(palette) {
    const ctx = paletteCanvasElement.getContext('2d')
    const width = paletteCanvasElement.width
    const height = paletteCanvasElement.height
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

const canvasElement = document.getElementById("mandelbrot-canvas")
const progressElement = document.getElementById("progress-canvas")
const paletteCanvasElement = document.getElementById("palette-canvas")

const tempCanvas = document.createElement('canvas');

const fractal = new Mandelbrot(canvasElement, new ProgressMonitor(progressElement))

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
    document.getElementById('value').innerText = `Zoom: ${fractal.zoom.toNumber().toExponential(2)}`
}

let lastX = canvasElement.width / 2
let lastY = canvasElement.height / 2
let dragStart = null
// let dragged = false

const scaleFactor = 1.1;

function zoom(clicks, cooldown) {
    const scale = fractal.precision
    const lowerBound = MIN_ZOOM.withScale(scale)
    if (fractal.zoom.leq(lowerBound) && clicks < 0) return

    const ptr = fractal.canvas2complex(lastX, lastY)
    fractal.setCenter(ptr)
    let factor = fxp.fromNumber(Math.pow(scaleFactor, clicks), scale);
    fractal.setZoom(fractal.zoom.multiply(factor).max(lowerBound))
    const newPtr = fractal.canvas2complex(lastX, lastY)
    fractal.setCenter([fractal.center[0].add(ptr[0].subtract(newPtr[0])), fractal.center[1].add(ptr[1].subtract(newPtr[1]))])

    scalesCanvas(factor.toNumber(), lastX, lastY)
    redraw(false, cooldown);
}

function handleScroll(evt) {
    updateMousePos(evt)
    const delta = evt.wheelDelta ? evt.wheelDelta / 40 : evt.detail ? -evt.detail : 0
    if (delta) zoom(delta, 0) // TODO only apply a cooldown when rendering takes long
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
        fractal.initPallet()
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
function scalesCanvas(factor, x, y) {
    // TODO Scale from original (last rendered) images to reduce distortion
    console.log(`Scaling canvas by ${factor} around (${x},${y})`)
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
    if (evt.touches && evt.touches.length > 0) {
        lastX = evt.touches[0].pageX - canvasElement.offsetLeft
        lastY = evt.touches[0].pageY - canvasElement.offsetTop
    } else {
        lastX = evt.offsetX || (evt.pageX - canvasElement.offsetLeft)
        lastY = evt.offsetY || (evt.pageY - canvasElement.offsetTop)
    }
}

function onResize() {
    console.log(`Resized to ${canvasElement.offsetWidth}x${canvasElement.offsetHeight}`)
    canvasElement.width = canvasElement.offsetWidth
    canvasElement.height = canvasElement.offsetHeight
    resizeTmpCanvas()
    fractal.resized()
    showZoomFactor()
    redraw();
}

new ResizeObserver(onResize).observe(canvasElement)

function resizeTmpCanvas() {
    tempCanvas.width = canvasElement.width
    tempCanvas.height = canvasElement.height
}

const debugElement = document.getElementById('debug')

const appElement = document.getElementById('app')
const iterationsElement = document.getElementById('max-iterations')
const fullScreenElement = document.getElementById('fullscreen')
const smoothElement = document.getElementById('smooth')
const resetElement = document.getElementById('reset')
canvasElement.addEventListener('mousedown', onMouseDown)
canvasElement.addEventListener('mousemove', onMouseMove)
canvasElement.addEventListener('mouseup', onMouseUp)

canvasElement.addEventListener('DOMMouseScroll', handleScroll, false)
canvasElement.addEventListener('mousewheel', handleScroll, false)

let lastTouchDistance = null
let lastTouchCenter = null
canvasElement.addEventListener('touchstart', (evt) => {
    if (evt.touches.length === 1) {
        onMouseDown(evt)
    }
    if (evt.touches.length === 2) {
        lastTouchDistance = Math.hypot(evt.touches[0].pageX - evt.touches[1].pageX, evt.touches[0].pageY - evt.touches[1].pageY)
        lastTouchCenter = [(evt.touches[0].pageX + evt.touches[1].pageX)/2, (evt.touches[0].pageY + evt.touches[1].pageY)/2]
    }
    // evt.preventDefault()
})
canvasElement.addEventListener('touchmove', (evt) => {
    if (evt.touches.length === 1) {
        onMouseMove(evt)
        if (!document.fullscreenElement == null) {
            // no preventDefault in full-screen mode because this may be used to exit full-screen
            evt.preventDefault()
        }
    }
    if (evt.touches.length === 2) {
        const newTouchDistance = Math.hypot(evt.touches[0].pageX - evt.touches[1].pageX, evt.touches[0].pageY - evt.touches[1].pageY)
        const newTouchCenter = [(evt.touches[0].pageX + evt.touches[1].pageX)/2, (evt.touches[0].pageY + evt.touches[1].pageY)/2]
        const delta = newTouchDistance - lastTouchDistance
        lastX = newTouchCenter[0] - canvasElement.offsetLeft
        lastY = newTouchCenter[1] - canvasElement.offsetTop
        zoom(delta/10, 0) // FIXME calculate a proper delta to correspond with touch positions
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
smoothElement.addEventListener('change', (event) => {
    fractal.smooth = event.target.checked
    redraw()
})
fullScreenElement.addEventListener('click', (event) => {
    document.documentElement.requestFullscreen()
})

function reset() {
    fractal.setZoom(fxp.fromNumber(1))
    fractal.setCenter([fxp.fromNumber(-0.5), fxp.fromNumber(0)])
    if (!setIterations(DEFAULT_ITERATIONS)) {
        redraw()
    }
}

resetElement.addEventListener('click', (event) => {
    reset();
})
appElement.addEventListener('keydown', (event) => {
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
        smoothElement.checked = fractal.smooth
        redraw()
    }
    if (event.key === 'f') {
        if (document.fullscreenElement) {
            document.exitFullscreen()
        } else {
            document.documentElement.requestFullscreen()
        }
    }
})

function updatePermalink() {
    const url = new URL(window.location)
    const p = url.searchParams
    const params = {
        center: fractal.center,
        zoom: fractal.zoom,
        max_iter: fractal.max_iter,
        smooth: fractal.smooth
    }
    p.set('params', btoa(JSON.stringify(params)))

    window.history.replaceState({}, '', url)
}

// on load, check if there is a permalink in the url
function init() {
    const url = new URL(window.location)
    const params = url.searchParams.get('params')
    if (params) {
        const p = JSON.parse(atob(params))
        fractal.setZoom(fxp.fromJSON(p.zoom))
        fractal.setCenter(p.center.map(fxp.fromJSON))
        fractal.max_iter = p.max_iter
        fractal.smooth = p.smooth
    }
    // resizeTmpCanvas()
    onResize()
    iterationsElement.value = fractal.max_iter
    smoothElement.checked = fractal.smooth
    fractal.initPallet()
    redraw()
}

window.onload = init
