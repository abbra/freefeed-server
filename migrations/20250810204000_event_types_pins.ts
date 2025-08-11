import type { Knex } from 'knex';

export const up = (knex: Knex) =>
  knex.schema.raw(`do $$begin
    insert into event_types (event_type) values
      ('post_pinned_in_group'),
      ('post_unpinned_in_group')
    on conflict do nothing;
  end$$`);

export const down = (knex: Knex) =>
  knex.schema.raw(`do $$begin
    delete from event_types where event_type in ('post_pinned_in_group','post_unpinned_in_group');
  end$$`);
