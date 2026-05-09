import { createSystem } from '@iwsdk/core';
import { Texture } from 'three';
import { Cape, setCameraTexture } from './cape.js';

type Eye = 'left' | 'right';

/**
 * Each frame, ask the WebXR Raw Camera Access API for an aligned camera
 * texture for each XRView (eye), inject the WebGL texture handle into a
 * Three.js Texture wrapper, and bind it to the cape material on the matching
 * eye. Per the W3C spec the WebGLTexture returned by getCameraImage is only
 * valid for the current frame, so we re-write the renderer-properties cache
 * every tick rather than allocating new Three textures.
 */
export class RawCameraSystem extends createSystem({}) {
  private cape: Cape | null = null;
  private binding: XRWebGLBinding | null = null;
  private bindingSession: XRSession | null = null;
  private eyeTextures: Record<Eye, Texture | null> = {
    left: null,
    right: null,
  };
  private boundOnMaterial: Record<Eye, boolean> = {
    left: false,
    right: false,
  };
  private warnedNoCamera = false;

  attach(cape: Cape) {
    this.cape = cape;
    this.eyeTextures.left = makeStandinTexture();
    this.eyeTextures.right = makeStandinTexture();
  }

  update() {
    if (!this.cape) return;
    const frame = this.xrFrame;
    if (!frame) return;
    const session = frame.session;
    if (!session) return;

    if (!this.binding || this.bindingSession !== session) {
      this.createBinding(session);
    }
    if (!this.binding) return;

    const refSpace = this.renderer.xr.getReferenceSpace();
    if (!refSpace) return;
    const pose = frame.getViewerPose(refSpace);
    if (!pose) return;

    for (const view of pose.views) {
      const xrCamera = (view as XRView).camera;
      if (!xrCamera) {
        if (!this.warnedNoCamera) {
          console.warn(
            "[WorldTear] view.camera is undefined — 'camera-access' not granted; cape will fall back.",
          );
          this.warnedNoCamera = true;
        }
        continue;
      }

      const glTexture = (this.binding as unknown as XRCameraBinding).getCameraImage(
        xrCamera,
      );
      if (!glTexture) continue;

      const eye: Eye = view.eye === 'right' ? 'right' : 'left';
      const wrapper = this.eyeTextures[eye];
      if (!wrapper) continue;

      this.assignWebGLTexture(wrapper, glTexture, xrCamera.width, xrCamera.height);

      if (!this.boundOnMaterial[eye]) {
        setCameraTexture(this.cape, eye, wrapper);
        this.boundOnMaterial[eye] = true;
      }
    }
  }

  private createBinding(session: XRSession) {
    try {
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      this.binding = new XRWebGLBinding(session, gl);
      this.bindingSession = session;
    } catch (err) {
      console.warn('[WorldTear] failed to create XRWebGLBinding:', err);
      this.binding = null;
      this.bindingSession = null;
    }
  }

  /**
   * Inject a foreign WebGLTexture into a Three.js Texture's renderer-side
   * properties. `__webglInit = true` signals to three's WebGLTextures module
   * that the texture object already exists, so it skips its own allocation
   * and uploads — it just binds whatever handle we put there.
   */
  private assignWebGLTexture(
    tex: Texture,
    glTexture: WebGLTexture,
    width: number,
    height: number,
  ) {
    const props = (this.renderer.properties as any).get(tex);
    props.__webglInit = true;
    props.__webglTexture = glTexture;
    if (
      !tex.image ||
      (tex.image as { width?: number }).width !== width ||
      (tex.image as { height?: number }).height !== height
    ) {
      tex.image = { width, height } as unknown as TexImageSource;
    }
    tex.needsUpdate = false;
  }
}

function makeStandinTexture(): Texture {
  const tex = new Texture();
  tex.flipY = false;
  tex.generateMipmaps = false;
  tex.image = { width: 1, height: 1 } as unknown as TexImageSource;
  return tex;
}
