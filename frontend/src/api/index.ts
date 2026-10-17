import { db, type StoredAccount, type AccountSummary, type FolderItem, type TagItem, type LocalLogItem, type AppSettings, type SecretField } from '../services/storage';
import { steamClient, type ConfirmationItem, type SteamTimeResponse } from '../services/steamClient';
import { isSessionError, SteamApiError } from '../services/steamErrors';
import { steamAuth } from '../services/steamAuth';
import { parseMaFile, exportToMaFile, downloadFile } from '../services/mafileParser';

export interface LiveCodesResponse {
  generatedAt: string;
  validForSec: number;
  items: Array<{ accountId: string; code: string }>;
}

export const accountApi = {
  /** Metadata only: no secret ever reaches a component. */
  list: async (): Promise<{ items: AccountSummary[] }> => {
    const items = await db.getAccounts();
    return { items };
  },

  get: async (accountId: string): Promise<AccountSummary | null> => {
    return await db.getAccount(accountId);
  },

  code: async (accountId: string): Promise<{ code: string; validForSec: number }> => {
    const settings = await db.getSettings();
    const [item] = await db.getLiveCodes(settings.timeOffsetSec, [accountId]);
    if (!item) throw new Error('Account not found');

    const nowSec = Math.floor(Date.now() / 1000) + settings.timeOffsetSec;
    const validForSec = 30 - (nowSec % 30) || 30;
    return { code: item.code, validForSec };
  },

  liveCodes: async (): Promise<LiveCodesResponse> => {
    const settings = await db.getSettings();
    const nowSec = Math.floor(Date.now() / 1000) + settings.timeOffsetSec;
    const validForSec = 30 - (nowSec % 30) || 30;

    return {
      generatedAt: new Date().toISOString(),
      validForSec,
      items: await db.getLiveCodes(settings.timeOffsetSec)
    };
  },

  importMaFile: async (content: string, alias?: string): Promise<StoredAccount> => {
    const account = parseMaFile(content, alias);
    await db.saveAccount(account);
    await db.addLog({
      category: 'system',
      headline: `Imported account "${account.alias}" (${account.accountName})`,
      accountId: account.id,
      accountAlias: account.alias
    });
    return account;
  },

  save: async (account: StoredAccount): Promise<void> => {
    await db.saveAccount(account);
  },

  update: async (accountId: string, data: Partial<StoredAccount>): Promise<void> => {
    // Round-trips the secrets inside the service layer; the UI never sees them.
    const current = await db.getAccountWithSecrets(accountId);
    if (!current) throw new Error('Account not found');
    const updated = { ...current, ...data, updatedAt: new Date().toISOString() };
    await db.saveAccount(updated);
  },

  delete: async (accountId: string): Promise<void> => {
    const current = await db.getAccount(accountId);
    if (current) {
      await db.deleteAccount(accountId);
      await db.addLog({
        category: 'system',
        headline: `Deleted account "${current.alias}"`,
        accountId,
        accountAlias: current.alias
      });
    }
  },

  export: async (accountId: string): Promise<void> => {
    const account = await db.getAccountWithSecrets(accountId);
    if (!account) throw new Error('Account not found');
    const jsonStr = exportToMaFile(account);
    downloadFile(`${account.alias || account.accountName}.maFile`, jsonStr);
    await db.addLog({
      category: 'system',
      headline: `Exported .maFile for "${account.alias}"`,
      accountId: account.id,
      accountAlias: account.alias
    });
  },

  /**
   * Merges session values inside the service layer, so the existing ones never
   * have to be fetched by the UI just to be written back.
   */
  updateSession: async (
    accountId: string,
    patch: Partial<NonNullable<StoredAccount['session']>>
  ): Promise<void> => {
    const current = await db.getAccountWithSecrets(accountId);
    if (!current) throw new Error('Account not found');
    const session = { ...(current.session ?? {}), ...patch };
    await db.saveAccount({ ...current, session, updatedAt: new Date().toISOString() });
  },

  /**
   * Logs in with the Steam password and stores the new session. Lives in the
   * service layer so the resulting cookies and tokens never pass through a
   * component (and never end up in the DOM).
   */
  autoLogin: async (
    accountId: string,
    password: string,
    onStatus?: (status: string) => void
  ): Promise<{ success: boolean; error?: string }> => {
    const account = await db.getAccountWithSecrets(accountId);
    if (!account) throw new Error('Account not found');
    const settings = await db.getSettings();

    const res = await steamAuth.loginWithCredentials(account, password, settings, onStatus);
    if (res.success) {
      await db.saveAccount({
        ...account,
        session: {
          steamLoginSecure: res.steamLoginSecure,
          sessionid: res.sessionid,
          oauthToken: res.oauthToken,
          refreshToken: res.refreshToken
        },
        updatedAt: new Date().toISOString()
      });
    }
    return { success: res.success, error: res.error };
  },

  /** Refreshes the session with the stored refresh token (no password). */
  refreshSession: async (accountId: string): Promise<{ success: boolean; error?: string }> => {
    const account = await db.getAccountWithSecrets(accountId);
    if (!account) throw new Error('Account not found');
    if (!account.session?.refreshToken) {
      return { success: false, error: 'NO_REFRESH_TOKEN' };
    }
    const settings = await db.getSettings();

    const res = await steamAuth.refreshWithRefreshToken(account, settings);
    if (res.success && res.steamLoginSecure) {
      await db.saveAccount({
        ...account,
        session: {
          ...account.session,
          steamLoginSecure: res.steamLoginSecure,
          oauthToken: res.oauthToken ?? account.session.oauthToken,
          refreshToken: res.refreshToken ?? account.session.refreshToken
        },
        updatedAt: new Date().toISOString()
      });
    }
    return { success: res.success, error: res.error };
  },

  /**
   * Reveals a single secret on explicit user request. Never called implicitly
   * and never used to fill list views.
   */
  revealSecret: async (accountId: string, field: SecretField): Promise<string> => {
    const value = await db.getSecret(accountId, field);
    if (!value) throw new Error('Secret not available');
    return value;
  }
};

