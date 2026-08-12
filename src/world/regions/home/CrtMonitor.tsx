import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { hideCursor, showCursor } from "../../../utils/cursor/cursor";
import { getWorldDioramaTexture } from "./worldDiorama";

/**
 * The 7 worlds on the selector. Only glitch-city is real today — the rest
 * render as locked "???" pages. To unlock one later, give it a label + href.
 */
const WORLDS: { label: string; href?: string }[] = [
  { label: "/glitch-city", href: "/glitch-city" },
  { label: "???" },
  { label: "???" },
  { label: "???" },
  { label: "???" },
  { label: "???" },
  { label: "???" },
];
const PAGE_COUNT = WORLDS.length;

/** Screen is a classic 4:3 CRT. HUGE — the shell stands ~4.8u tall. */
const SCREEN_W = 4.8;
const SCREEN_H = 3.6;

/** Interact reach — larger than doors (7): the screen is huge, you click it
 *  from conversation distance, not nose-to-glass. */
const INTERACT_DISTANCE = 14;
const HOVER_GATE = 50;
const SCROLL_COOLDOWN_MS = 250;

const _raycaster = new THREE.Raycaster();
const _center = new THREE.Vector2(0, 0);
const _worldPos = new THREE.Vector3();

// ── Text atlas: one 4:3 row per page, drawn once with canvas 2D ────────────
const ATLAS_W = 512;
const ATLAS_ROW_H = 384; // 4:3, matches the screen so text isn't stretched

const font = (px: number) => `${px}px 'Kode Mono', 'Courier New', Courier, monospace`;

const drawAtlas = (ctx: CanvasRenderingContext2D) => {
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_ROW_H * PAGE_COUNT);
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  // Thin dark outline keeps text readable over the bright thumbnail
  const text = (str: string, x: number, y: number) => {
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.strokeText(str, x, y);
    ctx.fillText(str, x, y);
  };
  WORLDS.forEach((world, i) => {
    const top = i * ATLAS_ROW_H;
    ctx.fillStyle = "#00ff00";
    if (world.href) {
      // Unlocked: title up top, overlaid on the full-page thumbnail
      ctx.font = font(44);
      text(world.label, ATLAS_W / 2, top + 62);
      ctx.font = font(20);
      ctx.fillStyle = "#00dd44";
      text("click to enter", ATLAS_W / 2, top + 356);
    } else {
      // Locked: big ??? and nothing else to see
      ctx.fillStyle = "#1d6b2f";
      ctx.font = font(84);
      text(world.label, ATLAS_W / 2, top + 186);
      ctx.font = font(20);
      text("locked", ATLAS_W / 2, top + 246);
    }
    ctx.fillStyle = "#0a9a34";
    ctx.font = font(18);
    ctx.textAlign = "right";
    text(`${i + 1} / ${PAGE_COUNT}`, ATLAS_W - 18, top + ATLAS_ROW_H - 16);
    ctx.textAlign = "center";
  });
};

