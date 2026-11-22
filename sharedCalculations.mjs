/**
 * @author Bert Baron
 */
import * as fxp from "./fxp.mjs";

/**
 * @param {BigInt} re
 * @param {BigInt} im
 * @param {number} max_iter
 * @param {number} bailout
 * @param {BigInt} bigScale
 * @param {number} scale
 * @param {function(): boolean} [shouldStop] optional, called regularly to check if the calculation should be aborted
 * @returns {[number, BigInt, [number, number, zq][]] | null} [iterations, zq, sequence] where sequence is a list of [zr, zi, zq] tuples,
 *          or null when the calculation was stopped
 */
export function mandelbrot_high_precision(re, im, max_iter, bailout, bigScale, scale, shouldStop) {
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
        if (shouldStop && (iter & 1023) === 0 && shouldStop()) {
            return null
        }
        zi = (zr * zi >> scale_1) + im
        zr = zrq - ziq + re
        zrq = (zr * zr) >> bigScale
        ziq = (zi * zi) >> bigScale
        const z_real = fxp.toNumber(zr, scale)
        const z_imag = fxp.toNumber(zi, scale)
        zq = z_real * z_real + z_imag * z_imag
        seq.push([z_real, z_imag, zq])
    }
    zi = (zr * zi >> scale_1) + im
    zr = zrq - ziq + re
    const z_real = fxp.toNumber(zr, scale)
    const z_imag = fxp.toNumber(zi, scale)
    seq.push([z_real, z_imag, z_real * z_real + z_imag * z_imag])
    return [iter + 4, zq, seq]
}

/**
 * Calculates a reference point for the WebGPU implementation. The sequence is converted to Float32Arrays
 * so that it can be copied directly into the GPU buffers (and transferred cheaply from a worker).
 *
 * @param {BigInt} rr the reference point real part
 * @param {BigInt} ri the reference point imaginary part
 * @param {number} maxIter
 * @param {number} bailout
 * @param {number} scale
 * @param {function(): boolean} [shouldStop] optional, called regularly to check if the calculation should be aborted
 * @returns {{rr: BigInt, ri: BigInt, iter: number, zq: number, size: number, zBuffer: Float32Array, zqErrorBoundBuffer: Float32Array} | null} null when the calculation was stopped
 */
export function calculateGpuReference(rr, ri, maxIter, bailout, scale, shouldStop) {
    const result = mandelbrot_high_precision(rr, ri, maxIter, bailout, BigInt(scale), scale, shouldStop)
    if (result === null) {
        return null
    }
    const [iter, zq, seq] = result

    const iterations = seq.length
    const zBuffer = new Float32Array(iterations*2)
    const zqErrorBoundBuffer = new Float32Array(iterations)

    seq.forEach(([zr, zi, zq], idx) => {
        zBuffer[idx*2] = zr
        zBuffer[idx*2+1] = zi
        zqErrorBoundBuffer[idx] = zq * 0.000001
    })
    return {
        rr,
        ri,
        iter,
        zq,
        size: zqErrorBoundBuffer.length,
        zBuffer,
        zqErrorBoundBuffer,
    }
}
