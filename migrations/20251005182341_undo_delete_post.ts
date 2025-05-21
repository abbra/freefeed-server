import type { Knex } from 'knex';

import { eventTypesSQLs } from '../app/support/migrations';

const [eventTypesUp, eventTypesDown] = eventTypesSQLs(
  `post_restored`,
  `post_restored_by_another_admin`,
);

export const up = (knex: Knex) =>
  knex.schema.raw(`do $$begin
  alter table posts add column to_delete boolean not null default false;
  create index posts_to_delete_idx on posts (to_delete);

  -- Add event types
  ${eventTypesUp}
end$$`);

export const down = (knex: Knex) =>
  knex.schema.raw(`do $$begin
  alter table posts drop column to_delete;

  -- Remove event types
  ${eventTypesDown}
end$$`);
