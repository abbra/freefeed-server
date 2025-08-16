import type { Knex } from 'knex';

export const up = async (knex: Knex) => {
  await knex.schema.raw(`do $$begin
    alter table pinned_posts
      add column if not exists feed_id uuid references feeds (uid) on delete cascade on update cascade;
  end$$`);

  // Fill feed_id from existing user_id via users' 'Posts' feeds
  await knex.schema.raw(`
    update pinned_posts pp set feed_id = f.uid
    from feeds f
    where f.user_id = pp.user_id and f.name = 'Posts' and f.ord is null and pp.feed_id is null;
  `);

  // Replace PK to (feed_id, post_id)
  await knex.schema.raw(`do $$begin
    alter table pinned_posts drop constraint if exists pinned_posts_pkey;
    alter table pinned_posts add primary key (feed_id, post_id);
  end$$`);

  // Drop old user_id column
  await knex.schema.raw(`do $$begin
    alter table pinned_posts drop column if exists user_id;
  end$$`);
};

export const down = async (knex: Knex) => {
  await knex.schema.raw(`do $$begin
    alter table pinned_posts add column if not exists user_id uuid references users (uid) on delete cascade on update cascade;
  end$$`);

  // Best-effort rollback: restore user_id from feeds
  await knex.schema.raw(`
    update pinned_posts pp set user_id = f.user_id
    from feeds f
    where f.uid = pp.feed_id and pp.user_id is null;
  `);

  await knex.schema.raw(`do $$begin
    alter table pinned_posts drop constraint if exists pinned_posts_pkey;
    alter table pinned_posts add primary key (user_id, post_id);
    alter table pinned_posts drop column if exists feed_id;
  end$$`);
};
