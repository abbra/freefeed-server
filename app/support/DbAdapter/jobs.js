import createDebug from 'debug';
import { difference, uniq } from 'lodash';

import { Job } from '../../models';

import { prepareModelPayload, initObject } from './utils';
import { advisoryLock, JOBS_FETCH } from './adv-locks';

const debug = createDebug('freefeed:jobs:debug');

export default function jobsTrait(superClass) {
  return class extends superClass {
    async createJob(name, payload = {}, { unlockAt, uniqKey } = {}) {
      const row = await this.database.getRow(
        `insert into jobs 
          (name, payload, unlock_at, uniq_key) 
          values (:name, :payload, :unlockAt, :uniqKey)
          on conflict (name, uniq_key) do 
            update set (payload, unlock_at) = (:payload, :unlockAt)
          returning *`,
        { name, payload: JSON.stringify(payload), uniqKey, unlockAt: this._jobUnlockAt(unlockAt) },
      );

      return initJobObject(row);
    }

    async updateJob(id, { unlockAt = 0, failure = null } = {}) {
      const toUpdate = { unlock_at: this._jobUnlockAt(unlockAt) };

      if (failure === true) {
        toUpdate.failures = this.database.raw('failures + 1');
      } else if (failure === false) {
        toUpdate.failures = 0;
      }

      const [row] = await this.database('jobs').update(toUpdate).where({ id }).returning('*');
      return initJobObject(row);
    }

    async getJobById(id) {
      const row = await this.database.getRow(`select * from jobs where id = :id`, { id });
      return initJobObject(row);
    }

    async deleteJob(id) {
      await this.database.raw(`delete from jobs where id = :id`, { id });
    }

    /**
     * @param {number} count - number of jobs to fetch
     * @param {number} lockTime - in seconds
     * @param {Record<string, int>} limitedJobs - names of jobs with limited
     * number of simultaneous executions
     * @returns {Promise<Job[]>}
     */
    async fetchJobs(count, lockTime, limitedJobs = {}) {
      const rows1 = await this.database.transaction(async (trx) => {
        // Lock jobs table in exclusive mode
        await advisoryLock(trx, JOBS_FETCH);

        const allRows = [];
        const allReturning = [];
        let maxLoops = 10; // To prevent infinite loop

        while (maxLoops--) {
          // eslint-disable-next-line no-await-in-loop
          const { rows, toReturn } = await this._fetchJobsWithLimits(
            trx,
            count,
            lockTime,
            limitedJobs,
          );
          allRows.push(...rows);
          allReturning.push(...toReturn);

          if (toReturn.length === 0 || rows.length + toReturn.length < count) {
            break;
          }

          count -= rows.length;
        }

        // Unlock all returned jobs
        const updData = allReturning.map(({ id, old_unlock_at }) => ({ id, old_unlock_at }));
        await trx.raw(
          `update jobs set
            unlock_at = j.old_unlock_at,
            attempts = greatest(attempts - 1, 0)
          from
            jsonb_to_recordset(:updData) as j(id uuid, old_unlock_at timestamptz)
          where
            jobs.id = j.id`,
          { updData: JSON.stringify(updData) },
        );

        return allRows;
      });

      return rows1.map(initJobObject);
    }

    async _fetchJobsWithLimits(db, count, lockTime, limitedJobs = {}) {
      const rows = await db.getAll(
        `with selected as (
            select id, unlock_at as old_unlock_at from jobs 
            where unlock_at <= now()
            order by unlock_at
            limit :count
        ),
        updated as (
            update jobs set
                unlock_at = now() + :lockTime * '1 second'::interval,
                attempts = attempts + 1
            from selected
            where jobs.id = selected.id
            returning jobs.*, selected.old_unlock_at          
        )
        select * from updated order by old_unlock_at`,
        { count, lockTime },
      );

      for (const row of rows) {
        debug(`got a job ${row.name} (${row.id})`);
      }

      const toReturn = [];

      // Are there any limited jobs in results?
      const limRows = rows.filter((row) => limitedJobs[row.name]).reverse(); // Add .reverse() for the further filtering

      if (limRows.length === 0) {
        // No limited jobs, just return
        return { rows, toReturn };
      }

      // How many jobs are already taken for each job name?
      const takenCountsRows = await db.getAll(
        `select name, count(*)::int from jobs where unlock_at > now() and name = any(:limNames) group by name`,
        { limNames: uniq(limRows.map((row) => row.name)) },
      );
      const takenCounts = {};

      for (const row of takenCountsRows) {
        takenCounts[row.name] = row.count;
      }

      // Put back jobs that are over the limit
      for (const row of limRows) {
        if (takenCounts[row.name] > limitedJobs[row.name]) {
          debug(`returning job ${row.name} (${row.id}) to the queue`);
          toReturn.push(row);
          takenCounts[row.name]--;
        }
      }

      return {
        rows: difference(rows, toReturn),
        toReturn,
      };
    }

    // For testing purposes only
    async getAllJobs(names = null) {
      let rows;

      if (names) {
        rows = await this.database.getAll(
          `select * from jobs where name = any(:names) order by created_at`,
          { names },
        );
      } else {
        rows = await this.database.getAll(`select * from jobs order by created_at`);
      }

      return rows.map(initJobObject);
    }

    _jobUnlockAt(unlockAt) {
      if (Number.isFinite(unlockAt)) {
        return this.database.raw(`now() + :unlockAt * '1 second'::interval`, { unlockAt });
      } else if (unlockAt instanceof Date) {
        return unlockAt.toISOString();
      }

      return this.database.raw('default');
    }
  };
}

function initJobObject(row) {
  if (!row) {
    return null;
  }

  row = prepareModelPayload(row, JOB_FIELDS, JOB_FIELDS_MAPPING);
  return initObject(Job, row, row.id);
}

const JOB_FIELDS = {
  id: 'id',
  created_at: 'createdAt',
  unlock_at: 'unlockAt',
  name: 'name',
  payload: 'payload',
  attempts: 'attempts',
  failures: 'failures',
  uniq_key: 'uniqKey',
};

const JOB_FIELDS_MAPPING = {};
