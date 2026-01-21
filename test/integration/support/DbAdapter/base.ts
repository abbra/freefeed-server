
import expect from 'unexpected';

import { dbAdapter } from '../../../../app/models';

describe('DbAdapterBase', () => {
  it('should provide access to slonik', async () => {
    const poopPromise = dbAdapter.getSlonik();
    await expect(
      poopPromise,
      'to be fulfilled with value satisfying',
      expect.it('to be an object'),
    );

    const slonik = await poopPromise;
    expect(slonik.state().state, 'to be', 'ACTIVE');
  });
});
