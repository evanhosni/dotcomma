import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { hideCursor, showCursor } from "../../../utils/cursor/cursor";
import { navigateToAddress } from "../navigation";
import { OVERWORLD_REGIONS } from "../overworld/regions";
import { createCrtScreen, type CrtPage } from "./crtScreen";
import { getDomainDioramaTexture } from "./domainDiorama";

/** The screen always shows at least this many pages; the rest are locked "???". */
const MIN_PAGE_COUNT = 7;

/** Pages after the region pages, e.g. `{ label: "/snow/mountain", href: "/snow/mountain" }`: any
 *  overworld address (world/domains/overworld/README.md). A page without `href` is locked. */
const EXTRA_PAGES: CrtPage[] = [];

/** Pages are ADDRESSES into the overworld: one per region type ("/<region>" = that type's instance
 *  nearest the origin — the same place for everyone), then EXTRA_PAGES, then locked "???" pages. */
const ADDRESS_PAGES: CrtPage[] = [
  ...OVERWORLD_REGIONS.map(({ name }) => ({ label: `/${name}`, href: `/${name}` })),
  ...EXTRA_PAGES,
];
while (ADDRESS_PAGES.length < MIN_PAGE_COUNT) ADDRESS_PAGES.push({ label: "???" });
const PAGE_COUNT = ADDRESS_PAGES.length;

const SCREEN_W = 4.8; // 4:3
const SCREEN_H = 3.6;

// Beyond a door's reach (6, building/spec.ts DOOR_INTERACT_REACH): the screen is huge, you click it from conversation distance.
const INTERACT_DISTANCE = 14;
const HOVER_CHECK_DISTANCE = 50;
const SCROLL_COOLDOWN_MS = 250;

const _raycaster = new THREE.Raycaster();
const _center = new THREE.Vector2(0, 0);
const _worldPos = new THREE.Vector3();

// Shell dimensions (local; group origin = screen center)
const BEZEL = 0.6;
const FRAME_DEPTH = 0.95;
const FRAME_Z = -0.225; // screen (z=0) recessed 0.25 behind the bezel front

/** The home page's address selector (see CLAUDE.md). The glow light is PARKED
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

  const { atlasTexture, screenMaterial, shellMaterial } = useMemo(
    () => ({ ...createCrtScreen(ADDRESS_PAGES), shellMaterial: new THREE.MeshStandardMaterial({ color: "#262626", roughness: 0.85 }) }),
    [],
  );

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
      const href = ADDRESS_PAGES[targetPageRef.current].href;
      // Never a real navigation: that would reopen the back button as an exit (navigation.ts).
      if (href) navigateToAddress(href);
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
    const unlocked = !!ADDRESS_PAGES[target].href && Math.abs(scroll - target) < 0.1;
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
