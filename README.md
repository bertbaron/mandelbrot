# mandelbrot
Online Mandelbrot Explorer

Requires a modern browser with support for BigInt and Web Workers.

## Implementation

This is currently a pure javascript implementation of the Mandelbrot set. I actually started this to play with Web Assembly but soon figured out that javascript on modern browsers is quite fast and hard to outperform with Web Assembly. Since the algorithm matters more than the language, I decided to start with a javascript implementation. I might move parts to Web Assembly later once I have a nice reference implementation in javascript.

The implementation uses the relative new BigInt javascript class for fixed point calculations at higher soom levels (above aprox. 1E13). The [Perturbation](https://en.wikipedia.org/wiki/Plotting_algorithms_for_the_Mandelbrot_set#Perturbation_theory_and_series_approximation) algorithm is used to increase rendering performance at those zoom levels.  