import { CameraSource, CameraState, CameraUtils, createSystem } from '@iwsdk/core';
import { Texture, VideoTexture } from 'three';
import { Cape, setCameraTexture } from './cape.js';

type Eye = 'left' | 'right';

/**
 * Fallback to W3C raw camera-access: opens both Quest passthrough cameras via
 * getUserMedia (IWSDK's `CameraSource`) and binds them to the cape per eye.
 *
 * RawCameraSystem (camera-access) takes precedence when it's actually granted
 * — it overwrites the cape uniforms every frame with view-aligned textures.
 * If `view.camera` is undefined (current Quest browser behavior in many
 * builds), this system fills in with the regular video stream so the cape
 * still shows passthrough, just without per-view geometric alignment.
 */
export class CameraSourceBindSystem extends createSystem({
  cameras: { required: [CameraSource] },
}) {
  private cape: Cape | null = null;
  private deviceIdToEye: Map<string, Eye> = new Map();
  private bound: Record<Eye, boolean> = { left: false, right: false };

  attach(cape: Cape, mapping: Record<Eye, string>) {
    this.cape = cape;
    this.deviceIdToEye = new Map([
      [mapping.left, 'left'],
      [mapping.right, 'right'],
    ]);
  }

  update() {
    if (!this.cape) return;
    if (this.bound.left && this.bound.right) return;

    for (const entity of this.queries.cameras.entities) {
      const state = entity.getValue(CameraSource, 'state');
      if (state !== CameraState.Active) continue;
      const deviceId = entity.getValue(CameraSource, 'deviceId') as string;
      const eye = this.deviceIdToEye.get(deviceId);
      if (!eye || this.bound[eye]) continue;
      const tex = entity.getValue(CameraSource, 'texture') as
        | VideoTexture
        | Texture
        | null;
      if (!tex) continue;
      setCameraTexture(this.cape, eye, tex);
      this.bound[eye] = true;
      this.onBound?.(eye);
      console.log(`[WorldTear] bound getUserMedia camera to ${eye} eye`);
    }
  }

  /** Hook fired the first frame either eye successfully binds a texture. */
  onBound: ((eye: Eye) => void) | null = null;
}

/**
 * Order enumerated video devices into [left, right]. Quest 3 exposes both
 * passthrough cameras as separate `videoinput` devices once camera permission
 * is granted. Heuristics in priority order:
 *  1. Explicit "left"/"right" substrings in label.
 *  2. Trailing 0/1 (matches native KEY_POSITION).
 *  3. Enumeration order: devices[0] = left, devices[1] = right.
 *
 * If only one camera is enumerable, returns it for both eyes.
 */
export async function pickStereoCameras(): Promise<{
  left: string;
  right: string;
} | null> {
  const devices = await CameraUtils.getDevices(true);
  if (devices.length === 0) return null;

  const labelOf = (i: number) => devices[i].label.toLowerCase();
  let leftIdx = devices.findIndex((_, i) => labelOf(i).includes('left'));
  let rightIdx = devices.findIndex((_, i) => labelOf(i).includes('right'));

  if (leftIdx < 0 || rightIdx < 0) {
    const findDigit = (digit: '0' | '1') =>
      devices.findIndex((d) => d.label.includes(digit));
    if (leftIdx < 0) leftIdx = findDigit('0');
    if (rightIdx < 0) rightIdx = findDigit('1');
  }

  if (leftIdx < 0) leftIdx = 0;
  if (rightIdx < 0) rightIdx = devices.length > 1 ? 1 : 0;

  console.log(
    '[WorldTear] cameras:',
    devices.map((d, i) => `${i}: "${d.label}"`),
    `=> left=${leftIdx}, right=${rightIdx}`,
  );

  return {
    left: devices[leftIdx].deviceId,
    right: devices[rightIdx].deviceId,
  };
}
