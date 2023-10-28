import * as fxp from './fxp.mjs'

async function initJavascriptFloatImplementation() {
    await new Promise(resolve => setTimeout(resolve, 1))
    return new JavascriptImpl()
}

async function initJavascriptFixedPointImplementation() {
    await new Promise(resolve => setTimeout(resolve, 1))
    return new JavascriptFxPImpl()
}

async function initJavascriptPerturbationImplementation() {
    await new Promise(resolve => setTimeout(resolve, 1))
    return new JavascriptPerturbationImpl()
}

const javascriptFloatImplementation = initJavascriptFloatImplementation();
const javascriptFixedPointImplementation = initJavascriptFixedPointImplementation();
const javascriptPerturbationImplementation = initJavascriptPerturbationImplementation();

onmessage = handleMessage

// Add some randomnes to have different checkpoints per worker
const STOP_CHECK_INTERVAL = 200 + Math.floor(Math.random() * 100)

async function handleMessage(msg) {
    const message = parseMessage(msg)

    if (message.type === 'task') {
        const impl = message.requiredPrecision > 58 ? await javascriptPerturbationImplementation : await javascriptFloatImplementation
        // const impl = message.requiredPrecision > 58 ? await javascriptFixedPointImplementation : await javascriptFloatImplementation

        initTask(message.jobToken)
        // console.log('rendering...')
        resetStats()
        // const start = performance.now()
        impl.onTask(message)
        // const end = performance.now()
        // console.log(`Rendering:      ${(end - start).toFixed(1)}ms`)
        // console.log(`HP calculations ${timeSpendInHighPrecision.toFixed(1)}ms (${(timeSpendInHighPrecision / (end - start) * 100).toFixed(1)}%)`)
        // console.log(`LP calculations ${timeSpendInLowPrecision.toFixed(1)}ms (${(timeSpendInLowPrecision / (end - start) * 100).toFixed(1)}%)`)
        // console.log(`HP points       ${numberOfHighPrecisionPoints}`)
        // console.log(`LP points       ${numberOfLowPrecisionPoints}`)
        // console.log(`LP misses       ${numberOfLowPrecisionMisses}`)
        // console.log(`LP misses time  ${timeLostOnLowPrecisionMisses.toFixed(1)}ms`)
        // console.log(`+ Error offsets ${errorOffsetsPos}`)
        // console.log(`- Error offsets ${errorOffsetsNeg}`)
    }
}

let timeSpendInHighPrecision = 0
let timeSpendInLowPrecision = 0
let numberOfHighPrecisionPoints = 0
let numberOfLowPrecisionPoints = 0
let numberOfLowPrecisionMisses = 0
let timeLostOnLowPrecisionMisses = 0
let errorOffsetsPos = []
let errorOffsetsNeg = []

function resetStats() {
    timeSpendInHighPrecision = 0
    timeSpendInLowPrecision = 0
    numberOfHighPrecisionPoints = 0
    numberOfLowPrecisionPoints = 0
    numberOfLowPrecisionMisses = 0
    timeLostOnLowPrecisionMisses = 0
    errorOffsetsPos = []
    errorOffsetsNeg = []
}

function parseMessage(msg) {
    if (msg.data.type === 'task') {
        msg.data.topleft[0] = fxp.fromJSON(msg.data.topleft[0])
        msg.data.topleft[1] = fxp.fromJSON(msg.data.topleft[1])
        msg.data.bottomright[0] = fxp.fromJSON(msg.data.bottomright[0])
        msg.data.bottomright[1] = fxp.fromJSON(msg.data.bottomright[1])
        msg.data.frameTopLeft[0] = fxp.fromJSON(msg.data.frameTopLeft[0])
        msg.data.frameTopLeft[1] = fxp.fromJSON(msg.data.frameTopLeft[1])
        msg.data.frameBottomRight[0] = fxp.fromJSON(msg.data.frameBottomRight[0])
        msg.data.frameBottomRight[1] = fxp.fromJSON(msg.data.frameBottomRight[1])
    }
    return msg.data
}

