import * as t from './tinytest.mjs'
import * as fxp from '../fxp.mjs'


export function fromAndToNumber() {
    function testNumber(n) {
        if (n > 2 ** -120) {
            t.eq(n.toExponential(8), fxp.fromNumber(n, 120).toNumber().toExponential(8))
        }
        t.eq(n.toExponential(8), fxp.fromNumber(n, 1200).toNumber().toExponential(8), "scale=1000")
    }

    for (const value of [0, 1, 2, 13, 8792364]) {
        testNumber(value)
        testNumber(-value)
        testNumber(value / 3)
        testNumber(value / 50)
        testNumber(value * 50)
    }
    testNumber(123e300)
    testNumber(123e-300)
}

export function testIlog2() {
    function testNumber(n) {
        const expected = n === 0 ? 0 : Math.trunc(Math.log2(Math.abs(n)))
        t.eq(expected, fxp.fromNumber(n, 100).bits())
        t.eq(expected, fxp.fromNumber(n, 1000).bits())
    }

    for (const value of [0, 1, 2, 13, 8792364]) {
        testNumber(value)
        testNumber(-value)
    }
}

export function testConstructor() {
    let b = new fxp.FxP(1234567890123456789012345678901234567890n, 0)
    t.eq(b.bigScale, 0n)

    b = new fxp.FxP(1234567890123456789012345678901234567890n, 20)
    t.eq(b.bigScale, 20n)

    b = new fxp.FxP(1234567890123456789012345678901234567890n, 20, 20n)
    t.eq(b.bigScale, 20n)
}

const TESTS = {
    'fromAndToNumber': fromAndToNumber,
    'Ilog2': testIlog2,
    'Constructor': testConstructor,
}

t.tests(TESTS);
