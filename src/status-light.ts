import {
  BoxGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  Object3D,
} from 'three';

export type StatusCode =
  | 'init'           // black — code reached but nothing happened yet
  | 'await-xr'       // dim blue — waiting for AR session to start
  | 'enumerating'    // bright blue — calling enumerateDevices
  | 'no-cameras'     // red — 0 cameras returned (denied or unsupported)
  | 'requested'      // yellow — CameraSource entities created, waiting for Active
  | 'active'         // green — at least one camera streaming, texture should show
  | 'rawcam'         // cyan — W3C camera-access reports view.camera and bound texture
  | 'error';         // magenta — unexpected exception

const COLORS: Record<StatusCode, number> = {
  init: 0x111111,
  'await-xr': 0x103060,
  enumerating: 0x1f8af2,
  'no-cameras': 0xc0341d,
  requested: 0xc0a01d,
  active: 0x1fa024,
  rawcam: 0x1fb8b8,
  error: 0xc01d8a,
};

export type StatusLight = {
  object: Object3D;
  set(code: StatusCode): void;
};

/**
 * A small colored cube the user can keep an eye on inside the headset to
 * understand what stage the camera pipeline is in. Floats next to the cape.
 */
export function createStatusLight(): StatusLight {
  const mesh = new Mesh(
    new BoxGeometry(0.05, 0.05, 0.05),
    new MeshBasicMaterial({ color: COLORS.init }),
  );
  let current: StatusCode = 'init';

  const set = (code: StatusCode) => {
    if (code === current) return;
    current = code;
    (mesh.material as MeshBasicMaterial).color = new Color(COLORS[code]);
    console.log(`[WorldTear] status -> ${code}`);
  };

  return { object: mesh, set };
}
