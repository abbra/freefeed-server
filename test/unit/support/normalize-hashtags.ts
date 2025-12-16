import { describe, it } from 'mocha';
import expect from 'unexpected';

import { normalizeHashtag } from '../../../app/support/normalize-hashtags';

describe('normalizeHashtag', () => {
  const testData = [
    { input: 'abc', output: 'abc' },
    { input: ' abc  ', output: 'abc' },
    { input: '?a==bc!', output: 'abc' },
    { input: 'ёж', output: 'еж' },
    { input: 'ﬁn', output: 'fin' },
    {
      input: 'mazačka',
      output: 'mazacka',
    },
  ];

  for (const { input, output } of testData) {
    it(`should normalize "${input}" to "${output}"`, () => {
      const res = normalizeHashtag(input);
      expect(res, 'to be', output);
    });
  }
});
