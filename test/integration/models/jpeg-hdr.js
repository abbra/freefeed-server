import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { describe, it } from 'mocha';
import expect from 'unexpected';
import { exiftoolPath } from 'exiftool-vendored';

import { nodeDirname } from '../../../app/support/node-dirname';
import { runImageMagick } from '../../../app/support/image-magick';
import { spawnAsync } from '../../../app/support/spawn-async';
import {
  createJpegHdrPreview,
  inspectJpegHdrPreview,
} from '../../../app/support/media-files/jpeg-hdr';

const __dirname = nodeDirname(import.meta.url);

describe('JPEG HDR previews', () => {
  const sourcePath = join(
    __dirname,
    '../../fixtures/media-files/Ultra_HDR_Samples_Originals_01.jpg',
  );

  it('should create a valid clean Ultra HDR JPEG preview', async () => {
    const workDir = await mkdtemp(join(tmpdir(), 'freefeed-hdr-'));

    try {
      const targetPath = join(workDir, 'preview.jpg');
      const created = await createJpegHdrPreview({
        sourcePath,
        targetPath,
        width: 1020,
        height: 768,
        quality: 95,
      });

      expect(created, 'to be true');

      const info = await inspectJpegHdrPreview(targetPath);
      expect(info, 'to satisfy', {
        numberOfImages: 2,
        mpImage2Length: expect.it('to be greater than', 0),
        directoryItemLength: expect.it('to be greater than', 0),
        gainMapImageLength: expect.it('to be greater than', 0),
        iccProfileDescription: 'Display P3',
        validate: 'OK',
        warnings: [],
      });
      expect(info.mpImage2Length, 'to be', info.directoryItemLength);
      expect(info.gainMapImageLength, 'to be', info.directoryItemLength);

      const { stdout: dimensions } = await runImageMagick('identify', [
        '-format',
        '%w %h %[profiles]',
        targetPath,
      ]);
      expect(dimensions, 'to be', '1020 768 icc,mpf,xmp');

      const { stdout: metadata } = await spawnAsync(await exiftoolPath(), [
        '-G1',
        '-a',
        '-s',
        '-GPS:all',
        '-EXIF:all',
        targetPath,
      ]);
      expect(metadata, 'not to contain', '[GPS]');
      expect(metadata, 'not to contain', '[ExifIFD]');
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
