import {smoothen, WorkerContext} from "./workerContext.mjs";

/**
 * Implementation of the Mandelbrot algorithm using (fixed point) numbers. Note that the actual algorithm does not use
 * the FxP class but has the functionality inlined for performance reasons.
 * This should allow for very deep zoom levels, but it's too slow to be useful. We keep it here for reference but use
 * the perturbation algorithm instead for deeper zoom levels.
 */
export class MandelbrotFxP {
    /**
     * @param {WorkerContext} ctx
     */
    constructor(ctx) {
        this.ctx = ctx
    }

    async process(task) {
        this.max_iter = task.maxIter
        const w = task.w
        const h = task.h

        const refr = task.frameTopLeft[0].bigInt
        const refi = task.frameTopLeft[1].bigInt
        const dr = Number(task.frameBottomRight[0].bigInt - refr) / task.frameWidth
        const di = Number(task.frameBottomRight[1].bigInt - refi) / task.frameHeight
        const rOffset = task.xOffset * dr
        const iOffset = task.yOffset * di

        const values = new Int32Array(w * h)
        const smooth = task.smooth ? new Uint8ClampedArray(w * h) : null
        this.calculate(values, smooth, BigInt(task.precision), w, h, refr, refi, rOffset, iOffset, dr, di, task.skipTopLeft)

        return {
            type: 'answer',
            task: task,
            values: values,
            smooth: smooth
        }
    }

    /**
     *
     * @param {Int32Array} values
     * @param {Uint8ClampedArray} smooth
     * @param {BigInt} scale
     * @param {number} w
     * @param {number} h
     * @param {BigInt} refr fixed point reference for the real part
     * @param {BigInt} refi fixed point reference for the imaginary part
     * @param {number} rOffset offset for the real part with implicit exponent 2**-scale
     * @param {number} iOffset offset for the imaginary part with implicit exponent 2**-scale
     * @param {number} dr pixel size for the real part with implicit exponent 2**-scale
     * @param {number} di pixel size for the imaginary part with implicit exponent 2**-scale
     * @param skipTopLeft
     */
    calculate(values, smooth, scale, w, h, refr, refi, rOffset, iOffset, dr, di, skipTopLeft) {
        for (let y = 0; y < h; y++) {
            const im = refi + BigInt(Math.round(iOffset + y * di))
            const skipLeft = skipTopLeft && y % 2 === 0
            for (let x = 0; x < w; x++) {
                const re = refr + BigInt(Math.round(rOffset + x * dr))
                if (skipLeft && x % 2 === 0) {
                    // skip
                } else {
                    if (this.ctx.shouldStop()) {
                        return
                    }
                    this.calculatePixel(y * w + x, re, im, values, scale, smooth);
                }
            }
        }
    }

    /**
     * @param {number} idx
     * @param {BigInt} re
     * @param {BigInt} im
     * @param {Int32Array} values
     * @param {Uint8ClampedArray|null} smooth
     * @param {BigInt} scale
     */
    calculatePixel(idx, re, im, values, scale, smooth) {
        const bailout = smooth ? 128n << scale : 4n << scale
        let [iter, bigZq] = this.mandelbrot(re, im, this.max_iter, bailout, scale)
        const zq = Number(bigZq >> (scale - 100n)) * 2 ** -100
        values[idx] = smoothen(smooth, idx, iter, zq)
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
                return [2, 0n]
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
