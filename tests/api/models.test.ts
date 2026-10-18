import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GET } from '@/app/api/assets/models/[file]/route';

const get = (file: string) => GET(new Request(`http://localhost/api/assets/models/${file}`), { params: Promise.resolve({ file }) });
const shipped = readdirSync(join(process.cwd(), 'src/assets/models')).find((name) => name.endsWith('.glb'))!;

describe('the 3D model files', () => {
  it('serves a shipped model as a binary glTF that browsers may keep for good', async () => {
    const response = await get(shipped);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('model/gltf-binary');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect((await response.arrayBuffer()).byteLength).toBe(statSync(join(process.cwd(), 'src/assets/models', shipped)).size);
  });

  it('answers 404 for anything else, including paths that try to leave the folder', async () => {
    for (const file of ['missing.glb', '..%2Fpackage.json', '../package.json', 'models.txt', 'UPPER.glb']) {
      expect((await get(file)).status, file).toBe(404);
    }
  });
});
