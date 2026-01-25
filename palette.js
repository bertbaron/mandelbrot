/**
 * @author Bert Baron
 */
export function getPalette(id) {
    const palette = palettes().find(p => p.id === id)
    if (palette) return palette
    return ORIGINAL
}

export function initPallet(palette, density, rotate, exp, max_iter) {
    const rgbaBuffer = new Uint8ClampedArray(max_iter * 4 + 20)
    // 0 and 1 = transparent (skipped), 2 and 3 = black (in set)
    // the first elements are doubled because we rotate the palette by one for smoothing
    rgbaBuffer[11] = 255
    rgbaBuffer[15] = 255

    // Scale density exponentially
    density = Math.pow(2, density / 10)
    for (let i = 0; i <= max_iter; i++) {
        const v = density * i // Math.pow(i*2, 0.9)

        const [r, g, b] = palette.getColor(v, rotate)
        rgbaBuffer[(i + 4) * 4] = r
        rgbaBuffer[(i + 4) * 4 + 1] = g
        rgbaBuffer[(i + 4) * 4 + 2] = b
        rgbaBuffer[(i + 4) * 4 + 3] = 255
    }
    return rgbaBuffer
}

export function createPaletteFromColors(id, name, colors, mirror) {
    const colorValues = colors.map(colorValue => {
        if (typeof colorValue === 'string') {
            return [parseInt(colorValue.slice(1, 3), 16), parseInt(colorValue.slice(3, 5), 16), parseInt(colorValue.slice(5, 7), 16)]
        } else {
            return colorValue
        }
    })
    return new IndexedPalette(id, name, colorValues, mirror)
}

export function palettes() {
    return PALETTES.slice().concat(loadCustomPalettes())
}

export function addCustomPalette(palette) {
    let arr = loadCustomPalettesRaw()
    arr.push({name: palette.name, colors: palette.colors, mirror: palette.mirror})
    palette.id = `custom_${arr.length - 1}`
    saveCustomPalettes(arr)
}

export function deleteCustomPalette(id) {
    const index = parseInt(id.split("_")[1])
    let arr = loadCustomPalettesRaw()
    arr.splice(index, 1)
    saveCustomPalettes(arr)
}

export function updateCustomPalette(id, pal) {
    const index = parseInt(id.split("_")[1])
    let arr = loadCustomPalettesRaw()
    if (index < 0 || index >= arr.length) return false
    arr[index] = { name: pal.name, colors: pal.colors, mirror: pal.mirror }
    saveCustomPalettes(arr)
    return true
}

export function loadCustomPalettes() {
    const rawPalettes = loadCustomPalettesRaw()
    let palettes = []
    for (let i = 0; i < rawPalettes.length; i++) {
        const obj = rawPalettes[i]
        const id = `custom_${i}`
        palettes.push(createPaletteFromColors(id, obj.name, obj.colors, obj.mirror || false))
    }
    return palettes
}

const CUSTOM_PALETTES_KEY = "customPalettes"

function loadCustomPalettesRaw() {
    try {
        return JSON.parse(localStorage.getItem(CUSTOM_PALETTES_KEY) || "[]")
    } catch (e) {
        return []
    }
}

function saveCustomPalettes(palettes) {
    let arr = palettes.map(palette => ({name: palette.name, colors: palette.colors, mirror: palette.mirror}))
    localStorage.setItem(CUSTOM_PALETTES_KEY, JSON.stringify(arr))
}


// not sure if this is correct, it does result in vibrant colors though
function toSRGB(r, g, b) {
    function toSRGBComponent(c) {
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    }

    return [toSRGBComponent(r), toSRGBComponent(g), toSRGBComponent(b)]
}

class Palette {
    constructor() {
        if (new.target === Palette) {
          throw new TypeError("Cannot instantiate abstract class Palette directly")
        }
    }

    isCustom() {
        return false
    }

    getColor(v, rotate) {
        throw new Error("Method 'getColor(v, rotate)' must be implemented.");
    }

    isSamePalette(other) {
        return this.id === other.id
    }
}

class OriginalPalette extends Palette {
    constructor() {
        super()
        this.id = 'original'
        this.name = "Original"
        this.wavelengths = [80, 81, 85]
        this.mirrorPosition = 565
    }

