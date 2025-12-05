/* eslint-env node, mocha */

import expect from 'unexpected';

import cleanDB from '../dbCleaner';
import { dbAdapter } from '../../app/models';

import {
  authHeaders,
  createTestUsers,
  performJSONRequest,
  createAndReturnPost,
  goPrivate,
} from './functional_test_helper';

/* global $pg_database */
describe('hashtags sparseMatches', () => {
  before(() => cleanDB($pg_database));

  let luna, mars;

  before(async () => {
    [luna, mars] = await createTestUsers(['luna', 'mars']);

    // Create posts with hashtags
    await createAndReturnPost(luna, 'Hello #world #programming');
    await createAndReturnPost(luna, 'More #javascript #coding');
    await createAndReturnPost(mars, 'Test #Python #programming');

    // Refresh materialized views
    await dbAdapter.refreshHashtagStats();
  });

  it('should not allow to search as anonymous', async () => {
    const result = await performJSONRequest('GET', '/v2/hashtags/sparseMatches', null);
    expect(result, 'to satisfy', { __httpCode: 401 });
  });

  it('should return empty array for empty query', async () => {
    const result = await performJSONRequest(
      'GET',
      '/v2/hashtags/sparseMatches',
      null,
      authHeaders(luna),
    );
    expect(result, 'to satisfy', { __httpCode: 200, hashtags: [] });
  });

  it('should return empty array for query with only special chars', async () => {
    const result = await performJSONRequest(
      'GET',
      '/v2/hashtags/sparseMatches?qs=%23%23%23',
      null,
      authHeaders(luna),
    );
    expect(result, 'to satisfy', { __httpCode: 200, hashtags: [] });
  });

  it('should find hashtags matching "pr"', async () => {
    const result = await performJSONRequest(
      'GET',
      '/v2/hashtags/sparseMatches?qs=pr',
      null,
      authHeaders(luna),
    );
    expect(result, 'to satisfy', { __httpCode: 200 });
    const names = result.hashtags.map((h) => h.name);
    expect(names, 'to contain', 'programming');
    expect(names, 'not to contain', 'python');
  });

  it('should find hashtags matching "p"', async () => {
    const result = await performJSONRequest(
      'GET',
      '/v2/hashtags/sparseMatches?qs=p',
      null,
      authHeaders(luna),
    );
    expect(result, 'to satisfy', { __httpCode: 200 });
    const names = result.hashtags.map((h) => h.name);
    expect(names, 'to contain', 'programming', 'python');
  });

  it('should find hashtags with sparse matching "js"', async () => {
    const result = await performJSONRequest(
      'GET',
      '/v2/hashtags/sparseMatches?qs=js',
      null,
      authHeaders(luna),
    );
    expect(result, 'to satisfy', { __httpCode: 200 });
    const names = result.hashtags.map((h) => h.name);
    expect(names, 'to contain', 'javascript');
  });

  describe('visibility rules', () => {
    let venus;

    before(async () => {
      [venus] = await createTestUsers(['venus']);

      // Venus becomes private and creates a post with unique hashtag
      await goPrivate(venus);
      await createAndReturnPost(venus, 'Secret #privatetag');

      await dbAdapter.refreshHashtagStats();
    });

    it('should not show private hashtags to other users', async () => {
      const result = await performJSONRequest(
        'GET',
        '/v2/hashtags/sparseMatches?qs=privatetag',
        null,
        authHeaders(luna),
      );
      expect(result, 'to satisfy', { __httpCode: 200 });
      const names = result.hashtags.map((h) => h.name);
      expect(names, 'not to contain', 'privatetag');
    });

    it('should show private hashtags to the owner', async () => {
      const result = await performJSONRequest(
        'GET',
        '/v2/hashtags/sparseMatches?qs=privatetag',
        null,
        authHeaders(venus),
      );
      expect(result, 'to satisfy', { __httpCode: 200 });
      const names = result.hashtags.map((h) => h.name);
      expect(names, 'to contain', 'privatetag');
    });
  });

  describe('is_own flag', () => {
    let jupiter;

    before(async () => {
      [jupiter] = await createTestUsers(['jupiter']);

      // Luna uses #FreeFeed many times
      await createAndReturnPost(luna, '#FreeFeed is great');
      await createAndReturnPost(luna, '#FreeFeed rocks');
      await createAndReturnPost(luna, '#FreeFeed forever');

      // Jupiter uses #freefeed (lowercase) once
      await createAndReturnPost(jupiter, 'I like #freefeed');

      await dbAdapter.refreshHashtagStats();
    });

    it('should return is_own=true for hashtags used by the user', async () => {
      const result = await performJSONRequest(
        'GET',
        '/v2/hashtags/sparseMatches?qs=freefeed',
        null,
        authHeaders(jupiter),
      );
      expect(result, 'to satisfy', { __httpCode: 200 });
      expect(result.hashtags, 'to have length', 1);
      expect(result.hashtags[0].is_own, 'to be true');
    });

    it('should return is_own=false for hashtags not used by the user', async () => {
      const result = await performJSONRequest(
        'GET',
        '/v2/hashtags/sparseMatches?qs=freefeed',
        null,
        authHeaders(mars),
      );
      expect(result, 'to satisfy', { __httpCode: 200 });
      expect(result.hashtags, 'to have length', 1);
      expect(result.hashtags[0].is_own, 'to be false');
    });

    it('should return most popular variant (FreeFeed not freefeed)', async () => {
      const result = await performJSONRequest(
        'GET',
        '/v2/hashtags/sparseMatches?qs=freefeed',
        null,
        authHeaders(mars),
      );
      expect(result, 'to satisfy', { __httpCode: 200 });
      expect(result.hashtags[0].name, 'to equal', 'freefeed');
    });
  });
});
