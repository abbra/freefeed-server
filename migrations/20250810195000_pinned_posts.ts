import type { Knex } from 'knex';

export const up = (knex: Knex) =>
  knex.raw(`do $$begin
  create table if not exists pinned_posts (
    user_id   uuid    not null references users (uid) on delete cascade on update cascade,
    post_id   uuid    not null references posts (uid) on delete cascade on update cascade,
    created_at timestamptz not null default now(),
    primary key (user_id, post_id)
  );
end$$`);

export const down = (knex: Knex) =>
  knex.raw(`do $$begin
  drop table if exists pinned_posts;
end$$`);
