import { beforeEach, describe, it } from 'mocha';
import expect from 'unexpected';

import cleanDB from '../../../dbCleaner';
import { dbAdapter, Post, User, Group } from '../../../../app/models';
import { createUser } from '../../helpers/users';
import { createPost } from '../../helpers/posts-and-comments';
import { postAccessRequired } from '../../../../app/controllers/middlewares';
import { getRoomsOfPost } from '../../../../app/pubsub-listener';
import { EVENT_TYPES } from '../../../../app/support/EventTypes';

describe('Posts in to-delete state', () => {
  beforeEach(() => cleanDB(dbAdapter.database));

  let luna: User;
  beforeEach(async () => {
    luna = await createUser('luna');
  });

  describe('Luna writes a regular post and inactivates it', () => {
    let post: Post;

    beforeEach(async () => {
      post = await createPost(luna, 'Post body');
      await post.inactivate();
    });

    it(`should be in 'isDeleting' state`, async () => {
      expect(await post.isDeleting(), 'to equal', true);
    });

    it(`should not be visible in 'postAccessRequired' middleware`, async () => {
      const mw = postAccessRequired();
      const ctx = { state: { user: luna }, params: { postId: post.id } };

      await expect(
        mw(ctx, () => {}),
        'to be rejected with',
        { status: 404 },
      );
    });

    it(`should have no realtime rooms`, async () => {
      const rooms = await getRoomsOfPost(post);
      expect(rooms, 'to be empty');
    });

    it(`should not appear in Luna's timeline`, async () => {
      const timeline = await luna.getPostsTimeline();
      expect(await dbAdapter.getTimelinePostsIds([timeline!.intId], luna.id), 'to be empty');
    });

    it(`should not appear in search results`, async () => {
      expect(await dbAdapter.search('body', { viewerId: luna.id }), 'to be empty');
    });
  });

  describe('Luna writes a post in group and group admin inactivates and then activates it', () => {
    let admin1: User;
    let admin2: User;
    let group: Group;
    let post: Post;
    beforeEach(async () => {
      admin1 = await createUser('admin1');
      admin2 = await createUser('admin2');
      group = new Group({ username: 'group' });
      await group.create(admin1.id);
      await group.addAdministrator(admin2.id);

      post = await createPost(luna, 'Post body', [group]);
      await post.inactivate(admin1);
      await post.activate(admin1);
    });

    it(`should not be in 'isDeleting' state`, async () => {
      expect(await post.isDeleting(), 'to equal', false);
    });

    it(`should notify Luna about post moderation and restore`, async () => {
      const events = await dbAdapter.getUserEvents(luna.intId);
      expect(events, 'to satisfy', [
        {
          event_type: EVENT_TYPES.POST_RESTORED,
          created_by_user_id: admin1.intId,
          target_user_id: luna.intId,
          post_id: post.intId,
        },
        {
          event_type: EVENT_TYPES.POST_MODERATED,
          created_by_user_id: admin1.intId,
          target_user_id: luna.intId,
          post_id: null, // Post is kind of "deleted" here
        },
      ]);
    });

    it(`should notify Admin2 about post moderation and restore`, async () => {
      const events = await dbAdapter.getUserEvents(admin2.intId);
      expect(events, 'to satisfy', [
        {
          event_type: EVENT_TYPES.POST_RESTORED_BY_ANOTHER_ADMIN,
          created_by_user_id: admin1.intId,
          target_user_id: luna.intId,
          post_id: post.intId,
        },
        {
          event_type: EVENT_TYPES.POST_MODERATED_BY_ANOTHER_ADMIN,
          created_by_user_id: admin1.intId,
          target_user_id: luna.intId,
          post_id: null, // Post is kind of "deleted" here
        },
      ]);
    });

    it(`should not notify Admin1 himself about post moderation and restore`, async () => {
      const events = await dbAdapter.getUserEvents(admin1.intId);
      expect(events, 'to satisfy', []);
    });
  });
});
