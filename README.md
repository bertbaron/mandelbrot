# mandelbrot

Online Mandelbrot Explorer

Requires a modern browser with support for BigInt and Web Workers.

A live version can be found here: https://bertbaron.github.io/mandelbrot/

## Table of Contents

- [Background](#background)
- [Javascript implementation](#javascript-implementation)
- [WebGPU implementation](#webgpu-implementation)

## Background

I actually started this to play with Web Assembly but soon figured out that javascript on modern browsers is quite fast and hard to outperform with Web Assembly. Since the algorithm matters more than the language, I decided to start with a javascript implementation. I might move parts to Web Assembly later once I have a nice reference implementation in javascript.

There is currently a pure javascript implementation and an experimental WebGPU implementation.

## Javascript implementation

The javascript implementation uses different algorithms depending on the zoom level¹

* Up to ≈1E13: Plain Mandelbrot algorithm using javascript numbers (float64)
* Then up to ≈1E300: Perturbation algorithm using BigInt for fixed point calculations and float64 for perturbation
* Above ≈1E300: Perturbation algorithm using BigInt for fixed point calculations and float64 with an additional implicit exponent for perturbation

> ¹ It actually depends also on the resolution because at a higher resolution artifacts might be visible that are not visible at a lower resolution for the same zoom level. Toggling to full-screen can for example result in a switch of algorithm.

The Perturbation algorithm is implemented based on the Wikipedia page [Plotting algorithms for the Mandelbrot set](https://en.wikipedia.org/wiki/Plotting_algorithms_for_the_Mandelbrot_set#Perturbation_theory_and_series_approximation).

**Multiple passes**

The image is rendered in multiple passes to provide quick feedback on the screen.  

**Web Workers**

For each rendering pass, the image is broken into small parts which are then caclulated in parallel using Web Workers. The number of workers is determined by the number of CPU cores. This keeps the main thread responsive while using all available CPU power.

**Fixed Point reference points**

The reference points are calculated using fixed-point arithmetic, which is implemented using BigInt. The size of BigInt numbers is determined by the zoom level, so it increases while zooming in.

**Extended Float**
The use of extended float was an idea of myself, though I'm likely not the first with the idea. In short and simplified, the Perturbation is based on adding a very small number δ to a much bigger number ε. At deep zoomlevels, δ becomes so small that it can not be represented anymore with a float64 (the exponent will become smaller than -1023). The precision is still more than enough though. By using an additional exponent, calculations can be done much further. The exponent doesn't need to be stored with each number. All the 'small' numbers in the loop implicitly share the same extra exponent, which is adjusted along the way. 

## WebGPU implementation

Using the GPU might result in much faster rendering. Note that the calculations on the GPU might contend with the pan and zoom animations resulting in a less smooth experience on smaller devices such as mobile phones. 

**Algorithm**
The WebGPU implementation only uses the 'perturbation with extended float' algorithm. For smaller zoom levels this might not be as fast as one might expect because it is not optimized for those, but at deeper zoomlevels the performance difference can become significant. 

The implementation uses float32 numbers, but with the extended exponent it is possible to zoom as deep as 1E1500 (still within seconds!), before artifacts become visible. Unfortunately WebGPU does not support float64 yet. To take it even further [Double-Double arithmetic](https://en.wikipedia.org/wiki/Quadruple-precision_floating-point_format) might be an option, but this is not implemented yet.

The reference points are still calculated using BigInt in javascript. These will be moved to webworkers to run as much as possible in parallel with the WebGPU calculations and without blocking the main thread, but this is not implemented yet.