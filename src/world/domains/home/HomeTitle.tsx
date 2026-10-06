import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { fontOfSize } from "../../../menus/overlay/styles";

const TEX_W = 1024;
const TEX_H = 256;

const BASE_FONT_PX = 112;
const FIT_PADDING = 48; // px of canvas left free on each side

/** The label centered on the canvas, shrunk to fit inside FIT_PADDING. */
const drawLabel = (ctx: CanvasRenderingContext2D, label: string) => {
  ctx.clearRect(0, 0, TEX_W, TEX_H);
  ctx.font = fontOfSize(BASE_FONT_PX);
  const baseWidth = ctx.measureText(label).width;
  const maxWidth = TEX_W - FIT_PADDING * 2;
  const size = baseWidth > maxWidth ? Math.floor((BASE_FONT_PX * maxWidth) / baseWidth) : BASE_FONT_PX;
  if (size !== BASE_FONT_PX) ctx.font = fontOfSize(size);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, TEX_W / 2, TEX_H / 2 - size * 0.18);
};

/** A transparent text material, redrawn once the web font has loaded. Caller disposes both. */
const createLabelMaterial = (label: string) => {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d")!;
  drawLabel(ctx, label);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
  });
  document.fonts?.ready.then(() => {
    drawLabel(ctx, label);
    texture.needsUpdate = true;
  });
  return { texture, material };
};

/** The floating "dotcomma" title of the home page. */
export const HomeTitle = ({ position }: { position: [number, number, number] }) => {
  const { texture, material } = useMemo(() => createLabelMaterial("dotcomma"), []);

  useEffect(() => {
    return () => {
      texture.dispose();
      material.dispose();
    };
  }, [texture, material]);

  return (
    <mesh position={position}>
      <planeGeometry args={[7.5, 1.875]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
};
