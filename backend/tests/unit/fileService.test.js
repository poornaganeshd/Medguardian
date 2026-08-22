'use strict';

const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

const fileService = require('../../src/services/fileService');
const { config } = require('../../src/config/env');

const medicinesDir = path.join(config.uploads.dir, 'medicines');

async function writeTestImage(filename, { width = 900, height = 600 } = {}) {
  await fs.mkdir(medicinesDir, { recursive: true });
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 220, g: 90, b: 90 } }
  })
    .jpeg()
    .toBuffer();
  const target = path.join(medicinesDir, filename);
  await fs.writeFile(target, buffer);
  return { filename, size: buffer.length };
}

describe('fileService.resolveStoredPath', () => {
  it('resolves a plain filename inside the upload directory', () => {
    const resolved = fileService.resolveStoredPath('medicines', 'abc.webp');
    expect(resolved).toBe(path.join(medicinesDir, 'abc.webp'));
  });

  it.each([
    '../../../etc/passwd',
    '..%2f..%2fetc',
    '/etc/passwd',
    '..',
    'sub/dir/file.webp',
    'file name.webp',
    '',
    'a\u0000b.webp'
  ])(
    'refuses path traversal attempt %s',
    (candidate) => {
      expect(() => fileService.resolveStoredPath('medicines', candidate)).toThrow(
        /Invalid file path/
      );
    }
  );
});

describe('fileService.processMedicineImage', () => {
  const created = [];

  afterAll(async () => {
    await Promise.all(created.map((f) => fileService.removeStoredFile('medicines', f)));
  });

  it('produces a normalised webp plus a square thumbnail and removes the original', async () => {
    const upload = await writeTestImage(`test-${Date.now()}.jpg`);
    const result = await fileService.processMedicineImage(upload);
    created.push(result.filename);

    expect(result.filename).toMatch(/\.webp$/);
    expect(result.thumbnailFilename).toMatch(/-thumb\.webp$/);
    expect(result.size).toBeGreaterThan(0);

    expect(await fileService.fileExists('medicines', upload.filename)).toBe(false);
    expect(await fileService.fileExists('medicines', result.filename)).toBe(true);
    expect(await fileService.fileExists('medicines', result.thumbnailFilename)).toBe(true);

    const thumbMeta = await sharp(
      fileService.resolveStoredPath('medicines', result.thumbnailFilename)
    ).metadata();
    expect(thumbMeta.width).toBe(320);
    expect(thumbMeta.height).toBe(320);
    expect(thumbMeta.format).toBe('webp');
  });

  it('caps very large images to 1024px on the longest edge', async () => {
    const upload = await writeTestImage(`big-${Date.now()}.jpg`, { width: 2400, height: 1200 });
    const result = await fileService.processMedicineImage(upload);
    created.push(result.filename);

    const meta = await sharp(
      fileService.resolveStoredPath('medicines', result.filename)
    ).metadata();
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(512);
  });

  it('strips EXIF metadata from the stored image', async () => {
    const upload = await writeTestImage(`exif-${Date.now()}.jpg`);
    const result = await fileService.processMedicineImage(upload);
    created.push(result.filename);

    const meta = await sharp(
      fileService.resolveStoredPath('medicines', result.filename)
    ).metadata();
    expect(meta.exif).toBeUndefined();
  });

  it('rejects a file that is not an image', async () => {
    await fs.mkdir(medicinesDir, { recursive: true });
    const filename = `not-an-image-${Date.now()}.jpg`;
    await fs.writeFile(path.join(medicinesDir, filename), 'this is plain text');
    await expect(fileService.processMedicineImage({ filename })).rejects.toThrow();
    await fileService.removeStoredFile('medicines', filename);
  });
});

describe('fileService.removeStoredFile', () => {
  it('is a no-op for a missing file', async () => {
    await expect(
      fileService.removeStoredFile('medicines', 'does-not-exist.webp')
    ).resolves.toBeUndefined();
  });

  it('ignores an empty filename', async () => {
    await expect(fileService.removeStoredFile('medicines', '')).resolves.toBeUndefined();
  });
});
