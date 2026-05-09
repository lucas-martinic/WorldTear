# WorldTear — Invisibility Cape on Quest 3

A WebXR demo built on the [Immersive Web SDK](https://iwsdk.dev) that hangs a
quad in 3D space, samples the Quest 3 passthrough camera onto its surface so it
acts like an invisibility cape, and runs a Verlet cloth simulation that
deforms when you poke it with your fingers.

## What it does

- Subdivided plane (24 × 32 grid) hung in front of the user.
- Custom `ShaderMaterial` samples the WebXR raw-camera image of each eye's
  view using the fragment's screen-space NDC position. Because the user agent
  guarantees the image is aligned to the `XRView`, the cape acts as a true
  window into reality with no manual parallax tuning needed.
- ECS `ClothSystem` runs Verlet integration with distance constraints,
  light gravity, and three pinned vertices along the top edge.
- Each frame the system reads `world.input.xrOrigin.indexTipSpaces.{left,right}`
  to get fingertip world positions and pushes nearby cloth vertices outward.

### How the stereo camera binding works

We use the W3C **WebXR Raw Camera Access** feature
(`'camera-access'`), which Quest browser implements. On every XR frame:

1. `RawCameraSystem.update()` (in `src/raw-camera-system.ts`) reads
   `this.xrFrame.getViewerPose(refSpace)`.
2. For each `XRView` in the pose, it calls
   `binding.getCameraImage(view.camera)` — the user agent returns a
   `WebGLTexture` that has already been cropped/warped to align with that
   eye's view frustum.
3. The handle is injected into a Three.js `Texture` wrapper via
   `renderer.properties.get(tex).__webglTexture = handle`. Per the spec the
   texture is only valid for the current frame, so we re-write the handle
   every tick rather than allocating new wrappers.
4. `bindStereoEyeSwitching()` flips the `uIsRightEye` uniform inside
   `mesh.onBeforeRender`, comparing the current sub-camera against
   `renderer.xr.getCamera().cameras[1]`. The fragment shader picks
   `uCameraLeft` or `uCameraRight` accordingly.

Because IWSDK 0.3.1's `XRFeatureOptions` doesn't include `cameraAccess`, we
set `xr.offer: 'none'` and start the session ourselves
(`src/xr-session.ts`) with `'camera-access'` in `optionalFeatures`, then hand
the session to `world.renderer.xr.setSession()`. Everything else (input,
hand tracking, ECS, render loop) stays on IWSDK.

### Caveats

- If the runtime doesn't grant `camera-access` (older Quest browser,
  emulator, or a desktop browser running the page), `view.camera` is
  `undefined`. The system logs a warning and the cape falls back to its
  purple haze color.
- The binding cache assumes the renderer is using a single GL context for
  the lifetime of the session; switching contexts mid-session would require
  recreating the `XRWebGLBinding`. The system handles new sessions
  (re-entry after end) automatically.

## Prerequisites

- **Node.js 20.9+** for this fork. Note: the upstream `npm create @iwsdk@latest`
  scaffolder requires Node 20.19+; this repo is configured manually so it
  installs fine on 20.9.
- Meta Quest 3 (or Quest Pro, with appropriate camera permissions).
- The Quest browser must trust the dev server's certificate. We use
  `vite-plugin-mkcert` to generate one automatically on first run.

## Run

```bash
npm install
npm run dev
```

`vite-plugin-mkcert` will print an HTTPS URL like `https://192.168.x.x:5173`.
Open that URL in the Quest browser, **accept the camera permission prompt**,
then enter the immersive AR session. The cape should appear ~0.9 m in front of
the user at eye level. Reach out with either hand and poke it.

If permissions are blocked, the cape falls back to a soft purple haze so you
can still see geometry and validate cloth simulation.

## Layout

```
src/
  cape.ts                Plane geometry, ShaderMaterial, cloth state struct
  cloth-system.ts        Verlet integrator + fingertip pokes (ECS system)
  raw-camera-system.ts   Per-frame XRWebGLBinding.getCameraImage binding
  xr-session.ts          Manual offerSession with 'camera-access'
  webxr-types.d.ts       Type augmentations for raw camera access
  index.ts               World setup, entity creation, system registration
```

## Tuning knobs

- `cape.ts` — width/height/cols/rows, pinned vertices, shader uniforms.
- `cloth-system.ts` — `GRAVITY`, `DAMPING`, `CONSTRAINT_ITERS`, `POKE_RADIUS`,
  `TICK_HZ`.
