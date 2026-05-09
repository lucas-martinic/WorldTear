import type { World } from '@iwsdk/core';

const SESSION_MODE: XRSessionMode = 'immersive-ar';

const REQUIRED: string[] = [];
const OPTIONAL: string[] = [
  'local-floor',
  'bounded-floor',
  'hand-tracking',
  'layers',
  'camera-access',
];

/**
 * Start an immersive-AR session ourselves so we can include 'camera-access'
 * in the optionalFeatures list. IWSDK 0.3.1's structured XRFeatureOptions
 * doesn't expose camera-access, so we bypass its offer flow and feed the
 * resulting session directly into the renderer.
 *
 * Pair this with `xr: { offer: 'none' }` in WorldOptions so IWSDK doesn't
 * race us with its own offerSession call.
 */
export async function offerSessionWithCameraAccess(world: World): Promise<void> {
  if (!('xr' in navigator) || !navigator.xr) {
    console.warn('[WorldTear] WebXR not available in this browser.');
    return;
  }

  const init: XRSessionInit = {
    requiredFeatures: REQUIRED,
    optionalFeatures: OPTIONAL,
  };

  const start = async () => {
    if (world.session) return;
    let session: XRSession | undefined;
    try {
      const offered = await (navigator.xr as any).offerSession?.(
        SESSION_MODE,
        init,
      );
      session = offered as XRSession | undefined;
    } catch (err) {
      console.warn('[WorldTear] offerSession failed:', err);
    }
    if (!session) return;
    await attach(world, session, start);
  };

  await start();
}

async function attach(world: World, session: XRSession, restart: () => Promise<void>) {
  // IWSDK disables their built-in depth-sensing occlusion mesh. We don't use
  // it either (we're rendering passthrough into the cape, not as background).
  (world.renderer.xr as any).getDepthSensingMesh = () => null;

  const grantedRefSpace = await pickReferenceSpace(session);
  world.renderer.xr.setReferenceSpaceType(grantedRefSpace);

  const onEnd = () => {
    session.removeEventListener('end', onEnd);
    world.session = undefined;
    restart();
  };
  session.addEventListener('end', onEnd);

  await world.renderer.xr.setSession(session);
  world.session = session;

  console.log(
    '[WorldTear] xr session started. enabledFeatures =',
    (session as any).enabledFeatures ?? '<unknown>',
  );
}

async function pickReferenceSpace(
  session: XRSession,
): Promise<XRReferenceSpaceType> {
  const candidates: XRReferenceSpaceType[] = ['local-floor', 'local', 'viewer'];
  for (const type of candidates) {
    try {
      await session.requestReferenceSpace(type);
      return type;
    } catch {}
  }
  return 'viewer';
}
