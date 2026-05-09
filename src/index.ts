import { CameraFacing, CameraSource, SessionMode, World } from '@iwsdk/core';
import { bindStereoEyeSwitching, Cape, createCape } from './cape.js';
import {
  CameraSourceBindSystem,
  pickStereoCameras,
} from './camera-source-system.js';
import { ClothSystem, makeFingertipSource } from './cloth-system.js';
import { RawCameraSystem } from './raw-camera-system.js';
import { createStatusLight, StatusLight } from './status-light.js';
import { offerSessionWithCameraAccess } from './xr-session.js';

World.create(document.getElementById('scene-container') as HTMLDivElement, {
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    offer: 'none',
    features: { handTracking: true },
  },
  features: {
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

  const status = createStatusLight();
  status.object.position.set(0.65, 1.4, -0.9);
  world.createTransformEntity(status.object, { parent: world.sceneEntity });
  status.set('init');

  const rawCam = world
    .registerSystem(RawCameraSystem)
    .getSystem(RawCameraSystem);
  if (rawCam) {
    rawCam.attach(cape);
    rawCam.onBound = () => status.set('rawcam');
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

  const cameraBind = world
    .registerSystem(CameraSourceBindSystem)
    .getSystem(CameraSourceBindSystem);
  if (cameraBind) {
    cameraBind.attach(cape, { left: '', right: '' });
    cameraBind.onBound = () => status.set('active');
  }

  status.set('await-xr');
  await offerSessionWithCameraAccess(world);
  await waitForSession(world);
  if (!world.session) {
    status.set('error');
    return;
  }

  // Defer the camera permission request until the user does a `select`
  // gesture inside the session. Quest browser appears to silently hang
  // getUserMedia inside an immersive session unless triggered from a
  // transient-activation (pinch / controller trigger).
  status.set('await-gesture');

  const session = world.session;
  let triggered = false;
  const handleSelect = async () => {
    if (triggered) return;
    triggered = true;
    session.removeEventListener('select', handleSelect);
    await requestCameras(world, cape, cameraBind, status);
  };
  session.addEventListener('select', handleSelect);
});

async function requestCameras(
  world: World,
  cape: Cape,
  cameraBind: CameraSourceBindSystem | undefined,
  status: StatusLight,
) {
  status.set('enumerating');
  try {
    const pairing = await pickStereoCameras();
    if (!pairing) {
      status.set('no-cameras');
      return;
    }

    if (cameraBind) cameraBind.attach(cape, pairing);

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

    status.set('requested');
  } catch (err) {
    console.warn('[WorldTear] camera setup failed:', err);
    status.set('error');
  }
}

function waitForSession(world: World): Promise<void> {
  return new Promise((resolve) => {
    if (world.session) {
      resolve();
      return;
    }
    const tick = () => {
      if (world.session) resolve();
      else setTimeout(tick, 100);
    };
    tick();
  });
}
