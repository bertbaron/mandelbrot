import {WorkerContext} from "./workerContext.mjs";

/**
 * Implementation of the Mandelbrot algorithm using (floating point) numbers.
 * Fast, but works with a precision up to about 58 bits
 */
export class MandelbrotFloat {
    /**
     * @param {WorkerContext} ctx the context for the worker
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

    /**
     * @param {Int32Array} values
     * @param {Uint8ClampedArray|null} smooth
     * @param {number} w
     * @param {number} h
     * @param {[number, number]} topleft
     * @param {[number, number]} bottomright
     * @param {boolean} skipTopLeft
     * @param {string} jobToken
     */
    calculate(values, smooth, w, h, topleft, bottomright, skipTopLeft, jobToken) {
        const rmin = topleft[0]
        const rmax = bottomright[0]
        const imin = topleft[1]
        const imax = bottomright[1]
        const dr = (rmax - rmin) / w
        const di = (imax - imin) / h
        for (let y = 0; y < h; y++) {
            if (this.ctx.shouldStop(jobToken)) {
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

    /**
     *
     * @param {number} y
     * @param {number} w
     * @param {number} x
     * @param {number} rmin
     * @param {number} dr
     * @param {number} im
     * @param {Int32Array} values
     * @param {Uint8ClampedArray|null} smooth
     */
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

    /**
     * @param {number} re
     * @param {number} im
     * @param {number} max_iter
     * @param {number} bailout
     * @returns {(number|number)[]|number[]}
     */
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
