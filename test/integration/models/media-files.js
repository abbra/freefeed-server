import { join } from 'path';
import { readFileSync } from 'fs';

import { describe, it } from 'mocha';
import expect from 'unexpected';

import { detectMediaType } from '../../../app/support/media-files/detect';
import { nodeDirname } from '../../../app/support/node-dirname';

const __dirname = nodeDirname(import.meta.url);
const samplesDir = join(__dirname, '../../fixtures/media-files');
const filesData = JSON.parse(readFileSync(join(samplesDir, 'file-info.json'), 'utf8'));

describe('Media files', () => {
  for (const file of filesData) {
    const { file: fileName, info } = file;
    it(`should detect media info for ${fileName}`, async () => {
      const detected = await detectMediaType(join(samplesDir, fileName), fileName);

      if (info.duration) {
        // Different FFmpeg versions may report slightly different durations, so
        // we allow a small delta
        const d = info.duration;
        info.duration = expect.it('to be close to', d, 0.1);
      }

      expect(detected, 'to satisfy', info);
    });
  }
});
