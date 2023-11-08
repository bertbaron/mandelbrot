export function getPalette(id) {
    const palette = PALETTES.find(p => p.id === id)
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
    density = Math.pow(2, density/10)
    // const indexes = []
    for (let i = 0; i <= max_iter; i++) {
        const v = i * density

        const [r, g, b] = palette.getColor(v, rotate)
        rgbaBuffer[(i + 4) * 4] = r
        rgbaBuffer[(i + 4) * 4 + 1] = g
        rgbaBuffer[(i + 4) * 4 + 2] = b
        rgbaBuffer[(i + 4) * 4 + 3] = 255
    }
    return rgbaBuffer
}

// not sure if this is correct, it does result in vibrant colors though
function toSRGB(r, g, b) {
    function toSRGBComponent(c) {
        return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    }

    return [toSRGBComponent(r), toSRGBComponent(g), toSRGBComponent(b)]
}

class OriginalPalette {
    constructor() {
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


class IndexedPalette {
    constructor(id, name, colors, mirror, reverse) {
        this.id = id
        this.name = name
        this.colors = []
        this.colors = this.colors.concat(colors)
        reverse && this.colors.reverse()
        mirror && (this.colors = this.colors.concat(this.colors.slice(1, this.colors.length - 1).reverse()))
    }

    getColor(v, rotate) {
        const palette = this.colors
        const scaled = v * palette.length / 100 + rotate / 360 * palette.length
        // const scaled = v * palette.length / 100
        const f = scaled - Math.floor(scaled)

        let idx = Math.floor(scaled)
        if (idx < 0) idx += palette.length

        const c1 = palette[idx % palette.length]
        const c2 = palette[(idx + 1) % palette.length]

        return [
            Math.round(c1[0] * (1 - f) + c2[0] * f),
            Math.round(c1[1] * (1 - f) + c2[1] * f),
            Math.round(c1[2] * (1 - f) + c2[2] * f)
        ]
    }
}

const ORIGINAL = new OriginalPalette();

const DUSK_DAWN = new IndexedPalette("dusk-to-dawn", "Dusk to Dawn", [
    [66, 30, 15],
    [25, 7, 26],
    [9, 1, 47],
    [4, 4, 73],
    [0, 7, 100],
    [12, 44, 138],
    [24, 82, 177],
    [57, 125, 209],
    [134, 181, 229],
    [211, 236, 248],
    [241, 233, 191],
    [248, 201, 95],
    [255, 170, 0],
    [204, 128, 0],
    [153, 87, 0],
    [106, 52, 3]
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
    [255, 255, 255]
], true)
const FALL = new IndexedPalette("fall", "Fall", [
    [102, 34, 0],
    [204, 68, 0],
    [204, 102, 0],
    [255, 102, 0],
    [255, 153, 0],
    [255, 204, 0],
    [255, 255, 0],
    [255, 204, 102],
    [255, 255, 153],
    [255, 255, 204],
    [204, 102, 0],
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
const DESERT = new IndexedPalette("desert", "Desert", [
    [255, 204, 153],
    [204, 119, 34],
    [153, 102, 51],
    [204, 153, 102],
    [204, 153, 51],
    [255, 255, 102],
    [255, 204, 102],
    [153, 102, 102],
    [102, 102, 51],
    [51, 51, 51],
    [0, 0, 0]
], false, true)
const BLUE_AND_BLACK = new IndexedPalette("blue_and_black", "Blue & Black", [
    [0, 0, 0],     // Black
    [0, 0, 51],    // Midnight Blue
    [0, 0, 102],   // Dark Blue
    [0, 0, 153],   // Navy Blue
    [0, 51, 102],  // Deep Teal
    [0, 51, 153],  // Deep Blue
    [0, 51, 204],  // Cobalt Blue
    [0, 102, 204], // Royal Blue
    [51, 102, 153], // Slate Blue
    [51, 51, 51]    // Charcoal
], false, false)

export const PALETTES = [
    ORIGINAL,
    DUSK_DAWN,
    LAVA,
    // FALL,
    OCEAN,
    SKY_WATER,
    POP,
    JEWELLERY,
    // DESERT,
    // BLUE_AND_BLACK
]