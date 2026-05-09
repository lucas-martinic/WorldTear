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

export async function diagnoseCameras(
  log: (msg: string) => void,
): Promise<DiagnosticResult> {
  const out: DiagnosticResult = { streams: [], videoDevices: [], log: '' };
  log('=== camera diagnostic ===');

  let pre = await navigator.mediaDevices.enumerateDevices();
  let preVideo = pre.filter((d) => d.kind === 'videoinput');
  log(`(no perm) ${preVideo.length} videoinput(s):`);
  preVideo.forEach((d, i) =>
    log(
      `  ${i}: label="${d.label || '(empty)'}", id=${d.deviceId.slice(0, 16)}…`,
    ),
  );

  log('calling getUserMedia({video:true}) …');
  let mainStream: MediaStream;
  try {
    mainStream = await navigator.mediaDevices.getUserMedia({ video: true });
  } catch (err: any) {
    log('getUserMedia rejected: ' + (err?.message || err));
    return out;
  }
  out.streams.push(mainStream);
  const mainTrack = mainStream.getVideoTracks()[0];
  if (mainTrack) {
    const s = mainTrack.getSettings();
    log(
      `got primary track: label="${mainTrack.label}", ${s.width}x${s.height} @ ${s.frameRate ?? '?'}fps, deviceId=${(s.deviceId || '').slice(0, 16)}…`,
    );
  }

  const post = await navigator.mediaDevices.enumerateDevices();
  out.videoDevices = post.filter((d) => d.kind === 'videoinput');
  log(`(with perm) ${out.videoDevices.length} videoinput(s):`);
  out.videoDevices.forEach((d, i) =>
    log(
      `  ${i}: label="${d.label || '(empty)'}", id=${d.deviceId.slice(0, 16)}…`,
    ),
  );

  // If there's more than one camera, try to open the second one too (right
  // eye). Skip the one already streaming.
  const primaryId = mainTrack?.getSettings().deviceId;
  const otherDevices = out.videoDevices.filter((d) => d.deviceId !== primaryId);
  for (const dev of otherDevices) {
    log(`trying secondary camera "${dev.label || dev.deviceId.slice(0, 8)}" …`);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: dev.deviceId } },
      });
      out.streams.push(s);
      const t = s.getVideoTracks()[0];
      if (t) {
        const set = t.getSettings();
        log(
          `  ok: ${set.width}x${set.height} @ ${set.frameRate ?? '?'}fps`,
        );
      }
      break; // one secondary is enough
    } catch (err: any) {
      log('  failed: ' + (err?.message || err));
    }
  }

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
