import test from 'node:test'
import assert from 'node:assert/strict'

// palette.mjs reads custom palettes from localStorage, which node does not have.
globalThis.localStorage = {
    data: {},
    getItem(key) { return this.data[key] ?? null },
    setItem(key, value) { this.data[key] = String(value) },
    removeItem(key) { delete this.data[key] },
}

const palette = await import('../palette.mjs')

const asJson = params => JSON.parse(JSON.stringify(params))

test('built-in palettes keep their id and carry no colors', () => {
    const params = palette.toPermalinkPalette(palette.getPalette('lava'), 1, 0)
    assert.equal(params.id, 'lava')
    assert.equal(params.colors, undefined)
})

test('a palette being edited travels with its colors', () => {
    // while editing, the active palette has no id yet
    const editing = palette.createPaletteFromColors('<tmp>', 'being edited', ['#ff0000', '#0000ff'], false)
    const params = asJson(palette.toPermalinkPalette(editing, 2, 30))
    assert.equal(params.id, undefined)
    assert.deepEqual(params.colors, ['#ff0000', '#0000ff'])
    assert.equal(params.mirror, false)
})

test('a saved custom palette travels with its colors', () => {
    const saved = palette.createPaletteFromColors('custom_3', 'saved', ['#ff0000'], true)
    const params = asJson(palette.toPermalinkPalette(saved, 1, 0))
    assert.equal(params.id, undefined)
    assert.deepEqual(params.colors, ['#ff0000'])
    assert.equal(params.mirror, true)
})

test('an embedded palette stays embedded', () => {
    const embedded = palette.createPaletteFromColors('embedded', 'from an url', ['#00ff00'], false)
    assert.deepEqual(asJson(palette.toPermalinkPalette(embedded, 1, 0)).colors, ['#00ff00'])
})

test('density and rotate are passed through unchanged', () => {
    const params = palette.toPermalinkPalette(palette.getPalette('ocean'), -5, 8)
    assert.equal(params.density, -5)
    assert.equal(params.rotate, 8)
})

test('every palette in the list is either built-in or custom, never both', () => {
    for (const p of palette.palettes()) {
        assert.equal(palette.isBuiltInPalette(p.id), !p.isCustom(), `palette ${p.id}`)
    }
    assert.equal(palette.isBuiltInPalette('<tmp>'), false)
    assert.equal(palette.isBuiltInPalette('custom_0'), false)
    assert.equal(palette.isBuiltInPalette('embedded'), false)
})

test('a mirroring palette only exports the first half of its colors', () => {
    const mirrored = palette.createPaletteFromColors('custom_0', 'mirrored', ['#ff0000', '#00ff00'], true)
    const params = palette.toPermalinkPalette(mirrored, 1, 0)
    assert.deepEqual(params.colors, ['#ff0000', '#00ff00'])
    assert.equal(params.mirror, true)
})

test('saving a new palette gives the live object its real id', () => {
    const editing = palette.createPaletteFromColors('<tmp>', 'nieuw', ['#ff0000'], false)
    palette.addCustomPalette(editing)
    assert.equal(editing.id, 'custom_0')
    assert.equal(palette.isBuiltInPalette(editing.id), false)
    assert.equal(palette.getPalette('custom_0').name, 'nieuw')
})

test('a saved palette survives a url round trip under its own name', () => {
    const editing = palette.createPaletteFromColors('<tmp>', 'rondje', ['#123456'], false)
    palette.addCustomPalette(editing)
    const params = asJson(palette.toPermalinkPalette(editing, 1, 0))

    const restored = palette.createPaletteFromColors('embedded', '<embedded>', params.colors, params.mirror)
    const match = palette.palettes().find(p => p.isSamePalette(restored))
    assert.equal(match && match.name, 'rondje')
})
