// GLSL for the world (owner: world agent): gradient sky dome, animated void / liquid surfaces, weather points.
// All ShaderMaterials include tone mapping + colour space chunks so they match the lit materials, and the
// surfaces use the scene fog.

import * as THREE from 'three';

const NOISE = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = r * p * 2.03 + 11.7;
    a *= 0.5;
  }
  return v;
}
`;

// ---------------------------------------------------------------------------------------------------------
// Sky dome
// ---------------------------------------------------------------------------------------------------------
export function createSkyMaterial(opts) {
  return new THREE.ShaderMaterial({
    name: 'SSK.Sky',
    uniforms: {
      uTop: { value: new THREE.Color(opts.top) },
      uBottom: { value: new THREE.Color(opts.bottom) },
      uHorizon: { value: new THREE.Color(opts.horizon) },
      uFog: { value: new THREE.Color(opts.fog) },
      uSunDir: { value: opts.sunDir.clone().normalize() },
      uSunColor: { value: new THREE.Color(opts.sunColor) },
      uSunDisc: { value: opts.sunDisc ? 1 : 0 },
      uMoon: { value: opts.moon ? 1 : 0 },
      uStars: { value: opts.stars ? 1 : 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop, uBottom, uHorizon, uFog, uSunDir, uSunColor;
      uniform float uSunDisc, uMoon, uStars, uTime;
      varying vec3 vDir;
      float hash13(vec3 p3) {
        p3 = fract(p3 * 0.1031);
        p3 += dot(p3, p3.zyx + 31.32);
        return fract((p3.x + p3.y) * p3.z);
      }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col;
        if (h >= 0.0) {
          float t = pow(clamp(h, 0.0, 1.0), 0.5);
          col = mix(uHorizon, uTop, smoothstep(0.0, 1.0, t));
        } else {
          float t = pow(clamp(-h, 0.0, 1.0), 0.6);
          col = mix(uHorizon, uBottom, smoothstep(0.0, 1.0, t * 2.2));
        }
        // blend into the fog colour right at the horizon so distant geometry melts into the sky
        col = mix(col, uFog, (1.0 - smoothstep(0.0, 0.16, abs(h))) * 0.8);
        float sd = max(dot(d, normalize(uSunDir)), 0.0);
        float glowAmt = uMoon > 0.5 ? 0.35 : 1.0;
        col += uSunColor * (pow(sd, 6.0) * 0.16 + pow(sd, 48.0) * 0.3) * glowAmt;
        if (uSunDisc > 0.5) {
          float disc = smoothstep(0.99935, 0.9997, sd);
          col = mix(col, uSunColor * 1.35 + 0.15, disc);
        }
        if (uMoon > 0.5) {
          vec3 md = normalize(uSunDir);
          float mdisc = smoothstep(0.9990, 0.9993, sd);
          // crescent: subtract a shifted disc
          vec3 off = normalize(md + vec3(0.02, 0.012, 0.0));
          float cut = smoothstep(0.9990, 0.9993, max(dot(d, off), 0.0));
          col = mix(col, vec3(1.0, 0.97, 0.88), clamp(mdisc - cut * 0.85, 0.0, 1.0));
        }
        if (uStars > 0.5 && h > 0.0) {
          for (int k = 0; k < 2; k++) {
            float sc = k == 0 ? 90.0 : 170.0;
            vec3 p = d * sc;
            vec3 cell = floor(p);
            float r = hash13(cell + float(k) * 17.0);
            if (r > (k == 0 ? 0.965 : 0.94)) {
              vec3 jitter = vec3(hash13(cell + 1.3), hash13(cell + 2.9), hash13(cell + 5.1)) - 0.5;
              vec3 f = fract(p) - 0.5 - jitter * 0.5;
              float s = smoothstep(k == 0 ? 0.2 : 0.14, 0.0, length(f));
              float tw = 0.55 + 0.45 * sin(uTime * (1.5 + r * 3.0) + r * 91.0);
              col += vec3(0.9, 0.95, 1.0) * s * tw * smoothstep(0.0, 0.3, h) * (k == 0 ? 1.2 : 0.7);
            }
          }
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
}

// ---------------------------------------------------------------------------------------------------------
// Void / liquid surfaces: lava, water, sky (cloud sea), abyss (starry)
// ---------------------------------------------------------------------------------------------------------
export function createVoidMaterial(type, opts) {
  const defines = {};
  defines[`VOID_${type.toUpperCase()}`] = 1;
  return new THREE.ShaderMaterial({
    name: `SSK.Void.${type}`,
    defines,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uColA: { value: new THREE.Color(opts.colA) },
        uColB: { value: new THREE.Color(opts.colB) },
        uColC: { value: new THREE.Color(opts.colC) },
        uSky: { value: new THREE.Color(opts.sky || '#9fd0ff') },
        uSunDir: { value: (opts.sunDir || new THREE.Vector3(0.4, 1, 0.3)).clone().normalize() },
        uSunColor: { value: new THREE.Color(opts.sunColor || '#ffffff') },
      },
    ]),
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColA, uColB, uColC, uSky, uSunDir, uSunColor;
      varying vec3 vWorld;
      #include <common>
      #include <fog_pars_fragment>
      ${NOISE}
      void main() {
        vec2 p = vWorld.xz;
        vec3 col = uColA;
      #ifdef VOID_LAVA
        vec2 q = p * 0.03;
        float n = fbm(q + vec2(uTime * 0.025, uTime * 0.018));
        float n2 = fbm(q * 2.1 - vec2(uTime * 0.04, -uTime * 0.03) + n * 1.5);
        float crust = smoothstep(0.5, 0.6, n2);
        float vein = 1.0 - smoothstep(0.0, 0.06, abs(n2 - 0.5));
        vec3 hot = mix(uColA, uColB, smoothstep(0.35, 0.75, n));
        col = mix(hot * 1.35, uColC, crust * 0.85);
        col += uColB * vein * 0.9;
        col *= 0.92 + 0.08 * sin(uTime * 1.7 + n * 9.0);
      #endif
      #ifdef VOID_WATER
        vec2 g = vec2(0.0);
        float t = uTime;
        vec2 d1 = normalize(vec2(1.0, 0.3)); vec2 d2 = normalize(vec2(-0.4, 1.0)); vec2 d3 = normalize(vec2(0.7, -0.8)); vec2 d4 = normalize(vec2(-1.0, -0.2));
        float f1 = 0.08, f2 = 0.13, f3 = 0.21, f4 = 0.34;
        g += d1 * f1 * 0.9 * cos(dot(d1, p) * f1 + t * 0.9);
        g += d2 * f2 * 0.55 * cos(dot(d2, p) * f2 + t * 1.2);
        g += d3 * f3 * 0.35 * cos(dot(d3, p) * f3 + t * 1.6);
        g += d4 * f4 * 0.2 * cos(dot(d4, p) * f4 + t * 2.1);
        vec3 nrm = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 v = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(nrm, v), 0.0), 3.0);
        float var = fbm(p * 0.02 + t * 0.01);
        vec3 deep = mix(uColA, uColB, var * 0.6);
        col = mix(deep, uSky, clamp(fres * 0.75 + 0.08, 0.0, 1.0));
        vec3 rd = reflect(-v, nrm);
        float spec = pow(max(dot(rd, normalize(uSunDir)), 0.0), 80.0);
        col += uSunColor * spec * 1.2;
        float foam = smoothstep(0.62, 0.75, fbm(p * 0.09 + vec2(t * 0.05, -t * 0.03)));
        col = mix(col, uColC, foam * 0.35);
      #endif
      #ifdef VOID_SKY
        vec2 q = p * 0.0045;
        float n = fbm(q + vec2(uTime * 0.004, uTime * 0.002));
        float n2 = fbm(q * 3.0 - vec2(uTime * 0.006, 0.0) + n);
        float c = smoothstep(0.3, 0.72, n * 0.65 + n2 * 0.5);
        vec3 lit = mix(uColC, uColA, smoothstep(0.35, 0.8, n2));
        col = mix(uColB, lit, c);
      #endif
      #ifdef VOID_ABYSS
        vec2 q = p * 0.004;
        float n = fbm(q + uTime * 0.003);
        col = mix(uColC, uColA * 0.55, smoothstep(0.35, 0.85, n));
        col = mix(col, uColB * 0.5, smoothstep(0.55, 0.9, fbm(q * 2.7 - uTime * 0.004)));
        vec2 sp = p * 0.12;
        vec2 cell = floor(sp);
        float r = hash12(cell);
        if (r > 0.93) {
          vec2 f = fract(sp) - 0.5 - (vec2(hash12(cell + 3.1), hash12(cell + 7.7)) - 0.5) * 0.6;
          float s = smoothstep(0.14, 0.0, length(f));
          col += vec3(0.85, 0.9, 1.0) * s * (0.5 + 0.5 * sin(uTime * 2.0 + r * 60.0));
        }
      #endif
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
    fog: true,
  });
}

// ---------------------------------------------------------------------------------------------------------
// Weather particles (infinite field wrapped around the camera, all motion in the vertex shader)
// ---------------------------------------------------------------------------------------------------------
export function createWeatherMaterial(opts) {
  return new THREE.ShaderMaterial({
    name: 'SSK.Weather',
    uniforms: {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uBox: { value: opts.box.clone() },
      uVel: { value: opts.vel.clone() },
      uSway: { value: opts.sway },
      uSize: { value: opts.size },
      uScale: { value: 400 },
      uMap: { value: opts.map },
      uColA: { value: new THREE.Color(opts.colA) },
      uColB: { value: new THREE.Color(opts.colB) },
      uOpacity: { value: opts.opacity },
      uTwinkle: { value: opts.twinkle ? 1 : 0 },
      uSpin: { value: opts.spin ?? 1 },
    },
    vertexShader: /* glsl */ `
      attribute float aRnd;
      uniform float uTime, uSway, uSize, uScale, uSpin, uTwinkle;
      uniform vec3 uCam, uBox, uVel;
      varying float vAlpha;
      varying float vRot;
      varying float vRnd;
      void main() {
        vec3 base = position * uBox;
        float sp = 0.6 + 0.8 * aRnd;
        vec3 p = base + uVel * uTime * sp;
        p.x += sin(uTime * (0.7 + aRnd) + aRnd * 40.0) * uSway;
        p.z += cos(uTime * (0.6 + aRnd * 0.7) + aRnd * 30.0) * uSway;
        vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
        vec3 world = uCam + rel;
        vec4 mv = viewMatrix * vec4(world, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = -mv.z;
        gl_PointSize = clamp(uSize * (0.6 + 0.8 * aRnd) * uScale / max(dist, 0.5), 0.0, 64.0);
        vec3 e = abs(rel) / (uBox * 0.5);
        float edge = 1.0 - smoothstep(0.65, 1.0, max(max(e.x, e.y), e.z));
        vAlpha = edge * smoothstep(0.6, 3.0, dist);
        if (uTwinkle > 0.5) vAlpha *= 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * (2.0 + aRnd * 4.0) + aRnd * 50.0));
        vRot = uTime * (aRnd - 0.5) * 3.0 * uSpin + aRnd * 6.28;
        vRnd = aRnd;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uColA, uColB;
      uniform float uOpacity;
      varying float vAlpha;
      varying float vRot;
      varying float vRnd;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float s = sin(vRot);
        float co = cos(vRot);
        vec2 r = vec2(co * c.x - s * c.y, s * c.x + co * c.y) + 0.5;
        vec4 t = texture2D(uMap, r);
        vec3 col = mix(uColA, uColB, fract(vRnd * 7.31));
        gl_FragColor = vec4(col * t.rgb, t.a * vAlpha * uOpacity);
        if (gl_FragColor.a < 0.01) discard;
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: false,
  });
}
