import { RootState } from "@react-three/fiber";
import React from "react";
import * as THREE from "three";
import type { ActorFrameUpdater } from "./types";

export const frameUpdaters = new Set<React.MutableRefObject<ActorFrameUpdater>>();
export const frustum = new THREE.Frustum();
const projScreenMatrix = new THREE.Matrix4();

export const driveActorFrames = (state: RootState, delta: number): void => {
  if (frameUpdaters.size === 0) return;
  projScreenMatrix.multiplyMatrices(state.camera.projectionMatrix, state.camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projScreenMatrix);
  for (const updater of frameUpdaters) updater.current(state, delta);
};

/** Spawn ids that never mount again in this domain: NPCs that became players (the intro's hosts), as the
 *  server lists them (net/entities/store.ts). ActorPool unmounts one the moment it is retired. */
const retired = new Set<string>();
const retireListeners = new Set<(id: string) => void>();

export const isActorRetired = (id: string): boolean => retired.has(id);

export const retireActor = (id: string): void => {
  if (retired.has(id)) return;
  retired.add(id);
  retireListeners.forEach((fn) => fn(id));
};

/** The domain's whole list, as a (re)joined session receives it. */
export const setRetiredActors = (ids: readonly string[]): void => {
  retired.clear();
  for (const id of ids) retireActor(id);
};

export const onActorRetired = (fn: (id: string) => void): (() => void) => {
  retireListeners.add(fn);
  return () => {
    retireListeners.delete(fn);
  };
};
