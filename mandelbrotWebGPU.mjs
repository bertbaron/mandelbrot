/**
 * @author Bert Baron
 */
import {smoothen, WorkerContext} from "./workerContext.mjs";
import {ReferencePointProvider} from "./referencePointProvider.mjs";

const USE_GPU = true

// Number of reference points that are calculated at the same time (each in its own web worker)
const REFERENCE_POINTS_PER_ROUND = 4

export class MandelbrotWebGPU {
    /**
     * @param {WorkerContext} ctx
     */
    constructor(p, ctx, errorCallback) {
        this.p = p
        this.ctx = ctx
        this.errorCallback = errorCallback
        this.paramHash = null
        this.jobId = null
        this.referencePoints = []
        this.referencePointProvider = new ReferencePointProvider(REFERENCE_POINTS_PER_ROUND)
        this.devicePromise = this.initGpu()
        this.mandelbrotPipeline = this.createPipeline()
        this.running = Promise.resolve()
        this.currentTask = null
        this.newTask = null
    }

    async initGpu() {
        const adapter = await navigator.gpu?.requestAdapter({
            powerPreference: 'high-performance'
            // powerPreference: 'low-power'
        });
        const device = await adapter?.requestDevice();
        if (!device) {
            this.errorCallback('need a browser that supports WebGPU')
            return
        }

        try {
            const info = await device?.adapterInfo
            console.log(`GPU Adapter: ${info.vendor}:${info.architecture}:${info.device} ${info.description}`)
        } catch (error) {
            console.log(`Failed to get adapter info: ${error}`)
        }

        device.lost.then(() => {
            console.log('GPU lost, reloading');
            // TODO Test if this actually works
            this.devicePromise = this.initGpu();
            this.mandelbrotPipeline = this.createPipeline()
        })
        return device
    }

    createPipeline() {
        return USE_GPU ? new MandelbrotPipeline(this, this.devicePromise) : new MandelbrotReference()
    }

    shouldStop() {
        return this.currentTask !== this.newTask
    }

    async process(task){
        this.newTask = task.jobToken
        await this.running
        if (task.jobToken !== this.newTask) {
            return
        }
        this.currentTask = task.jobToken

        this.max_iter = task.maxIter
        const w = task.w
        const h = task.h

        const start = performance.now()
        this.running = this.calculate(w, h, task.skipTopLeft, task);
        const {values, smooth, error} = await this.running
        const end = performance.now()
    }

