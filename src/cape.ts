import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
  Texture,
  Uint16BufferAttribute,
  VideoTexture,
} from 'three';

export type ClothState = {
  /** Local-space positions for the current step (xyz per vertex). */
  positions: Float32Array;
  /** Local-space positions from the previous step (Verlet integration). */
  prevPositions: Float32Array;
  /** Rest distances for each constraint (parallel to constraints). */
  restLengths: Float32Array;
  /** Pairs of vertex indices for each constraint. */
  constraints: Uint32Array;
  /** Indices of vertices that are pinned in place. */
  pinned: Uint32Array;
  /** Snapshot of the pinned vertices' rest position so we can hold them exactly. */
  pinnedRest: Float32Array;
  cols: number;
  rows: number;
  width: number;
  height: number;
};

export type Cape = {
  mesh: Mesh;
  geometry: BufferGeometry;
  material: ShaderMaterial;
  cloth: ClothState;
};

export type CapeOptions = {
  width?: number;
  height?: number;
  cols?: number;
  rows?: number;
};

const VERT = /* glsl */ `
  varying vec4 vClip;
  varying vec3 vWorldNormal;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vec4 viewPos = viewMatrix * worldPos;
    gl_Position = projectionMatrix * viewPos;
    vClip = gl_Position;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
  }
`;

// Sample the camera feed using each fragment's screen-space position so the
// quad acts as a window: every pixel of the cape shows whatever the headset
// camera saw at that same screen pixel. This is the "invisibility cape"
// effect, with the caveat that the physical camera is offset from the eye,
// so there is a small parallax error vs. true reality. `cameraScale` and
// `cameraOffset` let you nudge the mapping if the camera FOV doesn't match
// the eye view 1:1.
const FRAG = /* glsl */ `
  precision highp float;

  uniform sampler2D uCameraLeft;
  uniform sampler2D uCameraRight;
  uniform float uHasCameraLeft;
  uniform float uHasCameraRight;
  uniform float uIsRightEye;
  uniform vec2 uCameraScale;
  uniform vec2 uCameraOffset;
  uniform vec3 uTint;
  uniform float uShimmer;

  varying vec4 vClip;
  varying vec3 vWorldNormal;

  void main() {
    vec2 ndc = vClip.xy / vClip.w;
    vec2 uv = ndc * 0.5 + 0.5;
    uv = (uv - 0.5) * uCameraScale + 0.5 + uCameraOffset;

    bool useRight = uIsRightEye > 0.5 && uHasCameraRight > 0.5;
    bool useLeft  = !useRight && uHasCameraLeft > 0.5;

    vec3 color;
    if ((useRight || useLeft) && uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
      color = useRight ? texture2D(uCameraRight, uv).rgb : texture2D(uCameraLeft, uv).rgb;
    } else {
      color = vec3(0.12, 0.08, 0.22);
    }

    float rim = pow(1.0 - abs(vWorldNormal.z), 2.0);
    color += rim * uShimmer * vec3(0.35, 0.55, 1.0);
    color *= uTint;

    gl_FragColor = vec4(color, 1.0);
  }
`;

