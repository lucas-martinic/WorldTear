import { CameraFacing, CameraSource, SessionMode, World } from '@iwsdk/core';
import { bindStereoEyeSwitching, createCape } from './cape.js';
import {
  CameraSourceBindSystem,
  pickStereoCameras,
} from './camera-source-system.js';
import { ClothSystem, makeFingertipSource } from './cloth-system.js';
import { RawCameraSystem } from './raw-camera-system.js';
import { offerSessionWithCameraAccess } from './xr-session.js';

World.create(document.getElementById('scene-container') as HTMLDivElement, {
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    // We start the session ourselves so we can include 'camera-access' in
    // optionalFeatures (IWSDK 0.3.1 doesn't expose it through XRFeatureOptions).
    offer: 'none',
    features: { handTracking: true },
  },
  features: {
    // Enable IWSDK's CameraSystem so getUserMedia-based CameraSource entities
    // can run as a fallback when the W3C 'camera-access' feature isn't
    // granted by the runtime.
    camera: true,
  },
  render: {
    near: 0.01,
    far: 50,
  },
}).then(async (world) => {
  const cape = createCape({ width: 1.0, height: 1.4, cols: 24, rows: 32 });
  cape.mesh.position.set(0, 1.4, -0.9);
  bindStereoEyeSwitching(cape);

  world.createTransformEntity(cape.mesh, { parent: world.sceneEntity });

  const rawCam = world
    .registerSystem(RawCameraSystem)
    .getSystem(RawCameraSystem);
  if (rawCam) rawCam.attach(cape);

  const pairing = await pickStereoCameras().catch((err) => {
    console.warn('[WorldTear] camera enumeration failed:', err);
    return null;
  });

  if (pairing) {
    world.createEntity().addComponent(CameraSource, {
      deviceId: pairing.left,
      facing: CameraFacing.Back,
      width: 1280,
      height: 720,
      frameRate: 30,
    });

    if (pairing.right !== pairing.left) {
      world.createEntity().addComponent(CameraSource, {
        deviceId: pairing.right,
        facing: CameraFacing.Back,
        width: 1280,
        height: 720,
        frameRate: 30,
      });
    }

    const cameraBind = world
      .registerSystem(CameraSourceBindSystem)
      .getSystem(CameraSourceBindSystem);
    if (cameraBind) cameraBind.attach(cape, pairing);
  } else {
    console.warn(
      '[WorldTear] no cameras enumerable; cape will use fallback color.',
    );
  }

  const indexLeft = world.input?.xrOrigin.indexTipSpaces.left;
  const indexRight = world.input?.xrOrigin.indexTipSpaces.right;
  const clothSystem = world.registerSystem(ClothSystem).getSystem(ClothSystem);
  if (clothSystem) {
    clothSystem.attach(cape, [
      makeFingertipSource(indexLeft),
      makeFingertipSource(indexRight),
    ]);
  }

  await offerSessionWithCameraAccess(world);
});
