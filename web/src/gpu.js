// Whether this computer draws with a graphics card. Without one, browsers draw
// WebGL on the processor (slower than the plain canvas), and the canvas too.

let gpu = null;

/** True if WebGL runs on a graphics card (worked out once). */
export function hasGPU() {
  gpu ??= probe();
  return gpu;
}

function probe() {
  try {
    const c = document.createElement('canvas');
    const opts = { failIfMajorPerformanceCaveat: true };
    const gl = c.getContext('webgl2', opts) || c.getContext('webgl', opts);
    if (!gl) return false;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return !/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}
