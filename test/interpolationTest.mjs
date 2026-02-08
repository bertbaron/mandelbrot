import * as t from './tinytest.mjs'
import * as palette from '../palette.mjs'

export function testTimeWarpFn1() {
    const weights = [1, 2, 1, 2]
    const timeWarpFn = palette.timeWarpFn(weights)

    t.eq(0, timeWarpFn(0), "t=0")
    t.eq(1 / 4, timeWarpFn(1.5 / 6), "t=1.5")
    t.eq(2 / 4, timeWarpFn(3 / 6), "t=3")
    t.eq(3 / 4, timeWarpFn(4.5 / 6), "t=4.5")
}

export function testTimeWarpFn2() {
    const weights = [2, 4, 2, 4]
    const timeWarpFn = palette.timeWarpFn(weights)

    t.eq(0, timeWarpFn(0), "t=0")
    t.eq(1 / 4, timeWarpFn(1.5 / 6), "t=1.5")
    t.eq(2 / 4, timeWarpFn(3 / 6), "t=3")
    t.eq(3 / 4, timeWarpFn(4.5 / 6), "t=4.5")
}

const TESTS = {
    'testTimeWarpFn': testTimeWarpFn1,
    'testTimeWarpFn2': testTimeWarpFn2
}

t.tests(TESTS)