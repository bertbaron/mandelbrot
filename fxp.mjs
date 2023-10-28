/*
 * Simple library for calculations with fixed-point numbers. Each number has a scale in the number of bits.
 * Calculations are done with the same scale, and the result has the same scale. Mixing scales is not supported.
 */

// const FP_BITS = 32
// const FP_BASE = Math.pow(2,FP_BITS)
// const FP_MASK = FP_BASE - 1

const ASSERTIONS = true

export class FxP {
    constructor(bigInt, scale, bigScale) {
        if (ASSERTIONS && typeof bigInt !== 'bigint') throw new Error(`intValue must be a bigint but is a ${typeof bigInt}`)
        if (ASSERTIONS && typeof scale !== 'number') throw new Error(`scale must be a number but is a ${typeof bigint}`)
        if (ASSERTIONS && bigScale &&  typeof bigScale !== 'bigint') throw new Error(`bigScale must be a bigint but is a ${typeof bigScale}`)
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

    withScale(scale) {
        const diff = scale - this.scale
        if (diff === 0) return this
        if (diff > 0) {
            return new FxP(this.bigInt << BigInt(diff), scale, this.bigScale + BigInt(diff))
        } else {
            return new FxP(this.bigInt >> BigInt(-diff), scale, this.bigScale + BigInt(diff))
        }
    }

    toNumber() {
        return Number(this.bigInt) / Math.pow(2, this.scale)
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

export function fromNumber(value, scale) {
    scale = scale || 60
    const bigScale = BigInt(scale)
    let scaledNumber = Math.round(value * Math.pow(2, scale));
    const scaledValue = BigInt(scaledNumber)
    return new FxP(scaledValue, scale, bigScale)
}

export function fromJSON(json) {
    return new FxP(BigInt(json.bigInt), json.scale)
}
