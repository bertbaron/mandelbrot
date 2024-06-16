import * as fxp from "./fxp.mjs";
import {WorkerContext, smoothen} from "./workerContext.mjs";

export class MandelbrotPerturbation {
    /**
     * @param {WorkerContext} ctx
     */
    constructor(ctx) {
        this.ctx = ctx
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
                timeHighPrecision: this.ctx.stats.timeSpendInHighPrecision,
                highPrecisionCalculations: this.ctx.stats.numberOfHighPrecisionPoints,
                lowPrecisionMisses: this.ctx.stats.numberOfLowPrecisionMisses,
            }
        })
    }

    calculate(values, smooth, w, h, topleft, bottomright, skipTopLeft) {
        const stats = this.ctx.stats
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
            if (this.ctx.shouldStop()) return
        }

        // We queue reference points in LRU order, the head pointing to the least recently successfully used reference point
        let head = this.referencePoints.length - 1
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

                    let refIndex = head
                    for (let ignored of this.referencePoints) {
                        let referencePoint = this.referencePoints[refIndex]
                        const rr = referencePoint[0][0]
                        const ri = referencePoint[0][1]
                        const zs = referencePoint[3]

                        const dcr = Number(re - rr.bigInt) / scaleFactor
                        const dci = Number(im - ri.bigInt) / scaleFactor
                        const [iter, zq] = this.mandlebrot_perturbation(dcr, dci, this.max_iter, bailout, zs)
                        if (iter >= 0) {
                            values[offset] = smoothen(smooth, offset, iter, zq)
                            found = true
                            stats.numberOfLowPrecisionPoints++
                            if (refIndex < head) {
                                head--
                                this.referencePoints[refIndex] = this.referencePoints[head]
                                this.referencePoints[head] = referencePoint
                            } else if (refIndex > head) {
                                for (let i = refIndex; i > head; i--) {
                                    this.referencePoints[i] = this.referencePoints[i - 1]
                                }
                                this.referencePoints[head] = referencePoint
                            }
                            break
                        }
                        stats.numberOfLowPrecisionMisses++
                        refIndex = (refIndex + 1) % this.referencePoints.length
                    }

                    const end = performance.now()
                    this.ctx.stats.timeSpendInLowPrecision += end - start
                    if (!found) {
                        const newRef = this.calculate_reference(rmin, imin, dr, di, scale, scaleValue, scaleFactor, x, y, bigBailout)
                        values[offset] = smoothen(smooth, offset, newRef[1], Number(newRef[2]) / scaleFactor)
                        this.referencePoints.unshift(newRef)
                        if (this.ctx.shouldStop()) return
                    }
                }
                re = re + dr.bigInt
            }
            im = im + di.bigInt
            if (this.ctx.shouldStop()) return
        }
    }

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
        this.ctx.stats.timeSpendInHighPrecision += end - start
        this.ctx.stats.numberOfHighPrecisionPoints++
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