class JavascriptImpl {
    onTask(task) {
        this.max_iter = task.maxIter
        const w = task.w
        const h = task.h
        const topleft = task.topleft
        const bottomright = task.bottomright

        const topLeftFloat = topleft.map(fixed => fixed.toNumber())
        const bottomRightFloat = bottomright.map(fixed => fixed.toNumber())

        const values = new Int32Array(w * h)
        const smooth = task.smooth ? new Uint8ClampedArray(w * h) : null
        this.calculate(values, smooth, w, h, topLeftFloat, bottomRightFloat, task.skipTopLeft, task.jobToken)

        postMessage({
            type: 'answer',
            task: task,
            values: values,
            smooth: smooth
        })
    }

    calculate(values, smooth, w, h, topleft, bottomright, skipTopLeft, jobToken) {
        const rmin = topleft[0]
        const rmax = bottomright[0]
        const imin = topleft[1]
        const imax = bottomright[1]
        const dr = (rmax - rmin) / w
        const di = (imax - imin) / h
        for (let y = 0; y < h; y++) {
            if (shouldStop(jobToken)) {
                return
            }
            let im = imin + di * y
            if (skipTopLeft && y % 2 === 0) {
                for (let x = 1; x < w; x += 2) {
                    this.calculatePixel(y, w, x, rmin, dr, im, values, smooth);
                }
            } else {
                for (let x = 0; x < w; x++) {
                    this.calculatePixel(y, w, x, rmin, dr, im, values, smooth);
                }
            }
        }
    }

    calculatePixel(y, w, x, rmin, dr, im, values, smooth) {
        let offset = y * w + x
        let re = rmin + dr * x
        if (smooth) {
            let [iter, zq] = this.mandelbrot(re, im, this.max_iter, 128)
            let nu = 1
            if (iter > 3) {
                let log_zn = Math.log(zq) / 2
                nu = Math.log(log_zn / Math.log(2)) / Math.log(2)
                iter = Math.floor(iter + 1 - nu)
                nu = nu - Math.floor(nu)
            }
            smooth[offset] = Math.floor(255 - 255 * nu)
            values[offset] = iter
        } else {
            values[offset] = this.mandelbrot(re, im, this.max_iter, 4)[0]
        }
    }

    mandelbrot(re, im, max_iter, bailout) {
        let zr = 0.0
        let zi = 0.0
        let iter = -1
        let zrq = 0.0
        let ziq = 0.0
        let zq = 0.0
        while (zq <= bailout) {
            zi = 2 * zr * zi + im
            zr = zrq - ziq + re
            if (iter++ === max_iter) {
                return [2, 0]
            }
            zrq = zr * zr
            ziq = zi * zi
            zq = zrq + ziq
        }
        return [iter + 4, zq]
    }
}

class JavascriptFxPImpl {
    onTask(task) {
        this.max_iter = task.maxIter
        const w = task.w
        const h = task.h
        const topleft = task.topleft
        const bottomright = task.bottomright

        const values = new Int32Array(w * h)
        const smooth = task.smooth ? new Uint8ClampedArray(w * h) : null
        this.calculate(values, smooth, w, h, topleft, bottomright, task.skipTopLeft)

        postMessage({
            type: 'answer',
            task: task,
            values: values,
            smooth: smooth
        })
    }

    calculate(values, smooth, w, h, topleft, bottomright, skipTopLeft) {
        const scale = BigInt(topleft[0].scale)
        const rmin = topleft[0]
        const rmax = bottomright[0]
        const imin = topleft[1]
        const imax = bottomright[1]
        const width = BigInt(w) << scale
        const height = BigInt(h) << scale
        const dr = ((rmax.bigInt - rmin.bigInt) << scale) / width
        const di = ((imax.bigInt - imin.bigInt) << scale) / height
        let im = imin.bigInt

        for (let y = 0; y < h; y++) {
            let re = rmin.bigInt
            const skipLeft = skipTopLeft && y % 2 === 0
            for (let x = 0; x < w; x++) {
                if (skipLeft && x % 2 === 0) {
                    // skip
                } else {
                    if (shouldStop()) {
                        return
                    }
                    this.calculatePixel(y, w, x, re, im, values, scale, smooth);
                }
                re = re + dr
            }
            im = im + di
        }
    }

