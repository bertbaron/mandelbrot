import * as tasks from './testtasks.mjs'
import * as m from '../mandelbrotPerturbationExtFloat.mjs'
import {WorkerContext} from "../workerContext.mjs";

function calculate(mandelbrot, task, [x, y], [w, h]) {
    task.xOffset = x
    task.yOffset = y
    task.w = w
    task.h = h
    mandelbrot.ctx.resetStats()
    return mandelbrot.process(task)
}

function perfTest() {
    const ctx = new WorkerContext()
    const mandelbrot = new m.MandelbrotPerturbationExtFloat(ctx)
    const task = tasks.parse(tasks.E1000)
    task.resetCaches = true

    // warmup
    let result
    for (let i = 0; i < 10; i++) {
        task.jobId = i // caches are only cleared if jobId changes
        result = calculate(mandelbrot, task, [300, 200], [20, 20])
    }
    console.log(result.stats)
    for (let i = 0; i < 1; i++) {
        task.jobId = i // caches are only cleared if jobId changes
        result = calculate(mandelbrot, task, [0, 0], [800, 600])
    }
    console.log(result.stats)
}

function testje() {
    const ctx = new WorkerContext()
    const mandelbrot = new m.MandelbrotPerturbationExtFloat(ctx)
    const task = tasks.parse(tasks.I50000)
    task.resetCaches = true
    task.w = 80
    task.h = 60

    // calculates reference points
    calculate(mandelbrot, task, [0, 0], [80, 60])


    // now we take a sample
    mandelbrot.debug = true
    // calculate(mandelbrot, task, [79, 59], [1, 1])
    calculate(mandelbrot, task, [40, 20], [1, 1])
}

// perfTest()
testje()
