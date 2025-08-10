import pgFormat from 'pg-format';
import { type DbAdapter } from './index';

export default (superClass: typeof DbAdapter) =>
  class extends superClass {
    async pinUserPost(userId: string, postId: string) {
      // Ensure post belongs to the user
      const [{ count }] = await this.database('posts')
        .count()
        .where({ uid: postId, user_id: userId });
      if (parseInt(String(count || 0), 10) === 0) {
        return false;
      }
      await this.database('pinned_posts')
        .insert({ user_id: userId, post_id: postId })
        .onConflict(['user_id', 'post_id'])
        .ignore();
      return true;
    }

    async unpinUserPost(userId: string, postId: string) {
      await this.database('pinned_posts')
        .where({ user_id: userId, post_id: postId })
        .delete();
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
      if (postIds.length === 0) return new Set();
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
  };