export const accountOrganizationApi = {
  get: async (): Promise<{ folders: FolderItem[]; tags: TagItem[] }> => {
    const [folders, tags] = await Promise.all([db.getFolders(), db.getTags()]);
    return { folders, tags };
  },

  createFolder: async (name: string): Promise<FolderItem> => {
    const folder: FolderItem = {
      id: 'f_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      name: name.trim()
    };
    await db.saveFolder(folder);
    return folder;
  },

  deleteFolder: async (folderId: string): Promise<void> => {
    await db.deleteFolder(folderId);
  },

  createTag: async (name: string, color?: string): Promise<TagItem> => {
    const tag: TagItem = {
      id: 't_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      name: name.trim(),
      color: color || '#06b6d4'
    };
    await db.saveTag(tag);
    return tag;
  },

  deleteTag: async (tagId: string): Promise<void> => {
    await db.deleteTag(tagId);
  },

  updateAccountOrganization: async (
    accountId: string,
    payload: { folderId?: string | null; tags?: string[] }
  ): Promise<void> => {
    const acc = await db.getAccountWithSecrets(accountId);
    if (!acc) throw new Error('Account not found');
    if (payload.folderId !== undefined) acc.folderId = payload.folderId;
    if (payload.tags !== undefined) acc.tags = payload.tags;
    acc.updatedAt = new Date().toISOString();
    await db.saveAccount(acc);
  }
};

