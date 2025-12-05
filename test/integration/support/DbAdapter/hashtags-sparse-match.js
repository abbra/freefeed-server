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
      const result = await dbAdapter.sparseMatchesHashtags('p', user1.id);
      const names = result.map((h) => h.name);
      expect(names, 'to contain', 'programming', 'python');
    });

    it('should find hashtags matching "pr"', async () => {
      const result = await dbAdapter.sparseMatchesHashtags('pr', user1.id);
      const names = result.map((h) => h.name);
      expect(names, 'to contain', 'programming');
      expect(names, 'not to contain', 'python');
    });

    it('should find hashtags matching "js" (sparse)', async () => {
      const result = await dbAdapter.sparseMatchesHashtags('js', user1.id);
      const names = result.map((h) => h.name);
      expect(names, 'to contain', 'javascript');
    });

    it('should return empty array for empty query', async () => {
      const result = await dbAdapter.sparseMatchesHashtags('', user1.id);
      expect(result, 'to equal', []);
    });

    it('should return empty array for query with only special chars', async () => {
      const result = await dbAdapter.sparseMatchesHashtags('###', user1.id);
      expect(result, 'to equal', []);
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
      const result = await dbAdapter.sparseMatchesHashtags('privatetag', user1.id);
      const names = result.map((h) => h.name);
      expect(names, 'not to contain', 'privatetag');
    });

    it('should show private hashtags to the owner', async () => {
      const result = await dbAdapter.sparseMatchesHashtags('privatetag', user3.id);
      const names = result.map((h) => h.name);
      expect(names, 'to contain', 'privatetag');
    });
  });

  describe('is_own flag', () => {
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

    it('should return is_own=true for hashtags used by the user', async () => {
      const result = await dbAdapter.sparseMatchesHashtags('freefeed', user4.id);
      expect(result, 'to have length', 1);
      expect(result[0].is_own, 'to be true');
    });

    it('should return is_own=false for hashtags not used by the user', async () => {
      const result = await dbAdapter.sparseMatchesHashtags('freefeed', user2.id);
      expect(result, 'to have length', 1);
      expect(result[0].is_own, 'to be false');
    });

    it('should return most popular variant', async () => {
      const result = await dbAdapter.sparseMatchesHashtags('freefeed', user2.id);
      expect(result[0].name, 'to equal', 'freefeed');
    });
  });
});