    getColor(v, rotate) {
        let idx = (v * 2 + 590 + rotate / 180 * this.mirrorPosition) % (this.mirrorPosition * 2)
        if (idx >= this.mirrorPosition) {
            idx = this.mirrorPosition - (idx - this.mirrorPosition)
        }

        let r = Math.cos(idx / this.wavelengths[0] * Math.PI) * 0.5 + 0.5
        let g = Math.cos(idx / this.wavelengths[1] * Math.PI) * 0.5 + 0.5
        let b = Math.cos(idx / this.wavelengths[2] * Math.PI) * 0.5 + 0.5

        const [rr, gg, bb] = toSRGB(r, g, b)
        return [Math.round(rr * 255), Math.round(gg * 255), Math.round(bb * 255)]
    }
}

class GrayScalePalette extends Palette {
    constructor(id, name, min, max) {
        super()
        this.id = id
        this.name = name
        this.min = min
        this.max = max
    }

    getColor(v, rotate) {
        const idx = v * 1.6 + rotate / 180 * 80
        const f = Math.sin(idx / 80 * Math.PI - Math.PI / 3) * 127 + 128
        return [f, f, f]
    }
}

class SingleColorPalette extends Palette {
    constructor(id, name, color) {
        super()
        this.id = id
        this.name = name
        this.color = color
    }

    getColor(v, rotate) {
        return this.color
    }
}

export class IndexedPalette extends Palette {
    constructor(id, name, colors, mirror) {
        super()
        this.id = id
        this.name = name
        this.colors = []
        this.colors = this.colors.concat(colors)
        this.mirror = mirror
        mirror && (this.colors = this.colors.concat(this.colors.slice(1, this.colors.length - 1).reverse()))
    }

    isCustom() {
        return this.id.startsWith("custom_") || this.id === "embedded"
    }

    isSamePalette(other) {
        if (!other || !other.isCustom()) return false
        if (this.mirror !== other.mirror) return false
        if (this.colors.length !== other.colors.length) return false
        for (let i = 0; i < this.colors.length; i++) {
            const c1 = this.colors[i]
            const c2 = other.colors[i]
            if (c1[0] !== c2[0] || c1[1] !== c2[1] || c1[2] !== c2[2]) {
                return false
            }
        }
        return true
    }

    getColor(v, rotate) {
        const palette = this.colors
        const scaled = v * palette.length / 100 + rotate / 360 * palette.length
        return this.getInterpolationFunctions().map(fn => Math.round(fn(scaled)))
    }

    getInterpolationFunctions() {
        if (!this.interpolationFunctions) {
            this.interpolationFunctions = [0, 1, 2].map(i => monotoneCubicInterpolationFN(this.colors.map(c => c[i])))
        }
        return this.interpolationFunctions
    }

    export() {
        // colorValues is the list of colors in html rgb format. If mirror is true, only the first half is stored.
        let colorValues = []
        const len = this.mirror ? Math.ceil(this.colors.length / 2) : this.colors.length
        for (let i = 0; i < len; i++) {
            const c = this.colors[i]
            colorValues.push(`#${((1 << 24) + (c[0] << 16) + (c[1] << 8) + c[2]).toString(16).slice(1)}`)
        }

        return {
            id: this.id,
            name: this.name,
            colors: colorValues,
            mirror: this.mirror
        }
    }
}

const ORIGINAL = new OriginalPalette()

// Similar to that of Ultra Fractal, although these colors are equaly spaced
export const MANDELBROT = new IndexedPalette("mandelbrot", "Mandelbrot", [
    [0, 7, 100],
    [32, 107, 203],
    [237, 255, 255],
    [255, 170, 0],
    [0, 2, 0],
], false)

