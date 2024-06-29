const _f32buf = new Float32Array(1)
function f32(f) {
    _f32buf[0] = f
    const result = _f32buf[0]
    // validate if f is a valid float32 (not inf, -inf, nan)
    // if (!Number.isFinite(result)) {
    //     console.error(`Invalid float32: ${result}`)
    // }
    return result
}

const f = Math.sqrt(2)
const f32f = f32(f)
console.log(f.toExponential(20))
console.log(f32f.toExponential(20))

const fq = f * f
const f32fq = f32f * f32f
console.log(fq.toExponential(20))
console.log(f32fq.toExponential(20))