import {WorkerContext, smoothen} from "./workerContext.mjs";

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
                    if (this.ctx.shouldStop()) {
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

        /*
         * zq is a small number (smaller than the bailout). When very small we can assume it's zero. Therefore, we can
         * first scale it down to a 'normal' range before converting to a number, avoiding overflow.
         */
        const zqDownscaled = bigZq >> (scale - 58n)
        const zqDownscaledNumber = Number(zqDownscaled)
        const zq = zqDownscaledNumber / Math.pow(2, 58)
        values[offset] = smoothen(smooth, offset, iter, zq)
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
