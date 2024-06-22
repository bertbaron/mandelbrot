import * as fxp from "./fxp.mjs";
import {smoothen, WorkerContext} from "./workerContext.mjs";

/**
 * Similar to MandelbrotPerturbation class. That one uses floating point numbers for fast calculations. Those numbers
 * are typically very small, so we can't use them for deep zoom levels (above approx. 1e300) due to the limitations of
 * the number type.
 * In this class we use the FlP class that can handle much smaller numbers. Though not as fast as floating point it is
 * still much faster than performing all calculations in BigInt.
 *
 * We should try to share code with MandelbrotPerturbation of course, but need to test if this doesn't affect performance
 * as Javascript/jit optimization might be affected by the different types.
 */
export class MandelbrotPerturbationExtFloat {
    /**
     * @param {WorkerContext} ctx
     */
    constructor(ctx) {
        this.ctx = ctx
        this.paramHash = null
        this.jobId = null
        this.referencePoints = []
    }

    process(task){
        this.max_iter = task.maxIter
        const w = task.w
        const h = task.h

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
                const newScale = task.precision
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
        this.calculate(values, smooth, w, h, task.skipTopLeft, task)
        const end = performance.now()

        return {
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
        }
    }

    calculate(values, smooth, w, h, skipTopLeft, task) {
        const stats = this.ctx.stats
        const scale = task.precision
        const bigScale = BigInt(scale)
        const rmin = (task.frameTopLeft)[0]
        const rmax = (task.frameBottomRight)[0]
        const imin = (task.frameTopLeft)[1]
        const imax = (task.frameBottomRight)[1]

        // Size in the complex plane with implicit exponent 2^-scale
        const cWidth = Number(rmax.subtract(rmin).bigInt)
        const cHeight = Number(imax.subtract(imin).bigInt)
        const refr = rmin.bigInt
        const refi = imin.bigInt

        const bailout = smooth ? 128 : 4
        const bigBailout = BigInt(bailout) << bigScale

        if (this.referencePoints.length === 0) {
            const x = Math.trunc(w / 2)
            const y = Math.trunc(h / 2)
            const dr = (task.xOffset + x) / task.frameWidth * cWidth
            const di = (task.yOffset + y) / task.frameHeight * cHeight
            this.referencePoints.push(this.calculate_reference(refr, refi, dr, di, bigScale, scale, bigBailout))
            if (this.ctx.shouldStop()) return
        }

        // We queue reference points in LRU order, the head pointing to the least recently successfully used reference point
        let head = this.referencePoints.length - 1
        for (let y = 0; y < h; y++) {
            const di = (task.yOffset + y) / task.frameHeight * cHeight
            const skipLeft = skipTopLeft && y % 2 === 0

            for (let x = 0; x < w; x++) {
                if (skipLeft && x % 2 === 0) {
                    // skip
                } else {
                    const dr = (task.xOffset + x) / task.frameWidth * cWidth

                    let found = false
                    const offset = y * w + x
                    const start = performance.now()

                    let refIndex = head
                    for (let ignored of this.referencePoints) {
                        let referencePoint = this.referencePoints[refIndex]
                        const refDr = referencePoint[0][0]
                        const refDi = referencePoint[0][1]
                        const zs = referencePoint[3]

                        const [iter, zq] = this.mandlebrot_perturbation(-scale, dr - refDr, di - refDi, this.max_iter, bailout, zs)
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
                        const newRef = this.calculate_reference(refr, refi, dr, di, bigScale, scale, bigBailout)
                        values[offset] = smoothen(smooth, offset, newRef[1], Number(newRef[2] >> (bigScale - 60n)) * 2 ** -60)
                        this.referencePoints.unshift(newRef)
                        this.referencePoints[0] = this.referencePoints[head]
                        this.referencePoints[head] = newRef
                        if (this.ctx.shouldStop()) return
                    }
                }
            }
            if (this.ctx.shouldStop()) return
        }
    }

