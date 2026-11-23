/*
 * Compact permalink encoding. Each setting gets its own short query parameter:
 *   x, y = center (zigzag + base64url of the bigints), s = fixed-point scale of x and y,
 *   z = zoom in scientific notation, i = max_iter, m = smooth (0/1),
 *   p = built-in palette id, or c + cm = embedded palette colors + mirror, d = density, r = rotate.
 * The old format (`params` = base64 of a JSON document) is still readable via decodeLegacyPermalink.
 *
 * @author Bert Baron
 */
import * as fxp from './fxp.mjs'

const ZOOM_DIGITS = 17
// Bounds so a crafted url cannot make the page allocate or compute for ages.
const MAX_SCALE = 200000
const MAX_EXPONENT = 100000

// Maps the sign into the lowest bit, so no separate sign needs to be stored.
function bigIntToBase64url(n) {
    let hex = (n < 0n ? ((-n) << 1n) | 1n : n << 1n).toString(16)
    if (hex.length % 2) hex = '0' + hex
    const bytes = new Array(hex.length / 2)
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = String.fromCharCode(parseInt(hex.substr(i * 2, 2), 16))
    }
    return btoa(bytes.join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlToBigInt(s) {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
    const hex = new Array(bin.length)
    for (let i = 0; i < bin.length; i++) {
        hex[i] = bin.charCodeAt(i).toString(16).padStart(2, '0')
    }
    const z = BigInt('0x' + hex.join(''))
    return z & 1n ? -(z >> 1n) : z >> 1n
}

// ~17 significant digits are plenty: the zoom only determines the size of the view.
function zoomToString(zoom) {
    const integerPart = zoom.bigIntValue().toString()
    if (integerPart.length > ZOOM_DIGITS) {
        const fraction = integerPart.slice(1, ZOOM_DIGITS).replace(/0+$/, '')
        return `${integerPart[0]}${fraction && '.' + fraction}e${integerPart.length - 1}`
    }
    return String(zoom.toNumber()).replace('+', '')
}

function zoomFromString(str, scale) {
    const m = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(str)
    if (!m) throw new Error(`Invalid zoom: ${str}`)
    const fraction = m[2] || ''
    const digits = BigInt(m[1] + fraction)
    const exp10 = (m[3] ? parseInt(m[3]) : 0) - fraction.length
    if (Math.abs(exp10) > MAX_EXPONENT) throw new Error(`Invalid zoom: ${str}`)
    const bigScale = BigInt(scale)
    const value = exp10 >= 0
        ? (digits * 10n ** BigInt(exp10)) << bigScale
        : (digits << bigScale) / 10n ** BigInt(-exp10)
    return new fxp.FxP(value, scale)
}

/**
 * @param {{center: FxP[], zoom: FxP, max_iter: number, smooth: boolean, palette: object}} params
 *        palette is the result of palette.toPermalinkPalette
 * @returns {Object<string, string>} the query parameters
 */
export function encodePermalink({center, zoom, max_iter, smooth, palette}) {
    const scale = Math.max(center[0].scale, center[1].scale)
    const q = {
        x: bigIntToBase64url(center[0].withScale(scale).bigInt),
        y: bigIntToBase64url(center[1].withScale(scale).bigInt),
        s: String(scale),
        z: zoomToString(zoom),
        i: String(max_iter),
        m: smooth ? '1' : '0',
    }
    if (palette) {
        if (palette.colors) {
            q.c = palette.colors.map(c => c.slice(1).replace(':', '-')).join('_')
            q.cm = palette.mirror ? '1' : '0'
        } else {
            q.p = palette.id
        }
        q.d = String(palette.density)
        q.r = String(palette.rotate)
    }
    return q
}

/**
 * @param {URLSearchParams} searchParams
 * @returns the parameters, or null when the url does not contain a (new style) permalink
 */
export function decodePermalink(searchParams) {
    const x = searchParams.get('x')
    if (x === null) return null
    const [y, z] = [searchParams.get('y'), searchParams.get('z')]
    const scale = Number(searchParams.get('s'))
    const maxIter = Number(searchParams.get('i'))
    if (!x || !y || !z || !Number.isInteger(scale) || scale < 0 || scale > MAX_SCALE || !Number.isInteger(maxIter) || maxIter <= 0) {
        throw new Error('Invalid permalink')
    }
    const result = {
        center: [new fxp.FxP(base64urlToBigInt(x), scale), new fxp.FxP(base64urlToBigInt(y), scale)],
        zoom: zoomFromString(z, scale),
        max_iter: maxIter,
        smooth: searchParams.get('m') === '1',
    }
    const colors = searchParams.get('c')
    const id = searchParams.get('p')
    if (colors !== null || id !== null) {
        const density = Number(searchParams.get('d') ?? 1)
        const rotate = Number(searchParams.get('r') ?? 0)
        result.palette = {density: Number.isFinite(density) ? density : 1, rotate: Number.isFinite(rotate) ? rotate : 0}
        if (colors !== null) {
            result.palette.colors = colors.split('_').map(c => '#' + c.replace('-', ':'))
            result.palette.mirror = searchParams.get('cm') === '1'
        } else {
            result.palette.id = id
        }
    }
    return result
}

/**
 * Reads the old format: base64 of a JSON document.
 */
export function decodeLegacyPermalink(base64) {
    const p = JSON.parse(atob(base64))
    return {
        center: p.center.map(fxp.fromJSON),
        zoom: fxp.fromJSON(p.zoom),
        max_iter: p.max_iter,
        smooth: p.smooth,
        palette: p.palette,
    }
}
