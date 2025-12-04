/* eslint-env node, mocha */
/* global $pg_database */
import expect from 'unexpected';

import cleanDB from '../../../dbCleaner';
import { dbAdapter } from '../../../../app/models';
import { createUser, createUsers } from '../../helpers/users';
import { createPost } from '../../helpers/posts-and-comments';

describe('sparseMatchesHashtags', () => {
  before(() => cleanDB($pg_database));

  let user1, user2;

  before(async () => {
    [user1, user2] = await createUsers(['luna', 'mars']);
  });

  describe('basic matching', () => {
    before(async () => {
      // Create posts with various hashtags
      await createPost(user1, 'Hello #world #programming #javascript');
      await createPost(user1, 'More #javascript #coding');
      await createPost(user2, 'Test #Python #programming');

      // Refresh materialized views
      await dbAdapter.refreshHashtagStats();
    });

    it('should find hashtags matching "p"', async () => {
      const names = await dbAdapter.sparseMatchesHashtags('p', user1.id);
      expect(names, 'to contain', 'programming', 'python');
    });

    it('should find hashtags matching "pr"', async () => {
      const names = await dbAdapter.sparseMatchesHashtags('pr', user1.id);
      expect(names, 'to contain', 'programming');
      expect(names, 'not to contain', 'python');
    });

    it('should find hashtags matching "js" (sparse)', async () => {
      const names = await dbAdapter.sparseMatchesHashtags('js', user1.id);
      expect(names, 'to contain', 'javascript');
    });

    it('should return empty array for empty query', async () => {
      const names = await dbAdapter.sparseMatchesHashtags('', user1.id);
      expect(names, 'to equal', []);
    });

    it('should return empty array for query with only special chars', async () => {
      const names = await dbAdapter.sparseMatchesHashtags('###', user1.id);
      expect(names, 'to equal', []);
    });
  });

  describe('visibility rules', () => {
    let user3;

    before(async () => {
      user3 = await createUser('venus');

      // user3 becomes private and creates a post with unique hashtag
      await user3.update({ isPrivate: '1', isProtected: '1' });
      await createPost(user3, 'Secret #privatetag');

      await dbAdapter.refreshHashtagStats();
    });

    after(() => user3.update({ isPrivate: '0', isProtected: '0' }));

    it('should not show private hashtags to other users', async () => {
      const names = await dbAdapter.sparseMatchesHashtags('privatetag', user1.id);
      expect(names, 'not to contain', 'privatetag');
    });

    it('should show private hashtags to the owner', async () => {
      const names = await dbAdapter.sparseMatchesHashtags('privatetag', user3.id);
      expect(names, 'to contain', 'privatetag');
    });
  });

  describe('prioritization', () => {
    let user4;

    before(async () => {
      user4 = await createUser('jupiter');

      // user1 uses #FreeFeed many times
      await createPost(user1, '#FreeFeed is great');
      await createPost(user1, '#FreeFeed rocks');
      await createPost(user1, '#FreeFeed forever');

      // user4 uses #freefeed (lowercase) once
      await createPost(user4, 'I like #freefeed');

      await dbAdapter.refreshHashtagStats();
    });

    it('should prioritize own hashtag variant over more popular one', async () => {
      // user4 should see their own variant first
      const names = await dbAdapter.sparseMatchesHashtags('freefeed', user4.id);
      expect(names[0], 'to equal', 'freefeed');
    });

    it('should show most popular variant for users without own usage', async () => {
      // user2 has no freefeed usage, should see most popular
      const names = await dbAdapter.sparseMatchesHashtags('freefeed', user2.id);
      expect(names, 'to have length', 1);
    });
  });
});
