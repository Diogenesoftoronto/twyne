import { component$, useSignal, useVisibleTask$ } from "@qwik.dev/core";

/** A brief GPU-rendered solar corona; the ink impression remains after it fades. */
export const StampShader = component$<{ strength: number }>((props) => {
  const canvas = useSignal<HTMLCanvasElement>();
  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(({ track, cleanup }) => {
    const strength = track(() => props.strength);
    const el = canvas.value;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!el || motion.matches) return;
    const gl = el.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
    });
    if (!gl) return; // The CSS impact ring also works without WebGL.
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };
    const vertex = compile(
      gl.VERTEX_SHADER,
      "attribute vec2 p; varying vec2 uv; void main(){uv=p;gl_Position=vec4(p,0.,1.);}",
    );
    const fragment = compile(
      gl.FRAGMENT_SHADER,
      `
      precision mediump float;
      varying vec2 uv;
      uniform float t;
      uniform float power;
      void main(){
        float r=length(uv), a=atan(uv.y,uv.x);
        float fade=smoothstep(0.,.12,t)*(1.-smoothstep(.65,1.,t));
        float wave=.24+t*.55;
        float ring=exp(-abs(r-wave)*60.);
        float rays=pow(max(0.,sin(a*(18.+power*8.)+t*2.)),12.);
        float corona=exp(-abs(r-.36)*14.)*(.18+rays*.8);
        float flecks=pow(max(0.,sin(a*47.-t*3.)),32.)*exp(-abs(r-wave-.12)*45.);
        float filament=pow(max(0.,sin(a*13.+r*24.-t*9.)),8.);
        float silk=filament*exp(-abs(r-.46-.06*sin(a*5.+t*7.))*18.);
        float echo=exp(-abs(r-wave*.7)*75.)*step(2.5,power);
        float core=(1.-smoothstep(.12,.42,r))*.22;
        float alpha=(ring*.5+corona+flecks*power*.25+core+silk*power*.13+echo*.35)*fade;
        alpha*=1.-smoothstep(.8,.98,r);
        vec3 teal=vec3(.12,.75,.68), gold=vec3(1.,.64,.16);
        vec3 color=mix(teal,gold,step(1.5,power));
        vec3 prism=.55+.45*cos(vec3(0.,2.1,4.2)+a*2.+r*12.-t*5.);
        color=mix(color,prism,step(2.5,power)*silk*.6);
        color=mix(color,vec3(1.,.94,.72),ring*.65);
        gl_FragColor=vec4(color,min(.8,alpha));
      }`,
    );
    const program = gl.createProgram();
    if (!program || !vertex || !fragment) {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      if (program) gl.deleteProgram(program);
      return;
    }
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    const buffer = gl.createBuffer();
    const dispose = () => {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) || !buffer) {
      dispose();
      return;
    }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const time = gl.getUniformLocation(program, "t");
    gl.uniform1f(gl.getUniformLocation(program, "power"), strength);
    const size = Math.min(
      640,
      Math.round(320 * Math.min(window.devicePixelRatio || 1, 2)),
    );
    el.width = size;
    el.height = size;
    gl.viewport(0, 0, size, size);
    const duration = strength >= 3 ? 2200 : strength >= 2 ? 1700 : 1250;
    const start = performance.now();
    let frame = 0,
      disposed = false;
    const stop = () => {
      cancelAnimationFrame(frame);
      if (!disposed) {
        gl.clear(gl.COLOR_BUFFER_BIT);
        dispose();
        disposed = true;
      }
    };
    const render = (now: number) => {
      const progress = (now - start) / duration;
      if (progress >= 1 || motion.matches || gl.isContextLost()) {
        stop();
        return;
      }
      gl.uniform1f(time, progress);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    motion.addEventListener("change", stop);
    cleanup(() => {
      motion.removeEventListener("change", stop);
      stop();
    });
  });
  return <canvas ref={canvas} class="stamp-solar-shader" aria-hidden="true" />;
});
