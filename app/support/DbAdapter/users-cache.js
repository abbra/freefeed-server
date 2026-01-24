import * as _ from 'lodash-es';

///////////////////////////////////////////////////
// User's attributes caching
///////////////////////////////////////////////////

// We MUST increment this version when we change the structure of `users` table
const cacheVersion = 2;

function cacheKey(id) {
  return `user_${cacheVersion}_${id}`;
}

const usersCacheTrait = (superClass) =>
  class extends superClass {
    async cacheFlushUser(id) {
      await this.cache.del(cacheKey(id));
    }

    getCachedUserAttrs = async (id) => {
      return fixCachedUserAttrs(await this.cache.get(cacheKey(id)));
    };

    async fetchUser(id) {
      let attrs = await this.getCachedUserAttrs(id);

      if (!attrs) {
        // Cache miss, read from the database
        attrs = (await this.database('users').first().where('uid', id)) || null;

        if (attrs) {
          await this.cache.set(cacheKey(id), attrs);
        }
      }

      return attrs;
    }

    /**
     * Returns plain object with ids as keys and user attributes as values
     */
    async fetchUsersAssoc(ids) {
      const idToUser = {};

      if (_.isEmpty(ids)) {
        return idToUser;
      }

      const uniqIds = _.uniq(ids);
      let cachedUsers;

      if (this.redisStore) {
        // Use KeyvRedis getMany for batch retrieval (more efficient than individual gets)
        const cacheKeys = uniqIds.map((id) => cacheKey(id));
        const results = await this.redisStore.getMany(cacheKeys);
        cachedUsers = results.map(fixCachedUserAttrs);
      } else {
        cachedUsers = await Promise.all(uniqIds.map(this.getCachedUserAttrs));
      }

      const notFoundIds = _.compact(cachedUsers.map((attrs, i) => (attrs ? null : uniqIds[i])));
      const dbUsers =
        notFoundIds.length === 0 ? [] : await this.database('users').whereIn('uid', notFoundIds);

      await Promise.all(dbUsers.map((attrs) => this.cache.set(cacheKey(attrs.uid), attrs)));

      _.compact(cachedUsers).forEach((attrs) => (idToUser[attrs.uid] = attrs));
      dbUsers.forEach((attrs) => (idToUser[attrs.uid] = attrs));
      return idToUser;
    }

    async fetchUsers(ids) {
      const idToUser = await this.fetchUsersAssoc(ids);
      return ids.map((id) => idToUser[id] || null);
    }
  };

export default usersCacheTrait;

///////////////////////////////////////////////////

function fixDateType(date) {
  if (typeof date === 'string') {
    return new Date(date);
  }

  if (date instanceof Date) {
    return date;
  }

  return null;
}

function fixCachedUserAttrs(attrs) {
  if (!attrs) {
    return null;
  }

  // Convert dates back to the Date type
  attrs['created_at'] = fixDateType(attrs['created_at']);
  attrs['updated_at'] = fixDateType(attrs['updated_at']);
  attrs['gone_at'] = fixDateType(attrs['gone_at']);
  attrs['reset_password_sent_at'] = fixDateType(attrs['reset_password_sent_at']);
  attrs['reset_password_expires_at'] = fixDateType(attrs['reset_password_expires_at']);
  return attrs;
}
