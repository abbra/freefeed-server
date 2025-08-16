import pgFormat from 'pg-format';

import { type DbAdapter } from './index';

export default (superClass: typeof DbAdapter) =>
  class extends superClass {
    async pinUserPost(feedId: string, postId: string, pinnedBy: string) {
      // Record pin by the given feed (Posts of user or group) for this post and initiator
      await this.database('pinned_posts')
        .insert({ feed_id: feedId, post_id: postId, pinned_by: pinnedBy })
        .onConflict(['feed_id', 'post_id'])
        .ignore();
      return true;
    }

    async unpinUserPost(feedId: string, postId: string) {
      await this.database('pinned_posts').where({ feed_id: feedId, post_id: postId }).delete();
      return true;
    }

    async getPinnedPostIdsForUser(userId: string): Promise<string[]> {
      const rows = await this.database
        .select('post_id')
        .from('pinned_posts')
        .where({ user_id: userId })
        .orderBy('created_at', 'desc');
      return rows.map((r: any) => r.post_id);
    }

    async getPinnedStatusesForPosts(postIds: string[]): Promise<Set<string>> {
      if (postIds.length === 0) {
        return new Set();
      }

      const sql = pgFormat(
        `select p.uid as post_id
         from posts p
         join feeds f on f.user_id = p.user_id and f.name = 'Posts' and f.ord is null
         join pinned_posts pp on pp.post_id = p.uid and pp.feed_id = f.uid
         where p.uid in (%L)`,
        postIds,
      );
      const { rows } = await this.database.raw(sql);
      return new Set(rows.map((r: any) => r.post_id));
    }

    async getPinnedOwnersByPosts(postIds: string[]): Promise<Map<string, string[]>> {
      if (postIds.length === 0) {
        return new Map();
      }

      const sql = pgFormat(
        `select pp.post_id, f.user_id as owner_id
         from pinned_posts pp
         join feeds f on f.uid = pp.feed_id
         where pp.post_id in (%L)`,
        postIds,
      );
      const { rows } = await this.database.raw(sql);
      const map = new Map<string, string[]>();

      for (const r of rows) {
        if (!map.has(r.post_id)) {
          map.set(r.post_id, []);
        }

        map.get(r.post_id)!.push(r.owner_id);
      }

      return map;
    }

    async getPinnedDetailsByPosts(
      postIds: string[],
    ): Promise<Map<string, { userId: string; createdAt: string; pinnedBy: string | null }[]>> {
      if (postIds.length === 0) {
        return new Map();
      }

      const sql = pgFormat(
        `select pp.post_id, f.user_id, pp.created_at, pp.pinned_by
         from pinned_posts pp
         join feeds f on f.uid = pp.feed_id
         where pp.post_id in (%L)
         order by pp.created_at asc`,
        postIds,
      );
      const { rows } = await this.database.raw(sql);
      const map = new Map<
        string,
        { userId: string; createdAt: string; pinnedBy: string | null }[]
      >();

      for (const r of rows) {
        if (!map.has(r.post_id)) {
          map.set(r.post_id, []);
        }

        map.get(r.post_id)!.push({
          userId: r.user_id,
          createdAt: new Date(r.created_at).toISOString(),
          pinnedBy: r.pinned_by ?? null,
        });
      }

      return map;
    }
  };
