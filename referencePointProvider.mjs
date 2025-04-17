/**
 * @author Bert Baron
 */
import {mandelbrot_high_precision} from "./sharedCalculations.mjs";

/**
 * This class calculates reference points for indices that can not be resolved by the current
 * reference points.  In the future the calculation will happen async in a worker.
 */
export class ReferencePointProvider {
    constructor() {
        this.referencePoints = []
    }

    /**
     * Initializes the reference point provider with the properties of the next calculation.
     *
     */
    init(task) {
        this.task = task
        this.unresovolved = []
        this._updateCache(task)
        if (this.referencePoints.length === 0) {
            // start calculation of the first reference point
            const idx = Math.floor(task.w * task.h / 2)
            this._calculateReferencePoint(idx)
        }
    }

    /**
     * Returns the next reference point. The point may need to be calculated.
     *
     * @returns {Promise<void>}
     */
    async nextReferencePoint() {

    }

    /**
     * Can start an async calculation for a new reference point for one of the given indices.
     *
     * @param {number} indices integer indices that can not be resolved by the current reference points
     */
    unresolvedIndices(indices) {
        for (const element of indices) {
            this.unresovolved.push(element)
        }
    }

    _updateCache(task) {
        if (task.jobId !== this.jobId) {
            this.jobId = task.jobId
            if (this.paramHash !== task.paramHash || this.referencePoints.length === 0 || task.resetCaches) {
                this.paramHash = task.paramHash
                this.referencePoints = []
            } else {
                // Keep reference points that are within the total frame when job parameters did not change
                const oldReferencePoints = this.referencePoints
                this.referencePoints = []
                const oldPrecision = this.precision
                const newPrecision = task.precision
                if (newPrecision === oldPrecision) {  // <= requires adjusting the reference points because implicit scale changes, we don't do this yet
                    for (let ref of oldReferencePoints) {
                        if (ref.rr >= task.frameTopLeft[0].bigInt && ref.rr <= task.frameBottomRight[0].bigInt &&
                            ref.ri >= task.frameTopLeft[1].bigInt && ref.ri <= task.frameBottomRight[1].bigInt) {
                            this.referencePoints.push(ref)
                        }
                    }
                } else {
                    console.log(`Clearing caches because precision changed ${oldPrecision} -> ${newPrecision}`)
                }
            }
            this.precision = task.precision
        }
    }

    _calculateReferencePoint(idx) {
        const x = idx % this.task.w
        const y = Math.floor(idx / this.task.w)
        const task = this.task
        const rr = refr + BigInt(Math.trunc(x / w * cWidth))
        const ri = refi + BigInt(Math.trunc(y / h * cHeight))
        const maxIter = task.maxIter
        const bailout = task.smooth ? 128 : 4
        const scale = this.task.precision
        const bigScale = BigInt(scale)
        mandelbrot_high_precision(rr, ri, maxIter, bailout, bigScale, scale)

        const [iter, zq, seq] = this.mandelbrot_high_precision(rr, ri, this.max_iter, bailout, bigScale, scale)

        const iterations = seq.length
        const zBuffer = new Float32Array(iterations*2)
        const zqErrorBoundBuffer = new Float32Array(iterations)

        seq.forEach(([zr, zi, zq], idx) => {
            zBuffer[idx*2] = zr
            zBuffer[idx*2+1] = zi
            zqErrorBoundBuffer[idx] = zq * 0.000001
        })
        const ref = {
            rr,
            ri,
            iter,
            zq,
            size: zqErrorBoundBuffer.length,
            zBuffer,
            zqErrorBoundBuffer,
        }

        this.referencePoints.push(ref)
    }
}