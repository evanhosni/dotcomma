import { useFrame, useThree } from "@react-three/fiber";
import { useRapier } from "@react-three/rapier";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useGameContext } from "../../../../context/hooks";
import { send } from "../../../../net";
import { BEEBLE_SM } from "../../../../objects/actors/beeble/stateMachine";
import { seatWorldPoint } from "../../../../objects/actors/mav-unit";
import { mavImpactOf, MAV_HEAD_HEIGHT, MAV_SCREW_LENGTH } from "../../../../objects/actors/mav-unit/spec";
import { getLiveModelActor } from "../../../../objects/actors/model/registry";
import type { LiveModelActor } from "../../../../objects/actors/model/registry";
import { recoverSecondsOf } from "../../../../objects/actors/state/utils";
import { retireActor } from "../../../../objects/actors/store";
import { PLAYER_EYE_HEIGHT, SPAWN_CLEARANCE } from "../../../../player/spec";
import type { PlayerBodyState } from "../../../../player/types";
import { getLocalPlayerBody, placePlayer, setPlayerHeld } from "../../../../player/store";
import { setCursorLook } from "../../../../utils/cursor";
import { smoothstep } from "../../../../utils/math";
import { SCAN } from "../../../../vfx/screen-pass/store";
import { prefetchTerrainAround } from "../../../terrain/build-requests";
import { ensureVertexCompute } from "../../../terrain/utils";
import { flashAddressPath, holdAddressBar, takePendingAddress } from "../../navigation";
import { addressOfPosition, resolveAddress } from "../address";
import { ADDRESS_SEARCH_RADIUS, BELOW_TITLE, BLACK_FADE_DELAY, BLACK_FADE_SECONDS, BLINK_SECONDS, CAMERA_FOLLOW_RATE, CAMERA_GROUND_CLEARANCE, DROP_HEIGHT, FADE_OUT_SECONDS, FALL_SPIN, HEAD_TOP_GUESS, HOLD_BRAKE, HOLD_GIVE_UP_SECONDS, HOLD_HEIGHT, HOST_FOUND_SECONDS, HOST_MOUNT_WAIT_SECONDS, INSTALL_CAMERA_HEIGHT, INSTALL_CAMERA_SKYWARD, KNOCK_SECONDS, LANDING_RADIUS, LANDING_TOLERANCE, PROMPT_EXPANDING, PROMPT_FOUND, PROMPT_MIN_SECONDS, PROMPT_NONE, PROMPT_SCANNING, SCAN_FLICKER_RANGE, SCAN_FLICKER_SECONDS, SCAN_MIN_SECONDS, SCAN_RAMP_END, SCAN_RAMP_START, SCAN_TIMEOUT_SECONDS, SCREW_SECONDS, SCREW_TURNS, SEAT_BLEND_HEIGHT, SKY_TEST_SETTLE_SECONDS, STAND_TIMEOUT_SECONDS, TITLE_DEPTH, TITLE_GONE_SECONDS, TRACK_GLIDE_SECONDS, TRACK_GLIDE_SPEED } from "./constants";
import { IntroOverlay } from "./IntroOverlay";
import { SkyTitle } from "./SkyTitle";
import type { Host, HostView } from "./types";
import { claimHost, createIntroRun, eyesOpenAt, fallSpeedAt, groundAt, hostsAround, hostViewOf, lyingViewOf, searchPlaces } from "./utils";

/** Looking straight down, the top of the screen toward −z (the title's top). */
const LOOK_DOWN = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const WORLD_UP = new THREE.Vector3(0, 1, 0);

const _seatPoint = new THREE.Vector3();
const _seatUp = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _target = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _look = new THREE.Matrix4();
const _ahead = new THREE.Vector3();
const _standQ = new THREE.Quaternion();
const _standEuler = new THREE.Euler(0, 0, 0, "YXZ");

