import { dbAdapter } from '../models';

import { currentConfig } from './app-async-context';

export async function authenticateUser(username, clearPassword) {
  try {
    let user;

    if (username.includes('@')) {
      user = await dbAdapter.getUserByEmail(username.trim());
    } else {
      user = await dbAdapter.getUserByUsername(username.trim());
    }

    if (user && (await user.isFrozen())) {
      const { adminEmail } = currentConfig();
      return {
        error: {
          message:
            'Your account has been suspended due to suspicious activity. ' +
            `Please contact support${adminEmail ? ` at ${adminEmail}` : ''} if you believe this is an error.`,
        },
      };
    }

    if (!user || (!user.isActive && !user.isResumable)) {
      return {
        error: { message: 'We could not find the nickname you provided.' },
      };
    }

    const validPwd = await user.validPassword(clearPassword);

    if (!validPwd) {
      return {
        error: {
          message: user.isActive
            ? 'The password you provided does not match the password in our system.'
            : 'We could not find the nickname you provided.',
        },
      };
    }

    if (user.isResumable) {
      return {
        error: {
          message: 'Your account is now inactive but you can resume it.',
          userId: user.id,
          isResumable: true,
        },
      };
    }

    return { user };
  } catch {
    return {
      error: { message: 'We could not find the nickname you provided.' },
    };
  }
}
