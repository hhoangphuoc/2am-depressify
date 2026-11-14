import { useEffect, useRef, useState, type CSSProperties } from 'react';

// Simulated Gemini Live session. Each state maps to a Live API event (docs/research/gemini-api.md):
// connecting = token + setupComplete, speaking = model audio + outputTranscription,
// listening = mic stream + inputTranscription, thinking = toolCall, paused = audioStreamEnd (mic off).
export type LiveState = 'connecting' | 'speaking' | 'listening' | 'thinking' | 'paused';
export type LiveEvent = { state: LiveState; step: number; who?: 'Companion' | 'You'; text?: string; tool?: string; ms?: number; effect?: 'tried' | 'feeling' | 'offer' | 'wrap'; wait?: boolean };

export const LIVE_STEPS = ['Last time', 'Your day', 'One idea', 'Wrap up'];

export const LIVE_OPENING: LiveEvent[] = [
  { state: 'connecting', step: 0, ms: 1200 },
  { state: 'speaking', step: 0, who: 'Companion', text: 'Hi Alex, good to hear from you. Did you get to try the walk?' },
  { state: 'listening', step: 0, who: 'You', text: 'I did. About ten minutes. It felt a bit lighter.', effect: 'tried' },
  { state: 'speaking', step: 0, who: 'Companion', text: 'That’s good to hear. From 1 to 5, how did it feel?' },
  { state: 'listening', step: 0, who: 'You', text: 'Maybe a four.', effect: 'feeling' },
  { state: 'speaking', step: 1, who: 'Companion', text: 'Thank you. How has today been so far?' },
  { state: 'listening', step: 1, who: 'You', text: 'Tired. I slept badly and stayed in most of the morning.' },
  { state: 'thinking', step: 2, tool: 'Checking tomorrow’s weather and places nearby', ms: 1900 },
  { state: 'speaking', step: 2, who: 'Companion', text: 'Tomorrow looks dry around eleven, and Töölönlahti is about nine minutes away. Would a short walk there feel right?', effect: 'offer' },
  { state: 'listening', step: 2, wait: true },
];

export const LIVE_FIRST: LiveEvent[] = [
  { state: 'connecting', step: 0, ms: 1200 },
  { state: 'speaking', step: 1, who: 'Companion', text: 'Hi, I’m your AI Companion. I’m not a clinician. How are you feeling today?' },
  { state: 'listening', step: 1, who: 'You', text: 'Okay, I guess. A bit flat.' },
  { state: 'thinking', step: 2, tool: 'Checking tomorrow’s weather and places nearby', ms: 1900 },
  { state: 'speaking', step: 2, who: 'Companion', text: 'Thanks for telling me. Tomorrow looks dry around eleven. Would a short walk feel right?', effect: 'offer' },
  { state: 'listening', step: 2, wait: true },
];

export const LIVE_REPLIES: Record<'accept' | 'smaller' | 'decline', LiveEvent[]> = {
  accept: [
    { state: 'speaking', step: 2, who: 'Companion', text: 'Good. I can add it to your calendar for eleven, if you like.' },
    { state: 'speaking', step: 3, who: 'Companion', text: 'Before we finish, three quick ratings. You can skip any of them.', effect: 'wrap' },
  ],
  smaller: [
    { state: 'speaking', step: 2, who: 'Companion', text: 'Of course. How about one minute by a window, whenever it suits you?', effect: 'offer' },
    { state: 'listening', step: 2, wait: true },
  ],
  decline: [{ state: 'speaking', step: 3, who: 'Companion', text: 'That’s okay. Rest counts too. Shall we wrap up?', effect: 'wrap' }],
};

export function eventDuration(e: LiveEvent) {
  return e.ms ?? (e.text ? e.text.split(' ').length * (e.who === 'You' ? 300 : 250) + 900 : 1200);
}

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function Icon({ name, label }: { name: string; label?: string }) {
  return <span className="icon-mask" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} style={{ '--icon': 'url(/assets/' + name + '.svg)' } as CSSProperties} />;
}

// Gradient per state from the Depressify palette: deep, upper, lower, light band.
const PALETTES: Record<LiveState, string[]> = {
  speaking: ['#b47a55', '#d6a680', '#efd8c2', '#fcf4ec'],
  listening: ['#326b73', '#5d9893', '#bcdad6', '#eef6f4'],
  thinking: ['#4d6c8b', '#7f9cb6', '#d2deea', '#f2f6fa'],
  paused: ['#7f8e93', '#a6b3b6', '#dfe4e4', '#f5f7f6'],
  connecting: ['#8d9ba0', '#b2bdc0', '#e4e8e8', '#f6f8f7'],
};
const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

