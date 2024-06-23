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
            // FIXME we have to correct the dr and di since the reference points might have changed, hence the true for now
            if (this.paramHash !== task.paramHash || this.referencePoints.length === 0 || task.resetCaches || true) {
                this.paramHash = task.paramHash
                this.referencePoints = []
            } else {
                // Keep reference points that are within the total frame when job parameters did not change
                const oldReferencePoints = this.referencePoints
                this.referencePoints = []
                const oldScale = this.precision
                const newScale = task.precision
                if (newScale <= oldScale) {
                    for (let referencePoint of oldReferencePoints) {
                        const dr = referencePoint[0][0]
                        const di = referencePoint[0][1]
                        if (dr < cWidth && di < cHeight) {
                            referencePoint[0] = [referencePoint[0][0].withScale(newScale), referencePoint[0][1].withScale(newScale)]
                            this.referencePoints.push(referencePoint)
                        }
                    }
                }
            }
            this.precision = task.precision
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
            this.referencePoints.push(this.calculate_reference(refr, refi, dr, di, bigScale, scale, bailout))
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
                        const newRef = this.calculate_reference(refr, refi, dr, di, bigScale, scale, bailout)
                        values[offset] = smoothen(smooth, offset, newRef[1], newRef[2])
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
     * @returns {[number, number]} [iter, zq]
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
     * @param {BigInt} bigScale
     * @param {number} scale
     * @param {number} bailout
     * @returns {[[number, number], number, number, [number, number, number, number, number, number][]]} ((rr, ri), iter, zq, (zr, zi, zqErrorBound, zExp, zExpFactor, zEzpDeltaFactor)[])
     */
    calculate_reference(refr, refi, dr, di, bigScale, scale, bailout) {
        const start = performance.now()
        const rr = refr + BigInt(Math.round(dr))
        const ri = refi + BigInt(Math.round(di))
        const [iter, zq, seq] = this.mandelbrot_high_precision(rr, ri, this.max_iter, bailout, bigScale, scale)
        let lastExp = -scale

        const iterations = seq.length
        const zs = seq.map(([zr, zi, zq], idx) => {
            const eExp = Math.round((idx / iterations) * scale - scale)
            const eExpDeltaFactor = 2 ** (lastExp-eExp)
            const eExpFactor = 2 ** eExp
            lastExp = eExp
            return [zr, zi, zq, eExp, eExpFactor, eExpDeltaFactor]
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
     * @param {number} bailout
     * @param {BigInt} bigScale
     * @param {number} scale
     * @returns {[number, BigInt, [number, number, zq][]]} [iterations, zq, sequence] where sequence is a list of [zr, zi, zq] tuples
     */
    mandelbrot_high_precision(re, im, max_iter, bailout, bigScale, scale) {
        const scale_1 = bigScale - 1n
        let zr = 0n
        let zi = 0n
        let iter = -1
        let zrq = 0n
        let ziq = 0n
        let zq = 0
        const seq = []
        while (zq <= bailout) {
            if (iter++ === max_iter) {
                return [2, 0, seq]
            }
            zi = (zr * zi >> scale_1) + im
            zr = zrq - ziq + re
            zrq = (zr * zr) >> bigScale
            ziq = (zi * zi) >> bigScale
            const z_real = fxp.toNumber(zr, scale)
            const z_imag = fxp.toNumber(zi, scale)
            zq = z_real * z_real + z_imag * z_imag
            seq.push([z_real, z_imag, zq * 0.000001])
        }
        zi = (zr * zi >> scale_1) + im
        zr = zrq - ziq + re
        const z_real = fxp.toNumber(zr, scale)
        const z_imag = fxp.toNumber(zi, scale)
        seq.push([z_real, z_imag, z_real * z_real + z_imag * z_imag])
        return [iter + 4, zq, seq]
    }
}