    async calculate(w, h, skipTopLeft, task) {
        const scale = task.precision
        const bigScale = BigInt(scale)
        const rmin = task.frameTopLeft[0]
        const rmax = task.frameBottomRight[0]
        const imin = task.frameTopLeft[1]
        const imax = task.frameBottomRight[1]

        // Size in the complex plane with implicit exponent 2^-scale
        const cWidth = Number(rmax.subtract(rmin).bigInt)
        const cHeight = Number(imax.subtract(imin).bigInt)
        const refr = rmin.bigInt
        const refi = imin.bigInt

        const bailout = task.smooth ? 128 : 4

        this.updateCache(task)
        // this.referencePoints = []  // for debugging

        if (this.referencePoints.length === 0) {
            const x = Math.trunc(w / 2)
            const y = Math.trunc(h / 2)
            const rr = refr + BigInt(Math.trunc(x / w * cWidth))
            const ri = refi + BigInt(Math.trunc(y / h * cHeight))
            const ref = await this.calculate_reference(rr, ri, bigScale, scale, bailout)
            if (ref === null) return {
                error: "Stopped"
            }
            this.referencePoints.push(ref)
            if (this.shouldStop()) return {
                error: "Stopped"
            }
        }
        const ddr = cWidth / task.frameWidth
        const ddi = cHeight / task.frameHeight
        const ddr0 = task.xOffset * ddr
        const ddi0 = task.yOffset * ddi

        let solved = false
        let refIdx = 0
        let passnr = 0
        let indices = this.getInitialIndices(w, h)
        const refValues = []
        let values = []
        let smooth = []
        let lastUpdate = performance.now()
        while (!solved) {
            const ref = this.referencePoints[refIdx]
            const start = performance.now()
            const result = await this.perturbationPass({
                passnr,
                w,
                h,
                indices,
                zBuffer: ref.zBuffer,
                zqErrorBoundBuffer: ref.zqErrorBoundBuffer,
                max_iter: task.maxIter,
                dExp: -task.precision,
                refr: Number(ref.rr - refr),
                refi: Number(ref.ri - refi),
                refsize: ref.size,
                ddr0,
                ddi0,
                ddr,
                ddi,
                doSmooth: task.smooth,
                bailout,
                skipTopLeft,
            })
            const remainingIndices = result.indices
            const end = performance.now()
            if (passnr % 25 === 0) {
                console.log(`Pass ${passnr} of ${indices.length} pixels took ${(end - start).toFixed(1)}ms`)
            }
            if (this.shouldStop()) return {
                error: "Stopped"
            }
            if (passnr > 100) {
                console.log('Too many passes')
                return {
                    error: "Too many passes"
                }
            }
            indices = remainingIndices

            if (indices.length > 0) {
                refIdx++
                if (refIdx >= this.referencePoints.length) {
                    // Calculate several reference points at the same time, picked evenly spread from the remaining pixels
                    const count = Math.min(REFERENCE_POINTS_PER_ROUND, indices.length)
                    const newRefPoints = Array.from({length: count}, (_, i) => indices[Math.trunc((i + 0.5) * indices.length / count)])
                    const refs = await Promise.all(newRefPoints.map(newRefPoint => {
                        const x = newRefPoint % w
                        const y = Math.floor(newRefPoint / w)
                        const rr = refr + BigInt(Math.trunc(x / w * cWidth))
                        const ri = refi + BigInt(Math.trunc(y / h * cHeight))
                        return this.calculate_reference(rr, ri, bigScale, scale, bailout)
                    }))
                    if (refs.includes(null) || this.shouldStop()) return {
                        error: "Stopped"
                    }
                    this.referencePoints.push(...refs)

                    // remove the reference points from indices to ensure progress even when perturbation fails
                    // we will add them later by storing the result in refValues
                    indices = indices.filter(idx => !newRefPoints.includes(idx))
                    newRefPoints.forEach((newRefPoint, i) => refValues.push([newRefPoint, refs[i].iter, refs[i].zq]))
                }
                // this.ctx.stats.numberOfLowPrecisionMisses += indices.length
            }
            solved = indices.length === 0
            const now = performance.now()
            if (solved || now - lastUpdate > 100) {
                // values and smooth are only copied back from the GPU when we need them
                ({values, smooth} = await this.mandelbrotPipeline.readValues())
            }
            if (!solved && now - lastUpdate > 100) {
                this.intermediateUpdate(values, smooth)
                lastUpdate = now
            }
            passnr++
        }
        await this.mandelbrotPipeline.finish()

        for (let [offset, iter, zq] of refValues) {
            values[offset] = smoothen(smooth, offset, iter, zq)
        }
        this.p.onGpuUpdate({
            jobToken: task.jobToken,
            values,
            smooth,
            renderedPixels: values.length,
            isFinished: true,
        })
        return {values, smooth}
    }

    getInitialIndices(w, h) {
        const key = `${w}:${h}`
        if (this.initialIndicesKey === key) {
            return this.initialIndices
        }
        const indices = this.createZOrderCurve(w, h)
        this.initialIndicesKey = key
        this.initialIndices = indices
        return indices
    }

    createZOrderCurve(w, h) {
        const withZValue = []
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const index = y * w + x
                const z = this.interleaveBits(x, y)
                withZValue.push([index, z])
            }
        }
        withZValue.sort((a, b) => a[1] - b[1])
        return new Uint32Array(withZValue.map(([index, _]) => index))
    }

    interleaveBits(x, y) {
        let z = 0
        for (let i = 0; i < 32; i++) {
            z |= (x & (1 << i)) << i | (y & (1 << i)) << (i + 1)
        }
        return z
    }

    intermediateUpdate(values, smooth) {
        this.p.onGpuUpdate({
            jobToken: this.currentTask,
            values,
            smooth,
            isFinished: false,
        })
    }

    updateCache(task) {
        if (task.jobId !== this.jobId) {
            this.jobId = task.jobId
            if (this.paramHash !== task.paramHash || this.referencePoints.length === 0 || task.resetCaches) {
                this.paramHash = task.paramHash
                this.referencePoints = []
            } else {
                // Keep reference points that are within the total frame when job parameters did not change
                const oldReferencePoints = this.referencePoints
                this.referencePoints = []
                const oldPrecision = this.precision
                const newPrecision = task.precision
                if (newPrecision === oldPrecision) {  // <= requires adjusting the reference points because implicit scale changes, we don't do this yet
                    for (let ref of oldReferencePoints) {
                        if (ref.rr >= task.frameTopLeft[0].bigInt && ref.rr <= task.frameBottomRight[0].bigInt &&
                            ref.ri >= task.frameTopLeft[1].bigInt && ref.ri <= task.frameBottomRight[1].bigInt) {
                            this.referencePoints.push(ref)
                        }
                    }
                // } else {
                //     console.log(`Clearing caches because precision changed ${oldPrecision} -> ${newPrecision}`)
                }
            }
            this.precision = task.precision
        }
    }

    async perturbationPass(data) {
        if (data.passnr === 0) {
            await this.mandelbrotPipeline.beforeRun(data)
        }
        return await this.mandelbrotPipeline.run(data)
    }

    /**
     * @param {BigInt} rr the reference point real part
     * @param {BigInt} ri the reference point imaginary part
     * @param {BigInt} bigScale
     * @param {number} scale
     * @param {number} bailout
     */
    async calculate_reference(rr, ri, bigScale, scale, bailout) {
        const start = performance.now()
        const ref = await this.referencePointProvider.calculate(rr, ri, this.max_iter, bailout, scale, this.currentTask)
        const end = performance.now()
        // console.log(`Calculated reference point in ${(end - start).toFixed(1)}ms`)
        // this.ctx.stats.timeSpendInHighPrecision += end - start
        // this.ctx.stats.numberOfHighPrecisionPoints++
        return ref
    }
}

