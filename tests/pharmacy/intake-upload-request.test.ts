import { describe, expect, it } from 'vitest';
import { INTAKE_BODY_MAX_BYTES, readIntakeUpload } from '@/server/pharmacy/intake/upload-request';

const post = (form: FormData, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/pharmacy/intake/files', { method: 'POST', body: form, headers });
const png = (size = 11) => new File([Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size - 8, 1)])], 'invoice.png', { type: 'image/png' });
const formWith = (file: File | null, fields: Record<string, string> = { restaurantId: 'r1', branchId: 'b1', batchId: 'batch1', clientKey: 'upload-key-1' }) => {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  if (file) form.set('file', file);
  return form;
};

describe('readIntakeUpload', () => {
  it('turns the form into the input of ph.intake.file.add, without keeping the file’s name', async () => {
    const input = await readIntakeUpload(post(formWith(png())));
    expect(input).toMatchObject({ restaurantId: 'r1', branchId: 'b1', batchId: 'batch1', clientKey: 'upload-key-1', mediaType: 'image/png' });
    expect((input as { base64: string }).base64).toBe(Buffer.from(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(3, 1)])).toString('base64'));
    expect(JSON.stringify(input)).not.toContain('invoice.png');
  });

  it('takes exactly 8 MB and refuses one byte more with the same answer the service gives', async () => {
    const eight = 8 * 1024 * 1024;
    await expect(readIntakeUpload(post(formWith(png(eight))))).resolves.toMatchObject({ mediaType: 'image/png' });
    await expect(readIntakeUpload(post(formWith(png(eight + 1))))).rejects.toMatchObject({ code: 'INVALID', fields: { phCode: 'TOO_LARGE' } });
  });

  it('cuts a body off by its declared length before reading it', async () => {
    await expect(readIntakeUpload(post(formWith(png()), { 'content-length': String(INTAKE_BODY_MAX_BYTES + 1) }))).rejects.toMatchObject({ code: 'INVALID', fields: { phCode: 'TOO_LARGE' } });
  });

  it('refuses a body that is not a form, a form without a file, and an empty file', async () => {
    await expect(readIntakeUpload(new Request('http://localhost/x', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }))).rejects.toMatchObject({ code: 'INVALID' });
    await expect(readIntakeUpload(post(formWith(null)))).rejects.toMatchObject({ code: 'INVALID' });
    await expect(readIntakeUpload(post(formWith(new File([], 'empty.png', { type: 'image/png' }))))).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('leaves the type check to the service: any declared type passes through', async () => {
    const input = await readIntakeUpload(post(formWith(new File(['<html></html>'], 'x.png', { type: 'image/png' }))));
    expect(input).toMatchObject({ mediaType: 'image/png' });
  });
});
