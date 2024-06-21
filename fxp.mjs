/*
 * Simple library for calculations with fixed-point numbers. Each number has a scale in the number of bits.
 * Calculations are done with the same scale, and the result has the same scale. Mixing scales is not supported.
 */

// const FP_BITS = 32
// const FP_BASE = Math.pow(2,FP_BITS)
// const FP_MASK = FP_BASE - 1

const ASSERTIONS = false

export class FxP {
    /**
     * @param {bigint} bigInt
     * @param {number} scale
     * @param {bigint} bigScale optional bigScale, must be the same as scale!
     */
    constructor(bigInt, scale, bigScale = 0n) {
        if (ASSERTIONS && typeof bigInt !== 'bigint') throw new Error(`intValue must be a bigint but is a ${typeof bigInt}`)
        if (ASSERTIONS && typeof scale !== 'number') throw new Error(`scale must be a number but is a ${typeof bigint}`)
        if (ASSERTIONS && bigScale && typeof bigScale !== 'bigint') throw new Error(`bigScale must be a bigint but is a ${typeof bigScale}`)
        this.bigInt = bigInt
        this.scale = scale
        this.bigScale = bigScale || BigInt(scale)
    }

    add(other) {
        if (ASSERTIONS && this.scale !== other.scale) throw new Error('Scales must be equal')
        return new FxP(this.bigInt + other.bigInt, this.scale)
    }

    subtract(other) {
        if (ASSERTIONS && this.scale !== other.scale) throw new Error('Scales must be equal')
        return new FxP(this.bigInt - other.bigInt, this.scale)
    }

    multiply(other) {
        if (ASSERTIONS && this.scale !== other.scale) throw new Error('Scales must be equal')
        return new FxP((this.bigInt * other.bigInt) >> this.bigScale, this.scale, this.bigScale)
    }

    divide(other) {
        if (ASSERTIONS && this.scale !== other.scale) throw new Error('Scales must be equal')
        return new FxP((this.bigInt << this.bigScale) / other.bigInt, this.scale, this.bigScale)
    }

    min(other) {
        if (ASSERTIONS && this.scale !== other.scale) throw new Error('Scales must be equal')
        return this.bigInt < other.bigInt ? this : other
    }

    max(other) {
        if (ASSERTIONS && this.scale !== other.scale) throw new Error('Scales must be equal')
        return this.bigInt > other.bigInt ? this : other
    }

    leq(other) {
        if (ASSERTIONS && this.scale !== other.scale) throw new Error('Scales must be equal')
        return this.bigInt <= other.bigInt
    }

    /**
     * Returns approximate number of bits of the integer value. Works for very large numbers, not for very small
     *
     * @param {BigInt} value
     * @returns {number}
     */
    bits() {
        const n = this.bigInt >> this.bigScale
        return n.toString(2).length - (n < 0 ? 2 : 1);
        // return bits(this.bigInt >> this.bigScale)
    }

    withScale(scale) {
        const diff = scale - this.scale
        if (diff === 0) return this
        if (diff > 0) {
            return new FxP(this.bigInt << BigInt(diff), scale, this.bigScale + BigInt(diff))
        } else {
            return new FxP(this.bigInt >> BigInt(-diff), scale, this.bigScale + BigInt(diff))
        }
    }

    /**
     * Converts the fixed-point number to a number. Not that the value may be out of the range of a number.
     * @returns {number}
     */
    toNumber() {
        let exp = -this.scale
        const size = bits(this.bigInt)
        if (size > 53) {
            const preScale = size - 53
            const n = Number(this.bigInt >> BigInt(preScale))
            return n * 2 ** (exp + preScale)
        }
        return Number(this.bigInt) * 2 ** exp
    }

    bigIntValue() {
        return this.bigInt >> this.bigScale
    }

    toString() {
        return `${this.bigInt} / 2^${this.scale} (${this.toNumber()})`
    }

    toJSON() {
        return {
            bigInt: this.bigInt.toString(),
            scale: this.scale
        }
    }
}

export function fromNumber(value, scale = 60) {
    if (Number.isInteger(value)) {
        return fromIntNumber(value, scale)
    }

    let prescale = 0
    const exp = exponent(value)
    if (exp < 53) {
        prescale = Math.min(1023,  Math.min(scale, 53 - exp))
    }
    let sValue = Math.round(value * 2 ** prescale);
    const bigScale = BigInt(scale)
    const scaledValue = BigInt(sValue) << BigInt(scale - prescale)
    return new FxP(scaledValue, scale, bigScale)
}

export function fromIntNumber(value, scale = 60) {
    const bigScale = BigInt(scale)
    return new FxP(BigInt(value) << bigScale, scale, bigScale)
}

/**
 * Calculates the 2-base exponent of the given number. Deals with 0 and negative numbers.
 * @param {number} number
 * @returns {number}
 */
function exponent(number) {
    return (number === 0) ? 0 : Math.floor(Math.log2(Math.abs(number)))
}

/**
 * Returns approximate number of bits of the given value.
 * @param {BigInt} value
 * @returns {number}
 */
function bits(value) {
    return value > 0 ? ilog2(value) : ilog2(-value)
}

/**
 * https://stackoverflow.com/questions/55355184/optimized-integer-logarithm-base2-for-bigint
 * @param {BigInt} value
 * @returns {number}
 */
function ilog2(value) {
    let result = 0n, i, v
    for (i = 1n; value >> (1n << i); i <<= 1n) {
    }
    while (value > 1n) {
        v = 1n << --i
        if (value >> v) {
            result += v
            value >>= v
        }
    }
    return Number(result)
}

export function fromJSON(json) {
    return new FxP(BigInt(json.bigInt), json.scale)
}
