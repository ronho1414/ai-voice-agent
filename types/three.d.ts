declare module "three" {
  export const SRGBColorSpace: string;
  export const AdditiveBlending: number;
  export const DoubleSide: number;

  export class Vector3 {
    x: number;
    y: number;
    z: number;
    constructor(x?: number, y?: number, z?: number);
    set(x: number, y: number, z: number): this;
    copy(vector: Vector3): this;
    lerp(vector: Vector3, alpha: number): this;
  }

  export class Color {
    constructor(color?: number);
  }

  export interface Texture {
    colorSpace: string;
    dispose(): void;
  }

  export class TextureLoader {
    setCrossOrigin(origin: string): this;
    load(url: string): Texture;
  }

  export class CanvasTexture implements Texture {
    colorSpace: string;
    constructor(canvas: HTMLCanvasElement);
    dispose(): void;
  }

  export class SphereGeometry {
    constructor(radius?: number, widthSegments?: number, heightSegments?: number);
    dispose(): void;
  }

  export interface Material {
    dispose(): void;
  }

  export class MeshPhongMaterial implements Material {
    constructor(parameters?: Record<string, unknown>);
    dispose(): void;
  }

  export class SpriteMaterial implements Material {
    constructor(parameters?: Record<string, unknown>);
    dispose(): void;
  }

  export class Object3D {
    position: Vector3;
    scale: Vector3;
    rotation: { x: number; y: number; z: number };
    add(...objects: Object3D[]): this;
    traverse(callback: (object: Object3D) => void): void;
  }

  export class Group extends Object3D {}
  export class Scene extends Object3D {}

  export class Mesh extends Object3D {
    geometry: { dispose(): void };
    material: Material | Material[];
    constructor(geometry: SphereGeometry, material: Material);
  }

  export class Sprite extends Object3D {
    material: Material;
    constructor(material: SpriteMaterial);
  }

  export class Light extends Object3D {
    constructor(color?: number, intensity?: number);
  }

  export class AmbientLight extends Light {}
  export class DirectionalLight extends Light {}

  export class PerspectiveCamera {
    aspect: number;
    position: Vector3;
    constructor(fov?: number, aspect?: number, near?: number, far?: number);
    updateProjectionMatrix(): void;
  }

  export class WebGLRenderer {
    constructor(parameters?: Record<string, unknown>);
    domElement: HTMLCanvasElement;
    setPixelRatio(value: number): void;
    setSize(width: number, height: number, updateStyle?: boolean): void;
    render(scene: Scene, camera: PerspectiveCamera): void;
    getContext(): WebGLRenderingContext | WebGL2RenderingContext;
    dispose(): void;
  }
}