const LAVA = new IndexedPalette("lava", "Lava", [
    [0, 0, 0],
    [10, 0, 0],
    [20, 0, 0],
    [40, 0, 0],
    [80, 0, 0],
    [160, 10, 0],
    [200, 40, 0],
    [240, 90, 0],
    [255, 160, 0],
    [255, 220, 10],
    [255, 255, 80],
    [255, 255, 160],
    [255, 255, 255],
], true)
const FALL = new IndexedPalette("fall", "Fall", [
    [25, 25, 25],
    [128, 0, 0],
    [255, 69, 0],
    [255, 140, 0],
    [255, 215, 0],
    [255, 239, 184],
], false)
const OCEAN = new IndexedPalette("ocean", "Ocean", [
    [0, 0, 51],
    [0, 0, 102],
    [0, 0, 153],
    [0, 51, 102],
    [0, 102, 204],
    [51, 153, 255],
    [102, 178, 255],
    [153, 204, 255],
    [204, 229, 255],
    [255, 255, 255]
], true)
const POP = new IndexedPalette("pop", "Pop", [
    [255, 0, 0],
    [255, 165, 0],
    [255, 255, 0],
    [0, 128, 0],
    [0, 0, 255],
    [128, 0, 128],
    [255, 0, 255],
    [255, 192, 203],
    [255, 99, 71],
    [0, 255, 255],
    [0, 255, 0],
    [255, 0, 128]
], false)
const SKY_WATER = new IndexedPalette("sky_water", "Sky & Water", [
    [0, 0, 51],
    [0, 51, 102],
    [0, 102, 153],
    [0, 153, 204],
    [51, 153, 204],
    [102, 178, 255],
    [153, 204, 255],
    [178, 223, 255],
    [204, 238, 255],
    [229, 255, 255],
    [255, 255, 255],
    [51, 153, 204],
    [0, 102, 153]
], false)
const JEWELLERY = new IndexedPalette("jewellery", "Jewellery", [
    [0, 0, 51],
    [0, 0, 102],
    [0, 0, 153],
    [0, 102, 204],
    [51, 153, 255],
    [0, 102, 102],
    [0, 128, 128],
    [204, 204, 255],
    [255, 204, 0],
    [255, 0, 0],
    [255, 0, 255],
    [255, 255, 255],
    [51, 153, 255],
    [0, 0, 153]
], false)

const PALETTES = [
    ORIGINAL,
    MANDELBROT,
    LAVA,
    FALL,
    OCEAN,
    SKY_WATER,
    POP,
    JEWELLERY,
    new GrayScalePalette("gray_scale", "Gray Scale", 0, 255),
    new SingleColorPalette("black_white", "Pure B/W", [255, 255, 255]),
]

function linearInterpolationFN(values) {
    const N = values.length
    return function (x) {
        const t = x - Math.floor(x)
        let k = Math.floor(x)
        if (k < 0) k += N

        const yk0 = values[k % N]
        const yk1 = values[(k + 1) % N]
        return yk0 * (1 - t) + yk1 * t
    }
}

// https://en.wikipedia.org/wiki/Monotone_cubic_interpolation
function monotoneCubicInterpolationFN(values) {
    const N = values.length;
    const delta = []
    for (let k = 0; k < N; k++) {
        delta.push((values[(k + 1) % N] - values[k]))
    }

    const m = []
    for (let k = 1; k <= N; k++) {
        const dk = delta[k % N]
        const dk1 = delta[(k + 1) % N]
        m[(k + 1) % N] = dk * dk1 <= 0 ? 0 : (dk + dk1) / 2
        // m[(k + 1) % N] = (dk + dk1) / 2
    }

    for (let k = 0; k < N; k++) {
        if (delta[k] !== 0) {
            const alpha = m[k] / delta[k]
            const beta = m[(k + 1) % N] / delta[k]
            if (alpha < 0) {
                m[k] = 0
            }
            if (beta < 0) {
                m[(k + 1) % N] = 0
            }

            const sqRadius = alpha * alpha + beta * beta
            if (sqRadius > 9) {
                const tau = 3 / Math.sqrt(sqRadius)
                m[k] = tau * alpha * delta[k]
                m[(k + 1) % N] = tau * beta * delta[k]
            }
        }
    }

    return function (x) {
        const t = x - Math.floor(x)
        let k = Math.floor(x)
        if (k < 0) k += N

        const yk0 = values[k % N]
        const yk1 = values[(k + 1) % N]

        return yk0 * h00(t) + m[k % N] * h10(t) + yk1 * h01(t) + m[(k + 1) % N] * h11(t)
    }
}

function h00(t) {
    return (1 + 2 * t) * Math.pow(1 - t, 2)
}

function h10(t) {
    return t * Math.pow(1 - t, 2)
}

function h01(t) {
    return t * t * (3 - 2 * t)
}

function h11(t) {
    return t * t * (t - 1)
}
