// IndexedDB Client-Side Database: 100% Serverless Storage

export interface StoredAccount {
  id: string; // unique UUID or timestamp
  alias: string;
  accountName: string;
  steamid: string;
  sharedSecret: string;
  identitySecret: string;
  revocationCode?: string;
  session?: {
    steamLoginSecure?: string;
    sessionid?: string;
    oauthToken?: string;
    refreshToken?: string;
  };
  autoConfirmTrades?: boolean;
  autoConfirmTradeMode?: 'all' | 'incoming_only';
  autoConfirmLogins?: boolean;
  autoConfirmDelaySec?: number;
  folderId?: string | null;
  tags?: string[];
  pinned?: boolean;
  lastCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FolderItem {
  id: string;
  name: string;
}

export interface TagItem {
  id: string;
  name: string;
  color?: string;
}

export interface LocalLogItem {
  id: string;
  timestamp: string;
  category: 'totp' | 'trade' | 'login' | 'session' | 'system';
  headline: string;
  details?: string;
  accountId?: string;
  accountAlias?: string;
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  language: 'en' | 'ru' | 'tr';
  timeOffsetSec: number;
  lastTimeSync: string | null;
  autoRefreshTradesSec: number;
  masterPinHash?: string;
  vibrateOnCopy: boolean;
  compactView: boolean;
  corsProxyUrl?: string;
  corsProxySecret?: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  language: 'tr',
  timeOffsetSec: 0,
  lastTimeSync: null,
  autoRefreshTradesSec: 30,
  vibrateOnCopy: true,
  compactView: false,
  corsProxyUrl: '',
  corsProxySecret: ''
};

const DB_NAME = 'SteamWebAuthDB';
const DB_VERSION = 1;

class ClientDatabase {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is not supported on this device/browser'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains('accounts')) {
          const accountStore = db.createObjectStore('accounts', { keyPath: 'id' });
          accountStore.createIndex('accountName', 'accountName', { unique: false });
          accountStore.createIndex('steamid', 'steamid', { unique: false });
        }

