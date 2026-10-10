// Adaptive frame pacing for WebGL views.
//
// With a GPU a frame of these scenes costs a millisecond or two and the pacer
// never intervenes. Without one (virtual machines, remote desktops, blocklisted
// drivers: the browser falls back to software WebGL) a single render can take
// tens of milliseconds, and rendering every frame would leave the page sluggish
// for typing and scrolling. The pacer measures the frame gap that follows each
// render and, when it exceeds `slowMs`, spaces renders so that at least half of
// the time remains for the rest of the page.

export function createFramePacer({ slowMs = 40 } = {}) {
  let cost = 0; // smoothed duration of a rendered frame [ms]
  let lastFrameAt = 0;
  let lastRenderAt = -Infinity;
  let renderedLastFrame = false;
  return {
    /** Call once per animation frame with its timestamp; returns whether to render in this frame. */
    shouldRender(now) {
      const gap = now - lastFrameAt;
      // only consecutive frames measure the cost (ignore pauses between on-demand renders)
      if (renderedLastFrame && lastFrameAt && gap < 500) cost = cost ? 0.8 * cost + 0.2 * gap : gap;
      lastFrameAt = now;
      const minInterval = cost > slowMs ? 2 * cost : 0;
      renderedLastFrame = now - lastRenderAt >= minInterval;
      if (renderedLastFrame) lastRenderAt = now;
      return renderedLastFrame;
    },
    /** True while renders are being spaced out. */
    get throttled() {
      return cost > slowMs;
    },
  };
}
