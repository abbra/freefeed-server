/* eslint-disable no-await-in-loop */
/* eslint-env node, mocha */
/* global $pg_database */
import expect from 'unexpected';

import cleanDB from '../../../dbCleaner';
import { dbAdapter } from '../../../../app/models';
import { createUser, createUsers } from '../../helpers/users';

describe('Search in accounts', () => {
  beforeEach(() => cleanDB($pg_database));

  describe('Search single account', () => {
    let account;
    beforeEach(async () => {
      account = await createUser('luna');
      await account.update({
        screenName: 'Quick brown fox',
        description: 'jumps over the lazy dog',
      });
    });

    it('should find account by screen name', async () => {
      const foundIds = await dbAdapter.searchInAccounts('quick');
      expect(foundIds, 'to equal', [account.id]);
    });

    it('should find account by description', async () => {
      const foundIds = await dbAdapter.searchInAccounts('lazy');
      expect(foundIds, 'to equal', [account.id]);
    });

    it('should find account by multiple words', async () => {
      const foundIds = await dbAdapter.searchInAccounts('brown fox');
      expect(foundIds, 'to equal', [account.id]);
    });

    it('should find account with in-users scope', async () => {
      const foundIds = await dbAdapter.searchInAccounts('in-users: quick');
      expect(foundIds, 'to equal', [account.id]);
    });

    it('should NOT find account with in-body scope', async () => {
      const foundIds = await dbAdapter.searchInAccounts('in-body: quick');
      expect(foundIds, 'to equal', []);
    });

    it('should NOT find account with in-comments scope', async () => {
      const foundIds = await dbAdapter.searchInAccounts('in-comments: lazy');
      expect(foundIds, 'to equal', []);
    });
  });

  describe('Privacy restrictions', () => {
    let publicUser, protectedUser, privateUser, viewer;

    beforeEach(async () => {
      [publicUser, protectedUser, privateUser, viewer] = await createUsers([
        'luna',
        'mars',
        'venus',
        'jupiter',
      ]);

      await publicUser.update({
        screenName: 'Public Account',
        description: 'searchable content',
      });

      await protectedUser.update({
        screenName: 'Protected Account',
        description: 'searchable content',
        isProtected: '1',
      });

      await privateUser.update({
        screenName: 'Private Account',
        description: 'searchable content',
        isPrivate: '1',
      });
    });

    describe('Anonymous user', () => {
      it('should find public accounts', async () => {
        const foundIds = await dbAdapter.searchInAccounts('searchable');
        expect(foundIds, 'to contain', publicUser.id);
      });

      it('should find protected accounts', async () => {
        const foundIds = await dbAdapter.searchInAccounts('searchable');
        expect(foundIds, 'to contain', protectedUser.id);
      });

      it('should NOT find private accounts', async () => {
        const foundIds = await dbAdapter.searchInAccounts('searchable');
        expect(foundIds, 'not to contain', privateUser.id);
      });
    });

    describe('Authenticated user', () => {
      it('should find public accounts', async () => {
        const foundIds = await dbAdapter.searchInAccounts('searchable', { viewerId: viewer.id });
        expect(foundIds, 'to contain', publicUser.id);
      });

      it('should find protected accounts', async () => {
        const foundIds = await dbAdapter.searchInAccounts('searchable', { viewerId: viewer.id });
        expect(foundIds, 'to contain', protectedUser.id);
      });

      it('should NOT find private accounts if not subscribed', async () => {
        const foundIds = await dbAdapter.searchInAccounts('searchable', { viewerId: viewer.id });
        expect(foundIds, 'not to contain', privateUser.id);
      });

      it('should find private accounts if subscribed', async () => {
        await viewer.subscribeTo(privateUser);
        const foundIds = await dbAdapter.searchInAccounts('searchable', { viewerId: viewer.id });
        expect(foundIds, 'to contain', privateUser.id);
      });

      it('should find private accounts if they are subscribed to viewer', async () => {
        await privateUser.subscribeTo(viewer);
        const foundIds = await dbAdapter.searchInAccounts('searchable', { viewerId: viewer.id });
        expect(foundIds, 'to contain', privateUser.id);
      });

      it('should find private accounts with mutual subscription', async () => {
        await viewer.subscribeTo(privateUser);
        await privateUser.subscribeTo(viewer);
        const foundIds = await dbAdapter.searchInAccounts('searchable', { viewerId: viewer.id });
        expect(foundIds, 'to contain', privateUser.id);
      });
    });
  });

  describe('Search scope handling', () => {
    let user1, user2;

    beforeEach(async () => {
      [user1, user2] = await createUsers(['mercury', 'saturn']);

      await user1.update({
        screenName: 'Searchable Name',
        description: 'first account',
      });

      await user2.update({
        screenName: 'Another Name',
        description: 'second account',
      });
    });

    it('should find accounts only in in-users scope', async () => {
      const foundIds = await dbAdapter.searchInAccounts('in-users: searchable');
      expect(foundIds, 'to equal', [user1.id]);
    });

    it('should find accounts from in-users scope even after switching', async () => {
      const foundIds = await dbAdapter.searchInAccounts('in-users: searchable in-body: account');
      expect(foundIds, 'to equal', [user1.id]);
    });

    it('should NOT find accounts when text is only in other scope', async () => {
      const foundIds = await dbAdapter.searchInAccounts('in-body: searchable');
      expect(foundIds, 'to equal', []);
    });

    it('should find accounts when switching to in-users scope', async () => {
      const foundIds = await dbAdapter.searchInAccounts('in-body: something in-users: searchable');
      expect(foundIds, 'to equal', [user1.id]);
    });
  });

  describe('Sorting by subscribers count', () => {
    let user1, user2, user3, subscriber1, subscriber2, subscriber3;

    beforeEach(async () => {
      [user1, user2, user3, subscriber1, subscriber2, subscriber3] = await createUsers([
        'user1',
        'user2',
        'user3',
        'subscriber1',
        'subscriber2',
        'subscriber3',
      ]);

      await user1.update({
        screenName: 'Findable User One',
        description: 'test account',
      });

      await user2.update({
        screenName: 'Findable User Two',
        description: 'test account',
      });

      await user3.update({
        screenName: 'Findable User Three',
        description: 'test account',
      });
    });

    it('should sort accounts by subscribers count (descending)', async () => {
      // user3 has 3 subscribers
      await subscriber1.subscribeTo(user3);
      await subscriber2.subscribeTo(user3);
      await subscriber3.subscribeTo(user3);

      // user1 has 2 subscribers
      await subscriber1.subscribeTo(user1);
      await subscriber2.subscribeTo(user1);

      // user2 has 1 subscriber
      await subscriber1.subscribeTo(user2);

      const foundIds = await dbAdapter.searchInAccounts('findable');
      expect(foundIds, 'to equal', [user3.id, user1.id, user2.id]);
    });

    it('should handle accounts with no subscribers', async () => {
      // user1 has 1 subscriber
      await subscriber1.subscribeTo(user1);

      // user2 and user3 have no subscribers

      const foundIds = await dbAdapter.searchInAccounts('findable');
      expect(foundIds[0], 'to equal', user1.id);
      expect(foundIds.slice(1), 'to contain', user2.id, user3.id);
    });
  });

  describe('Search in usernames', () => {
    async function createUserWithName(username) {
      const user = await createUser(username);
      await user.update({ screenName: 'something unrelated' });
      return user;
    }

    it('should find accounts by full username', async () => {
      const user = await createUserWithName('luna');
      const foundIds = await dbAdapter.searchInAccounts('luna');
      expect(foundIds, 'to equal', [user.id]);
    });

    it('should find accounts by part of username', async () => {
      const user = await createUserWithName('welovebread');
      const foundIds = await dbAdapter.searchInAccounts('love');
      expect(foundIds, 'to equal', [user.id]);
    });

    it('should use logic in query', async () => {
      const user1 = await createUserWithName('workworkwork');
      const user2 = await createUserWithName('lifelifelife');
      const user3 = await createUserWithName('worklifebalance');

      {
        const foundIds = await dbAdapter.searchInAccounts('work | life');
        expect(foundIds.sort(), 'to equal', [user1.id, user2.id, user3.id].sort());
      }

      {
        const foundIds = await dbAdapter.searchInAccounts('work | life -balance');
        expect(foundIds.sort(), 'to equal', [user1.id, user2.id].sort());
      }

      {
        const foundIds = await dbAdapter.searchInAccounts('work life');
        expect(foundIds.sort(), 'to equal', [user3.id].sort());
      }
    });
  });
});
