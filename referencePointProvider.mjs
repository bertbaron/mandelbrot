/**
 * @author Bert Baron
 */

/**
 * Calculates reference points for the WebGPU implementation in dedicated web workers, so that the
 * (expensive) BigInt calculations do not block the main thread.
 */
export class ReferencePointProvider {
    /**
     * @param {number} workerCount the number of reference points that can be calculated at the same time
     */
    constructor(workerCount = 1) {
        this.workers = Array.from({length: workerCount}, () => {
            const worker = new Worker('worker.js', {type: 'module'})
            worker.onmessage = (msg) => this._onAnswer(msg.data)
            return worker
        })
        this.nextWorker = 0
        this.nextId = 0
        this.pending = new Map()
    }

    /**
     * Calculates a reference point in the worker.
     *
     * @param {BigInt} rr the reference point real part
     * @param {BigInt} ri the reference point imaginary part
     * @param {number} maxIter
     * @param {number} bailout
     * @param {number} scale
     * @param {string} jobToken the calculation is stopped when this URL is revoked
     * @returns {Promise<{rr: BigInt, ri: BigInt, iter: number, zq: number, size: number, zBuffer: Float32Array, zqErrorBoundBuffer: Float32Array} | null>}
     *          resolves to null when the calculation was stopped
     */
    calculate(rr, ri, maxIter, bailout, scale, jobToken) {
        const id = this.nextId++
        return new Promise(resolve => {
            this.pending.set(id, resolve)
            // Take the workers in turns, so that requests that are made at the same time use different workers
            this.workers[this.nextWorker].postMessage({type: 'reference', id, rr, ri, maxIter, bailout, scale, jobToken})
            this.nextWorker = (this.nextWorker + 1) % this.workers.length
        })
    }

    _onAnswer(answer) {
        const resolve = this.pending.get(answer.id)
        this.pending.delete(answer.id)
        resolve(answer.ref)
    }
}
