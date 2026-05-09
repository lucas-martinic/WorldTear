// Minimal type augmentations for the WebXR Raw Camera Access API.
// Quest browser implements these but they are not yet in the default
// TypeScript DOM lib.

export {};

declare global {
  interface XRView {
    readonly camera?: XRCamera;
  }

  interface XRCamera {
    readonly width: number;
    readonly height: number;
  }

  /**
   * Subset of XRWebGLBinding extended with the camera-access method. We use
   * this via cast (`binding as XRCameraBinding`) because TypeScript's built-in
   * XRWebGLBinding doesn't include getCameraImage and the global is not
   * augmentable here.
   */
  interface XRCameraBinding {
    getCameraImage(camera: XRCamera): WebGLTexture | null;
  }
}
