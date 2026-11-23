const FAVORITES = [
    "x=DipS8h4it0U&y=IXL9LIiQ4Q&s=58&z=6259629327995.045&i=3400&m=1&p=original&d=-22&r=-180",
    "x=AXuE60aejCc6AkA&y=Aq6Ew77phDv04EE&s=81&z=1.2184296898077526e20&i=1000&m=1&p=jewellery&d=1&r=0",
    "x=ZvE0F90y7eKnTY3tGA&y=mtwnczTmXhcuW7l4KQ&s=103&z=4.3527766307398201e26&i=5000&m=1&p=original&d=-20&r=-46",
    "x=A-i8tVUApGN19eE&y=AVSBMwAA-BMR&s=80&z=6.2463593669398969e19&i=2000&m=1&p=ocean&d=-13&r=-4",
    "x=CicjaGRTCDU&y=AXEbmxQjQL0&s=58&z=38016342042.85253&i=2700&m=1&c=421e0f_19071a_09012f_040449_000764_0c2c8a_1852b1_397dd1_86b5e5_d3ecf8_f1e9bf_f8c95f_ffaa00_cc8000_995700_6a3403&cm=0&d=-29&r=-6",
    "x=Ad-XaMwhWPDcLA&y=AWOVAGIOmfg76w&s=73&z=6.506419454308498e17&i=1200&m=1&p=lava&d=1&r=-4",
    "x=AhQ4kc0JQlI&y=A1gnRjPS3A&s=58&z=6932.369982990104&i=5000&m=1&c=000000-2_ffeb14_000000-2_39ff14_000000-2_00ffff&cm=0&d=1&r=0",
    "x=A30o5NihlW-YpxdK3w&y=C0WPUEOW5hQ8bz61&s=96&z=3.2642466556248884e24&i=1000&m=1&p=original&d=1&r=0",
    "x=BkSBkYs61qKaCKL8ImrUCqg&y=BenAViwo00ue7ixUNeNdfJQ&s=131&z=1.9985578327554e35&i=8000&m=1&p=lava&d=-25&r=0",
    "x=aCOrvyLFrxSKM7Ar&y=abDx4EoYLN_OorE&s=93&z=4.5173605077590136e23&i=5000&m=1&p=mandelbrot&d=-11&r=-36",
    "x=z5zijotRdmvMLCi4PYJn&y=tigUprMuC0i4Xvaor4s&s=118&z=1.4127496742220896e31&i=5000&m=1&p=mandelbrot&d=-11&r=-49",
    "x=DUCH-jT0Hu8iXW_wX2gjGvmxh0JHDsYGCQ&y=BYuVHvOT59XvdArkHsiI3HKkeUkJ-5f4&s=194&z=1.2387845547275405e54&i=5000&m=1&p=mandelbrot&d=-11&r=-11",
    "x=atv9W1oZ4F01&y=e4MQqH1wXw&s=69&z=24052219102057176&i=5000&m=1&p=pop&d=-7&r=-11",
    "x=X5AHwajYrLTk3hg&y=FsGAv7j4qrKZF8M&s=87&z=8.1705765949552286e21&i=5000&m=1&p=mandelbrot&d=-18&r=-30",
    "x=Ae6nckG_X13l3yR7&y=Z9a2W1mpm4OT&s=87&z=1.0543338218764e22&i=2000&m=1&p=ocean&d=1&r=0",
    "x=P0cbKGwNWAm3jj5L1fM&y=K9TxoIU3vg2tEg&s=108&z=1.5542577591929109e28&i=2000&m=1&p=gray_scale&d=17&r=8",
    "x=B7qdyQb9fVDAThU&y=AZ9a2W2i4eph&s=81&z=1.4124046380359949e20&i=2000&m=1&c=00665a-1.6_20cb6a-2.6_f2ffeb-2.2_ff5792-2.2_000000-1.4&cm=0&d=1&r=0",
    "x=B2G7dMJzIG8&y=Anx5WV-iFiU&s=58&z=334779121336.9954&i=1000&m=1&c=00665a-1.6_20cb6a-2.6_f2ffeb-2.2_ff5792-2.2_000000-1.4&cm=0&d=1&r=0",
    "x=COdiK73Qje0&y=AdLF60khEC0&s=58&z=11577014549.479189&i=4000&m=1&c=00665a-1.6_20cb6a-2.6_f2ffeb-2.2_ff5792-2.2_000000-1.4&cm=0&d=-5&r=0",
    "x=Cgf52bX1e2U&y=YHWi8PHT2A&s=58&z=4454.153674264754&i=8000&m=1&p=mandelbrot&d=-18&r=3",
    "x=AV9Vry4A4-JsqKU&y=A9kHOh90MO9Mbw&s=79&z=2.4394892630280868e19&i=14000&m=1&p=mandelbrot&d=-5&r=-53",
    "x=C0CKpD4Zbuk&y=NpBjZZA&s=58&z=1212159068229.4102&i=10000&m=1&p=mandelbrot&d=-25&r=148",
    "x=Df82a6wphu8&y=AVDmjNI&s=58&z=2153182.4394181636&i=8000&m=1&p=mandelbrot&d=-4&r=20",
    "x=B_16qmbshzyP&y=G9dSMQ&s=65&z=2042299461798973.2&i=5000&m=1&c=000764-1.6_206bcb-2.6_f9ebff-2.2_ea5d64-2.2_000200-1.4&cm=1&d=-11&r=10",
]

const luckyOrder = []
export function getRandomFavorite() {
    if (luckyOrder.length === 0) {
        for (let i = 0; i < FAVORITES.length; i++) {
            luckyOrder.push(i)
        }
        shuffle(luckyOrder)
    }
    const favoriteIndex = luckyOrder.pop()
    console.log(`favorite ${favoriteIndex}`)
    return FAVORITES[favoriteIndex]
}

function shuffle(array) {
    let currentIndex = array.length,  randomIndex;

    // While there remain elements to shuffle.
    while (currentIndex > 0) {

        // Pick a remaining element.
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;

        // And swap it with the current element.
        [array[currentIndex], array[randomIndex]] = [
            array[randomIndex], array[currentIndex]];
    }

    return array;
}