const SPEC_SIZE = 14 * 4
class MandelbrotPipeline {
    constructor(ctx, devicePromise) {
        this.ctx = ctx
        this.devicePromise = devicePromise
        this.pipeline = null
        this.pipelineKey = null

        this.workgroupSize = 64  // recommended default
        this.testsem = 0
    }

    /**
     * Prepares a new rendering run. Creates a bindgroup and fill all the buffers that will not change during the different
     * passes.
     * @param data
     * @returns {Promise<void>}
     */
    async beforeRun(data) {
        const device = await this.devicePromise
        const pipeline = await this.getPipeline(device, this.workgroupSize, data.doSmooth, data.bailout)
        this.doSmooth = data.doSmooth

        this.specBuffer = device.createBuffer({
            size: SPEC_SIZE,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        this.indexBuffer = device.createBuffer({
            label: 'index buffer',
            size: data.indices.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        })
        this.valuesBuffer = device.createBuffer({
            label: 'values buffer',
            size: data.w * data.h * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        })

        this.zBuffer = device.createBuffer({
            label: 'zr buffer',
            size: 4 * (data.max_iter + 1) * 2,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        })
        this.zqErrorBoundBuffer = device.createBuffer({
            label: 'zq error bound buffer',
            size: 4 * (data.max_iter + 1),
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        })
        this.smoothBuffer = device.createBuffer({
            label: 'smooth buffer',
            size: data.w * data.h * 4, // u32, WebGPU does not support u8 or similar
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        })
        // this.debugBuffer = device.createBuffer({
        //     label: 'debug buffer',
        //     size: data.w * data.h * 4,
        //     usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
        // })

        // Pre-create the buffers that will be used later to copy the results into
        this.resultIndexBuffer = device.createBuffer({
            label: 'result index buffer',
            size: data.indices.byteLength,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
        })
        this.resultValuesBuffer = device.createBuffer({
            label: 'result buffer',
            size: data.w * data.h * 4,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
        })
        this.resultSmoothBuffer = device.createBuffer({
            label: 'smooth result buffer',
            size: data.w * data.h * 4,
            usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
        })
        // this.resultDebugBuffer = device.createBuffer({
        //     label: 'debug result buffer',
        //     size: data.w * data.h * 4,
        //     usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
        // })

        this.bindGroup = device.createBindGroup({
            label: 'bindGroup for work buffer',
            layout: pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.specBuffer } },
                { binding: 1, resource: { buffer: this.indexBuffer } },
                { binding: 2, resource: { buffer: this.valuesBuffer } },
                { binding: 3, resource: { buffer: this.zBuffer } },
                { binding: 4, resource: { buffer: this.zqErrorBoundBuffer } },
                { binding: 5, resource: { buffer: this.smoothBuffer } },
                // { binding: 7, resource: { buffer: this.debugBuffer } },
            ],
        })
    }

    /**
     * @param data
     * @returns {Promise<{indices: Uint32Array, values: Int32Array, smooth: Uint8ClampedArray}>}
     */
    async run(data) {
        const device = await this.devicePromise
        device.queue.writeBuffer(this.zBuffer, 0, data.zBuffer)
        device.queue.writeBuffer(this.zqErrorBoundBuffer, 0, data.zqErrorBoundBuffer)

        // split data.indices into chunks so that we are more responsive
        // TODO Base maxWorkersCount on the avarage time it takes to process a chunk
        const maxWorkersCount = 2 ** 18
        const indices = data.indices
        const remainingIndices = []
        for (let i = 0; i < indices.length; i += maxWorkersCount) {
            const chunk = indices.slice(i, i + maxWorkersCount)
            const start = performance.now()
            const remainingChunk = await this.doRun(data, chunk)
            // here we can already start calculating a new reference point in another thread if needed
            for (const element of remainingChunk.indices) {
                remainingIndices.push(element)
            }
            const end = performance.now()
            // console.log(`Chunk of size ${chunk.length} took ${(end - start).toFixed(1)}ms`)
            if (this.ctx.shouldStop()) {
                await this.finish()
                return {
                    indices: [],
                }
            }
        }
        return {
            indices: new Uint32Array(remainingIndices),
        }
    }

    async doRun(data, indices) {
        const device = await this.devicePromise

        const workgroupCount = Math.ceil(indices.length / this.workgroupSize)
        const specSize = SPEC_SIZE  // max_iter, size, refSize, w, h, refr, refi, dExp
        const specArray = new Int32Array(specSize / 4)
        const specFloatView = new Float32Array(specArray.buffer)
        specArray.set([
            data.max_iter,
            indices.length,
            data.refsize,
            data.w,
            data.h,
            0,
        ], 0)
        specFloatView.set([
            data.refr,
            data.refi,
            data.ddr0,
            data.ddi0,
            data.ddr,
            data.ddi,
            data.dExp,
            2 ** data.dExp, // Can be pre-calculated of course
        ], 6)
        device.queue.writeBuffer(this.specBuffer, 0, specArray)
        device.queue.writeBuffer(this.indexBuffer, 0, indices)
        // device.queue.writeBuffer(this.debugBuffer, 0, new Float32Array(data.w * data.h))

        const encoder = device.createCommandEncoder({
            label: 'mandelbrot encoder',
        })
        const pass = encoder.beginComputePass({
            label: 'mandelbrot compute pass',
        })
        pass.setPipeline(this.pipeline)
        pass.setBindGroup(0, this.bindGroup)
        pass.dispatchWorkgroups(workgroupCount, 1, 1)
        pass.end();

        encoder.copyBufferToBuffer(this.indexBuffer, 0, this.resultIndexBuffer, 0, indices.length * 4);
        const commandBuffer = encoder.finish();
        device.queue.submit([commandBuffer]);

        await this.resultIndexBuffer.mapAsync(GPUMapMode.READ);
        const remainingIndices = []
        const resultIndex = new Int32Array(this.resultIndexBuffer.getMappedRange())
        for (let i = 0; i < indices.length; i++) {
            if (resultIndex[i] !== -1) {
                remainingIndices.push(resultIndex[i])
            }
        }
        this.resultIndexBuffer.unmap();

        return {
            indices: remainingIndices,
        }
    }

    /**
     * Copies the values and smooth buffers back from the GPU
     * @returns {Promise<{values: Int32Array, smooth: Uint8ClampedArray}>}
     */
    async readValues() {
        const device = await this.devicePromise
        const encoder = device.createCommandEncoder()
        encoder.copyBufferToBuffer(this.valuesBuffer, 0, this.resultValuesBuffer, 0, this.resultValuesBuffer.size)
        if (this.doSmooth) {
            encoder.copyBufferToBuffer(this.smoothBuffer, 0, this.resultSmoothBuffer, 0, this.resultSmoothBuffer.size)
        }
        device.queue.submit([encoder.finish()])

        await this.resultValuesBuffer.mapAsync(GPUMapMode.READ)
        const values = new Int32Array(this.resultValuesBuffer.getMappedRange().slice(0))
        this.resultValuesBuffer.unmap()

        const smooth = new Uint8ClampedArray(this.resultSmoothBuffer.size / 4)
        if (this.doSmooth) {
            await this.resultSmoothBuffer.mapAsync(GPUMapMode.READ)
            smooth.set(new Int32Array(this.resultSmoothBuffer.getMappedRange()))
            this.resultSmoothBuffer.unmap()
        }
        return {values, smooth}
    }

    /**
     * Destroys all buffers
     */
    async finish() {
        this.specBuffer.destroy()
        this.indexBuffer.destroy()
        this.valuesBuffer.destroy()
        this.zBuffer.destroy()
        this.zqErrorBoundBuffer.destroy()
        this.smoothBuffer.destroy()
        this.resultIndexBuffer.destroy()
        this.resultValuesBuffer.destroy()
        this.resultSmoothBuffer.destroy()
        // this.debugBuffer.destroy()
    }

    async getPipeline(device, workgroupSize, smooth, bailout) {
        const key = `${workgroupSize}:${smooth}:${bailout}`
        if (this.pipelineKey === key) {
            return this.pipeline
        }

        const module = device.createShaderModule({code: this.getShadercode(workgroupSize, smooth, bailout)})
        // const module = device.createShaderModule({code: this.originalGetShadercode(workgroupSize, smooth, bailout)})
        const pipeline = device.createComputePipeline({
            label: 'mandelbrot',
            layout: 'auto',
            compute: {
                module,
            }
        })
        this.pipelineKey = key
        this.pipeline = pipeline
        return pipeline
    }

    getShadercode(workgroupSize, smooth, bailout) {
        let smoothCode = ''
        if (smooth) smoothCode = `
            var nu = log2(log2(zzq)) - 1;
            var modf = modf(nu);
            iter = iter - i32(modf.whole);
            smoothBuffer[i] = u32(255.0 * (1.0 - modf.fract));
        `
        //language=WGSL
        return `
            struct Spec {
                max_iter: i32,
                size: u32,
                refSize: i32,
                w: u32,
                h: u32,
                padd0: u32,
                reff: vec2f,
                dd0: vec2f,
                dd: vec2f,
                dExp: f32,
                dExpFactor: f32,
            };
            @group(0) @binding(0) var<uniform> spec: Spec;
            @group(0) @binding(1) var<storage, read_write> indexBuffer: array<i32>;
            @group(0) @binding(2) var<storage, read_write> values: array<i32>;
            @group(0) @binding(3) var<storage, read> zBuffer: array<vec2f>;
            @group(0) @binding(4) var<storage, read> zqErrorBoundBuffer: array<f32>;
            @group(0) @binding(5) var<storage, read_write> smoothBuffer: array<u32>;
//            @group(0) @binding(7) var<storage, read_write> debugBuffer: array<f32>;
            
            /**
             * This is the authors own code. In particular, the idea to use an implicit
             * extended exponent to overcome the limit of float32 is the authors own.             
             * Feel free to use or adapt this code in your own projects.
             * If you do, I would greatly appreciate it if you could reference the original source.
             * Thank you!
             */ 

            @compute @workgroup_size(${workgroupSize}) fn computeSomething(
              @builtin(global_invocation_id) id: vec3u
            ) {
                let iid = id.x;
                if (iid >= spec.size) {
                    return;
                }
                let i = u32(indexBuffer[iid]);  // input will always be >=0               
                let xy = vec2f(f32(i % spec.w), f32(i / spec.w));
                var dc = fma(xy, spec.dd, spec.dd0) - spec.reff;
                
                var eExp = spec.dExp;
                var eExpFactor = spec.dExpFactor;
              
                var ez = dc;
                
                // one check per iteration for both max_iter and the end of the reference orbit
                let limit = min(spec.max_iter, spec.refSize);
                var iter = -1;
                var zzq = 0.0;
                while (zzq <= ${bailout}) {
                    iter = iter + 1;
                    if (iter >= limit) {
                        if (iter == spec.max_iter) {
                            values[i] = 2;
                            smoothBuffer[i] = 0;
                            indexBuffer[iid] = -1;
                        }
                        return;
                    }
                    
                    while (max(abs(ez.x), abs(ez.y)) > 2) {
                        eExp = eExp + 1.0;
                        ez = ez * 0.5;
                        dc = dc * 0.5;
                        eExpFactor = eExpFactor * 2.0;
                        if (eExp == -126.0) {
                            eExpFactor = 0x1.0p-126;
                        }
                    }
                    
                    let z = zBuffer[iter];
                    let zqErrorBound = zqErrorBoundBuffer[iter];
                    
                    let zz = z + ez * eExpFactor;
                    zzq = dot(zz, zz);
                    if (zzq < zqErrorBound) {
                        return;
                    }

                    let ez_2z = z + zz;
                    ez = vec2f(dot(ez_2z, vec2f(ez.x, -ez.y)), dot(ez_2z, vec2f(ez.y, ez.x))) + dc;
                }
                
                ${smoothCode}
              
                values[i] = iter + 4;
                indexBuffer[iid] = -1;
            }
        `
    }
}

