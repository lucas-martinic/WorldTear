/**
 * 2D page overlay: a single button that, on click, runs the camera diagnostic
 * and enters AR — both calls happen inside a user-activation context which is
 * the cleanest way to satisfy Quest browser's permission gating. The log box
 * below the button stays visible so we can read results without chrome://
 * inspect.
 */

export type DiagnosticResult = {
  streams: MediaStream[];
  videoDevices: MediaDeviceInfo[];
  log: string;
};

export type BootstrapHooks = {
  onClick: () => Promise<void>;
};

export function installOverlay(hooks: BootstrapHooks): {
  log: (msg: string) => void;
  remove: () => void;
} {
  const overlay = document.createElement('div');
  overlay.id = 'worldtear-overlay';
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'background:linear-gradient(135deg,#0a0e1a,#1a1330)',
    'color:#e6edf3',
    'font-family:system-ui,sans-serif',
    'z-index:9999',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'justify-content:flex-start',
    'padding:6vh 6vw',
    'gap:24px',
    'overflow-y:auto',
  ].join(';');

  const title = document.createElement('h1');
  title.textContent = 'WorldTear — Invisibility Cape';
  title.style.cssText = 'margin:0;font-size:28px;font-weight:600';
  overlay.appendChild(title);

  const subtitle = document.createElement('p');
  subtitle.textContent =
    'Tap the button to grant camera permission and enter AR. The log below shows what Quest returns.';
  subtitle.style.cssText = 'margin:0;opacity:0.8;text-align:center;max-width:680px';
  overlay.appendChild(subtitle);

  const button = document.createElement('button');
  button.textContent = 'Enable camera & enter AR';
  button.style.cssText = [
    'padding:18px 36px',
    'font-size:20px',
    'font-weight:600',
    'background:#7d5fff',
    'color:#fff',
    'border:none',
    'border-radius:14px',
    'cursor:pointer',
    'box-shadow:0 8px 24px rgba(125,95,255,0.45)',
  ].join(';');
  overlay.appendChild(button);

  const logBox = document.createElement('pre');
  logBox.id = 'worldtear-log';
  logBox.style.cssText = [
    'background:#0d111a',
    'border:1px solid #2a3145',
    'border-radius:10px',
    'padding:14px 18px',
    'width:min(720px,90vw)',
    'max-height:55vh',
    'overflow-y:auto',
    'font-family:ui-monospace,monospace',
    'font-size:13px',
    'line-height:1.5',
    'white-space:pre-wrap',
    'word-break:break-all',
    'color:#9cdcfe',
    'margin:0',
  ].join(';');
  logBox.textContent = '(awaiting click)\n';
  overlay.appendChild(logBox);

  document.body.appendChild(overlay);

  const log = (msg: string) => {
    const line = msg + '\n';
    logBox.textContent += line;
    console.log('[WorldTear]', msg);
  };

  let busy = false;
  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.textContent = 'Working…';
    try {
      await hooks.onClick();
    } catch (err: any) {
      log('Click handler failed: ' + (err?.message || err));
      button.disabled = false;
      button.textContent = 'Try again';
      busy = false;
    }
  });

  return {
    log,
    remove: () => overlay.remove(),
  };
}

function withTimeout<T>(
  label: string,
  promise: Promise<T>,
  ms: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([
    promise.finally(() => clearTimeout(timeoutId)),
    timeout,
  ]);
}

