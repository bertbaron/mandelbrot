/**
 * @author Bert Baron
 */
// Add some randomnes to have different checkpoints per worker
const STOP_CHECK_INTERVAL = 200 + Math.floor(Math.random() * 100)

export class WorkerContext {
    constructor() {
        this.currentJob = null
        this.lastStoppedJob = null
        this.nextStopCheck = 0
        this.timeSpendInStopCheck = 0
        this.resetStats()
    }

    initTask(jobToken) {
        this.timeSpendInStopCheck = 0
        this.currentJob = jobToken
        this.nextStopCheck = performance.now() + STOP_CHECK_INTERVAL
    }

    resetStats() {
        this.stats = {
            timeSpendInHighPrecision: 0,
            timeSpendInLowPrecision: 0,
            numberOfHighPrecisionPoints: 0,
            numberOfLowPrecisionPoints: 0,
            numberOfLowPrecisionMisses: 0,
            timeLostOnLowPrecisionMisses: 0,
            errorOffsetsPos: [],
            errorOffsetsNeg: []
        }
    }

    shouldStop() {
        const currentJobToken = this.currentJob
        const ts = performance.now()
        let shouldStop = false
        if (ts > this.nextStopCheck) {
            shouldStop = this._shouldStop(currentJobToken)
            this.nextStopCheck = performance.now() + STOP_CHECK_INTERVAL
        }
        this.timeSpendInStopCheck += performance.now() - ts
        return shouldStop
    }

    _shouldStop(jobToken) {
        if (!jobToken) {
            return false
        }
        let xhr = new XMLHttpRequest();
        xhr.open("GET", jobToken, /* async= */false);
        try {
            xhr.send(null);
        } catch (e) {
            return true // request failed, URL has been revoked
        }
        return false // URL is still valid, we can continue
    }
}

// Inserts the smooth value in the smooth buffer if any and returns the (potentially updated) iter value
export function smoothen(smooth, offset, iter, zq) {
    if (smooth && iter > 3) {
        let log_zn = Math.log(zq) / 2
        let nu = Math.log(log_zn / Math.log(2)) / Math.log(2)
        iter = Math.floor(iter + 1 - nu)
        nu = nu - Math.floor(nu)
        smooth[offset] = Math.floor(255 - 255 * nu)
    }
    return iter
}

