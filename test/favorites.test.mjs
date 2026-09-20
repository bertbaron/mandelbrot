import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

globalThis.localStorage = {
    data: {},
    getItem(key) { return this.data[key] ?? null },
    setItem(key, value) { this.data[key] = String(value) },
    removeItem(key) { delete this.data[key] },
}

const palette = await import('../palette.mjs')

const source = fs.readFileSync(new URL('../favorites.js', import.meta.url), 'utf8')
const arrayBody = source.slice(source.indexOf('const FAVORITES = ['), source.indexOf('\n]'))
const entries = [...arrayBody.matchAll(/"([A-Za-z0-9+/=]+)"/g)].map(m => m[1])
const decoded = entries.map(entry => JSON.parse(Buffer.from(entry, 'base64').toString()))

test('the favourites array is not empty', () => {
    assert.ok(entries.length > 0)
})

test('every favourite is valid base64 holding the expected parameters', () => {
    decoded.forEach((params, i) => {
        assert.ok(params.center && params.center.length === 2, `entry ${i}: center`)
        assert.ok(params.zoom, `entry ${i}: zoom`)
        assert.equal(typeof params.max_iter, 'number', `entry ${i}: max_iter`)
        assert.equal(typeof params.smooth, 'boolean', `entry ${i}: smooth`)
        assert.ok(params.palette, `entry ${i}: palette`)
    })
})

test('every favourite palette is a built-in one or carries its own colors', () => {
    decoded.forEach((params, i) => {
        const p = params.palette
        if (p.colors) {
            assert.ok(p.colors.length > 0, `entry ${i}: empty color list`)
            for (const color of p.colors) {
                assert.match(color, /^#[0-9a-f]{6}(:\d+(\.\d+)?)?$/i, `entry ${i}: color ${color}`)
            }
            assert.equal(typeof p.mirror, 'boolean', `entry ${i}: mirror`)
        } else {
            // An id that no longer exists silently falls back to the original palette.
            assert.ok(palette.isBuiltInPalette(p.id), `entry ${i}: unknown palette id ${p.id}`)
        }
    })
})

test('the favourites are unique', () => {
    assert.equal(new Set(entries).size, entries.length)
})
