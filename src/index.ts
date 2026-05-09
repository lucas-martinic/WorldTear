import { SessionMode, World } from '@iwsdk/core';
import { LinearFilter, VideoTexture } from 'three';
import {
  diagnoseCameras,
  installOverlay,
  streamToVideo,
} from './bootstrap-overlay.js';
import { bindStereoEyeSwitching, Cape, createCape, setCameraTexture } from './cape.js';
import { ClothSystem, makeFingertipSource } from './cloth-system.js';
import { RawCameraSystem } from './raw-camera-system.js';
import { createStatusLight } from './status-light.js';
import { offerSessionWithCameraAccess } from './xr-session.js';

World.create(document.getElementById('scene-container') as HTMLDivElement, {
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    offer: 'none',
    features: { handTracking: true },
  },
  features: {
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

  const overlay = installOverlay({
    onClick: async () => {
      const result = await diagnoseCameras(overlay.log);
      bindStreamsToCape(cape, result.streams, overlay.log);

      overlay.log('offering AR session…');
      status.set('await-xr');
      await offerSessionWithCameraAccess(world);
      // The session offer button is shown to the user; they tap it. After
      // setSession resolves, world.session is set.
      overlay.log('session offered — accept the prompt to enter AR.');

      // Hide the overlay only once the session actually starts so the user
      // can keep watching the log if something stalls.
      const handle = setInterval(() => {
        if (world.session) {
          clearInterval(handle);
          status.set(result.streams.length > 0 ? 'active' : 'no-cameras');
          overlay.remove();
        }
      }, 200);
    },
  });
});

function bindStreamsToCape(
  cape: Cape,
  streams: MediaStream[],
  log: (msg: string) => void,
) {
  if (streams.length === 0) {
    log('no streams to bind — cape will stay purple.');
    return;
  }

  const leftVideo = streamToVideo(streams[0]);
  leftVideo.play().catch((err) => log('left video.play() failed: ' + err.message));
  const leftTex = makeVideoTexture(leftVideo);
  setCameraTexture(cape, 'left', leftTex);

  if (streams.length > 1) {
    const rightVideo = streamToVideo(streams[1]);
    rightVideo
      .play()
      .catch((err) => log('right video.play() failed: ' + err.message));
    const rightTex = makeVideoTexture(rightVideo);
    setCameraTexture(cape, 'right', rightTex);
    log('bound stream 0 -> left eye, stream 1 -> right eye');
  } else {
    setCameraTexture(cape, 'right', leftTex);
    log('only one stream available — using same texture in both eyes');
  }
}

function makeVideoTexture(video: HTMLVideoElement): VideoTexture {
  const tex = new VideoTexture(video);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  return tex;
}