// Cloud field adapted from the orb-ui "cloud" theme (MIT License, Copyright (c) orb-ui contributors,
// github.com/exprmntl/orb-ui): domain-warped fbm, a two-tone sky and a soft light band on a moving horizon.
const VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
const FRAG = [
  'precision mediump float;',
  'uniform vec2 u_res;uniform float u_time,u_act,u_dim;uniform vec3 u_deep,u_upper,u_lower,u_light;',
  'float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}',
  'float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);}',
  'float fbm(vec2 p){float v=0.,a=.52;mat2 r=mat2(.8,.6,-.6,.8);for(int o=0;o<5;o++){v+=a*noise(p);p=r*p*1.92+vec2(9.7,4.3);a*=.5;}return v;}',
  'void main(){',
  '  vec2 uv=gl_FragCoord.xy/u_res;vec2 c=uv-.5;float r=length(c);',
  '  float edge=1.-smoothstep(.488,.5,r);if(edge<=0.)discard;',
  '  vec2 p=c*2.;float t=u_time;',
  '  vec2 w=vec2(fbm(p*1.02+vec2(t*.34,-t*.24)),fbm(p*1.08+vec2(-t*.27,t*.32)+vec2(6.7,2.9)));',
  '  vec2 q=p+(w-.5)*(1.15+u_act*.4)+vec2(sin(p.y*2.4+t*.68+w.y*3.2),cos(p.x*2.1-t*.61+w.x*3.))*(.035+u_act*.07);',
  '  float broad=fbm(q*.92+vec2(t*.14,-t*.18)),fold=fbm(q*1.66+vec2(-t*.23,t*.19)+5.2);',
  '  float field=mix(broad,fold,.3+u_act*.14);',
  '  float horizon=.46+.08*sin((uv.x+w.x*.2)*5.4+t*.42)+.16*(broad-.5);',
  '  float upper=smoothstep(horizon-.12,horizon+.08,uv.y);',
  '  float band=exp(-pow((uv.y-horizon)*(5.2+u_act*.8),2.));',
  '  vec3 col=mix(u_lower,u_upper,upper);',
  '  col=mix(col,u_deep,upper*(.14+smoothstep(.42,.78,fold)*.5));',
  '  col=mix(col,u_light,clamp(band*(.42+smoothstep(.24,.79,field)*.62),0.,.88));',
  '  col=mix(col,u_light,(1.-upper)*smoothstep(.58,.9,broad)*.18);',
  '  col=mix(col,u_light,smoothstep(.38,.5,r)*.14);',
  '  col=col*u_dim+(noise(gl_FragCoord.xy*.64)-.5)/255.;',
  '  gl_FragColor=vec4(col*edge,edge);',
  '}',
].join('\n');

