import { beforeEach, describe, it } from 'mocha';
import unexpected from 'unexpected';
import unexpectedDate from 'unexpected-date';

import cleanDB from '../../../dbCleaner';
import { dbAdapter, Group, User } from '../../../../app/models';
import { createGroup, createUser } from '../../helpers/users';

const expect = unexpected.clone();
expect.use(unexpectedDate);

describe('User model', () => {
  describe('First interaction', () => {
    beforeEach(() => cleanDB(dbAdapter.database));

    let luna: User;
    let selenites: Group;
    beforeEach(async () => {
      luna = await createUser('luna');
      selenites = await createGroup('selenites', luna);
    });

    it(`should create user with nullified 'firstInteractionAt'`, () => {
      expect(luna, 'to satisfy', {
        firstInteractionAt: null,
      });
    });

    it(`should update the 'firstInteractionAt' field`, async () => {
      const [ok, now] = await Promise.all([luna.setFirstInteraction(), dbAdapter.now()]);
      expect(ok, 'to be', true);
      expect(luna, 'to satisfy', { firstInteractionAt: expect.it('to be close to', now) });
    });

    it(`should not update the 'firstInteractionAt' twice`, async () => {
      const ok1 = await luna.setFirstInteraction();
      const ok2 = await luna.setFirstInteraction();
      expect(ok1, 'to be', true);
      expect(ok2, 'to be', false);
    });

    it(`should not update the 'firstInteractionAt' field of a group`, async () => {
      const ok = await selenites.setFirstInteraction();
      expect(ok, 'to be', false);
    });
  });
});
