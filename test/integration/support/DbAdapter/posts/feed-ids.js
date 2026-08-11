/* global $pg_database */
import expect from 'unexpected';

import cleanDB from '../../../../dbCleaner';
import { dbAdapter, User } from '../../../../../app/models';

describe('Post feed IDs', () => {
  beforeEach(() => cleanDB($pg_database));

  it('updates a post only when at least one feed ID is missing', async () => {
    const luna = new User({ username: 'luna', password: 'password' });
    await luna.create();

    const post = await luna.newPost({ body: 'Post body' });
    await post.create();

    const likesFeedId = await luna.getLikesTimelineIntId();
    const firstResult = await dbAdapter.insertPostIntoFeeds([likesFeedId], post.id);
    const secondResult = await dbAdapter.insertPostIntoFeeds([likesFeedId], post.id);
    const commentsFeedId = await luna.getCommentsTimelineIntId();
    const partialResult = await dbAdapter.insertPostIntoFeeds(
      [likesFeedId, commentsFeedId],
      post.id,
    );
    const updatedPost = await dbAdapter.getPostById(post.id);

    expect(firstResult.rowCount, 'to equal', 1);
    expect(secondResult.rowCount, 'to equal', 0);
    expect(partialResult.rowCount, 'to equal', 1);
    expect(updatedPost.feedIntIds, 'to contain', likesFeedId);
    expect(updatedPost.feedIntIds, 'to contain', commentsFeedId);
  });
});
