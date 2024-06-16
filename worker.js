import * as fxp from './fxp.mjs'
import {WorkerContext} from "./workerContext.mjs";
import {MandelbrotFloat} from "./mandelbrotFloat.mjs";
import {MandelbrotFxP} from "./mandelbrotFxP.mjs";
import {MandelbrotPerturbation} from "./mandelbrotPerturbation.mjs";

const ctx = new WorkerContext()

async function initMandelbrotFloat() {
    await new Promise(resolve => setTimeout(resolve, 1))
    return new MandelbrotFloat(ctx)
}

async function initMandelbrotFxP() {
    await new Promise(resolve => setTimeout(resolve, 1))
    return new MandelbrotFxP(ctx)
}

async function initMandelbrotPerturbation() {
    await new Promise(resolve => setTimeout(resolve, 1))
    return new MandelbrotPerturbation(ctx)
}

const mandelbrotFloat = initMandelbrotFloat();
const mandelbrotFxP = initMandelbrotFxP();
const mandelbrotPerturbation = initMandelbrotPerturbation();

onmessage = handleMessage

// Add some randomnes to have different checkpoints per worker
const STOP_CHECK_INTERVAL = 200 + Math.floor(Math.random() * 100)

async function handleMessage(msg) {
    const message = parseMessage(msg)

    if (message.type === 'task') {
        const impl = message.requiredPrecision > 58 ? await mandelbrotPerturbation : await mandelbrotFloat
        // const impl = await mandelbrotFxP

        ctx.initTask(message.jobToken)
        ctx.resetStats()
        impl.onTask(message)
    }
}

function parseMessage(msg) {
    if (msg.data.type === 'task') {
        msg.data.topleft[0] = fxp.fromJSON(msg.data.topleft[0])
        msg.data.topleft[1] = fxp.fromJSON(msg.data.topleft[1])
        msg.data.bottomright[0] = fxp.fromJSON(msg.data.bottomright[0])
        msg.data.bottomright[1] = fxp.fromJSON(msg.data.bottomright[1])
        msg.data.frameTopLeft[0] = fxp.fromJSON(msg.data.frameTopLeft[0])
        msg.data.frameTopLeft[1] = fxp.fromJSON(msg.data.frameTopLeft[1])
        msg.data.frameBottomRight[0] = fxp.fromJSON(msg.data.frameBottomRight[0])
        msg.data.frameBottomRight[1] = fxp.fromJSON(msg.data.frameBottomRight[1])
    }
    return msg.data
}