    calculatePixel(y, w, x, re, im, values, scale, smooth) {
        const offset = y * w + x
        const bailout = smooth ? 128n << scale : 4n << scale
        let [iter, bigZq] = this.mandelbrot(re, im, this.max_iter, bailout, scale)
        values[offset] = smoothen(smooth, offset, iter, Number(bigZq) / Math.pow(2, Number(scale)))
    }

    mandelbrot(re, im, max_iter, bailout, scale) {
        const scale_1 = scale - 1n
        let zr = 0n
        let zi = 0n
        let iter = -1
        let zrq = 0n
        let ziq = 0n
        let zq = 0n
        while (zq <= bailout) {
            if (iter++ === max_iter) {
                return [2, 0]
            }
            zi = (zr * zi >> scale_1) + im
            zr = zrq - ziq + re
            zrq = (zr * zr) >> scale
            ziq = (zi * zi) >> scale
            zq = zrq + ziq
        }
        return [iter + 4, zq]
    }
}

export class JavascriptPerturbationImpl {
    constructor() {
        this.paramHash = null
        this.jobId = null
        this.referencePoints = []
    }

    onTask(task) {
        this.max_iter = task.maxIter
        const w = task.w
        const h = task.h
        const topleft = task.topleft
        const bottomright = task.bottomright

        if (task.jobId !== this.jobId) {
            this.jobId = task.jobId
            if (this.paramHash !== task.paramHash || this.referencePoints.length === 0 || task.resetCaches) {
                this.paramHash = task.paramHash
                this.referencePoints = []
            } else {
                // Keep reference points that are within the total frame when job parameters did not change
                const oldReferencePoints = this.referencePoints
                this.referencePoints = []
                const oldScale = oldReferencePoints[0][0][0].scale
                const newScale = topleft[0].scale
                if (newScale <= oldScale) {
                    const rmin = task.frameTopLeft[0].withScale(oldScale).bigInt
                    const rmax = task.frameBottomRight[0].withScale(oldScale).bigInt
                    const imin = task.frameTopLeft[1].withScale(oldScale).bigInt
                    const imax = task.frameBottomRight[1].withScale(oldScale).bigInt
                    for (let referencePoint of oldReferencePoints) {
                        const rr = referencePoint[0][0].bigInt
                        const ri = referencePoint[0][1].bigInt
                        if (rr >= rmin && rr <= rmax && ri >= imin && ri <= imax) {
                            referencePoint[0] = [referencePoint[0][0].withScale(newScale), referencePoint[0][1].withScale(newScale)]
                            this.referencePoints.push(referencePoint)
                        }
                    }
                }
            }
        }


        const values = new Int32Array(w * h)
        const smooth = task.smooth ? new Uint8ClampedArray(w * h) : null
        const start = performance.now()
        this.calculate(values, smooth, w, h, topleft, bottomright, task.skipTopLeft)
        const end = performance.now()

        postMessage({
            type: 'answer',
            task: task,
            values: values,
            smooth: smooth,
            stats: {
                time: end - start,
                timeHighPrecision: timeSpendInHighPrecision,
                highPrecisionCalculations: numberOfHighPrecisionPoints,
                lowPrecisionMisses: numberOfLowPrecisionMisses,
            }
        })
    }

