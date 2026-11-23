import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as fxp from '../fxp.mjs'
import {encodePermalink, decodePermalink, decodeLegacyPermalink} from '../permalink.mjs'

function roundtrip(params) {
    const query = new URLSearchParams(encodePermalink(params)).toString()
    return {query, decoded: decodePermalink(new URLSearchParams(query))}
}

function randomBigInt(bits) {
    let hex = ''
    while (hex.length * 4 < bits) hex += Math.floor(Math.random() * 16).toString(16)
    return BigInt('0x' + hex)
}

const builtIn = {id: 'ocean', density: -13, rotate: 20}

test('center roundtrips exactly, including zero, negative and huge values', () => {
    const scale = 5000
    for (const v of [0n, 1n, -1n, 255n, -256n, randomBigInt(5000), -randomBigInt(5000)]) {
        const center = [new fxp.FxP(v, scale), new fxp.FxP(-v, scale)]
        const {decoded} = roundtrip({center, zoom: fxp.fromNumber(1, scale), max_iter: 100, smooth: true, palette: builtIn})
        assert.equal(decoded.center[0].bigInt, v)
        assert.equal(decoded.center[1].bigInt, -v)
        assert.equal(decoded.center[0].scale, scale)
    }
})

test('zoom roundtrips with a small relative error', () => {
    const scale = 5100
    const zooms = [fxp.fromNumber(1, scale), fxp.fromNumber(1.5, scale), fxp.fromNumber(1e20, scale),
        new fxp.FxP(10n ** 300n << BigInt(scale), scale), new fxp.FxP(10n ** 1500n << BigInt(scale), scale)]
    for (const zoom of zooms) {
        const center = [new fxp.FxP(0n, scale), new fxp.FxP(0n, scale)]
        const {decoded} = roundtrip({center, zoom, max_iter: 100, smooth: false, palette: builtIn})
        const diff = decoded.zoom.bigInt - zoom.bigInt
        const relative = Number((diff < 0n ? -diff : diff) * 10n ** 20n / zoom.bigInt) / 1e20
        assert.ok(relative < 1e-15, `relative error ${relative}`)
    }
})

test('settings and built-in palette roundtrip', () => {
    const center = [fxp.fromNumber(-0.5, 60), fxp.fromNumber(0.25, 60)]
    const {query, decoded} = roundtrip({center, zoom: fxp.fromNumber(1, 60), max_iter: 3400, smooth: true, palette: builtIn})
    assert.doesNotMatch(query, /%/)
    assert.equal(decoded.max_iter, 3400)
    assert.equal(decoded.smooth, true)
    assert.deepEqual(decoded.palette, {id: 'ocean', density: -13, rotate: 20})
})

test('embedded palette roundtrips with weights', () => {
    const colors = ['#ff0000', '#00ff00:2.5', '#0000ff:0.5']
    const palette = {id: undefined, colors, mirror: true, density: 1, rotate: -4}
    const center = [fxp.fromNumber(-0.5, 60), fxp.fromNumber(0, 60)]
    const {query, decoded} = roundtrip({center, zoom: fxp.fromNumber(1, 60), max_iter: 100, smooth: false, palette})
    assert.doesNotMatch(query, /%/)
    assert.deepEqual(decoded.palette, {colors, mirror: true, density: 1, rotate: -4})
})

test('a url without new style params gives null', () => {
    assert.equal(decodePermalink(new URLSearchParams('params=abc')), null)
})

test('every favourite converts to a shorter, identical-center permalink', () => {
    const source = fs.readFileSync(new URL('../favorites.js', import.meta.url), 'utf8')
    const entries = [...source.matchAll(/"([A-Za-z0-9+/=]+)"/g)].map(m => m[1])
    assert.ok(entries.length > 0)
    for (const entry of entries) {
        const legacy = decodeLegacyPermalink(entry)
        const palette = legacy.palette.colors
            ? {...legacy.palette}
            : {id: legacy.palette.id, density: legacy.palette.density, rotate: legacy.palette.rotate}
        const {query, decoded} = roundtrip({...legacy, palette})
        assert.equal(decoded.center[0].bigInt, legacy.center[0].bigInt)
        assert.equal(decoded.center[1].bigInt, legacy.center[1].bigInt)
        assert.ok(query.length < entry.length, `${query.length} >= ${entry.length}`)
    }
})

test('zoom 10^1500 stays far below the 8100 character url limit', () => {
    const scale = 5100
    const center = [new fxp.FxP(randomBigInt(5100), scale), new fxp.FxP(-randomBigInt(5100), scale)]
    const zoom = new fxp.FxP(10n ** 1500n << BigInt(scale), scale)
    const {query} = roundtrip({center, zoom, max_iter: 5000, smooth: true, palette: builtIn})
    assert.ok(query.length < 2500, `length ${query.length}`)
})

function zoomRoundtrip(zoom, scale = 100) {
    const center = [new fxp.FxP(0n, scale), new fxp.FxP(0n, scale)]
    return roundtrip({center, zoom, max_iter: 100, smooth: false, palette: builtIn}).decoded.zoom
}

