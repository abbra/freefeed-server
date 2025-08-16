import pgFormat from 'pg-format';

import { type DbAdapter } from './index';

export default (superClass: typeof DbAdapter) =>
  class extends superClass {
    async pinUserPost(userId: string, postId: string, pinnedBy: string) {
      // Record pin by the given owner (user or group) for this post and initiator
      await this.database('pinned_posts')
        .insert({ user_id: userId, post_id: postId, pinned_by: pinnedBy })
        .onConflict(['user_id', 'post_id'])
        .ignore();
      return true;
    }

    async unpinUserPost(userId: string, postId: string) {
      await this.database('pinned_posts').where({ user_id: userId, post_id: postId }).delete();
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
         join pinned_posts pp on pp.post_id = p.uid and pp.user_id = p.user_id
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
        `select post_id, user_id from pinned_posts where post_id in (%L)`,
        postIds,
      );
      const { rows } = await this.database.raw(sql);
      const map = new Map<string, string[]>();

      for (const r of rows) {
        if (!map.has(r.post_id)) {
          map.set(r.post_id, []);
        }

        map.get(r.post_id)!.push(r.user_id);
      }

      return map;
    }
  };