// ── Screen shader: scrollable pages + thumbnail + CRT dressing ─────────────
const screenVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const screenFragmentShader = `
  uniform sampler2D uAtlas;
  uniform sampler2D uWorld;
  uniform float uScroll; // page units, 0..PAGE_COUNT-1
  uniform float uPower;
  uniform float uTime;
  uniform float uHover;
  varying vec2 vUv;

  const float PAGES = ${PAGE_COUNT}.0;

  void main() {
    // Barrel curvature
    vec2 c = vUv * 2.0 - 1.0;
    c *= 1.0 + 0.06 * dot(c, c);
    vec2 uv = c * 0.5 + 0.5;

    vec3 col = vec3(0.0);
    float dy = abs(uv.y - 0.5);

    // CRT power-on: the picture opens from a horizontal line
    float open = smoothstep(0.0, 0.6, uPower);
    float halfH = 0.5 * open;

    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0 && uPower > 0.001 && dy < halfH) {
      // Content squeezed into the open band while it expands
      float cy = 0.5 + (uv.y - 0.5) / max(open, 0.001);

      // Vertical page scroll: content coordinate grows downward
      float cv = (1.0 - cy) + uScroll;
      float page = floor(cv);
      float ly = fract(cv);

      // Raster glow — the tube is visibly "on" even where nothing is drawn
      col = vec3(0.010, 0.028, 0.014);

      if (page >= -0.5 && page < PAGES - 0.5) {
        // Page 0: the baked mini-world thumbnail fills the whole page
        if (page < 0.5) {
          vec3 world = texture2D(uWorld, vec2(uv.x, 1.0 - ly)).rgb;
          col = pow(world, vec3(0.4545)) * 0.9; // linear bake -> display, dimmed a touch for text contrast
        }

        // Text overlaid in front (the atlas rows have transparent backgrounds)
        vec2 auv = vec2(uv.x, 1.0 - (page + ly) / PAGES);
        vec4 text = texture2D(uAtlas, auv);
        col = mix(col, text.rgb, text.a);
      }

      // Scanlines, rolling band, flicker, vignette
      col *= 0.85 + 0.15 * sin(uv.y * 3.14159 * 220.0);
      float band = fract(uv.y + uTime * 0.06);
      col += vec3(0.010, 0.030, 0.016) * smoothstep(0.18, 0.0, abs(band - 0.5));
      col *= 0.96 + 0.04 * sin(uTime * 97.0);
      col *= 1.0 - 0.35 * pow(dot(c, c), 1.5);

      col *= 1.0 + 0.15 * uHover;
    }

    // Bright line at the opening edge while powering on
    col += vec3(0.7, 1.0, 0.8) * (1.0 - open) * step(0.001, uPower) * smoothstep(halfH + 0.04, halfH, dy);

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ── Shell dimensions (local; group origin = screen center) ────────────────
const BEZEL = 0.6;
const FRAME_DEPTH = 0.95;
const FRAME_Z = -0.225; // screen (z=0) recessed 0.25 behind the bezel front

/**
 * A HUGE retro CRT monitor: the home page's world selector. It powers on
 * (classic line-expand + fade) a moment after the player clicks into the
 * canvas, washing the wireframe grid in green screen-glow. The screen lists
 * the worlds one page at a time — scroll (mouse wheel) to flip pages, walk
 * up and click an unlocked page to load that world (a FULL page load —
 * workers and the world registry init once per page load). Page 1 is
 * /glitch-city with the baked mini-world thumbnail (worldDiorama.ts); the
 * other six are locked.
 *
 * The glow point light is PARKED at intensity 0 from mount — a first light
 * appearing mid-play changes NUM_POINT_LIGHTS and recompiles every lit
 * shader at the exact frame of entry (the DayNightCycle nightfall hitch).
 */
export const CrtMonitor = ({
  position = [0, 2.2, -36] as [number, number, number],
  glowIntensity = 26,
  glowDistance = 24,
  delayMs = 1000,
  fadeMs = 2000,
}) => {
  const { camera, gl } = useThree();
  const screenRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const ledMatRef = useRef<THREE.MeshStandardMaterial>(null);

  const triggeredRef = useRef(false);
  const progressRef = useRef(0);
  const scrollRef = useRef(0);
  const targetPageRef = useRef(0);
  const lastScrollAtRef = useRef(0);
  const hoverRef = useRef(false);
  const frameRef = useRef(0);

  const { atlasTexture, screenMaterial, shellMaterial } = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = ATLAS_W;
    canvas.height = ATLAS_ROW_H * PAGE_COUNT;
    const ctx = canvas.getContext("2d")!;
    drawAtlas(ctx);
    const atlasTexture = new THREE.CanvasTexture(canvas);
    // Kode Mono loads async — redraw once webfonts are in
    document.fonts?.ready.then(() => {
      drawAtlas(ctx);
      atlasTexture.needsUpdate = true;
    });
    return {
      atlasTexture,
      screenMaterial: new THREE.ShaderMaterial({
        uniforms: {
          uAtlas: { value: atlasTexture },
          uWorld: { value: null as THREE.Texture | null },
          uScroll: { value: 0 },
          uPower: { value: 0 },
          uTime: { value: 0 },
          uHover: { value: 0 },
        },
        vertexShader: screenVertexShader,
        fragmentShader: screenFragmentShader,
      }),
      shellMaterial: new THREE.MeshStandardMaterial({ color: "#262626", roughness: 0.85 }),
    };
  }, []);

  // Bake (or reuse) the mini-world thumbnail — outside the render phase,
  // since baking issues a gl.render
  useEffect(() => {
    screenMaterial.uniforms.uWorld.value = getWorldDioramaTexture(gl);
  }, [gl, screenMaterial]);

  useEffect(() => {
    return () => {
      atlasTexture.dispose();
      screenMaterial.dispose();
      shellMaterial.dispose();
      if (hoverRef.current) hideCursor();
    };
  }, [atlasTexture, screenMaterial, shellMaterial]);

  // Power on delayMs after the player first clicks in (pointer lock)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onLockChange = () => {
      if (!document.pointerLockElement || timer !== null) return;
      timer = setTimeout(() => {
        triggeredRef.current = true;
      }, delayMs);
      document.removeEventListener("pointerlockchange", onLockChange);
    };
    document.addEventListener("pointerlockchange", onLockChange);
    return () => {
      document.removeEventListener("pointerlockchange", onLockChange);
      if (timer !== null) clearTimeout(timer);
    };
  }, [delayMs]);

  // Wheel flips pages (one per cooldown tick, so a fast flick isn't 6 pages)
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!document.pointerLockElement || !triggeredRef.current) return;
      const dir = Math.sign(e.deltaY);
      if (dir === 0) return;
      const now = performance.now();
      if (now - lastScrollAtRef.current < SCROLL_COOLDOWN_MS) return;
      const next = Math.min(PAGE_COUNT - 1, Math.max(0, targetPageRef.current + dir));
      if (next === targetPageRef.current) return;
      targetPageRef.current = next;
      lastScrollAtRef.current = now;
    };
    window.addEventListener("wheel", onWheel);
    return () => window.removeEventListener("wheel", onWheel);
  }, []);

  // Click an unlocked, settled page to load its world
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (e.button !== 0 || !hoverRef.current) return;
      const href = WORLDS[targetPageRef.current].href;
      if (href) window.location.assign(`${process.env.PUBLIC_URL ?? ""}${href}`);
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  useFrame(({ clock }, dt) => {
    const u = screenMaterial.uniforms;
    u.uTime.value = clock.elapsedTime;

    // Power fade (ease-in-out) — drives the screen, glow light, and LED
    if (triggeredRef.current && progressRef.current < 1) {
      const progress = Math.min(1, progressRef.current + (dt * 1000) / fadeMs);
      progressRef.current = progress;
      const power = progress * progress * (3 - 2 * progress);
      u.uPower.value = power;
      if (lightRef.current) lightRef.current.intensity = glowIntensity * power;
      if (ledMatRef.current) ledMatRef.current.emissiveIntensity = 2 * power;
    }

    // Smooth scroll toward the target page
    const target = targetPageRef.current;
    const scroll = scrollRef.current;
    if (scroll !== target) {
      const next = Math.abs(target - scroll) < 0.001 ? target : scroll + (target - scroll) * Math.min(1, dt * 6);
      scrollRef.current = next;
      u.uScroll.value = next;
    }

    // Hover: screen-center raycast every 3rd frame, only nearby, and only
    // meaningful when the settled page is unlocked
    if (++frameRef.current % 3 !== 0) return;
    const screen = screenRef.current;
    if (!screen) return;
    let hover = false;
    const unlocked = !!WORLDS[target].href && Math.abs(scroll - target) < 0.1;
    if (unlocked && triggeredRef.current && camera.position.distanceTo(screen.getWorldPosition(_worldPos)) < HOVER_GATE) {
      _raycaster.setFromCamera(_center, camera);
      _raycaster.far = INTERACT_DISTANCE;
      hover = _raycaster.intersectObject(screen, false).length > 0;
      _raycaster.far = Infinity;
    }
    if (hover !== hoverRef.current) {
      hoverRef.current = hover;
      if (hover) showCursor();
      else hideCursor();
      u.uHover.value = hover ? 1 : 0;
    }
  });

  return (
    <group position={position}>
      {/* The tube */}
      <mesh ref={screenRef}>
        <planeGeometry args={[SCREEN_W, SCREEN_H]} />
        <primitive object={screenMaterial} attach="material" />
      </mesh>
      {/* Bezel frame around the screen */}
      <mesh position={[0, SCREEN_H / 2 + BEZEL / 2, FRAME_Z]} material={shellMaterial}>
        <boxGeometry args={[SCREEN_W + BEZEL * 2, BEZEL, FRAME_DEPTH]} />
      </mesh>
      <mesh position={[0, -(SCREEN_H / 2 + BEZEL / 2), FRAME_Z]} material={shellMaterial}>
        <boxGeometry args={[SCREEN_W + BEZEL * 2, BEZEL, FRAME_DEPTH]} />
      </mesh>
      <mesh position={[-(SCREEN_W / 2 + BEZEL / 2), 0, FRAME_Z]} material={shellMaterial}>
        <boxGeometry args={[BEZEL, SCREEN_H, FRAME_DEPTH]} />
      </mesh>
      <mesh position={[SCREEN_W / 2 + BEZEL / 2, 0, FRAME_Z]} material={shellMaterial}>
        <boxGeometry args={[BEZEL, SCREEN_H, FRAME_DEPTH]} />
      </mesh>
      {/* Deep tube body behind the frame */}
      <mesh position={[0, 0, -2.2]} material={shellMaterial}>
        <boxGeometry args={[SCREEN_W + 0.4, SCREEN_H + 0.6, 3.2]} />
      </mesh>
      {/* Power LED on the bottom bezel */}
      <mesh position={[SCREEN_W / 2 - 0.15, -(SCREEN_H / 2 + BEZEL / 2), FRAME_Z + FRAME_DEPTH / 2 + 0.02]}>
        <boxGeometry args={[0.12, 0.12, 0.04]} />
        <meshStandardMaterial ref={ledMatRef} color="#0a1a0a" emissive="#00ff44" emissiveIntensity={0} />
      </mesh>
      {/* Screen glow washing the grid in front of the monitor */}
      <pointLight ref={lightRef} position={[0, 0.3, 5]} color="#8fffc8" intensity={0} distance={glowDistance} decay={2} />
    </group>
  );
};
