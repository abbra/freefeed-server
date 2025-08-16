/* eslint-env node, mocha */
/* global $database, $pg_database */
import expect from 'unexpected';

import cleanDB from '../dbCleaner';
import { getSingleton } from '../../app/app';
import { DummyPublisher } from '../../app/pubsub';
import { dbAdapter, PubSub } from '../../app/models';
import { PubSubAdapter } from '../../app/support/PubSubAdapter';

import Session from './realtime-session';
import {
  createTestUsers,
  createTestUser,
  mutualSubscriptions,
  performJSONRequest,
  authHeaders,
  justCreatePost,
  justCreateGroup,
  getUserFeed,
  getRiverOfNews,
} from './functional_test_helper';

describe('Pins (v2)', () => {
  let app;
  let port;

  before(async () => {
    app = await getSingleton();
    port = process.env.PEPYATKA_SERVER_PORT || app.context.config.port;
    PubSub.setPublisher(new DummyPublisher());
  });

  beforeEach(() => cleanDB($pg_database));

  describe('API rights and validation', () => {
    let luna, mars, venus;
    beforeEach(async () => {
      [luna, mars, venus] = await createTestUsers(['luna', 'mars', 'venus']);
    });

    it('author can pin/unpin to profile', async () => {
      const post = await justCreatePost(luna, 'Hello');

      const pinResp = await performJSONRequest(
        'POST',
        `/v2/posts/${post.id}/pin`,
        {},
        authHeaders(luna),
      );

      expect(pinResp, 'to satisfy', {
        __httpCode: 200,
        posts: { id: post.id, isPinned: true, pinnedIn: expect.it('to contain', luna.user.id) },
      });

      const rows = await dbAdapter
        .database('pinned_posts')
        .select('*')
        .where({ user_id: luna.user.id, post_id: post.id });
      expect(rows, 'to have length', 1);
      expect(rows[0].pinned_by, 'to equal', luna.user.id);

      const unpinResp = await performJSONRequest(
        'POST',
        `/v2/posts/${post.id}/unpin`,
        {},
        authHeaders(luna),
      );

      expect(unpinResp, 'to satisfy', { __httpCode: 200, posts: { id: post.id } });
      const rows2 = await dbAdapter
        .database('pinned_posts')
        .select('*')
        .where({ user_id: luna.user.id, post_id: post.id });
      expect(rows2, 'to have length', 0);
    });

    it('non-author cannot pin to profile', async () => {
      const post = await justCreatePost(luna, 'Hello');
      const pinResp = await performJSONRequest(
        'POST',
        `/v2/posts/${post.id}/pin`,
        {},
        authHeaders(mars),
      );
      expect(pinResp, 'to satisfy', { __httpCode: 403 });
    });

    describe('Pin to group by group admin', () => {
      let group, post;
      beforeEach(async () => {
        group = await justCreateGroup(mars, 'celestials', 'Celestials');
        // Make sure Luna can post to the group
        await mutualSubscriptions([luna, mars]);
        post = await justCreatePost(luna, 'Group post', [luna.username, group.username]);
      });

      it('admin can pin/unpin to group', async () => {
        const pinResp = await performJSONRequest(
          'POST',
          `/v2/posts/${post.id}/pin`,
          { owner: group.id },
          authHeaders(mars),
        );
        expect(pinResp, 'to satisfy', {
          __httpCode: 200,
          posts: { id: post.id, pinnedIn: expect.it('to contain', group.id) },
        });

        const rows = await dbAdapter
          .database('pinned_posts')
          .select('*')
          .where({ user_id: group.id, post_id: post.id });
        expect(rows, 'to have length', 1);
        expect(rows[0].pinned_by, 'to equal', mars.user.id);

        const unpinResp = await performJSONRequest(
          'POST',
          `/v2/posts/${post.id}/unpin`,
          { owner: group.id },
          authHeaders(mars),
        );
        expect(unpinResp, 'to satisfy', { __httpCode: 200 });
        const rows2 = await dbAdapter
          .database('pinned_posts')
          .select('*')
          .where({ user_id: group.id, post_id: post.id });
        expect(rows2, 'to have length', 0);
      });

      it('non-admin cannot pin to group', async () => {
        const pinResp = await performJSONRequest(
          'POST',
          `/v2/posts/${post.id}/pin`,
          { owner: group.id },
          authHeaders(venus),
        );
        expect(pinResp, 'to satisfy', { __httpCode: 403 });
      });

      it('cannot pin to unrelated group', async () => {
        const other = await justCreateGroup(mars, 'orbits', 'Orbits');
        const pinResp = await performJSONRequest(
          'POST',
          `/v2/posts/${post.id}/pin`,
          { owner: other.id },
          authHeaders(mars),
        );
        expect(pinResp, 'to satisfy', { __httpCode: 403 });
      });
    });

    describe('App token scopes', () => {
      it('token without manage-posts cannot pin/unpin, with manage-posts can', async () => {
        const post = await justCreatePost(luna, 'Hello');
        const tokenNo = await dbAdapter.createAppToken({
          userId: luna.user.id,
          title: 'No manage',
          scopes: ['read-my-info'],
        });
        const tokenYes = await dbAdapter.createAppToken({
          userId: luna.user.id,
          title: 'Manage',
          scopes: ['manage-posts'],
        });

        const noResp = await performJSONRequest(
          'POST',
          `/v2/posts/${post.id}/pin`,
          {},
          { 'X-Authentication-Token': tokenNo.tokenString() },
        );
        expect(noResp, 'to satisfy', { __httpCode: expect.it('to be within', 401, 403) });

        const yesResp = await performJSONRequest(
          'POST',
          `/v2/posts/${post.id}/pin`,
          {},
          { 'X-Authentication-Token': tokenYes.tokenString() },
        );
        expect(yesResp, 'to satisfy', { __httpCode: 200, posts: { isPinned: true } });
      });
    });
  });

  describe('Serialization and sorting', () => {
    let luna, mars, group;
    let p1, p2, p3;
    beforeEach(async () => {
      [luna, mars] = await createTestUsers(['luna', 'mars']);
      group = await justCreateGroup(mars, 'celestials', 'Celestials');
      await mutualSubscriptions([luna, mars]);
      p1 = await justCreatePost(luna, 'Post1');
      p2 = await justCreatePost(luna, 'Post2');
      p3 = await justCreatePost(luna, 'Post3', [luna.username, group.username]);
    });

    it('pinnedIn and isPinned present across feeds', async () => {
      await performJSONRequest('POST', `/v2/posts/${p1.id}/pin`, {}, authHeaders(luna));
      await performJSONRequest(
        'POST',
        `/v2/posts/${p3.id}/pin`,
        { owner: group.id },
        authHeaders(mars),
      );

      const userFeed = await getUserFeed(luna, luna);
      const post1 = userFeed.posts.find((p) => p.id === p1.id);
      const post3 = userFeed.posts.find((p) => p.id === p3.id);
      expect(post1, 'to satisfy', {
        isPinned: true,
        pinnedIn: expect.it('to contain', luna.user.id),
      });
      expect(post3, 'to satisfy', { pinnedIn: expect.it('to contain', group.id) });

      const home = await getRiverOfNews(luna);
      const h1 = home.posts.find((p) => p.id === p1.id);
      const h3 = home.posts.find((p) => p.id === p3.id);
      expect(h1, 'to satisfy', { pinnedIn: expect.it('to be an array'), isPinned: true });
      expect(h3, 'to satisfy', { pinnedIn: expect.it('to be an array') });

      // Fetch MyDiscussions including own posts
      const discussions = await performJSONRequest(
        'GET',
        '/v2/timelines/filter/discussions?with-my-posts=yes',
        null,
        authHeaders(luna),
      );
      const d1 = discussions.posts.find((p) => p.id === p1.id);
      expect(d1, 'to satisfy', { pinnedIn: expect.it('to be an array') });
    });

    it('Posts timeline: pinned first, by pin time asc', async () => {
      // Pin p2 first, then p1: pinned order should be [p2, p1]
      await performJSONRequest('POST', `/v2/posts/${p2.id}/pin`, {}, authHeaders(luna));
      await performJSONRequest('POST', `/v2/posts/${p1.id}/pin`, {}, authHeaders(luna));

      const feed = await getUserFeed(luna, luna);
      const ids = feed.timelines.posts;
      const idx1 = ids.indexOf(p1.id);
      const idx2 = ids.indexOf(p2.id);
      const idx3 = ids.indexOf(p3.id);
      expect(idx2, 'to be less than', idx1); // p2 before p1
      expect(idx3, 'to be greater than', Math.max(idx1, idx2)); // non-pinned goes after pinned
    });
  });

  describe('Realtime: post:update after pin/unpin', () => {
    let luna, mars, post, group;
    let lunaSession, marsSession, anonSession;

    before(() => {
      // Enable realtime pubsub for this block
      PubSub.setPublisher(new PubSubAdapter($database));
    });

    beforeEach(async () => {
      [luna, mars] = await createTestUsers(['luna', 'mars']);
      group = await justCreateGroup(mars, 'celestials', 'Celestials');
      await mutualSubscriptions([luna, mars]);
      post = await justCreatePost(luna, 'Hello', [luna.username, group.username]);
      [lunaSession, marsSession, anonSession] = await Promise.all([
        Session.create(port, 'Luna'),
        Session.create(port, 'Mars'),
        Session.create(port, 'Anon'),
      ]);
      await Promise.all([
        lunaSession.sendAsync('auth', { authToken: luna.authToken }),
        marsSession.sendAsync('auth', { authToken: mars.authToken }),
      ]);
      await Promise.all([
        lunaSession.sendAsync('subscribe', { post: [post.id] }),
        marsSession.sendAsync('subscribe', { post: [post.id] }),
        anonSession.sendAsync('subscribe', { post: [post.id] }),
      ]);
    });

    afterEach(() => [lunaSession, marsSession, anonSession].forEach((s) => s.disconnect()));

    after(() => {
      // Switch publisher back to Dummy to not affect other tests
      PubSub.setPublisher(new DummyPublisher());
    });

    it("should deliver 'post:update' with pinnedIn/isPinned after pin to profile", async () => {
      const lunaEvent = lunaSession.receive('post:update');
      const marsEvent = marsSession.receive('post:update');
      const anonEvent = anonSession.receive('post:update');
      await Promise.all([
        performJSONRequest('POST', `/v2/posts/${post.id}/pin`, {}, authHeaders(luna)),
        lunaEvent,
        marsEvent,
        anonEvent,
      ]);
      expect(lunaEvent, 'to be fulfilled with value satisfying', {
        posts: { id: post.id, isPinned: true, pinnedIn: expect.it('to contain', luna.user.id) },
      });
    });

    it("should deliver 'post:update' with pinnedIn after pin to group", async () => {
      const ev = lunaSession.receive('post:update');
      await Promise.all([
        performJSONRequest(
          'POST',
          `/v2/posts/${post.id}/pin`,
          { owner: group.id },
          authHeaders(mars),
        ),
        ev,
      ]);
      expect(ev, 'to be fulfilled with value satisfying', {
        posts: { id: post.id, pinnedIn: expect.it('to contain', group.id) },
      });
    });

    it("should deliver 'post:update' after unpin", async () => {
      await performJSONRequest('POST', `/v2/posts/${post.id}/pin`, {}, authHeaders(luna));
      const ev = lunaSession.receive('post:update');
      await Promise.all([
        performJSONRequest('POST', `/v2/posts/${post.id}/unpin`, {}, authHeaders(luna)),
        ev,
      ]);
      expect(ev, 'to be fulfilled with value satisfying', { posts: { id: post.id } });
    });
  });

  describe('DB and migrations behaviors', () => {
    it('ON DELETE CASCADE removes pinned row', async () => {
      const luna = await createTestUser();
      const post = await justCreatePost(luna, 'Hello');
      await performJSONRequest('POST', `/v2/posts/${post.id}/pin`, {}, authHeaders(luna));
      const before = await dbAdapter
        .database('pinned_posts')
        .select('*')
        .where({ user_id: luna.user.id, post_id: post.id });
      expect(before, 'to have length', 1);
      // Delete post record directly to test DB cascade behavior
      await dbAdapter.deletePostRecord(post.id);
      const after = await dbAdapter
        .database('pinned_posts')
        .select('*')
        .where({ user_id: luna.user.id, post_id: post.id });
      expect(after, 'to have length', 0);
    });

    it('Removing group from recipients unpins from that group', async () => {
      const [luna, mars] = await createTestUsers(['luna', 'mars']);
      const group = await justCreateGroup(mars, 'celestials', 'Celestials');
      await mutualSubscriptions([luna, mars]);
      const post = await justCreatePost(luna, 'Hello', [luna.username, group.username]);
      await performJSONRequest(
        'POST',
        `/v2/posts/${post.id}/pin`,
        { owner: group.id },
        authHeaders(mars),
      );
      // Remove group from destinations (update post feeds)
      const upd = await performJSONRequest(
        'PUT',
        `/v2/posts/${post.id}`,
        { post: { feeds: [luna.username] } },
        authHeaders(luna),
      );
      expect(upd, 'to satisfy', { __httpCode: 200 });
      const rows = await dbAdapter
        .database('pinned_posts')
        .select('*')
        .where({ user_id: group.id, post_id: post.id });
      expect(rows, 'to have length', 0);
    });
  });

  describe('Notifications for group pin/unpin', () => {
    it('post_pinned_in_group and post_unpinned_in_group are delivered', async () => {
      const [luna, mars] = await createTestUsers(['luna', 'mars']);
      const group = await justCreateGroup(mars, 'celestials', 'Celestials');
      await mutualSubscriptions([luna, mars]);
      const post = await justCreatePost(luna, 'Hello', [luna.username, group.username]);

      const pinResp = await performJSONRequest(
        'POST',
        `/v2/posts/${post.id}/pin`,
        { owner: group.id },
        authHeaders(mars),
      );
      expect(pinResp, 'to satisfy', { __httpCode: 200 });

      const pinnedEventsLuna = await performJSONRequest(
        'GET',
        '/v2/notifications?filter=post_pinned_in_group',
        null,
        authHeaders(luna),
      );
      const pinnedEventsMars = await performJSONRequest(
        'GET',
        '/v2/notifications?filter=post_pinned_in_group',
        null,
        authHeaders(mars),
      );
      expect(pinnedEventsLuna, 'to satisfy', {
        __httpCode: 200,
        Notifications: expect.it('to be non-empty'),
      });
      expect(pinnedEventsMars, 'to satisfy', {
        __httpCode: 200,
        Notifications: expect.it('to be non-empty'),
      });

      const unpinResp = await performJSONRequest(
        'POST',
        `/v2/posts/${post.id}/unpin`,
        { owner: group.id },
        authHeaders(mars),
      );
      expect(unpinResp, 'to satisfy', { __httpCode: 200 });

      const unpinnedEventsLuna = await performJSONRequest(
        'GET',
        '/v2/notifications?filter=post_unpinned_in_group',
        null,
        authHeaders(luna),
      );
      const unpinnedEventsMars = await performJSONRequest(
        'GET',
        '/v2/notifications?filter=post_unpinned_in_group',
        null,
        authHeaders(mars),
      );
      expect(unpinnedEventsLuna, 'to satisfy', {
        __httpCode: 200,
        Notifications: expect.it('to be non-empty'),
      });
      expect(unpinnedEventsMars, 'to satisfy', {
        __httpCode: 200,
        Notifications: expect.it('to be non-empty'),
      });
    });
  });
});
