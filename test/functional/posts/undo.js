import { beforeEach, describe, it } from 'mocha';
import expect from 'unexpected';

import { dbAdapter } from '../../../app/models';
import cleanDB from '../../dbCleaner';
import {
  authHeaders,
  createTestUsers,
  justCreateGroup,
  justCreatePost,
  performJSONRequest,
} from '../functional_test_helper';
import { getExpirationIntervalSec, UNDO_POST_DELETE } from '../../../app/support/undo/actions';

describe('Undo post actions', () => {
  beforeEach(() => cleanDB(dbAdapter.database));
  let luna, mars;
  beforeEach(async () => {
    [luna, mars] = await createTestUsers(['luna', 'mars']);
  });

  describe('Undo delete regular post', () => {
    let post;
    beforeEach(async () => {
      post = await justCreatePost(luna, 'Post body');
    });

    it(`should return the 'undo' array in response to DELETE`, async () => {
      const resp = await performJSONRequest(
        'DELETE',
        `/v2/posts/${post.id}`,
        null,
        authHeaders(luna),
      );

      expect(resp, 'to satisfy', {
        __httpCode: 200,
        postStillAvailable: false,
        undo: [
          {
            subject: UNDO_POST_DELETE,
            message: 'You deleted your post',
            extra: { author: 'luna' },
            expiresInSec: getExpirationIntervalSec(UNDO_POST_DELETE),
            token: expect.it('to be a string'),
          },
        ],
      });
    });

    it(`should allow Luna to undo the post deletion`, async () => {
      const {
        undo: [{ token }],
      } = await performJSONRequest('DELETE', `/v2/posts/${post.id}`, null, authHeaders(luna));

      // Post should not be available anymore
      expect(await isPostAvailable(post.id), 'to be false');

      const resp = await performJSONRequest(
        'POST',
        `/v2/undo/${UNDO_POST_DELETE}`,
        { token },
        authHeaders(luna),
      );
      expect(resp, 'to satisfy', { __httpCode: 200, postId: post.id });

      // Post should be available again
      expect(await isPostAvailable(post.id), 'to be true');
    });

    it(`should not allow Mars to use Luna's token`, async () => {
      const {
        undo: [{ token }],
      } = await performJSONRequest('DELETE', `/v2/posts/${post.id}`, null, authHeaders(luna));

      const resp = await performJSONRequest(
        'POST',
        `/v2/undo/${UNDO_POST_DELETE}`,
        { token },
        authHeaders(mars),
      );
      expect(resp, 'to satisfy', { __httpCode: 403, err: 'Invalid or expired undo token' });
    });
  });

  describe('Undo delete group post', () => {
    let post;
    let group;
    beforeEach(async () => {
      group = await justCreateGroup(mars, 'group', 'Group');
      post = await justCreatePost(luna, 'Post body', [group.username]);
    });

    it(`should return the 'undo' array to the group admin in response to DELETE`, async () => {
      const resp = await performJSONRequest(
        'DELETE',
        `/v2/posts/${post.id}`,
        null,
        authHeaders(mars),
      );

      expect(resp, 'to satisfy', {
        __httpCode: 200,
        postStillAvailable: false,
        undo: [
          {
            subject: UNDO_POST_DELETE,
            message: `You deleted luna's post`,
            extra: { author: 'luna' },
            expiresInSec: getExpirationIntervalSec(UNDO_POST_DELETE),
            token: expect.it('to be a string'),
          },
        ],
      });
    });

    it(`should allow group admin to undo the post deletion`, async () => {
      const {
        undo: [{ token }],
      } = await performJSONRequest('DELETE', `/v2/posts/${post.id}`, null, authHeaders(mars));

      // Post should not be available anymore
      expect(await isPostAvailable(post.id), 'to be false');

      const resp = await performJSONRequest(
        'POST',
        `/v2/undo/${UNDO_POST_DELETE}`,
        { token },
        authHeaders(mars),
      );
      expect(resp, 'to satisfy', { __httpCode: 200, postId: post.id });

      // Post should be available again
      expect(await isPostAvailable(post.id), 'to be true');
    });
  });
});

async function isPostAvailable(postId, user) {
  const resp = await performJSONRequest('GET', `/v2/posts/${postId}`, null, authHeaders(user));

  if (resp.__httpCode === 200) {
    return true;
  }

  if (resp.__httpCode === 404) {
    return false;
  }

  throw new Error(`Unexpected response: ${JSON.stringify(resp)}`);
}