/**
 * Reference implementation in javascript
 */
class MandelbrotReference {
    constructor() {
    }

    async beforeRun(data) {
        this.values = new Int32Array(data.w * data.h)
    }

    /**
     * @param data
     * @returns {Promise<{indices: Uint32Array, values: Int32Array, smooth: Uint8ClampedArray}>}
     */
    async run(data) {
        const indices = data.indices
        const smooth = data.doSmooth ? new Uint8ClampedArray(data.w * data.h) : null
        const remainingIndices = []
        for (let offset of indices) {
            const x = offset % data.w
            const y = Math.floor(offset / data.w)
            const dcr = data.ddr0 + x * data.ddr - data.refr
            const dci = data.ddi0 + y * data.ddi - data.refi
            const [iter, zq] = this.mandlebrot_perturbation(offset, data.dExp, dcr, dci, data.max_iter, data.bailout, data.refsize, data.zrBuffer, data.ziBuffer, data.zqErrorBoundBuffer)
            if (iter >= 0) {
                this.values[offset] = smoothen(smooth, offset, iter, zq)
            } else {
                remainingIndices.push(offset)
            }
        }
        return {
            indices: new Uint32Array(remainingIndices),
            values: this.values,
            smooth,
        }
    }

    /**
     * @param {number} idx the pixel index
     * @param {number} dExp
     * @param {number} dcr
     * @param {number} dci
     * @param {number} max_iter
     * @param {number} bailout
     * @param {number} refsize
     * @param {Float32Array} zrBuffer
     * @param {Float32Array} ziBuffer
     * @param {Float32Array} zqErrorBoundBuffer
     * @param {Float32Array} eExpFactorBuffer
     * @param {Float32Array} eEzpDeltaFactorBuffer
     * @returns {[number, number]} [iter, zq]
     */
    mandlebrot_perturbation(idx, dExp, dcr, dci, max_iter, bailout, refsize, zrBuffer, ziBuffer, zqErrorBoundBuffer) {
        dcr = f32(dcr)
        dci = f32(dci)

        let eExp = dExp
        let eExpFactor = f32(2 ** eExp)

        // ε₀ = δ
        let ezr = dcr
        let ezi = dci

        let iter = -1
        let zzq = 0
        const debug = []
        while (zzq <= bailout) {
            if (iter++ === max_iter) {
                return [2, 0]
            }

            if (iter >= refsize) {
                return [-1, zzq]
            }

            while (Math.max(ezr, ezi) > 2) {
                eExp += 1
                if (eExp === -126) {
                    eExpFactor = 2 ** -126
                } else {
                    eExpFactor *= 2
                }
                ezr = f32(ezr * 0.5)
                ezi = f32(ezi * 0.5)
                dcr = f32(dcr * 0.5)
                dci = f32(dci * 0.5)
            }

            // Zₙ
            const zr = f32(zrBuffer[iter])
            const zi = f32(ziBuffer[iter])
            const zqErrorBound = f32(zqErrorBoundBuffer[iter])

            // Z'ₙ = Zₙ + εₙ
            const zzr = f32(zr + f32(ezr * eExpFactor))
            const zzi = f32(zi + f32(ezi * eExpFactor))
            zzq = f32(f32(zzr * zzr) + f32(zzi * zzi))
            if (zzq < zqErrorBound) {
                return [-1, 0]
            }

            // εₙ₊₁ = 2·zₙ·εₙ + εₙ² + δ = (2·zₙ + εₙ)·εₙ + δ
            const zr_ezr_2 = f32(zr + zzr)
            const zi_ezi_2 = f32(zi + zzi)
            const _ezr = f32(f32(zr_ezr_2 * ezr) - f32(zi_ezi_2 * ezi))
            const _ezi = f32(f32(zr_ezr_2 * ezi) + f32(zi_ezi_2 * ezr))
            ezr = f32(_ezr + dcr)
            ezi = f32(_ezi + dci)
            if (idx === 0) {
                debug.push(eExp)
            }
        }
        if (idx === 0) {
            console.log(`debug: ${debug}`)
        }
        return [iter + 4, zzq]
    }

    async finish() {
        // nothing to do
    }
}

const _f32buf = new Float32Array(1)
function f32(f) {
    _f32buf[0] = f
    const result = _f32buf[0]
    // validate if f is a valid float32 (not inf, -inf, nan)
    // if (!Number.isFinite(result)) {
    //     console.error(`Invalid float32: ${result}`)
    // }
    return result
}
