import {
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  type WebGLRenderer,
} from 'three';

/**
 * A small photographic studio, built from emissive panels and baked into an environment map on the
 * GPU: no files, no network. Glossy things reflect the long soft highlights of softboxes instead of
 * a blank room, which is most of what makes a product render look expensive.
 */
export function installStudio(gl: WebGLRenderer, scene: Scene, intensity = 1): () => void {
  const studio = new Scene();
  studio.background = new Color('#0b0a09');
  const geometries: PlaneGeometry[] = [];
  const materials: MeshBasicMaterial[] = [];

  const panel = (
    width: number,
    height: number,
    position: [number, number, number],
    color: string,
    power: number,
  ) => {
    const geometry = new PlaneGeometry(width, height);
    const material = new MeshBasicMaterial({ color: new Color(color).multiplyScalar(power), side: DoubleSide });
    const mesh = new Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.lookAt(0, 0.5, 0);
    studio.add(mesh);
    geometries.push(geometry);
    materials.push(material);
  };

  panel(9, 5, [0, 6, 0.5], '#fff4e2', 6.5); // overhead softbox
  panel(1.4, 7, [-5.5, 2.2, 3], '#ffe2b8', 5); // warm key strip
  panel(1.1, 6, [5.5, 1.8, 2], '#e8f0ff', 2.4); // cool fill strip
  panel(8, 1.2, [0, 3.2, -7], '#fff7ea', 4); // rim from behind
  panel(12, 12, [0, -2.5, 0], '#d6bc8a', 0.5); // warm floor bounce
  panel(3, 3, [3.5, 0.6, -4], '#ffd9a0', 2.2); // small accent

  const generator = new PMREMGenerator(gl);
  const target = generator.fromScene(studio, 0.02);
  const previous = scene.environment;
  const previousIntensity = scene.environmentIntensity;
  scene.environment = target.texture;
  scene.environmentIntensity = intensity;

  return () => {
    scene.environment = previous;
    scene.environmentIntensity = previousIntensity;
    target.dispose();
    generator.dispose();
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
  };
}