test('shallow and fractional zooms roundtrip', () => {
    for (const value of [0.5, 1, 1.25, 3, 12345.678, 1e15, 123456789012345680, 1e16, 1e17, 1.5e17]) {
        const zoom = fxp.fromNumber(value, 100)
        const back = zoomRoundtrip(zoom).toNumber()
        assert.ok(Math.abs(back - value) / value < 1e-15, `${value} -> ${back}`)
    }
})

test('tiny zooms in exponent notation roundtrip', () => {
    const zoom = new fxp.FxP(1n << 60n, 100) // 2^-40 ~ 9.09e-13
    const back = zoomRoundtrip(zoom)
    assert.ok(Math.abs(back.toNumber() / zoom.toNumber() - 1) < 1e-15)
})

test('zoom exactly at the digit limit', () => {
    for (const exp of [16, 17, 18, 19]) {
        const zoom = new fxp.FxP(10n ** BigInt(exp) << 100n, 100)
        const back = zoomRoundtrip(zoom)
        const diff = back.bigInt - zoom.bigInt
        assert.ok((diff < 0n ? -diff : diff) * 10n ** 15n < zoom.bigInt, `1e${exp}`)
    }
})

test('weights in exponent notation survive', () => {
    const colors = ['#112233:1e-7', '#445566:0.25']
    const center = [fxp.fromNumber(0, 60), fxp.fromNumber(0, 60)]
    const {decoded} = roundtrip({center, zoom: fxp.fromNumber(1, 60), max_iter: 10, smooth: true,
        palette: {colors, mirror: false, density: 0, rotate: 0}})
    assert.deepEqual(decoded.palette.colors, colors)
})

test('center y with another scale than x is normalised', () => {
    const center = [new fxp.FxP(5n << 10n, 100), new fxp.FxP(3n, 50)]
    const {decoded} = roundtrip({center, zoom: fxp.fromNumber(1, 100), max_iter: 10, smooth: true, palette: builtIn})
    assert.equal(decoded.center[1].bigInt, 3n << 50n)
})

test('invalid permalinks throw', () => {
    for (const q of ['x=AA', 'x=AA&y=AA&s=abc&z=1&i=10', 'x=AA&y=AA&s=60&z=oops&i=10', 'x=AA&y=AA&s=60&z=1&i=nope', 'x=AA&y=AA&s=-3&z=1&i=10']) {
        assert.throws(() => decodePermalink(new URLSearchParams(q)), undefined, q)
    }
})

test('encoding and decoding a 5000-bit center is fast', () => {
    const scale = 5100
    const center = [new fxp.FxP(randomBigInt(5100), scale), new fxp.FxP(-randomBigInt(5100), scale)]
    const zoom = new fxp.FxP(10n ** 1500n << BigInt(scale), scale)
    const start = performance.now()
    for (let i = 0; i < 20; i++) roundtrip({center, zoom, max_iter: 5000, smooth: true, palette: builtIn})
    const perRoundtrip = (performance.now() - start) / 20
    console.log(`roundtrip: ${perRoundtrip.toFixed(2)}ms`)
    assert.ok(perRoundtrip < 20, `${perRoundtrip}ms`)
})

test('absurd exponents and scales are rejected', () => {
    for (const q of ['x=AA&y=AA&s=60&z=1e300000000&i=10', 'x=AA&y=AA&s=900000000&z=1&i=10', 'x=AA&y=AA&s=60&z=1&i=10abc',
        'x=AA&y=AA&s=60.5&z=1&i=10', 'x=&y=AA&s=60&z=1&i=10', 'x=AA&s=60&z=1&i=10', 'x=AA&y=AA&s=60&i=10']) {
        assert.throws(() => decodePermalink(new URLSearchParams(q)), undefined, q)
    }
})

test('missing or broken density and rotate fall back to defaults', () => {
    const decoded = decodePermalink(new URLSearchParams('x=AA&y=AA&s=60&z=1&i=10&p=original&d=x'))
    assert.deepEqual(decoded.palette, {id: 'original', density: 1, rotate: 0})
})

test('zoom string has no trailing zeros', () => {
    const scale = 100
    const center = [new fxp.FxP(0n, scale), new fxp.FxP(0n, scale)]
    const zoom = new fxp.FxP(10n ** 1500n << BigInt(scale), scale)
    assert.equal(encodePermalink({center, zoom, max_iter: 1, smooth: true, palette: builtIn}).z, '1e1500')
})

test('y with a larger scale than x keeps its precision', () => {
    const center = [new fxp.FxP(3n, 50), new fxp.FxP(5n << 10n, 100)]
    const {decoded} = roundtrip({center, zoom: fxp.fromNumber(1, 100), max_iter: 10, smooth: true, palette: builtIn})
    assert.equal(decoded.center[1].bigInt, 5n << 10n)
    assert.equal(decoded.center[0].bigInt, 3n << 50n)
})