export async function diagnoseCameras(
  log: (msg: string) => void,
): Promise<DiagnosticResult> {
  const out: DiagnosticResult = { streams: [], videoDevices: [], log: '' };
  log('=== camera diagnostic ===');

  log(`secureContext=${window.isSecureContext} userAgent=${navigator.userAgent}`);
  log(`navigator.mediaDevices=${typeof navigator.mediaDevices}`);
  if (!navigator.mediaDevices) {
    log('FATAL: navigator.mediaDevices is missing on this browser.');
    return out;
  }
  log(`getUserMedia=${typeof navigator.mediaDevices.getUserMedia}`);
  log(`enumerateDevices=${typeof navigator.mediaDevices.enumerateDevices}`);

  // Check the Permissions API state, if available — gives us a hint without
  // making an actual getUserMedia call.
  if (navigator.permissions?.query) {
    try {
      const perm = await withTimeout(
        'permissions.query',
        navigator.permissions.query({ name: 'camera' as PermissionName }),
        3000,
      );
      log(`permissions.camera = ${perm.state}`);
    } catch (err: any) {
      log('permissions.query: ' + (err?.message || err));
    }
  }

  log('enumerateDevices (no perm) …');
  try {
    const pre = await withTimeout(
      'enumerateDevices',
      navigator.mediaDevices.enumerateDevices(),
      5000,
    );
    const preVideo = pre.filter((d) => d.kind === 'videoinput');
    log(`  ${preVideo.length} videoinput(s):`);
    preVideo.forEach((d, i) =>
      log(
        `    ${i}: kind=${d.kind} label="${d.label || '(empty)'}" id=${d.deviceId.slice(0, 16)}…`,
      ),
    );
  } catch (err: any) {
    log('enumerateDevices threw: ' + (err?.message || err));
    log('— moving on to getUserMedia anyway —');
  }

  log('calling getUserMedia({video:true}) …');
  let mainStream: MediaStream | null = null;
  try {
    mainStream = await withTimeout(
      'getUserMedia',
      navigator.mediaDevices.getUserMedia({ video: true }),
      15000,
    );
  } catch (err: any) {
    log('getUserMedia rejected: ' + (err?.name || '') + ' ' + (err?.message || err));
  }

  if (mainStream) {
    out.streams.push(mainStream);
    const mainTrack = mainStream.getVideoTracks()[0];
    if (mainTrack) {
      const s = mainTrack.getSettings();
      log(
        `primary track: label="${mainTrack.label}" ${s.width}x${s.height} @ ${s.frameRate ?? '?'}fps id=${(s.deviceId || '').slice(0, 16)}…`,
      );
    }

    log('enumerateDevices (with perm) …');
    try {
      const post = await withTimeout(
        'enumerateDevices2',
        navigator.mediaDevices.enumerateDevices(),
        5000,
      );
      out.videoDevices = post.filter((d) => d.kind === 'videoinput');
      log(`  ${out.videoDevices.length} videoinput(s):`);
      out.videoDevices.forEach((d, i) =>
        log(
          `    ${i}: label="${d.label || '(empty)'}" id=${d.deviceId.slice(0, 16)}…`,
        ),
      );
    } catch (err: any) {
      log('enumerateDevices2 threw: ' + (err?.message || err));
    }

    const primaryId = mainTrack?.getSettings().deviceId;
    const otherDevices = out.videoDevices.filter(
      (d) => d.deviceId !== primaryId,
    );
    for (const dev of otherDevices) {
      log(`trying secondary "${dev.label || dev.deviceId.slice(0, 8)}" …`);
      try {
        const s = await withTimeout(
          'getUserMedia#2',
          navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: dev.deviceId } },
          }),
          10000,
        );
        out.streams.push(s);
        const t = s.getVideoTracks()[0];
        if (t) {
          const set = t.getSettings();
          log(`  ok: ${set.width}x${set.height} @ ${set.frameRate ?? '?'}fps`);
        }
        break;
      } catch (err: any) {
        log('  failed: ' + (err?.name || '') + ' ' + (err?.message || err));
      }
    }
  }

  // Try alternative constraints if first call gave nothing.
  if (out.streams.length === 0) {
    for (const facingMode of ['environment', 'user']) {
      log(`fallback: getUserMedia({video:{facingMode:'${facingMode}'}}) …`);
      try {
        const s = await withTimeout(
          'getUserMedia-' + facingMode,
          navigator.mediaDevices.getUserMedia({ video: { facingMode } }),
          10000,
        );
        out.streams.push(s);
        const t = s.getVideoTracks()[0];
        if (t) {
          const set = t.getSettings();
          log(`  ok: label="${t.label}" ${set.width}x${set.height}`);
        }
        break;
      } catch (err: any) {
        log('  failed: ' + (err?.name || '') + ' ' + (err?.message || err));
      }
    }
  }

  log(`=== diagnostic done — got ${out.streams.length} stream(s) ===`);
  return out;
}

export function streamToVideo(stream: MediaStream): HTMLVideoElement {
  const video = document.createElement('video');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.srcObject = stream;
  return video;
}
