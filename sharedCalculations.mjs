import * as fxp from "./fxp.mjs";

/**
 * @param {BigInt} re
 * @param {BigInt} im
 * @param {number} max_iter
 * @param {number} bailout
 * @param {BigInt} bigScale
 * @param {number} scale
 * @returns {[number, BigInt, [number, number, zq][]]} [iterations, zq, sequence] where sequence is a list of [zr, zi, zq] tuples
 */
export function mandelbrot_high_precision(re, im, max_iter, bailout, bigScale, scale) {
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
        seq.push([z_real, z_imag, zq])
    }
    zi = (zr * zi >> scale_1) + im
    zr = zrq - ziq + re
    const z_real = fxp.toNumber(zr, scale)
    const z_imag = fxp.toNumber(zi, scale)
    seq.push([z_real, z_imag, z_real * z_real + z_imag * z_imag])
    return [iter + 4, zq, seq]
}