// Audio level eases up fast and down slower; drift speed and size follow the level and the state.
export function Orb({ state, onInterrupt, frozen = false, decorative = false }: { state: LiveState; onInterrupt?: () => void; frozen?: boolean; decorative?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null), halo = useRef<HTMLSpanElement>(null), stateRef = useRef(state), drawRef = useRef<(now: number) => void>(() => {});
  const [webgl, setWebgl] = useState(true);
  stateRef.current = state;
  useEffect(() => {
    const cv = canvas.current, g = cv?.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!cv || !g) { setWebgl(false); return; }
    const shader = (type: number, src: string) => { const sh = g.createShader(type)!; g.shaderSource(sh, src); g.compileShader(sh); return sh; };
    const prog = g.createProgram()!; g.attachShader(prog, shader(g.VERTEX_SHADER, VERT)); g.attachShader(prog, shader(g.FRAGMENT_SHADER, FRAG)); g.linkProgram(prog);
    if (!g.getProgramParameter(prog, g.LINK_STATUS)) { setWebgl(false); return; }
    g.useProgram(prog); g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer()); g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
    const aLoc = g.getAttribLocation(prog, 'a'); g.enableVertexAttribArray(aLoc); g.vertexAttribPointer(aLoc, 2, g.FLOAT, false, 0, 0);
    const u = (n: string) => g.getUniformLocation(prog, n), uRes = u('u_res'), uTime = u('u_time'), uAct = u('u_act'), uDim = u('u_dim'), uCols = ['u_deep', 'u_upper', 'u_lower', 'u_light'].map(u);
    const still = reducedMotion() || frozen, ease = (dt: number, ms: number) => 1 - Math.pow(0.1, dt * 1000 / ms);
    let pal = PALETTES[stateRef.current].map(rgb), act = 0, target = 0, next = 0, scale = 0.94, t = frozen ? 7.3 : Math.random() * 40, last = performance.now(), raf = 0;
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000), s = stateRef.current, live = s === 'speaking' || s === 'listening'; last = now;
      if (now > next) { target = live ? 0.25 + Math.random() * 0.75 : s === 'thinking' ? 0.2 : 0; next = now + (s === 'speaking' ? 130 : 190); }
      act = still ? (live ? 0.45 : 0) : act + (target - act) * ease(dt, target > act ? 210 : 380);
      if (!still) t += dt * 0.75 * (s === 'speaking' ? 1.65 + 1.55 * act : s === 'listening' ? 0.72 + 0.78 * act : s === 'thinking' ? 1 : 0.24);
      const goal = PALETTES[s].map(rgb), k = still ? 1 : ease(dt, 500);
      pal = pal.map((col, i) => col.map((v, j) => v + (goal[i][j] - v) * k));
      const size = s === 'speaking' ? 1 + 0.1 * act : s === 'listening' ? 0.95 + 0.07 * act : 0.94;
      scale = still ? size : scale + (size - scale) * ease(dt, 250);
      cv.style.transform = 'scale(' + scale.toFixed(4) + ')';
      if (halo.current) { halo.current.style.transform = 'scale(' + (scale * (1.06 + act * 0.22)).toFixed(4) + ')'; halo.current.style.opacity = live ? (0.16 + act * 0.34).toFixed(3) : '0'; }
      const px = Math.round(cv.clientWidth * Math.min(window.devicePixelRatio || 1, 2));
      if (cv.width !== px) { cv.width = cv.height = px; }
      g.viewport(0, 0, px, px); g.uniform2f(uRes, px, px); g.uniform1f(uTime, t); g.uniform1f(uAct, act);
      g.uniform1f(uDim, cv.closest('[data-time=night]') ? 0.84 : 1); uCols.forEach((loc, i) => g.uniform3fv(loc, pal[i]));
      g.drawArrays(g.TRIANGLES, 0, 3);
      if (!still) raf = requestAnimationFrame(draw);
    };
    drawRef.current = draw; draw(performance.now());
    // A still orb paints once, so repaint when layout gives the canvas its real size.
    const ro = new ResizeObserver(() => { if (still) draw(performance.now()); }); ro.observe(cv);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); drawRef.current = () => {}; };
  }, [frozen]);
  // Still mode (Reduce Motion or a frozen deck frame) repaints once per state; colour still changes.
  useEffect(() => { if (reducedMotion() || frozen) drawRef.current(performance.now()); }, [state, frozen]);
  const canInterrupt = state === 'speaking' && !!onInterrupt;
  if (decorative) return <span className="orb" data-state={state} aria-hidden="true">{webgl ? <canvas className="orb-canvas" ref={canvas} /> : <span className="orb-core" />}</span>;
  return <button type="button" className="orb" data-state={state} aria-disabled={!canInterrupt} aria-label={canInterrupt ? 'Interrupt the Companion' : 'Voice session'} onClick={() => canInterrupt && onInterrupt?.()}>
    <span className="orb-halo" ref={halo} aria-hidden="true" />
    {webgl ? <canvas className="orb-canvas" ref={canvas} aria-hidden="true" /> : <span className="orb-core" aria-hidden="true" />}
    {state === 'thinking' && <span className="orb-arc" aria-hidden="true" />}
  </button>;
}

export const STATE_LABEL: Record<LiveState, string> = { connecting: 'Connecting', speaking: 'Speaking', listening: 'Listening', thinking: 'One moment', paused: 'Microphone off' };

// Words reveal like streamed transcription; hidden words keep their space so nothing jumps.
export function LiveCaption({ who, text, placeholder, instant = false }: { who?: string; text?: string; placeholder: string; instant?: boolean }) {
  const words = text ? text.split(' ') : [];
  const [shown, setShown] = useState(instant ? words.length : 0);
  useEffect(() => {
    if (instant || !text) { setShown(words.length); return; }
    setShown(0);
    const id = window.setInterval(() => setShown(n => { if (n >= words.length) { window.clearInterval(id); return n; } return n + 1; }), who === 'You' ? 220 : 170);
    return () => window.clearInterval(id);
  }, [text, instant]);
  return <div className="live-caption">
    <p className="sr-only" aria-live="polite">{text ? who + ': ' + text : placeholder}</p>
    {text ? <><small aria-hidden="true">{who}</small><p aria-hidden="true">{words.map((w, i) => <span key={i} className={i < shown ? 'word on' : 'word'}>{w} </span>)}</p></> : <p className="caption-placeholder" aria-hidden="true">{placeholder}</p>}
  </div>;
}

export function CheckSteps({ current }: { current: number }) {
  return <div className="check-steps" role="img" aria-label={'Step ' + (current + 1) + ' of 4, ' + LIVE_STEPS[current]}>
    <span className="step-bars" aria-hidden="true">{LIVE_STEPS.map((s, i) => <span key={s} className={i < current ? 'done' : i === current ? 'current' : ''} />)}</span>
    <span className="step-name" aria-hidden="true">{LIVE_STEPS[current]}</span>
  </div>;
}
