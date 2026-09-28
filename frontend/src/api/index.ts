import { db, type StoredAccount, type FolderItem, type TagItem, type LocalLogItem, type AppSettings } from '../services/storage';
import { generateSteamGuardCode } from '../services/steamCrypto';
import { steamClient, type ConfirmationItem, type SteamTimeResponse } from '../services/steamClient';
import { parseMaFile, exportToMaFile, downloadFile } from '../services/mafileParser';

export interface LiveCodesResponse {
  generatedAt: string;
  validForSec: number;
  items: Array<{ accountId: string; code: string }>;
}

export const accountApi = {
  list: async (): Promise<{ items: StoredAccount[] }> => {
    const items = await db.getAccounts();
    return { items };
  },

  get: async (accountId: string): Promise<StoredAccount | null> => {
    return await db.getAccount(accountId);
  },

  code: async (accountId: string): Promise<{ code: string; validForSec: number }> => {
    const account = await db.getAccount(accountId);
    if (!account) throw new Error('Account not found');
    const settings = await db.getSettings();
    const code = generateSteamGuardCode(account.sharedSecret, settings.timeOffsetSec);
    const nowSec = Math.floor(Date.now() / 1000) + settings.timeOffsetSec;
    const validForSec = 30 - (nowSec % 30) || 30;
    return { code, validForSec };
  },

  liveCodes: async (): Promise<LiveCodesResponse> => {
    const [accounts, settings] = await Promise.all([db.getAccounts(), db.getSettings()]);
    const nowSec = Math.floor(Date.now() / 1000) + settings.timeOffsetSec;
    const validForSec = 30 - (nowSec % 30) || 30;

    const items = accounts.map((acc) => ({
      accountId: acc.id,
      code: generateSteamGuardCode(acc.sharedSecret, settings.timeOffsetSec)
    }));

    return {
      generatedAt: new Date().toISOString(),
      validForSec,
      items
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
    const current = await db.getAccount(accountId);
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
    const account = await db.getAccount(accountId);
    if (!account) throw new Error('Account not found');
    const jsonStr = exportToMaFile(account);
    downloadFile(`${account.alias || account.accountName}.maFile`, jsonStr);
    await db.addLog({
      category: 'system',
      headline: `Exported .maFile for "${account.alias}"`,
      accountId: account.id,
      accountAlias: account.alias
    });
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
    const acc = await db.getAccount(accountId);
    if (!acc) throw new Error('Account not found');
    if (payload.folderId !== undefined) acc.folderId = payload.folderId;
    if (payload.tags !== undefined) acc.tags = payload.tags;
    acc.updatedAt = new Date().toISOString();
    await db.saveAccount(acc);
  }
};

export const steamApi = {
  confirmations: async (accountId: string): Promise<ConfirmationItem[]> => {
    const account = await db.getAccount(accountId);
    if (!account) throw new Error('Account not found');
    const settings = await db.getSettings();
    return await steamClient.getAllConfirmations(account, settings);
  },

  allConfirmations: async (): Promise<ConfirmationItem[]> => {
    const [accounts, settings] = await Promise.all([db.getAccounts(), db.getSettings()]);
    if (accounts.length === 0) return [];

    const results: ConfirmationItem[] = [];
    let corsBlockedCount = 0;
    const errors: string[] = [];

    for (const acc of accounts) {
      try {
        const items = await steamClient.getAllConfirmations(acc, settings);
        results.push(...items);
      } catch (err: any) {
        if (err?.message === 'CORS_BLOCKED') {
          corsBlockedCount++;
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

    return results;
  },

  getDirectConfirmationUrl: async (accountId?: string): Promise<string> => {
    const settings = await db.getSettings();
    if (accountId && accountId !== 'all') {
      const account = await db.getAccount(accountId);
      if (account) return steamClient.getDirectConfirmationUrl(account, settings);
    }
    const accounts = await db.getAccounts();
    const firstWithSecret = accounts.find((a) => a.identitySecret) || accounts[0];
    if (firstWithSecret) {
      return steamClient.getDirectConfirmationUrl(firstWithSecret, settings);
    }
    return 'https://steamcommunity.com/mobileconf/conf';
  },

  respond: async (
    accountId: string,
    confirmationId: string,
    nonce: string,
    accept: boolean
  ): Promise<boolean> => {
    const account = await db.getAccount(accountId);
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
