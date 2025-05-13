import { beforeEach, describe, it } from 'mocha';
import expect from 'unexpected';

import cleanDB from '../../../dbCleaner';
import { dbAdapter, Post, User } from '../../../../app/models';
import { createUser } from '../../helpers/users';
import { createPost } from '../../helpers/posts-and-comments';
import { postAccessRequired } from '../../../../app/controllers/middlewares';
import { getRoomsOfPost } from '../../../../app/pubsub-listener';

describe('Posts in to-delete state', () => {
  beforeEach(() => cleanDB(dbAdapter.database));

  let luna: User;
  let post: Post;

  beforeEach(async () => {
    luna = await createUser('luna');
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
