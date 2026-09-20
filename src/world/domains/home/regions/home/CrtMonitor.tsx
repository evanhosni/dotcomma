import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { hideCursor, showCursor } from "../../../../../utils/cursor/cursor";
import { switchDomain, domainIdFromPath } from "../../../navigation";
import { getDomainDioramaTexture } from "./domainDiorama";

/** Entries without an href render as locked "???" pages. */
const DOMAINS: { label: string; href?: string }[] = [
  { label: "/glitch-city", href: "/glitch-city" },
  { label: "???" },
  { label: "???" },
  { label: "???" },
  { label: "???" },
  { label: "???" },
  { label: "???" },
];
const PAGE_COUNT = DOMAINS.length;

const SCREEN_W = 4.8; // 4:3
const SCREEN_H = 3.6;

// Larger than doors (7): the screen is huge, you click it from conversation distance.
const INTERACT_DISTANCE = 14;
const HOVER_CHECK_DISTANCE = 50;
const SCROLL_COOLDOWN_MS = 250;

const _raycaster = new THREE.Raycaster();
const _center = new THREE.Vector2(0, 0);
const _worldPos = new THREE.Vector3();

// Text atlas: one row per page.
const ATLAS_W = 512;
const ATLAS_ROW_H = 384; // 4:3, matches the screen so text isn't stretched

const font = (px: number) => `${px}px 'Kode Mono', 'Courier New', Courier, monospace`;

const drawAtlas = (ctx: CanvasRenderingContext2D) => {
  ctx.clearRect(0, 0, ATLAS_W, ATLAS_ROW_H * PAGE_COUNT);
  ctx.textAlign = "center";
  ctx.lineJoin = "round";
  const text = (str: string, x: number, y: number) => {
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    ctx.strokeText(str, x, y);
    ctx.fillText(str, x, y);
  };
  DOMAINS.forEach((domain, i) => {
    const top = i * ATLAS_ROW_H;
    ctx.fillStyle = "#00ff00";
    if (domain.href) {
      ctx.font = font(44);
      text(domain.label, ATLAS_W / 2, top + 62);
      ctx.font = font(20);
      ctx.fillStyle = "#00dd44";
      text("click to enter", ATLAS_W / 2, top + 356);
    } else {
      ctx.fillStyle = "#1d6b2f";
      ctx.font = font(84);
      text(domain.label, ATLAS_W / 2, top + 186);
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
      float cy = 0.5 + (uv.y - 0.5) / max(open, 0.001);

      float cv = (1.0 - cy) + uScroll;
      float page = floor(cv);
      float ly = fract(cv);

      // Raster glow: the tube reads as "on" where nothing is drawn
      col = vec3(0.010, 0.028, 0.014);

      if (page >= -0.5 && page < PAGES - 0.5) {
        if (page < 0.5) {
          vec3 world = texture2D(uWorld, vec2(uv.x, 1.0 - ly)).rgb;
          col = pow(world, vec3(0.4545)) * 0.9; // linear bake -> display, dimmed a touch for text contrast
        }

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

// Shell dimensions (local; group origin = screen center)
const BEZEL = 0.6;
const FRAME_DEPTH = 0.95;
const FRAME_Z = -0.225; // screen (z=0) recessed 0.25 behind the bezel front

/** The home page's domain selector (see CLAUDE.md). The glow light is PARKED
 *  at intensity 0 from mount: a light appearing mid-play changes
 *  NUM_POINT_LIGHTS and recompiles every lit shader at that frame. */
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

  const powerOnTriggeredRef = useRef(false);
  const powerProgressRef = useRef(0);
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

  // In an effect: baking issues a gl.render.
  useEffect(() => {
    screenMaterial.uniforms.uWorld.value = getDomainDioramaTexture(gl);
  }, [gl, screenMaterial]);

  useEffect(() => {
    return () => {
      atlasTexture.dispose();
      screenMaterial.dispose();
      shellMaterial.dispose();
      if (hoverRef.current) hideCursor();
    };
  }, [atlasTexture, screenMaterial, shellMaterial]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onLockChange = () => {
      if (!document.pointerLockElement || timer !== null) return;
      timer = setTimeout(() => {
        powerOnTriggeredRef.current = true;
      }, delayMs);
      document.removeEventListener("pointerlockchange", onLockChange);
    };
    document.addEventListener("pointerlockchange", onLockChange);
    return () => {
      document.removeEventListener("pointerlockchange", onLockChange);
      if (timer !== null) clearTimeout(timer);
    };
  }, [delayMs]);

  // One page per cooldown tick, so a fast flick isn't 6 pages.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (!document.pointerLockElement || !powerOnTriggeredRef.current) return;
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

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (e.button !== 0 || !hoverRef.current) return;
      const href = DOMAINS[targetPageRef.current].href;
      // Never a real navigation: that would reopen the back button as an exit (navigation.ts).
      if (href) switchDomain(domainIdFromPath(href));
    };
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  useFrame(({ clock }, dt) => {
    const u = screenMaterial.uniforms;
    u.uTime.value = clock.elapsedTime;

    if (powerOnTriggeredRef.current && powerProgressRef.current < 1) {
      const progress = Math.min(1, powerProgressRef.current + (dt * 1000) / fadeMs);
      powerProgressRef.current = progress;
      const power = progress * progress * (3 - 2 * progress);
      u.uPower.value = power;
      if (lightRef.current) lightRef.current.intensity = glowIntensity * power;
      if (ledMatRef.current) ledMatRef.current.emissiveIntensity = 2 * power;
    }

    const target = targetPageRef.current;
    const scroll = scrollRef.current;
    if (scroll !== target) {
      const next = Math.abs(target - scroll) < 0.001 ? target : scroll + (target - scroll) * Math.min(1, dt * 6);
      scrollRef.current = next;
      u.uScroll.value = next;
    }

    if (++frameRef.current % 3 !== 0) return;
    const screen = screenRef.current;
    if (!screen) return;
    let hover = false;
    const unlocked = !!DOMAINS[target].href && Math.abs(scroll - target) < 0.1;
    if (unlocked && powerOnTriggeredRef.current && camera.position.distanceTo(screen.getWorldPosition(_worldPos)) < HOVER_CHECK_DISTANCE) {
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
      <mesh ref={screenRef}>
        <planeGeometry args={[SCREEN_W, SCREEN_H]} />
        <primitive object={screenMaterial} attach="material" />
      </mesh>
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
      <mesh position={[0, 0, -2.2]} material={shellMaterial}>
        <boxGeometry args={[SCREEN_W + 0.4, SCREEN_H + 0.6, 3.2]} />
      </mesh>
      <mesh position={[SCREEN_W / 2 - 0.15, -(SCREEN_H / 2 + BEZEL / 2), FRAME_Z + FRAME_DEPTH / 2 + 0.02]}>
        <boxGeometry args={[0.12, 0.12, 0.04]} />
        <meshStandardMaterial ref={ledMatRef} color="#0a1a0a" emissive="#00ff44" emissiveIntensity={0} />
      </mesh>
      <pointLight ref={lightRef} position={[0, 0.3, 5]} color="#8fffc8" intensity={0} distance={glowDistance} decay={2} />
    </group>
  );
};
