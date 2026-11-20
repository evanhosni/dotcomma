import { RootState } from "@react-three/fiber";
import React from "react";
import * as THREE from "three";
import type { ActorFrameUpdater } from "./types";

export const frameUpdaters = new Set<React.MutableRefObject<ActorFrameUpdater>>();
/** Where each MOVING actor (one with a live positionRef) is now, by id: the pool sweeps it by where it
 *  went, not where it spawned (a car driven across town stays mounted under its driver). */
export const liveActorPositions = new Map<string, React.MutableRefObject<THREE.Vector3>>();
export const frustum = new THREE.Frustum();
const projScreenMatrix = new THREE.Matrix4();

export const driveActorFrames = (state: RootState, delta: number): void => {
  if (frameUpdaters.size === 0) return;
  projScreenMatrix.multiplyMatrices(state.camera.projectionMatrix, state.camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projScreenMatrix);
  for (const updater of frameUpdaters) updater.current(state, delta);
};
