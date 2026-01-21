/* eslint-disable no-await-in-loop */
import { promises as fs } from 'fs';
import path from 'path';

import { program } from 'commander';

import { setSearchConfig } from '../app/setup/postgres';
import { dbAdapter } from '../app/models';
import { toTSVector, toSuffixTSVector } from '../app/support/search/to-tsvector';
import { delay } from '../app/support/timers';

// Reindex search columns in 'users' table.
// Usage: yarn babel bin/reindex_accounts.js --help

const ZERO_UID = '00000000-00000000-00000000-00000000';
const statusFile = path.join(__dirname, '../tmp/reindex_accounts.json');

program
  .option('--batch-size <batch size>', 'batch size', (v) => parseInt(v, 10), 1000)
  .option('--delay <delay>', 'delay between batches, seconds', (v) => parseInt(v, 10), 1)
  .option('--retries <count>', 'count of retries in case of failure', (v) => parseInt(v, 10), 10)
  .option('--timeout <timeout>', 'timeout of transaction in PostgreSQL syntax', '1min')
  .option('--restart', 'start indexing from the beginning');
program.parse(process.argv);

const [batchSize, delaySec, retries, timeout, restart] = [
  program.getOptionValue('batchSize'),
  program.getOptionValue('delay'),
  program.getOptionValue('retries'),
  program.getOptionValue('timeout'),
  program.getOptionValue('restart'),
];

if (!isFinite(batchSize) || !isFinite(delaySec)) {
  process.stderr.write(`⛔ Invalid program option\n`);
  program.help();
}

process.stdout.write(`Running with batch size of ${batchSize} and delay of ${delaySec}\n`);
process.stdout.write(`Status file: ${statusFile}\n`);
process.stdout.write(`\n`);

(async () => {
  try {
    await setSearchConfig();

    let lastUID = ZERO_UID;

    if (!restart) {
      try {
        const statusText = await fs.readFile(statusFile, { encoding: 'utf8' });
        ({ lastUID } = JSON.parse(statusText));
      } catch (err) {
        if (err.code !== 'ENOENT') {
          throw new Error(`Cannot read status from ${statusFile}: ${err.message}`);
        }

        process.stdout.write(`Status file is not found, starting from the beginning...\n`);
      }
    }

    process.stdout.write(`Indexing users starting from ${lastUID}...\n`);
    let indexed = 0;

    while (true) {
      const { rows } = await dbAdapter.database.raw(
        `select uid, username, screen_name, description from users where uid > :lastUID order by uid limit :batchSize`,
        { lastUID, batchSize },
      );

      if (rows.length === 0) {
        break;
      }

      let attemptsLeft = retries;

      while (true) {
        const start = Date.now();

        try {
          await dbAdapter.database.transaction(async (trx) => {
            // Cannot use placeholder here: Postgres doesn't allow prepared statements for 'set'
            await trx.raw(`set local statement_timeout to '${timeout.replace(/'/g, `''`)}'`);
            await trx.raw(
              `create temp table ftsdata (uid uuid, username_vector tsvector, screen_name_vector tsvector, description_vector tsvector) on commit drop`,
            );
            await trx('ftsdata').insert(
              rows.map((r) => ({
                uid: r.uid,
                username_vector: trx.raw(toSuffixTSVector(r.username || '').replace(/\?/g, '\\?')),
                screen_name_vector: trx.raw(toTSVector(r.screen_name || '').replace(/\?/g, '\\?')),
                description_vector: trx.raw(toTSVector(r.description || '').replace(/\?/g, '\\?')),
              })),
            );
            await trx.raw(
              `update users set 
                username_tsvector = username_vector,
                screen_name_tsvector = screen_name_vector,
                description_tsvector = description_vector
              from ftsdata where users.uid = ftsdata.uid`,
            );
          });

          indexed += rows.length;
          lastUID = rows[rows.length - 1].uid;

          const percent = (parseInt(lastUID.substr(0, 2), 16) * 100) >> 8;
          const speed = Math.round((batchSize * 1000) / (Date.now() - start));
          process.stdout.write(
            `\tindexed ${indexed} users at ${speed} upd/sec (${percent}% of total)\n`,
          );

          await saveStatus(lastUID);

          break;
        } catch (e) {
          if (e.code === '57014' /* query_canceled */ && attemptsLeft > 0) {
            process.stdout.write(`\tquery canceled at ${Date.now() - start} ms, retrying...\n`);
            attemptsLeft--;
          } else {
            throw e;
          }
        }

        await delay(1000 * delaySec);
      }
    }

    process.stdout.write(`All users indexed, starting VACUUM ANALYZE...\n`);
    await dbAdapter.database.raw(`vacuum analyze users`);
    process.stdout.write(`Done with users.\n`);

    process.stdout.write(`All accounts were indexed.\n`);
    await fs.unlink(statusFile);

    process.exit(0);
  } catch (e) {
    process.stderr.write(`⛔ ERROR: ${e.message}\n`);
    process.exit(1);
  }
})();

async function saveStatus(lastUID) {
  await fs.mkdir(path.dirname(statusFile), { recursive: true });
  await fs.writeFile(statusFile, JSON.stringify({ lastUID }));
}
