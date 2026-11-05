import { component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";
import { allowsMotion, onMotionLevelChange } from "../../utils/motion";

/** A single, bounded impression; the context is surrendered when ink dries. */
export const StampShader = component$(() => {
  const canvas = useSignal<HTMLCanvasElement>();
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const el = canvas.value;
    if (!el || !allowsMotion("ceremony")) return;
    const gl = el.getContext("webgl", { alpha: true, antialias: false });
    if (!gl) return;
    let frame = 0;
    let stopped = false;
    let timeout: ReturnType<typeof setTimeout> | undefined = undefined;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frame);
      if (timeout !== undefined) clearTimeout(timeout);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
    cleanup(stop);
    const unsubscribe = onMotionLevelChange(() => {
      if (!allowsMotion("ceremony")) stop();
    });
    cleanup(unsubscribe);
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return null;
      return shader;
    };
    const vertex = compile(gl.VERTEX_SHADER, "attribute vec2 p; varying vec2 uv; void main(){uv=p;gl_Position=vec4(p,0.,1.);}");
    const fragment = compile(gl.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec2 uv;
      uniform float t;
      uniform vec3 redInk, blueInk;
      void main() {
        float radius = length(uv);
        float spread = smoothstep(.1,.8,t);
        float edge = (1. - smoothstep(.22 + spread*.38, .32 + spread*.38, radius));
        float hole = smoothstep(.25,.45,radius);
        vec2 grid = fract((uv + 1.) * 33.) - .5;
        float dots = 1. - smoothstep(.18,.32,length(grid));
        float red = edge * hole * dots;
        vec2 shifted = uv + vec2(.025,-.015);
        vec2 blueGrid = fract((shifted + 1.) * 33.) - .5;
        float blue = (1. - smoothstep(.22 + spread*.38,.32 + spread*.38,length(shifted))) * hole * (1. - smoothstep(.18,.32,length(blueGrid)));
        float fade = (1. - smoothstep(.45,1.,t)) * smoothstep(0.,.08,t);
        float alpha = max(red,blue) * fade * .5;
        gl_FragColor = vec4(mix(redInk, blueInk, blue/(red+blue+.001)), alpha);
      }`);
    const program = gl.createProgram();
    if (!vertex || !fragment || !program) { stop(); return; }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    const buffer = gl.createBuffer();
    if (!buffer || !gl.getProgramParameter(program, gl.LINK_STATUS)) { stop(); return; }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    // Resolve theme variables through CSS, including non-hex colour formats.
    const probe = document.createElement("span");
    el.parentElement?.appendChild(probe);
    const ink = (name: string): [number, number, number] => {
      probe.style.color = `var(${name})`;
      const channels = getComputedStyle(probe).color.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];
      return [channels[0] / 255, channels[1] / 255, channels[2] / 255];
    };
    gl.uniform3fv(gl.getUniformLocation(program, "redInk"), ink("--color-vermilion"));
    gl.uniform3fv(gl.getUniformLocation(program, "blueInk"), ink("--color-cobalt"));
    probe.remove();
    const size = Math.max(1, Math.round(256 * (window.devicePixelRatio || 1) / 2));
    el.width = size; el.height = size;
    gl.viewport(0, 0, size, size);
    const rawDuration = getComputedStyle(document.documentElement).getPropertyValue("--dur-ceremony").trim();
    const duration = Math.min(900, Math.max(1, parseFloat(rawDuration) * (rawDuration.endsWith("ms") ? 1 : 1000)) || 900);
    timeout = setTimeout(stop, duration);
    const start = performance.now();
    const render = (now: number) => {
      if (stopped || gl.isContextLost() || now - start >= duration) { stop(); return; }
      gl.uniform1f(gl.getUniformLocation(program, "t"), (now - start) / duration);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
  });
  return <canvas ref={canvas} class="room-stamp-shader" aria-hidden="true" />;
});
