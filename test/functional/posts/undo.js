import { beforeEach, describe, it } from 'mocha';
import expect from 'unexpected';

import { dbAdapter, PubSub } from '../../../app/models';
import cleanDB from '../../dbCleaner';
import {
  authHeaders,
  createTestUsers,
  justCreateGroup,
  justCreatePost,
  performJSONRequest,
} from '../functional_test_helper';
import { getExpirationIntervalSec, UNDO_POST_DELETE } from '../../../app/support/undo/actions';
import { getSingleton } from '../../../app/app';
import { eventNames, PubSubAdapter } from '../../../app/support/PubSubAdapter';
import { connect as redisConnect } from '../../../app/setup/database';
import Session from '../realtime-session';

describe('Undo post actions', () => {
  beforeEach(() => cleanDB(dbAdapter.database));
  /**
   * @type {import('../functional_test_helper').UserCtx}
   */
  let luna;
  /**
   * @type {import('../functional_test_helper').UserCtx}
   */
  let mars;
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
      // Someone listens to Luna's posts feed
      const lunaPostsFeed = await luna.user.getPostsTimeline();

      const app = await getSingleton();
      const port = process.env.PEPYATKA_SERVER_PORT || app.context.config.port;
      const pubsubAdapter = new PubSubAdapter(redisConnect());
      PubSub.setPublisher(pubsubAdapter);
      const rtSession = await Session.create(port, 'Luna session');
      await rtSession.sendAsync('subscribe', { timeline: [lunaPostsFeed.id] });

      rtSession.clearCollected();
      const {
        undo: [{ token }],
      } = await performJSONRequest('DELETE', `/v2/posts/${post.id}`, null, authHeaders(luna));

      expect(await rtSession.haveCollected(eventNames.POST_DESTROYED), 'to satisfy', {
        meta: { postId: post.id },
      });

      // Post should not be available anymore
      expect(await isPostAvailable(post.id), 'to be false');

      rtSession.clearCollected();
      const resp = await performJSONRequest(
        'POST',
        `/v2/undo/${UNDO_POST_DELETE}`,
        { token },
        authHeaders(luna),
      );
      expect(resp, 'to satisfy', { __httpCode: 200, postId: post.id });
      expect(await rtSession.haveCollected(eventNames.POST_CREATED), 'to satisfy', {
        posts: { id: post.id },
      });

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
