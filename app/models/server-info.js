import config from 'config';

export function addServerInfoModel(dbAdapter) {
  // eslint-disable-next-line @typescript-eslint/no-extraneous-class
  return class ServerInfo {
    static async isRegistrationOpen({ interval, maxCount } = config.registrationsLimit) {
      const count = await dbAdapter.getLatestUsersCount(interval);
      return count < maxCount;
    }
  };
}
