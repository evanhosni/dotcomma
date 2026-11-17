uniform sampler2D lakesandtexture;
varying vec2 vWorldUv;
varying vec3 vWorldPosWrapped;
varying float vUnderwaterDepth;

void main() {
  // Sea-floor sand under the one bed shade (common.glsl bedShade: the river's channel wears it too).
  vec3 sand = texture2D(lakesandtexture, fract(vWorldUv)).rgb;
  gl_FragColor = vec4(bedShade(sand, vWorldPosWrapped, vUnderwaterDepth), 1.0);
}
