import { SessionMode, World } from '@iwsdk/core';
import { bindStereoEyeSwitching, createCape } from './cape.js';
import { ClothSystem, makeFingertipSource } from './cloth-system.js';
import { RawCameraSystem } from './raw-camera-system.js';
import { offerSessionWithCameraAccess } from './xr-session.js';

World.create(document.getElementById('scene-container') as HTMLDivElement, {
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    // We start the session ourselves so we can include 'camera-access'
    // in optionalFeatures (IWSDK's XRFeatureOptions doesn't expose it).
    offer: 'none',
    features: { handTracking: true },
  },
  features: {
    // No longer using IWSDK's CameraSource (getUserMedia path); the raw
    // camera-access feature gives view-aligned per-eye textures via
    // XRWebGLBinding.getCameraImage(view.camera).
    camera: false,
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