/**
 * THE WAY IN (README.md). The player starts as a MAV Unit hovering high over the overworld, above the title
 * written in the sky. A click scans for a host — the address bar flicking through places while a beeble is
 * found and claimed from the server — then the unit falls through the title, the black fading into the
 * unit's scan of the world, homes in on its host's head and screws into it: the host goes limp (its
 * ragdoll), the screen goes black, and the player wakes up in it, lying down, blinking, and stands up as
 * that beeble. Everyone sees the unit fall and the host take it; only this player sees the text and the
 * blackness. Renders nothing of its own into React; owns the camera while it runs.
 */
export const Intro = () => {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const { playerPosition, terrainLoaded, setPlayerSpawn, setTerrainLoaded, setProgress } = useGameContext();
  const { world, rapier } = useRapier();
  const terrainLoadedRef = useRef(terrainLoaded);
  terrainLoadedRef.current = terrainLoaded;

  const run = useRef(createIntroRun()).current;
  /** The page layer and the sky's text, while the intro runs. */
  const parts = useRef<{ overlay: IntroOverlay; sky: SkyTitle } | null>(null);
  const cancelled = useRef(false);

  /** Takes the intro's meshes and page layer away (once it is over, or unmounted). */
  const teardown = (): void => {
    const p = parts.current;
    if (!p) return;
    p.overlay.dispose();
    p.sky.dispose();
    parts.current = null;
    SCAN.strength = 0;
  };

  /** The message under the title, on the page's title and the sky's alike. */
  const setPrompt = (text: string): void => {
    parts.current?.sky.setPrompt(text);
    parts.current?.overlay.setPrompt(text);
    run.promptAt = performance.now();
  };
  /** Changes the prompt once the current message has been up PROMPT_MIN_SECONDS, unless `stale()` says the
   *  scan has moved on meanwhile (its timeout put "no host found" up: never overwritten). */
  const showPrompt = async (text: string, stale: () => boolean): Promise<void> => {
    const wait = run.promptAt + PROMPT_MIN_SECONDS * 1000 - performance.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    if (!stale()) setPrompt(text);
  };
  const promptAged = (): boolean => performance.now() - run.promptAt >= PROMPT_MIN_SECONDS * 1000;

  /** Below the title: the unit may turn toward its host, and its reticle shows. */
  const pastTitle = (): boolean => run.mav.y < (parts.current?.sky.promptY ?? Infinity) - BELOW_TITLE;

  /** The scan shows the places it searches in the address bar: always, but on an opened address only once
   *  it has widened past it. */
  const scanMovesAddressBar = (): boolean => !run.address || run.expanding;

  /** The unit's own view, looking straight down. */
  const lookDownFromUnit = (): void => {
    camera.position.set(run.mav.x, run.mav.y + MAV_HEAD_HEIGHT / 2, run.mav.z);
    camera.quaternion.copy(LOOK_DOWN);
  };

  /** Closes the terrain gate on a new spot and points the spawn there: the ground loads under the unit, and a
   *  player handed off before it has loaded is held exactly there (Player.tsx holdAtSpawn). */
  const loadAround = (x: number, groundY: number, z: number): void => {
    prefetchTerrainAround(x, z);
    setTerrainLoaded(false);
    setProgress(0);
    setPlayerSpawn([x, groundY, z], 0);
  };

  useEffect(() => {
    cancelled.current = false;
    // The page's own title covers everything until the fall (IntroOverlay.ts); the sky's is drawn behind it.
    const overlay = new IntroOverlay();
    overlay.layoutTitle((camera as THREE.PerspectiveCamera).fov, TITLE_DEPTH + MAV_HEAD_HEIGHT / 2);
    setCursorLook("none");
    parts.current = { overlay, sky: new SkyTitle(scene) };
    setPlayerHeld(true);
    holdAddressBar(true);
    // This run's own flag: StrictMode mounts twice in dev, and a shared one let BOTH starts finish, the
    // first leaving its click gate over the page for good.
    let disposed = false;
    (async () => {
      await ensureVertexCompute();
      if (disposed) return;
      const address = takePendingAddress();
      const resolved = address && resolveAddress(address);
      const { site } = resolved ?? addressOfPosition(0, 0);
      run.address = resolved ? resolved.path : null;
      const vd = await groundAt(site.x, site.z);
      if (disposed) return;
      const ground = Number.isNaN(vd.waterHeight) ? vd.height : Math.max(vd.height, vd.waterHeight);
      run.start = { x: site.x, z: site.z };
      run.landY = ground;
      run.mav.set(site.x, ground + DROP_HEIGHT, site.z);
      loadAround(site.x, ground, site.z);
      parts.current?.sky.placeUnder(run.mav);
      run.ready = true;
      overlay.openGate(enter);
    })();

    return () => {
      disposed = true;
      cancelled.current = true;
      teardown();
      setPlayerHeld(false);
      holdAddressBar(false);
      setCursorLook("dot");
    };
  }, []);

  /** The click: scan for a host, claiming the nearest free beeble of the first place that has one. An
   *  opened address is where the player asked to go: its own cell is searched first, the address bar left on
   *  it, and only when it has no free beeble does the scan widen to the places around it. */
  const enter = (): void => {
    run.nextPhase = "scanning";
    setPrompt(PROMPT_SCANNING);
    const claimFirst = async (hosts: Host[]): Promise<boolean> => {
      for (const host of hosts) {
        if (cancelled.current || run.searchDone) return true;
        if (await claimHost(host.id)) {
          // Granted after the scan timed out ("no host found", the unit already falling as a beeble): let it go.
          if (run.searchDone) send({ t: "host", id: host.id, step: "release" });
          else run.host = host;
          run.searchDone = true;
          return true;
        }
      }
      return false;
    };
    (async () => {
      if (run.address) {
        if (await claimFirst(await hostsAround(run.start, ADDRESS_SEARCH_RADIUS, run.address))) return;
        await showPrompt(PROMPT_EXPANDING, () => cancelled.current || run.searchDone);
        if (cancelled.current || run.searchDone) return;
        run.expanding = true;
      }
      for (const place of searchPlaces(run.start)) {
        if (cancelled.current || run.searchDone) return;
        flashAddressPath(addressOfPosition(place.x, place.z).path);
        if (await claimFirst(await hostsAround(place))) return;
      }
      run.searchDone = true;
    })();
  };

  /** "Host found": the unit moves (in the black) over its host, and the address bar is the host's place. */
  const foundHost = (): void => {
    const host = run.host;
    setPrompt(host ? PROMPT_FOUND : PROMPT_NONE);
    if (host) {
      run.mav.set(host.x, host.groundY + DROP_HEIGHT, host.z);
      run.landY = host.groundY;
      loadAround(host.x, host.groundY, host.z);
      parts.current?.sky.placeUnder(run.mav);
    }
    holdAddressBar(false);
    // An opened address with its host in it keeps its path; a widened scan shows where it found one.
    if (scanMovesAddressBar()) flashAddressPath(addressOfPosition(run.mav.x, run.mav.z).path);
  };

  /** The sky test: nothing solid between the host's head and the unit straight above it. Only fixed bodies
   *  count (the ground, buildings, bridges, dressing): never an actor's capsule or a ragdoll part. */
  const skyIsClear = (seat: THREE.Vector3): boolean => {
    const ray = new rapier.Ray({ x: seat.x, y: seat.y + 0.05, z: seat.z }, { x: 0, y: 1, z: 0 });
    const reach = Math.max(run.mav.y - seat.y - 0.05, 0);
    return !world.castRay(ray, reach, true, rapier.QueryFilterFlags.ONLY_FIXED | rapier.QueryFilterFlags.EXCLUDE_SENSORS);
  };

  /** The host failed the sky test: it is let go and another is found from where it stood (the unit hovers
   *  meanwhile, then glides over to it). None anywhere: the unit lands where it is, as a beeble already
   *  wearing it. */
  const refuseHost = (host: Host): void => {
    run.refused.add(host.id);
    send({ t: "host", id: host.id, step: "release" });
    run.host = null;
    run.view = null;
    run.rehosting = true;
    (async () => {
      for (const place of searchPlaces({ x: host.x, z: host.z })) {
        for (const next of await hostsAround(place, undefined, undefined, run.refused)) {
          if (cancelled.current) return;
          if (await claimHost(next.id)) {
            run.host = next;
            run.landY = next.groundY;
            run.liveSince = NaN;
            loadAround(next.x, next.groundY, next.z);
            flashAddressPath(addressOfPosition(next.x, next.z).path);
            run.rehosting = false;
            return;
          }
        }
      }
      run.start = { x: run.mav.x, z: run.mav.z };
      run.landY = host.groundY;
      run.rehosting = false;
    })();
  };

  /** The host's sky test, once per host, as soon as it stands mounted here (and its colliders around it have
   *  had a moment to build): at any height, so the fall never stops for it. */
  const testSky = (host: Host | null, live: LiveModelActor | undefined, now: number): void => {
    if (!host || !live || run.rehosting) return;
    if (Number.isNaN(run.liveSince)) run.liveSince = now;
    if (run.skyClear === host.id || now - run.liveSince < SKY_TEST_SETTLE_SECONDS) return;
    const landing = landingOf(live, _target);
    if (!landing) return;
    if (skyIsClear(landing)) run.skyClear = host.id;
    else refuseHost(host);
  };

  /** Where the unit lands: the top of its host's head (its seat) once the host is mounted, a guess over the
   *  host's spawn point before, the ground with no host. Null while it cannot land yet. */
  const landingOf = (live: LiveModelActor | undefined, out: THREE.Vector3): THREE.Vector3 | null => {
    const host = run.host;
    if (!host) return out.set(run.start.x, run.landY + PLAYER_EYE_HEIGHT, run.start.z);
    if (live && !run.view) run.view = hostViewOf(live);
    if (!live || !run.view) return null;
    return seatWorldPoint(run.view.seat, out);
  };

  /** Where the unit is held, horizontally: over its host's feet, onto the top of its head over the last
   *  SEAT_BLEND_HEIGHT, glided onto after any change of target. */
  const trackHost = (host: Host | null, live: LiveModelActor | undefined, goal: THREE.Vector3, height: number, now: number): void => {
    let tx = goal.x;
    let tz = goal.z;
    const feet = live?.group?.position;
    if (feet && !run.rehosting) {
      const onHead = 1 - smoothstep(0, SEAT_BLEND_HEIGHT, height);
      tx = feet.x + (goal.x - feet.x) * onHead;
      tz = feet.z + (goal.z - feet.z) * onHead;
    }
    const track = run.track;
    const key = `${host?.id ?? ""}|${live && !run.rehosting ? "live" : "spawn"}`;
    if (key !== track.key) {
      track.key = key;
      track.from = { x: run.mav.x, z: run.mav.z };
      track.at = now;
      track.seconds = Math.max(TRACK_GLIDE_SECONDS, Math.hypot(tx - run.mav.x, tz - run.mav.z) / TRACK_GLIDE_SPEED);
    }
    const g = smoothstep(0, track.seconds, now - track.at);
    run.mav.x = track.from.x + (tx - track.from.x) * g;
    run.mav.z = track.from.z + (tz - track.from.z) * g;
  };

  /** Held over one host too long with the ground loaded: whatever keeps it from landing, another is taken. */
  const watchHold = (host: Host | null, canLand: boolean, height: number, now: number): void => {
    const holding = !canLand && height <= HOLD_HEIGHT + 1 && terrainLoadedRef.current;
    if (!holding) run.heldSince = NaN;
    else if (Number.isNaN(run.heldSince)) run.heldSince = now;
    else if (host && !run.rehosting && now - run.heldSince >= HOLD_GIVE_UP_SECONDS) {
      run.heldSince = NaN;
      refuseHost(host);
    }
  };

  /** The player is the host now: it stands where the host stood, facing as it faces (else as the camera looks). */
  const handOff = (live: LiveModelActor | undefined): void => {
    const host = run.host;
    const at = live?.group?.position ?? (host ? _target.set(host.x, host.groundY, host.z) : _target.set(run.mav.x, run.landY, run.mav.z));
    camera.getWorldDirection(_forward);
    const yaw = live ? live.yaw : Math.atan2(_forward.x, _forward.z);
    if (host) {
      send({ t: "host", id: host.id, step: "possess" });
      retireActor(host.id);
    }
    const body = getLocalPlayerBody();
    if (body) {
      body.form = "host";
      body.mavHost = "";
      body.mavDepth = 0;
      // Already where the Player will stand it: never one frame drawn at the unit's spot.
      body.feetX = at.x;
      body.feetY = at.y;
      body.feetZ = at.z;
      body.yaw = yaw;
    }
    // The spawn too: should the ground not be loaded, the Player holds exactly here, not at the old spawn.
    setPlayerSpawn([at.x, at.y, at.z], 0);
    placePlayer({ x: at.x, feetY: at.y, z: at.z, yaw });
    setPlayerHeld(false);
    setCursorLook("dot");
    teardown();
    run.nextPhase = "done";
  };

  // One frame of each phase.

  const scan = (t: number, now: number): void => {
    if (scanMovesAddressBar() && now - run.lastFlickerAt >= SCAN_FLICKER_SECONDS) {
      run.lastFlickerAt = now;
      const r = SCAN_FLICKER_RANGE;
      flashAddressPath(addressOfPosition(run.start.x + (Math.random() - 0.5) * 2 * r, run.start.z + (Math.random() - 0.5) * 2 * r).path);
    }
    if ((run.searchDone && t >= SCAN_MIN_SECONDS && promptAged()) || t >= SCAN_TIMEOUT_SECONDS) {
      run.searchDone = true;
      foundHost();
      run.nextPhase = "found";
    }
  };

  /** The host is mounted before the fall starts, so the unit tracks where it really is from the first frame. */
  const awaitHostMount = (t: number, now: number, host: Host | null, live: LiveModelActor | undefined, overlay: IntroOverlay): void => {
    testSky(host, live, now);
    if (t >= HOST_FOUND_SECONDS && (!host || live || t >= HOST_MOUNT_WAIT_SECONDS)) {
      // The page's title gives way to the sky's, which the camera sees exactly where it stood.
      overlay.removeTitle();
      run.nextPhase = "falling";
    }
  };

  const fall = (t: number, now: number, dt: number, host: Host | null, live: LiveModelActor | undefined, sky: SkyTitle): void => {
    testSky(host, live, now);
    const landing = run.rehosting ? null : landingOf(live, _target);
    const goal = landing ?? _target.set(host ? host.x : run.mav.x, run.landY + HEAD_TOP_GUESS, host ? host.z : run.mav.z);
    const height = run.mav.y - MAV_SCREW_LENGTH - goal.y;
    const canLand = !run.rehosting && landing !== null && terrainLoadedRef.current && (!run.host || run.skyClear === run.host.id);
    watchHold(host, canLand, height, now);
    let speed = fallSpeedAt(t, height);
    // Not ready to land: braking to the hold, never a halt.
    if (!canLand) speed = Math.min(speed, Math.sqrt(2 * HOLD_BRAKE * Math.max(height - HOLD_HEIGHT, 0)));
    run.mav.y -= Math.min(speed * dt, Math.max(height, 0));
    trackHost(host, live, goal, height, now);
    sky.followAcross(run.mav);
    if (pastTitle()) setCursorLook("reticle");
    run.spin += FALL_SPIN * dt;

    sky.setBlack(1 - smoothstep(BLACK_FADE_DELAY, BLACK_FADE_DELAY + BLACK_FADE_SECONDS, t));
    SCAN.strength = smoothstep(SCAN_RAMP_START, SCAN_RAMP_END, t);
    if (t > TITLE_GONE_SECONDS) sky.hideText();
    lookDownFromUnit();

    const landed = run.mav.y - MAV_SCREW_LENGTH - goal.y <= LANDING_TOLERANCE && Math.hypot(goal.x - run.mav.x, goal.z - run.mav.z) < LANDING_RADIUS;
    if (canLand && pastTitle() && landed) land(host, live);
  };

  /** The impact: the host goes limp (the server's RAGDOLL state, predicted here at once) and the screw starts. */
  const land = (host: Host | null, live: LiveModelActor | undefined): void => {
    if (!host || !live) {
      handOff(live);
      return;
    }
    send({ t: "host", id: host.id, step: "impact" });
    live.setRagdoll(true, mavImpactOf(host.id));
    run.spinAtImpact = run.spin;
    run.nextPhase = "installing";
  };

  const install = (t: number, dt: number, live: LiveModelActor, view: HostView, overlay: IntroOverlay): void => {
    const depth = smoothstep(KNOCK_SECONDS, KNOCK_SECONDS + SCREW_SECONDS, t);
    run.screwDepth = depth;
    run.spin = run.spinAtImpact + depth * SCREW_TURNS * Math.PI * 2;
    const seat = seatWorldPoint(view.seat, _seatPoint);
    _seatUp.copy(view.seat.up).transformDirection(view.seat.bone.matrixWorld);
    run.mav.copy(seat).addScaledVector(_seatUp, MAV_SCREW_LENGTH * (1 - depth));
    // Rising out of the unit to look down at the head it screws into, the host's front at the top.
    _ahead.copy(_seatUp).addScaledVector(WORLD_UP, INSTALL_CAMERA_SKYWARD).normalize();
    _eye.copy(run.mav).addScaledVector(_ahead, INSTALL_CAMERA_HEIGHT);
    _eye.y = Math.max(_eye.y, run.landY + CAMERA_GROUND_CLEARANCE);
    _forward.set(0, 0, 1).applyQuaternion(view.seat.rotation).transformDirection(view.seat.bone.matrixWorld);
    _q.setFromRotationMatrix(_look.lookAt(_eye, seat, _forward));
    const k = 1 - Math.exp(-CAMERA_FOLLOW_RATE * dt);
    camera.position.lerp(_eye, k);
    camera.quaternion.slerp(_q, k);

    const screwedFor = t - KNOCK_SECONDS - SCREW_SECONDS;
    overlay.setBlack(smoothstep(0, FADE_OUT_SECONDS, screwedFor));
    if (screwedFor >= FADE_OUT_SECONDS) {
      SCAN.strength = 0;
      setCursorLook("none");
      live.setDrawn(false);
      overlay.setEyes(0);
      overlay.setBlack(0);
      run.nextPhase = "waking";
    }
  };

  const wake = (t: number, host: Host, live: LiveModelActor, view: HostView, overlay: IntroOverlay): void => {
    const lying = run.lying;
    // Taken once, as the eyes first open: the body has settled, and a head lying nearly level rolled the
    // view 180° back and forth as its tilt crossed level.
    if (!lying.taken) {
      lyingViewOf(view, live, run.landY, lying.at, lying.look);
      lying.taken = true;
    }
    camera.position.copy(lying.at);
    camera.quaternion.copy(lying.look);
    overlay.setEyes(eyesOpenAt(t));
    if (t >= BLINK_SECONDS) {
      overlay.setEyes(1);
      if (!send({ t: "host", id: host.id, step: "wake" })) live.setRagdoll(false, undefined, true);
      run.nextPhase = "standing";
    }
  };

  /** From lying on the side to the level first-person view the Player takes over, as the body gets up. */
  const stand = (t: number, now: number, live: LiveModelActor): void => {
    if (live.ragdollPhase === "recovering" && Number.isNaN(run.recoverAt)) run.recoverAt = now;
    const risen = Number.isNaN(run.recoverAt) ? 0 : smoothstep(0, recoverSecondsOf(BEEBLE_SM), now - run.recoverAt);
    const g = live.group;
    if (g) {
      // Exactly the Player's first view (Player.tsx takePlacement): no jump when it takes over.
      _eye.set(g.position.x, g.position.y + SPAWN_CLEARANCE + PLAYER_EYE_HEIGHT, g.position.z);
      _standQ.setFromEuler(_standEuler.set(0, live.yaw + Math.PI, 0));
      camera.position.lerpVectors(run.lying.at, _eye, risen);
      camera.quaternion.slerpQuaternions(run.lying.look, _standQ, risen);
    }
    // Only once the view has fully risen onto the Player's: handing off mid-rise jumped the camera.
    if ((risen >= 1 && live.ragdollPhase === "none") || t >= STAND_TIMEOUT_SECONDS) handOff(live);
  };

  /** What every player sees of this one: the lone unit, then the unit screwing into its host. Written every
   *  frame: the Player publishes its body state only after this component has mounted. */
  const publishBody = (body: PlayerBodyState, host: Host | null, inHost: boolean): void => {
    body.form = "mav";
    body.mavHost = inHost && host ? host.id : "";
    body.mavDepth = inHost ? run.screwDepth : 0;
    body.feetX = run.mav.x;
    body.feetY = run.mav.y;
    body.feetZ = run.mav.z;
    body.yaw = run.spin;
    // The camera is outside the unit only while it screws in; waking, the host (and the unit on it) is hidden.
    body.visible = run.phase === "installing";
  };

  useFrame((state, delta) => {
    const p = parts.current;
    if (!p || run.phase === "done") return;
    const now = state.clock.elapsedTime;
    const dt = Math.min(delta, 0.1);
    if (run.nextPhase) {
      run.phase = run.nextPhase;
      run.phaseAt = now;
      run.nextPhase = null;
      if (run.phase === "done") return;
    }
    if (Number.isNaN(run.phaseAt)) run.phaseAt = now;
    const t = now - run.phaseAt;
    const host = run.host;
    const live = host ? getLiveModelActor(host.id) : undefined;
    const inHost = run.phase === "installing" || run.phase === "waking" || run.phase === "standing";
    const view = run.view;
    if (inHost && (!host || !live || !view)) {
      handOff(live);
      return;
    }

    switch (run.phase) {
      case "scanning":
        scan(t, now);
        break;
      case "found":
        awaitHostMount(t, now, host, live, p.overlay);
        break;
      case "falling":
        fall(t, now, dt, host, live, p.sky);
        break;
      case "installing":
        install(t, dt, live!, view!, p.overlay);
        break;
      case "waking":
        wake(t, host!, live!, view!, p.overlay);
        break;
      case "standing":
        stand(t, now, live!);
        break;
    }

    if (run.phase === "title" || run.phase === "scanning" || run.phase === "found") lookDownFromUnit();
    // Handed off this frame (its parts torn down): the body is the Player's again.
    if (!run.ready || !parts.current) return;
    if (inHost && live?.group) playerPosition.set(live.group.position.x, live.group.position.y + HEAD_TOP_GUESS / 2, live.group.position.z);
    else playerPosition.copy(run.mav);
    const body = getLocalPlayerBody();
    if (body) publishBody(body, host, inHost);
  }, 1);

  return null;
};