    calculate(values, smooth, w, h, topleft, bottomright, skipTopLeft) {
        const scaleValue = topleft[0].scale
        const scaleFactor = Math.pow(2, Number(scaleValue))
        const scale = BigInt(scaleValue)
        const rmin = topleft[0]
        const rmax = bottomright[0]
        const imin = topleft[1]
        const imax = bottomright[1]
        const width = fxp.fromNumber(w, scaleValue)
        const height = fxp.fromNumber(h, scaleValue)
        const dr = rmax.subtract(rmin).divide(width) // can be a float?
        const di = imax.subtract(imin).divide(height) // can be a float?
        let im = imin.bigInt

        const bailout = smooth ? 128 : 4
        const bigBailout = BigInt(bailout) << scale

        if (this.referencePoints.length === 0) {
            this.referencePoints.push(this.calculate_reference(rmin, imin, dr, di, scale, scaleValue, scaleFactor, Math.trunc(w / 2), Math.trunc(h / 2), bigBailout))
            if (shouldStop()) return
        }

        let refIndex = 0
        let refDir = 1
        for (let y = 0; y < h; y++) {
            let re = rmin.bigInt
            const skipLeft = skipTopLeft && y % 2 === 0

            for (let x = 0; x < w; x++) {
                if (skipLeft && x % 2 === 0) {
                    // skip
                } else {
                    let found = false
                    const offset = y * w + x
                    const start = performance.now()

                    // loop over reference points and calculate perturbation until we find a valid result
                    let attempts = 0
                    for (let ignored of this.referencePoints) {
                        let referencePoint = this.referencePoints[refIndex]
                        if (!referencePoint[0]) {
                            console.log("WTF")
                        }
                        const rr = referencePoint[0][0]
                        const ri = referencePoint[0][1]
                        const zs = referencePoint[3]

                        const dcr = Number(re - rr.bigInt) / scaleFactor
                        const dci = Number(im - ri.bigInt) / scaleFactor
                        const [iter, zq] = this.mandlebrot_perturbation(dcr, dci, this.max_iter, bailout, zs)
                        if (iter >= 0) {
                            values[offset] = smoothen(smooth, offset, iter, zq)
                            found = true
                            numberOfLowPrecisionPoints++
                            if (attempts === 1) {
                                refDir *= -1 // prefer toggeling between succeeding reference points
                            }
                            break

                        }
                        numberOfLowPrecisionMisses++
                        attempts++
                        refIndex = (refIndex + refDir + this.referencePoints.length) % this.referencePoints.length
                    }

                    const end = performance.now()
                    timeSpendInLowPrecision += end - start
                    if (!found) {
                        const newRef = this.calculate_reference(rmin, imin, dr, di, scale, scaleValue, scaleFactor, x, y, bigBailout)
                        values[offset] = smoothen(smooth, offset, newRef[1], Number(newRef[2]) / scaleFactor)
                        this.referencePoints.push(newRef)
                        refIndex = this.referencePoints.length - 1
                        if (shouldStop()) return
                    }
                }
                re = re + dr.bigInt
            }
            im = im + di.bigInt
            if (shouldStop()) return
        }
    }

    // http://localhost:63342/wip/index.html?_ijt=9a2uiik3ascdj3hr7r9hea6ien&_ij_reload=RELOAD_ON_SAVE&params=eyJjZW50ZXIiOlt7ImJpZ0ludCI6Ii00MjI1MjY2NzUwNjQzNzg1MTg0Iiwic2NhbGUiOjYxfSx7ImJpZ0ludCI6Ii02MzgxMTE3MTY4NzcyNiIsInNjYWxlIjo2MX1dLCJ6b29tIjp7ImJpZ0ludCI6IjM4ODU5MzU4Mjc2NjM5MTc2NTcxMTM5MzM1NzQ2NzYwMSIsInNjYWxlIjo2MX0sIm1heF9pdGVyIjoxMDAwMCwic21vb3RoIjp0cnVlfQ%3D%3D

    mandlebrot_perturbation(dcr, dci, max_iter, bailout, zs) {
        // ε₀ = δ
        let ezr = dcr
        let ezi = dci

        let iter = -1
        let zzq = 0
        while (zzq <= bailout) {
            if (iter++ === max_iter) {
                return [2, 0]
            }
            if (iter >= zs.length) {
                // TODO make sure we don't get here by pre-caclulating enough (how do we know how many?) or extending the sequence from here
                // console.log('Not enough reference points')
                return [-1, zzq]
            }

            // Zₙ
            const _zsvalues = zs[iter]
            const zr = _zsvalues[0]
            const zi = _zsvalues[1]
            const zqErrorBound = _zsvalues[2]

            // Z'ₙ = Zₙ + εₙ
            const zzr = zr + ezr
            const zzi = zi + ezi

            // detect glitches
            // const zq =zr * zr + zi * zi
            zzq = zzr * zzr + zzi * zzi
            if (zzq < zqErrorBound) {
                return [-1, 0]
            }

            // εₙ₊₁ = 2·zₙ·εₙ + εₙ² + δ = (2·zₙ + εₙ)·εₙ + δ
            let zr_ezr_2 = 2 * zr + ezr;
            let zi_ezi_2 = 2 * zi + ezi;
            const _ezr = zr_ezr_2 * ezr - zi_ezi_2 * ezi
            const _ezi = zr_ezr_2 * ezi + zi_ezi_2 * ezr
            ezr = _ezr + dcr
            ezi = _ezi + dci
        }
        return [iter + 4, zzq]
    }