export function createCape(opts: CapeOptions = {}): Cape {
  const width = opts.width ?? 1.2;
  const height = opts.height ?? 1.6;
  const cols = opts.cols ?? 24;
  const rows = opts.rows ?? 32;

  const geometry = new BufferGeometry();
  const vertCount = cols * rows;

  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const normals = new Float32Array(vertCount * 3);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const x = (c / (cols - 1) - 0.5) * width;
      const y = (0.5 - r / (rows - 1)) * height;
      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = 0;
      uvs[i * 2 + 0] = c / (cols - 1);
      uvs[i * 2 + 1] = 1 - r / (rows - 1);
      normals[i * 3 + 2] = 1;
    }
  }

  const indices = new Uint16Array((cols - 1) * (rows - 1) * 6);
  let idx = 0;
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c;
      const b = r * cols + c + 1;
      const d = (r + 1) * cols + c;
      const e = (r + 1) * cols + c + 1;
      indices[idx++] = a;
      indices[idx++] = d;
      indices[idx++] = b;
      indices[idx++] = b;
      indices[idx++] = d;
      indices[idx++] = e;
    }
  }

  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setIndex(new Uint16BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  const material = new ShaderMaterial({
    uniforms: {
      uCameraLeft: { value: null },
      uCameraRight: { value: null },
      uHasCameraLeft: { value: 0 },
      uHasCameraRight: { value: 0 },
      uIsRightEye: { value: 0 },
      uCameraScale: { value: [1.0, 1.0] },
      uCameraOffset: { value: [0.0, 0.0] },
      uTint: { value: [1.0, 1.0, 1.0] },
      uShimmer: { value: 0.35 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: DoubleSide,
    transparent: false,
  });

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;

  const constraints: number[] = [];
  const restLengths: number[] = [];
  const restPos = (i: number) => [
    positions[i * 3],
    positions[i * 3 + 1],
    positions[i * 3 + 2],
  ] as const;
  const dist = (a: number, b: number) => {
    const [ax, ay, az] = restPos(a);
    const [bx, by, bz] = restPos(b);
    return Math.hypot(ax - bx, ay - by, az - bz);
  };
  const addConstraint = (a: number, b: number) => {
    constraints.push(a, b);
    restLengths.push(dist(a, b));
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (c < cols - 1) addConstraint(i, i + 1);
      if (r < rows - 1) addConstraint(i, i + cols);
      if (c < cols - 1 && r < rows - 1) {
        addConstraint(i, i + cols + 1);
        addConstraint(i + 1, i + cols);
      }
    }
  }

  const pinned: number[] = [];
  pinned.push(0);
  pinned.push(cols - 1);
  pinned.push(Math.floor((cols - 1) / 2));
  const pinnedRest = new Float32Array(pinned.length * 3);
  for (let p = 0; p < pinned.length; p++) {
    const i = pinned[p];
    pinnedRest[p * 3 + 0] = positions[i * 3 + 0];
    pinnedRest[p * 3 + 1] = positions[i * 3 + 1];
    pinnedRest[p * 3 + 2] = positions[i * 3 + 2];
  }

  const cloth: ClothState = {
    positions: positions.slice(),
    prevPositions: positions.slice(),
    constraints: new Uint32Array(constraints),
    restLengths: new Float32Array(restLengths),
    pinned: new Uint32Array(pinned),
    pinnedRest,
    cols,
    rows,
    width,
    height,
  };

  return { mesh, geometry, material, cloth };
}

export type CameraEye = 'left' | 'right';

export function setCameraTexture(
  cape: Cape,
  eye: CameraEye,
  texture: VideoTexture | Texture | null,
) {
  if (eye === 'left') {
    cape.material.uniforms.uCameraLeft.value = texture;
    cape.material.uniforms.uHasCameraLeft.value = texture ? 1 : 0;
  } else {
    cape.material.uniforms.uCameraRight.value = texture;
    cape.material.uniforms.uHasCameraRight.value = texture ? 1 : 0;
  }
  cape.material.needsUpdate = true;
}

/**
 * Wire the cape mesh so that the correct camera texture is sampled for each
 * XR eye during stereo rendering. Three.js calls onBeforeRender once per
 * sub-camera (per-eye) when WebXR is active, so we just compare the camera
 * pointer to the ArrayCamera's right-eye entry and flip the uniform.
 */
export function bindStereoEyeSwitching(cape: Cape) {
  cape.mesh.onBeforeRender = (renderer, _scene, camera) => {
    const xrCam: any = renderer.xr.getCamera();
    let isRight = 0;
    if (xrCam && Array.isArray(xrCam.cameras) && xrCam.cameras.length >= 2) {
      isRight = camera === xrCam.cameras[1] ? 1 : 0;
    }
    cape.material.uniforms.uIsRightEye.value = isRight;
  };
}
