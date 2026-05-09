import type { World } from '@iwsdk/core';

const SESSION_MODE: XRSessionMode = 'immersive-ar';

// Try the most aggressive form first: camera-access REQUIRED. If Quest
// implements it the session boots and `view.camera` populates. If it doesn't,
// the session won't start and we fall back to a less-strict request that
// just enters AR (still purple cape but at least the user is in the world).
const VARIANTS: { required: string[]; optional: string[] }[] = [
  {
    required: ['camera-access'],
    optional: [
      'local-floor',
      'bounded-floor',
      'hand-tracking',
      'layers',
    ],
  },
  {
    required: [],
    optional: [
      'local-floor',
      'bounded-floor',
      'hand-tracking',
      'layers',
      'camera-access',
    ],
  },
  {
    required: [],
    optional: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'],
  },
];

export type SessionLogger = (msg: string) => void;

/**
 * Start an immersive-AR session. Tries multiple feature combinations from
 * strictest (camera-access required) to most permissive — the first one Quest
 * accepts wins. Logs everything to the supplied logger so we can see which
 * variant succeeded and what enabledFeatures the runtime ended up giving us.
 *
 * Pair this with `xr: { offer: 'none' }` in WorldOptions so IWSDK doesn't
 * race us with its own offerSession call.
 */
export async function offerSessionWithCameraAccess(
  world: World,
  log: SessionLogger = () => {},
): Promise<void> {
  if (!('xr' in navigator) || !navigator.xr) {
    log('WebXR not available in this browser.');
    return;
  }

  for (let i = 0; i < VARIANTS.length; i++) {
    const v = VARIANTS[i];
    log(
      `XR variant ${i}: required=[${v.required.join(',')}] optional=[${v.optional.join(',')}]`,
    );
    const init: XRSessionInit = {
      requiredFeatures: v.required,
      optionalFeatures: v.optional,
    };

    let session: XRSession | undefined;
    try {
      const offered = await (navigator.xr as any).requestSession?.(
        SESSION_MODE,
        init,
      );
      session = offered as XRSession | undefined;
    } catch (err: any) {
      log(`  requestSession rejected: ${err?.name || ''} ${err?.message || err}`);
      continue;
    }

    if (!session) {
      log('  requestSession returned no session');
      continue;
    }

    log(
      `  session started. enabledFeatures=${JSON.stringify((session as any).enabledFeatures ?? null)}`,
    );
    await attach(world, session, async () => {
      log('session ended; reload page to re-enter.');
    });
    return;
  }

  log('all XR variants failed.');
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