export const steamApi = {
  confirmations: async (accountId: string): Promise<ConfirmationItem[]> => {
    const account = await db.getAccountWithSecrets(accountId);
    if (!account) throw new Error('Account not found');
    const settings = await db.getSettings();
    return await steamClient.getAllConfirmations(account, settings);
  },

  /**
   * Fetches confirmations for every stored account.
   *
   * Returns the items plus the accounts whose session Steam rejected, so the
   * page can offer a refresh right where the user is looking instead of
   * sending them into account settings.
   */
  allConfirmations: async (): Promise<{
    items: ConfirmationItem[];
    sessionExpiredAccountIds: string[];
  }> => {
    const settings = await db.getSettings();
    const summaries = await db.getAccounts();
    if (summaries.length === 0) return { items: [], sessionExpiredAccountIds: [] };

    const results: ConfirmationItem[] = [];
    const sessionExpiredAccountIds: string[] = [];
    let corsBlockedCount = 0;
    const errors: string[] = [];

    for (const summary of summaries) {
      const acc = await db.getAccountWithSecrets(summary.id);
      if (!acc) continue;
      try {
        const items = await steamClient.getAllConfirmations(acc, settings);
        results.push(...items);
      } catch (err: any) {
        if (err?.message === 'CORS_BLOCKED') {
          corsBlockedCount++;
        } else if (isSessionError(err)) {
          sessionExpiredAccountIds.push(acc.id);
        } else {
          errors.push(err?.message || 'Bilinmeyen hata');
        }
      }
    }

    if (results.length === 0 && corsBlockedCount > 0) {
      throw new Error('CORS_BLOCKED');
    }

    if (results.length === 0 && errors.length > 0) {
      throw new Error(errors[0]);
    }

    // Nothing came back and every account failed on its session: that is a
    // session problem, not a generic failure, and it must reach the UI as one.
    if (results.length === 0 && sessionExpiredAccountIds.length > 0) {
      throw new SteamApiError(
        'SESSION_EXPIRED',
        'SESSION_EXPIRED',
        sessionExpiredAccountIds[0]
      );
    }

    return { items: results, sessionExpiredAccountIds };
  },

  getDirectConfirmationUrl: async (accountId?: string): Promise<string> => {
    const settings = await db.getSettings();
    if (accountId && accountId !== 'all') {
      const account = await db.getAccountWithSecrets(accountId);
      if (account) return steamClient.getDirectConfirmationUrl(account, settings);
    }
    const summaries = await db.getAccounts();
    const target = summaries.find((a) => a.secretFields.includes('identitySecret')) ?? summaries[0];
    if (target) {
      const account = await db.getAccountWithSecrets(target.id);
      if (account) return steamClient.getDirectConfirmationUrl(account, settings);
    }
    return 'https://steamcommunity.com/mobileconf/conf';
  },

  respond: async (
    accountId: string,
    confirmationId: string,
    nonce: string,
    accept: boolean
  ): Promise<boolean> => {
    const account = await db.getAccountWithSecrets(accountId);
    if (!account) throw new Error('Account not found');
    const settings = await db.getSettings();
    const success = await steamClient.respond(account, confirmationId, nonce, accept, settings);

    await db.addLog({
      category: confirmationId.startsWith('auth:') ? 'login' : 'trade',
      headline: `${accept ? 'Accepted' : 'Declined'} confirmation ${confirmationId} for "${account.alias}"`,
      details: success ? 'Success' : 'Failed',
      accountId: account.id,
      accountAlias: account.alias
    });

    return success;
  }
};

export const settingsApi = {
  get: async (): Promise<AppSettings> => {
    return await db.getSettings();
  },

  update: async (payload: Partial<AppSettings>): Promise<AppSettings> => {
    return await db.saveSettings(payload);
  },

  syncTime: async (): Promise<SteamTimeResponse> => {
    const res = await steamClient.syncSteamTime();
    await db.saveSettings({
      timeOffsetSec: res.offsetSeconds,
      lastTimeSync: new Date().toISOString()
    });
    await db.addLog({
      category: 'system',
      headline: `Steam time synchronized. Clock drift: ${res.offsetSeconds >= 0 ? '+' : ''}${res.offsetSeconds}s`
    });
    return res;
  },

  exportBackup: async (): Promise<void> => {
    const jsonStr = await db.exportFullBackup();
    const dateStr = new Date().toISOString().slice(0, 10);
    downloadFile(`SteamWebAuth_Backup_${dateStr}.json`, jsonStr);
  },

  importBackup: async (jsonStr: string): Promise<{ accountsImported: number }> => {
    const res = await db.importFullBackup(jsonStr);
    await db.addLog({
      category: 'system',
      headline: `Restored backup: ${res.accountsImported} accounts imported.`
    });
    return res;
  }
};

export const logApi = {
  list: async (limit = 100): Promise<{ items: LocalLogItem[] }> => {
    const items = await db.getLogs(limit);
    return { items };
  },

  clear: async (): Promise<void> => {
    await db.clearLogs();
  }
};