    calculate_reference(rmin, imin, dr, di, scale, scaleValue, scaleFactor, x, y, bailout) {
        const start = performance.now()
        const [rr, ri] = [rmin.add(dr.multiply(fxp.fromNumber(x, scaleValue))), imin.add(di.multiply(fxp.fromNumber(y, scaleValue)))]
        const [iter, zq, seq] = this.mandelbrot_high_precision(rr.bigInt, ri.bigInt, this.max_iter, bailout, scale)
        const zs = seq.map(([zr, zi]) => {
            // TODO Zq is already calculated. And dividing by factor of 2 may be faster
            let z_real = Number(zr) / scaleFactor;
            let z_imag = Number(zi) / scaleFactor;
            return [z_real, z_imag, (z_real * z_real + z_imag * z_imag) * 0.000001];
        })
        const end = performance.now()
        timeSpendInHighPrecision += end - start
        numberOfHighPrecisionPoints++
        return [[rr, ri], iter, zq, zs]
    }

    mandelbrot_high_precision(re, im, max_iter, bailout, scale) {
        const scale_1 = scale - 1n
        let zr = 0n
        let zi = 0n
        let iter = -1
        let zrq = 0n
        let ziq = 0n
        let zq = 0n
        const seq = []
        while (zq <= bailout) {
            if (iter++ === max_iter) {
                return [2, 0, seq]
            }
            zi = (zr * zi >> scale_1) + im
            zr = zrq - ziq + re
            zrq = (zr * zr) >> scale
            ziq = (zi * zi) >> scale
            zq = zrq + ziq
            seq.push([zr, zi])
        }
        let xiter = iter
        // perform a few more iterations to get complete reference sequence given the perturbation error margin
        while (xiter <= max_iter && zq <= 1n << 100n) { // TODO How big can we let zq become until the BigInt overhead outweighs just calculating another reference point?
            zi = (zr * zi >> scale_1) + im
            zr = zrq - ziq + re
            zrq = (zr * zr) >> scale
            ziq = (zi * zi) >> scale
            zq = zrq + ziq
            seq.push([zr, zi])
        }

        return [iter + 4, zq, seq]
    }
}

// Inserts the smooth value in the smooth buffer if any and returns the (potentially updated) iter value
function smoothen(smooth, offset, iter, zq) {
    let nu = 1
    if (smooth && iter > 3) {
        let log_zn = Math.log(zq) / 2
        nu = Math.log(log_zn / Math.log(2)) / Math.log(2)
        iter = Math.floor(iter + 1 - nu)
        nu = nu - Math.floor(nu)
        smooth[offset] = Math.floor(255 - 255 * nu)
    }
    return iter
}

let currentJob = null
let lastStoppedJob = null
let nextStopCheck = 0
let timeSpendInStopCheck = 0

function initTask(jobToken) {
    timeSpendInStopCheck = 0
    currentJob = jobToken
    nextStopCheck = performance.now() + STOP_CHECK_INTERVAL
}

function shouldStop() {
    const currentJobToken = currentJob
    const ts = performance.now()
    let shouldStop = false
    if (ts > nextStopCheck) {
        shouldStop = _shouldStop(currentJobToken)
        nextStopCheck = performance.now() + STOP_CHECK_INTERVAL
    }
    timeSpendInStopCheck += performance.now() - ts
    return shouldStop
}

function _shouldStop(jobToken) {
    let xhr = new XMLHttpRequest();
    xhr.open("GET", jobToken, /* async= */false);
    try {
        xhr.send(null);
    } catch (e) {
        return true // request failed, URL has been revoked
    }
    return false // URL is still valid, we can continue
}

export async function test_hook(algorithm, task) {
    let impl = null
    switch (algorithm) {
        case 'javascript_float':
            impl = await javascriptFloatImplementation
            break
        case 'javascript_fixed_point':
            impl = await javascriptFixedPointImplementation
            break
        case 'javascript_perturbation':
            impl = await javascriptPerturbationImplementation
            break
        default:
            throw new Error(`Unknown algorithm ${algorithm}`)
    }
    impl.onTask(task)
}