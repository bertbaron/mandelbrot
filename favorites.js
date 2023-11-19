const FAVORITES = [
    "eyJjZW50ZXIiOlt7ImJpZ0ludCI6Ii01MTAzNTk3MzI2OTY5OTY3NzAiLCJzY2FsZSI6NTh9LHsiYmlnSW50IjoiLTQ3MDc1NTI5NjU0NDU3NDQiLCJzY2FsZSI6NTh9XSwiem9vbSI6eyJiaWdJbnQiOiIxODA0MjE1MzE1Nzc4Mjk4Mzc4MzU0NTA5OTQ0NTEzIiwic2NhbGUiOjU4fSwibWF4X2l0ZXIiOjM0MDAsInNtb290aCI6dHJ1ZSwicGFsZXR0ZSI6eyJpZCI6Im9yaWdpbmFsIiwiZGVuc2l0eSI6Ii0yMiIsInJvdGF0ZSI6Ii0xODAifX0=",
    "eyJjZW50ZXIiOlt7ImJpZ0ludCI6Ijg5NjExNDQxMDMxODc0ODYzNTE2OTA1NiIsInNjYWxlIjo4MX0seyJiaWdJbnQiOiItMTYyMDk5NjI0MTIxNzA3MTY5OTYxOTg3MiIsInNjYWxlIjo4MX1dLCJ6b29tIjp7ImJpZ0ludCI6IjI5NDU5ODIyMjI3ODcyNzE0MjUwNzgwMTU3NzA4MDc1MDg1MzA2NDI2MDk3NiIsInNjYWxlIjo4MX0sIm1heF9pdGVyIjoxMDAwLCJzbW9vdGgiOnRydWUsInBhbGV0dGUiOnsiaWQiOiJqZXdlbGxlcnkiLCJkZW5zaXR5IjoxLCJyb3RhdGUiOjB9fQ==",
    "eyJjZW50ZXIiOlt7ImJpZ0ludCI6IjQwNzc5NjA3MjAzMjk2Nzc5NzA3OTYyMjgwNDg1MjQiLCJzY2FsZSI6MTAzfSx7ImJpZ0ludCI6Ii02MTM0NjM1NzEwNzU2MTcyNDEzODM0NzY5NTEzNDkyIiwic2NhbGUiOjEwM31dLCJ6b29tIjp7ImJpZ0ludCI6IjQ0MTQyMzk5MjY4OTMzOTQ0NzA3MDM3Nzk5OTE2MjcyNzgwMjkwMzYwOTIyMDY0OTg1NTUxMzExMjQiLCJzY2FsZSI6MTAzfSwibWF4X2l0ZXIiOjUwMDAsInNtb290aCI6dHJ1ZSwicGFsZXR0ZSI6eyJpZCI6Im9yaWdpbmFsIiwiZGVuc2l0eSI6Ii0yMCIsInJvdGF0ZSI6Ii00NiJ9fQ",
    "eyJjZW50ZXIiOlt7ImJpZ0ludCI6Ii0yMzYyOTIzNzY4NTUzMDUxMjY5MDM2Nzg0Iiwic2NhbGUiOjgwfSx7ImJpZ0ludCI6Ii0xMjI2Nzk3NDE2MDAwMDIyMzYyNCIsInNjYWxlIjo4MH1dLCJ6b29tIjp7ImJpZ0ludCI6Ijc1NTEzODUxMTcyODUzMzEyMDA3MjY1ODI1OTY2Njg3OTMwNzkxMTg4NTk2Iiwic2NhbGUiOjgwfSwibWF4X2l0ZXIiOjIwMDAsInNtb290aCI6dHJ1ZSwicGFsZXR0ZSI6eyJpZCI6Im9jZWFuIiwiZGVuc2l0eSI6Ii0xMyIsInJvdGF0ZSI6Ii00In19",
    "eyJjZW50ZXIiOlt7ImJpZ0ludCI6Ii0zNjU3OTYxOTc4Njg4NjQ1MzgiLCJzY2FsZSI6NTh9LHsiYmlnSW50IjoiLTUxOTQ3MzA5NjM4OTgzNzc0Iiwic2NhbGUiOjU4fV0sInpvb20iOnsiYmlnSW50IjoiMTA5NTc0NjQ1NjY5MjM1MTgwODA5MjU0NDkxNTkiLCJzY2FsZSI6NTh9LCJtYXhfaXRlciI6MjcwMCwic21vb3RoIjp0cnVlLCJwYWxldHRlIjp7ImlkIjoiZHVzay10by1kYXduIiwiZGVuc2l0eSI6Ii0yOSIsInJvdGF0ZSI6Ii02In19",
    "eyJjZW50ZXIiOlt7ImJpZ0ludCI6IjQ0MjM0NTAzMDI5MjM4ODkyMDg4NTQiLCJzY2FsZSI6NzN9LHsiYmlnSW50IjoiLTMyNzk2NjU0MTc3NDY2OTcxNjYzMjUiLCJzY2FsZSI6NzN9XSwiem9vbSI6eyJiaWdJbnQiOiI2MTQ1MTM5NDMwOTAzNDkxNjA0NDU2MjcwMjM4MTUzNzYzNjgzMjY2Iiwic2NhbGUiOjczfSwibWF4X2l0ZXIiOjEyMDAsInNtb290aCI6dHJ1ZSwicGFsZXR0ZSI6eyJpZCI6ImxhdmEiLCJkZW5zaXR5IjoxLCJyb3RhdGUiOiItNCJ9fQ==",
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
