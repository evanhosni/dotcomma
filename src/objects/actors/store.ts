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
