import type { Knex } from 'knex';

export const up = (knex: Knex) =>
  knex.schema.raw(`do $$begin
  alter table posts add column to_delete boolean not null default false;
  create index posts_to_delete_idx on posts (to_delete);
end$$`);

export const down = (knex: Knex) =>
  knex.schema.raw(`do $$begin
  alter table posts drop column to_delete;
end$$`);
