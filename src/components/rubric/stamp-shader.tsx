import { component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";
import { allowsMotion, onMotionLevelChange } from "../../utils/motion";

/**
 * The ink a new verdict squeezes out of the paper.
 *
 * The walnut die lands 160ms into its press (`stamp-die-press`). At that
 * moment a little ink is pushed out past the tips of the sunburst's rays, in
 * spokes, as a halftone in the stamp's own ink, with a vermilion second plate
 * printed a hair out of register (cobalt beside a red grade). It spreads a
 * few millimetres, holds a beat, and dries away, leaving only the stamp.
 *
 * The clock is the press's own animation, so the ink meets the die even when
 * the die's image was slow to load. If the press never starts, neither does
 * the ink: the stamp itself never depends on any of this.
 *
 * Budget: one canvas 1.6 times the stamp (never over 256 CSS px), one quad,
 * for `--dur-ceremony` from the press (900ms; 360ms at calm), and then the
 * context is surrendered. Nothing at the still level or on a restored verdict
 * (this component is only mounted for a fresh one), or without WebGL.
 */

const VERTEX =
  "attribute vec2 p; varying vec2 uv; void main(){uv=p;gl_Position=vec4(p,0.,1.);}";

const FRAGMENT = `
precision mediump float;
varying vec2 uv;
uniform float t;          // 0..1 through the ceremony, from the press start
uniform float contact;    // when the die meets the paper, on the same scale
uniform vec3 stampInk;    // the grade's own ink
uniform vec3 registerInk; // the second plate
uniform float radius;     // the stamp's radius, in uv units
uniform float cells;      // halftone cells across the canvas
uniform float aa;         // one device pixel, in cell units

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Smooth value noise, so neighbouring dots never disagree at a cell edge.
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

// How much ink the squeeze has put at p, 0..1.
float squeeze(vec2 p, float spread, float dry) {
  float r = length(p);
  vec2 dir = p / max(r, 0.0001);
  float tip = radius * 0.79;                       // the rays end here
  // A ragged front: the ink gets further in some directions than others.
  float front = max(spread * radius * 0.32, 0.0001)
    * (0.55 + 0.9 * noise(dir * 2.6 + 11.0));
  float along = (r - tip) / front;                 // 0 at the tips, 1 at the front
  float body = (1.0 - smoothstep(0.1, 1.0, along)) * smoothstep(-0.35, 0.05, along);
  // Pushed out in spokes, so it reads as squeezed rather than sprayed.
  float spokes = smoothstep(0.3, 0.75, noise(dir * 3.2 + r * 0.8));
  return body * (0.25 + 0.75 * spokes) * (1.0 - 0.6 * dry);
}

// One plate of halftone at a screen angle: each dot is sized by the ink at
// its own centre, so dots stay round and grow or shrink whole.
float plate(vec2 p, float angle, float spread, float dry, float gain) {
  float c = cos(angle);
  float s = sin(angle);
  vec2 g = mat2(c, -s, s, c) * p * cells * 0.5;
  vec2 centre = floor(g) + 0.5;
  vec2 back = mat2(c, s, -s, c) * centre / (cells * 0.5);
  float density = squeeze(back, spread, dry) * gain;
  float size = sqrt(clamp(density, 0.0, 1.0)) * 0.58;
  float dotCover = 1.0 - smoothstep(size - aa, size + aa, length(g - centre));
  return dotCover * step(0.02, density);
}

void main() {
  float span = 1.0 - contact;
  float spread = smoothstep(contact, contact + span * 0.35, t);
  float appear = smoothstep(contact - 0.01, contact + span * 0.06, t);
  float dry = smoothstep(contact + span * 0.45, 1.0, t);
  float strength = appear * (1.0 - dry);

  float a1 = plate(uv, 0.26, spread, dry, 1.0) * strength * 0.62;
  // The second plate, printed a hair out of register at its own angle.
  vec2 off = uv + vec2(0.022, -0.015);
  float a2 = plate(off, 1.31, spread, dry, 0.5) * strength * 0.38;

  // Inks overprint like inks: where both fall, they multiply.
  float alpha = 1.0 - (1.0 - a1) * (1.0 - a2);
  vec3 colour = (stampInk * a1 * (1.0 - a2) + registerInk * a2 * (1.0 - a1)
    + stampInk * registerInk * a1 * a2) / max(alpha, 0.0001);
  // The canvas is premultiplied: colour carries its own alpha.
  gl_FragColor = vec4(colour * alpha, alpha);
}`;

/** When the die meets the paper in `stamp-die-press` (32% of 500ms). */
const CONTACT_MS = 160;
/** How long to wait for the press to begin before giving the ink up. */
const PRESS_WAIT_MS = 2000;

function rgb(colour: string): [number, number, number] {
  const channels = colour.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
  return channels.length === 3
    ? [channels[0] / 255, channels[1] / 255, channels[2] / 255]
    : [0.12, 0.11, 0.09];
}

export const StampShader = component$(() => {
  const canvas = useSignal<HTMLCanvasElement>();
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ cleanup }) => {
    const el = canvas.value;
    const stamp = el?.parentElement;
    if (!el || !stamp || !allowsMotion("ceremony")) return;

    let gl: WebGLRenderingContext | null = null;
    let frame = 0;
    let stopped = false;
    // One timer at a time: first the wait for the press, then the ceremony's end.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onPress = (event: AnimationEvent) => {
      if (event.animationName === "stamp-die-press") begin(performance.now());
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
      stamp.removeEventListener("animationstart", onPress);
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    };
    cleanup(stop);
    cleanup(
      onMotionLevelChange(() => {
        if (!allowsMotion("ceremony")) stop();
      }),
    );

    function begin(origin: number) {
      if (stopped || gl) return;
      if (timer !== undefined) clearTimeout(timer);
      stamp!.removeEventListener("animationstart", onPress);
      const context = el!.getContext("webgl", {
        alpha: true,
        antialias: false,
      });
      if (!context) {
        stop();
        return;
      }
      gl = context;
      const compile = (type: number, source: string) => {
        const shader = context.createShader(type);
        if (!shader) return null;
        context.shaderSource(shader, source);
        context.compileShader(shader);
        return context.getShaderParameter(shader, context.COMPILE_STATUS)
          ? shader
          : null;
      };
      const vertex = compile(context.VERTEX_SHADER, VERTEX);
      const fragment = compile(context.FRAGMENT_SHADER, FRAGMENT);
      const program = context.createProgram();
      const buffer = context.createBuffer();
      if (!vertex || !fragment || !program || !buffer) {
        stop();
        return;
      }
      context.attachShader(program, vertex);
      context.attachShader(program, fragment);
      context.linkProgram(program);
      if (!context.getProgramParameter(program, context.LINK_STATUS)) {
        stop();
        return;
      }
      context.useProgram(program);
      context.bindBuffer(context.ARRAY_BUFFER, buffer);
      context.bufferData(
        context.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        context.STATIC_DRAW,
      );
      const position = context.getAttribLocation(program, "p");
      context.enableVertexAttribArray(position);
      context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0);

      // Sized from the layout (press-room.css sets the canvas around the
      // stamp). Layout widths, not bounding boxes: the stamp is rotated.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const canvasCss = el!.offsetWidth || 140;
      const stampCss = stamp!.offsetWidth || canvasCss / 1.6;
      const size = Math.max(1, Math.round(canvasCss * dpr));
      el!.width = size;
      el!.height = size;
      context.viewport(0, 0, size, size);
      // A newsprint screen: about 4.5 CSS px per halftone cell.
      const cells = canvasCss / 4.5;
      const uniform = (name: string) => context.getUniformLocation(program, name);
      context.uniform1f(uniform("radius"), Math.min(1, stampCss / canvasCss));
      context.uniform1f(uniform("cells"), cells);
      context.uniform1f(uniform("aa"), cells / size);

      // The stamp's ink is its current colour (the grade's tier). The second
      // plate is the house vermilion, or cobalt beside a red grade.
      const stampInk = rgb(getComputedStyle(stamp!).color);
      const probe = document.createElement("span");
      probe.style.color = "var(--color-vermilion)";
      stamp!.appendChild(probe);
      const vermilion = getComputedStyle(probe).color;
      probe.style.color = "var(--color-cobalt)";
      const cobalt = getComputedStyle(probe).color;
      probe.remove();
      const [red, green, blue] = stampInk;
      const nearRed = red > 0.5 && red > green * 1.8 && red > blue * 1.8;
      context.uniform3fv(uniform("stampInk"), stampInk);
      context.uniform3fv(uniform("registerInk"), rgb(nearRed ? cobalt : vermilion));

      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue("--dur-ceremony")
        .trim();
      const parsed = parseFloat(raw) * (raw.endsWith("ms") ? 1 : 1000);
      const duration =
        Number.isFinite(parsed) && parsed > CONTACT_MS
          ? Math.min(parsed, 900)
          : 900;
      context.uniform1f(uniform("contact"), CONTACT_MS / duration);
      const time = uniform("t");
      timer = setTimeout(
        stop,
        Math.max(0, origin + duration - performance.now()) + 50,
      );
      const render = (now: number) => {
        if (stopped || context.isContextLost()) return;
        const progress = (now - origin) / duration;
        if (progress >= 1) {
          stop();
          return;
        }
        context.uniform1f(time, Math.max(0, progress));
        context.drawArrays(context.TRIANGLES, 0, 6);
        frame = requestAnimationFrame(render);
      };
      frame = requestAnimationFrame(render);
    }

    // Clock the ink from the press. It may already be under way (a cached
    // die image), it may start shortly, or it may never start.
    const tool = stamp.querySelector<HTMLElement>(".ink-stamp__tool");
    const running = tool
      ?.getAnimations()
      .find(
        (animation) =>
          (animation as CSSAnimation).animationName === "stamp-die-press",
      );
    if (running && typeof running.currentTime === "number") {
      begin(performance.now() - running.currentTime);
      return;
    }
    stamp.addEventListener("animationstart", onPress);
    timer = setTimeout(stop, PRESS_WAIT_MS);
  });
  return <canvas ref={canvas} class="room-stamp-shader" aria-hidden="true" />;
});
