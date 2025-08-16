import type { Knex } from 'knex';

export const up = (knex: Knex) =>
  knex.schema.raw(`do $$begin
    alter table pinned_posts
      add column if not exists pinned_by uuid references users (uid) on delete cascade on update cascade;
  end$$`);

export const down = (knex: Knex) =>
  knex.schema.raw(`do $$begin
    alter table pinned_posts
      drop column if exists pinned_by;
  end$$`);