        if (!db.objectStoreNames.contains('folders')) {
          db.createObjectStore('folders', { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains('tags')) {
          db.createObjectStore('tags', { keyPath: 'id' });
        }

        if (!db.objectStoreNames.contains('logs')) {
          const logStore = db.createObjectStore('logs', { keyPath: 'id' });
          logStore.createIndex('category', 'category', { unique: false });
          logStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return this.dbPromise;
  }

  // Generic store transaction
  private async getStore(storeName: string, mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
    const db = await this.openDB();
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  }

  // ---------------- Accounts ----------------
  async getAccounts(): Promise<StoredAccount[]> {
    try {
      const store = await this.getStore('accounts');
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      // Fallback to localStorage if IndexedDB is blocked
      const raw = localStorage.getItem('sw_accounts');
      return raw ? JSON.parse(raw) : [];
    }
  }

  async getAccount(id: string): Promise<StoredAccount | null> {
    try {
      const store = await this.getStore('accounts');
      return new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      const accounts = await this.getAccounts();
      return accounts.find((a) => a.id === id) || null;
    }
  }

  async saveAccount(account: StoredAccount): Promise<void> {
    try {
      const store = await this.getStore('accounts', 'readwrite');
      await new Promise<void>((resolve, reject) => {
        const req = store.put(account);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('IndexedDB write failed, falling back to localStorage', err);
    }
    // Also sync localStorage as mirror/backup
    const accounts = await this.getAccounts();
    const idx = accounts.findIndex((a) => a.id === account.id);
    if (idx >= 0) accounts[idx] = account;
    else accounts.push(account);
    localStorage.setItem('sw_accounts', JSON.stringify(accounts));
  }

  async deleteAccount(id: string): Promise<void> {
    try {
      const store = await this.getStore('accounts', 'readwrite');
      await new Promise<void>((resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('IndexedDB delete failed', err);
    }
    const accounts = (await this.getAccounts()).filter((a) => a.id !== id);
    localStorage.setItem('sw_accounts', JSON.stringify(accounts));
  }

  // ---------------- Folders ----------------
  async getFolders(): Promise<FolderItem[]> {
    try {
      const store = await this.getStore('folders');
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      const raw = localStorage.getItem('sw_folders');
      return raw ? JSON.parse(raw) : [];
    }
  }

  async saveFolder(folder: FolderItem): Promise<void> {
    try {
      const store = await this.getStore('folders', 'readwrite');
      await new Promise<void>((resolve, reject) => {
        const req = store.put(folder);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('IndexedDB folder save error', err);
    }
    const folders = await this.getFolders();
    const idx = folders.findIndex((f) => f.id === folder.id);
    if (idx >= 0) folders[idx] = folder;
    else folders.push(folder);
    localStorage.setItem('sw_folders', JSON.stringify(folders));
  }

  async deleteFolder(id: string): Promise<void> {
    try {
      const store = await this.getStore('folders', 'readwrite');
      await new Promise<void>((resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('IndexedDB folder delete error', err);
    }
    const folders = (await this.getFolders()).filter((f) => f.id !== id);
    localStorage.setItem('sw_folders', JSON.stringify(folders));
  }

  // ---------------- Tags ----------------
  async getTags(): Promise<TagItem[]> {
    try {
      const store = await this.getStore('tags');
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch {
      const raw = localStorage.getItem('sw_tags');
      return raw ? JSON.parse(raw) : [];
    }
  }

  async saveTag(tag: TagItem): Promise<void> {
    try {
      const store = await this.getStore('tags', 'readwrite');
      await new Promise<void>((resolve, reject) => {
        const req = store.put(tag);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('IndexedDB tag save error', err);
    }
    const tags = await this.getTags();
    const idx = tags.findIndex((t) => t.id === tag.id);
    if (idx >= 0) tags[idx] = tag;
    else tags.push(tag);
    localStorage.setItem('sw_tags', JSON.stringify(tags));
  }

  async deleteTag(id: string): Promise<void> {
    try {
      const store = await this.getStore('tags', 'readwrite');
      await new Promise<void>((resolve, reject) => {
        const req = store.delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      console.warn('IndexedDB tag delete error', err);
    }
    const tags = (await this.getTags()).filter((t) => t.id !== id);
    localStorage.setItem('sw_tags', JSON.stringify(tags));
  }

  // ---------------- Logs ----------------
  async getLogs(limit = 100): Promise<LocalLogItem[]> {
    try {
      const store = await this.getStore('logs');
      return new Promise((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => {
          const list: LocalLogItem[] = req.result || [];
          list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          resolve(list.slice(0, limit));
        };
        req.onerror = () => reject(req.error);
      });
    } catch {
      const raw = localStorage.getItem('sw_logs');
      const list: LocalLogItem[] = raw ? JSON.parse(raw) : [];
      return list.slice(0, limit);
    }
  }

  async addLog(entry: Omit<LocalLogItem, 'id' | 'timestamp'>): Promise<void> {
    const item: LocalLogItem = {
      ...entry,
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      timestamp: new Date().toISOString()
    };

    try {
      const store = await this.getStore('logs', 'readwrite');
      store.put(item);
    } catch (err) {
      console.warn('IndexedDB log add error', err);
    }

    try {
      const raw = localStorage.getItem('sw_logs');
      const list: LocalLogItem[] = raw ? JSON.parse(raw) : [];
      list.unshift(item);
      localStorage.setItem('sw_logs', JSON.stringify(list.slice(0, 100)));
    } catch {
      // ignore
    }
  }

  async clearLogs(): Promise<void> {
    try {
      const store = await this.getStore('logs', 'readwrite');
      store.clear();
    } catch (err) {
      console.warn('IndexedDB clear logs error', err);
    }
    localStorage.removeItem('sw_logs');
  }

  // ---------------- Settings ----------------
  async getSettings(): Promise<AppSettings> {
    try {
      const store = await this.getStore('settings');
      return new Promise((resolve) => {
        const req = store.get('app_settings');
        req.onsuccess = () => {
          if (req.result && req.result.value) {
            resolve({ ...DEFAULT_SETTINGS, ...req.result.value });
          } else {
            const raw = localStorage.getItem('sw_settings');
            resolve(raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS);
          }
        };
        req.onerror = () => {
          const raw = localStorage.getItem('sw_settings');
          resolve(raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS);
        };
      });
    } catch {
      const raw = localStorage.getItem('sw_settings');
      return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
    }
  }

  async saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings();
    const updated: AppSettings = { ...current, ...settings };

    try {
      const store = await this.getStore('settings', 'readwrite');
      store.put({ key: 'app_settings', value: updated });
    } catch (err) {
      console.warn('IndexedDB settings write error', err);
    }

    localStorage.setItem('sw_settings', JSON.stringify(updated));
    return updated;
  }

  // ---------------- Export & Backup ----------------
  async exportFullBackup(): Promise<string> {
    const [accounts, folders, tags, settings] = await Promise.all([
      this.getAccounts(),
      this.getFolders(),
      this.getTags(),
      this.getSettings()
    ]);

    const backup = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      accounts,
      folders,
      tags,
      settings
    };

    return JSON.stringify(backup, null, 2);
  }

  async importFullBackup(jsonString: string): Promise<{ accountsImported: number }> {
    const data = JSON.parse(jsonString);
    if (!data || !Array.isArray(data.accounts)) {
      throw new Error('Invalid backup file format.');
    }

    for (const acc of data.accounts) {
      if (acc.sharedSecret && acc.accountName) {
        await this.saveAccount(acc);
      }
    }

    if (Array.isArray(data.folders)) {
      for (const f of data.folders) await this.saveFolder(f);
    }
    if (Array.isArray(data.tags)) {
      for (const t of data.tags) await this.saveTag(t);
    }
    if (data.settings) {
      await this.saveSettings(data.settings);
    }

    return { accountsImported: data.accounts.length };
  }
}

export const db = new ClientDatabase();