    /**
     * @param {number} dExp exp of dcr and dci
     * @param {number} dcr
     * @param {number} dci
     * @param {number} max_iter
     * @param {number} bailout
     * @param {[number, number, number, number, number, number, number][]} zs (zr, zi, zq, zExp, zExpFactor, zEzpDeltaFactor, dExpZEzpDeltaFactor)[]
     * @returns {(number|number)[]|number[]}
     */
    mandlebrot_perturbation(dExp, dcr, dci, max_iter, bailout, zs) {

        // ε₀ = δ
        let ezr = dcr
        let ezi = dci
        let eExp = dExp

        let iter = -1
        let zzq = 0
        while (zzq <= bailout) {
            if (iter++ === max_iter) {
                return [2, 0]
            }
            if (iter >= zs.length) {
                return [-1, zzq]
            }

            // Zₙ
            const _zsvalues = zs[iter]
            const newEExp = _zsvalues[3]
            const eExpFactor = _zsvalues[4]  // 2 ** eExp
            const eExpDeltaFactor = _zsvalues[5]  // 2 ** (eExp - newEExp);
            ezr *= eExpDeltaFactor
            ezi *= eExpDeltaFactor
            dcr *= eExpDeltaFactor
            dci *= eExpDeltaFactor
            eExp = newEExp

            const zr = _zsvalues[0]
            const zi = _zsvalues[1]
            const zqErrorBound = _zsvalues[2]

            // Z'ₙ = Zₙ + εₙ
            const zzr = zr + ezr * eExpFactor
            const zzi = zi + ezi * eExpFactor
            zzq = zzr * zzr + zzi * zzi
            if (zzq < zqErrorBound) {
                return [-1, 0]
            }

            // εₙ₊₁ = 2·zₙ·εₙ + εₙ² + δ = (2·zₙ + εₙ)·εₙ + δ
            const zr_ezr_2 = 2 * zr + ezr * eExpFactor
            const zi_ezi_2 = 2 * zi + ezi * eExpFactor
            const _ezr = zr_ezr_2 * ezr - zi_ezi_2 * ezi
            const _ezi = zr_ezr_2 * ezi + zi_ezi_2 * ezr
            ezr = _ezr + dcr
            ezi = _ezi + dci
        }
        return [iter + 4, zzq]
    }

    /**
     * @param {BigInt} refr fixed point reference point real part
     * @param {BigInt} refi fixed point reference point imaginary part
     * @param {number} dr the delta relative to the reference point real part as floating point with implicit exponent 2^-scale
     * @param {number} di the delta relative to the reference point imaginary part as floating point with implicit exponent 2^-scale
     * @param {BigInt} scale
     * @param {number} scaleValue
     * @param {BigInt} bailout
     * @returns {[[fxp.FxP, fxp.FxP], number, BigInt, [number, number, number, number, number, number, number][]]} ((rr, ri), iter, zq, (zr, zi, zqErrorBound, zExp, zExpFactor, zEzpDeltaFactor, dExpZEzpDeltaFactor)[])
     */
    calculate_reference(refr, refi, dr, di, scale, scaleValue, bailout) {
        const start = performance.now()
        const rr = refr + BigInt(Math.round(dr))
        const ri = refi + BigInt(Math.round(di))
        const [iter, zq, seq] = this.mandelbrot_high_precision(rr, ri, this.max_iter, bailout, scale)
        let lastExp = -scaleValue

        const iterations = seq.length
        const zs = seq.map(([zr, zi], idx) => {
            const eExp = Math.round((idx / iterations) * scaleValue - scaleValue)
            const eExpDeltaFactor = 2 ** (lastExp-eExp)
            const eExpFactor = 2 ** eExp
            lastExp = eExp

            const z_real = new fxp.FxP(zr, scaleValue, scale).toNumber()
            const z_imag = new fxp.FxP(zi, scaleValue, scale).toNumber()
            const zq = ( z_real * z_real + z_imag * z_imag) * 0.000001

            return [z_real, z_imag, zq, eExp, eExpFactor, eExpDeltaFactor]
        })
        const end = performance.now()
        this.ctx.stats.timeSpendInHighPrecision += end - start
        this.ctx.stats.numberOfHighPrecisionPoints++
        return [[dr, di], iter, zq, zs]
    }

    /**
     * @param {BigInt} re
     * @param {BigInt} im
     * @param {number} max_iter
     * @param {BigInt} bailout
     * @param {BigInt} scale
     * @returns {[number, BigInt, [BigInt, BigInt][]]} [iterations, zq, sequence] where sequence is a list of [zr, zi] points
     */
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
                return [2, 0n, seq]
            }
            zi = (zr * zi >> scale_1) + im
            zr = zrq - ziq + re
            seq.push([zr, zi])
            zrq = (zr * zr) >> scale
            ziq = (zi * zi) >> scale
            zq = zrq + ziq
        }
        zi = (zr * zi >> scale_1) + im
        zr = zrq - ziq + re
        seq.push([zr, zi])
        return [iter + 4, zq, seq]
    }
}
