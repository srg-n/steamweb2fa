// IndexedDB Client-Side Database: 100% Serverless Storage
import { decryptField, encryptField, type EncryptedBlob } from './vaultCrypto';
import {
  configureVaultPersistence,
  getVaultStatus,
  isVaultUnlocked,
  loadVaultConfig,
  markVaultConfigUnavailable,
  onVaultChange,
  requireVaultKey,
  VAULT_CONFIG_KEY,
  VaultLockedError
} from './vault';

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
  /** Vault schema marker. Missing means a pre-vault, plain-text record. */
  v?: 2;
  /** AES-GCM blobs for every secret field of this account. */
  secrets?: Record<string, EncryptedBlob>;
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

/**
 * Raised when the private vault cannot be reached (IndexedDB blocked by the
 * browser, storage pressure, private windows, etc.). Callers must surface it
 * instead of silently degrading to a weaker store.
 */
export class StorageUnavailableError extends Error {
  constructor(message = 'Secure storage is unavailable in this browser context.') {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

/** Fired once per session so the UI can warn the user. */
export const STORAGE_UNAVAILABLE_EVENT = 'steamguard:storage-unavailable';

let storageWarningSent = false;

function notifyStorageUnavailable(err: unknown): void {
  if (storageWarningSent) return;
  storageWarningSent = true;
  console.error(
    '[SteamGuard] IndexedDB is unavailable. Account secrets are not persisted; ' +
      'they are never written to localStorage in plain text.',
    err
  );
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent(STORAGE_UNAVAILABLE_EVENT));
  }
}

class ClientDatabase {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private openDB(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        this.purgeLegacyPlaintext();
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

      request.onsuccess = () => {
        this.purgeLegacyPlaintext();
        resolve(request.result);
      };
      request.onsuccess = () => {
        this.purgeLegacyPlaintext();
        resolve(request.result);
      };
      request.onerror = () => {
        // The legacy copies are plain text on disk regardless of whether the
        // database opens, so they must go even when the vault is unreachable.
        this.purgeLegacyPlaintext();
        reject(request.error);
      };
      request.onblocked = () => {
        this.purgeLegacyPlaintext();
        reject(new StorageUnavailableError('Secure storage is blocked by another open tab.'));
      };
    });

    return this.dbPromise;
  }

  /**
   * Older builds mirrored every account (including Steam shared/identity
   * secrets) and the CORS proxy secret into localStorage as plain text. Those
   * copies are removed once, on open. IndexedDB stays the only source of truth.
   */
  private purgeLegacyPlaintext(): void {
    this.purgeLegacyPlaintextOnLoad();
  }

  /** Removes plain-text leftovers from older builds. Safe to call repeatedly. */
  purgeLegacyPlaintextOnLoad(): void {
    try {
      localStorage.removeItem('sw_accounts');

      const raw = localStorage.getItem('sw_settings');
      if (raw && raw.includes('corsProxySecret')) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        delete parsed.corsProxySecret;
        localStorage.setItem('sw_settings', JSON.stringify(parsed));
      }
    } catch {
      // localStorage may be entirely unavailable (private mode); nothing to purge.
    }
  }

  // Generic store transaction
  private async getStore(storeName: string, mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
    const db = await this.openDB();
    const tx = db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  }

  /** Whether the private vault can be opened. Useful for diagnostics/tests. */
  async isAvailable(): Promise<boolean> {
    try {
      await this.openDB();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Empties every object store.
   *
   * `deleteDatabase()` is not used on purpose: it is refused while any other
   * tab still has the database open, and the pending request then blocks every
   * following `open()` call — which used to leave the app stuck on a spinner
   * after "wipe all data". Clearing works with open connections.
   */
  async wipeAll(): Promise<void> {
    const db = await this.openDB();
    const stores = Array.from(db.objectStoreNames);
    if (stores.length === 0) return;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      stores.forEach((name) => tx.objectStore(name).clear());
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  // ---------------- Accounts ----------------
  // Accounts contain Steam shared/identity secrets, so they live only in
  // IndexedDB. There is deliberately no localStorage fallback and no mirror:
  // an unreachable vault is reported instead of silently downgraded.
  async getAccounts(): Promise<StoredAccount[]> {
    try {
      const store = await this.getStore('accounts');
      const rows = await new Promise<StoredAccount[]>((resolve, reject) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });

      const out: StoredAccount[] = [];
      for (const row of rows) {
        out.push(row.v === 2 ? await decryptAccountSecrets(row) : row);
      }
      return out;
    } catch (err) {
      // VaultLockedError must reach the caller: showing "no accounts" would be
      // a lie, and it must not be confused with a storage failure.
      if (err instanceof VaultLockedError) throw err;
      notifyStorageUnavailable(err);
      return [];
    }
  }

  async getAccount(id: string): Promise<StoredAccount | null> {
    try {
      const store = await this.getStore('accounts');
      const row = await new Promise<StoredAccount | null>((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      if (!row) return null;
      return row.v === 2 ? await decryptAccountSecrets(row) : row;
    } catch (err) {
      if (err instanceof VaultLockedError) throw err;
      notifyStorageUnavailable(err);
      return null;
    }
  }

  async saveAccount(account: StoredAccount): Promise<void> {
    try {
      // Encryption must finish before the transaction opens: an `await`
      // between `transaction()` and `put()` closes it (TransactionInactive).
      const payload = vaultActive() ? await encryptAccountSecrets(account) : account;
      const store = await this.getStore('accounts', 'readwrite');
      await new Promise<void>((resolve, reject) => {
        const req = store.put(payload);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      if (err instanceof VaultLockedError) throw err;
      notifyStorageUnavailable(err);
      throw new StorageUnavailableError(
        'Could not save the account: secure storage is unavailable.'
      );
    }
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
      notifyStorageUnavailable(err);
    }
  }

  // ---------------- Folders ----------------
  // Folders, tags and logs hold no secrets, so they keep a localStorage mirror
  // as resilience when IndexedDB is blocked.
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
      return await new Promise<AppSettings>((resolve) => {
        const req = store.get('app_settings');
        req.onsuccess = async () => {
          try {
            resolve(await this.readSettingsRecord(req.result));
          } catch (err) {
            // Locked vault: the proxy secret stays encrypted, everything else
            // is still readable.
            if (err instanceof VaultLockedError) {
              const rest: Partial<AppSettings> = {
                ...((req.result?.value as AppSettings | undefined) ?? DEFAULT_SETTINGS)
              };
              delete rest.corsProxySecret;
              resolve({ ...DEFAULT_SETTINGS, ...rest });
              return;
            }
            throw err;
          }
        };
        req.onerror = () => {
          notifyStorageUnavailable(req.error);
          const raw = localStorage.getItem('sw_settings');
          resolve(raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS);
        };
      });
    } catch (err) {
      notifyStorageUnavailable(err);
      const raw = localStorage.getItem('sw_settings');
      return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
    }
  }

  /** Rebuilds settings, decrypting the proxy secret when the vault is open. */
  private async readSettingsRecord(record: any): Promise<AppSettings> {
    if (record?.value) {
      const base: AppSettings = { ...DEFAULT_SETTINGS, ...record.value };
      const blob = record.secrets?.corsProxySecret as EncryptedBlob | undefined;
      if (blob) {
        base.corsProxySecret = await decryptField(
          requireVaultKey(),
          'settings',
          'corsProxySecret',
          blob
        );
      }
      return base;
    }

    const raw = localStorage.getItem('sw_settings');
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  }

  async saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.getSettings();
    const updated: AppSettings = { ...current, ...settings };

    try {
      const store = await this.getStore('settings', 'readwrite');
      const { corsProxySecret, ...plain } = updated;
      const record: Record<string, unknown> = { key: 'app_settings', value: plain };

      if (corsProxySecret) {
        if (vaultActive()) {
          // Refuses to downgrade to plain text if the vault happens to be shut.
          const key = requireVaultKey();
          record.secrets = {
            corsProxySecret: await encryptField(key, 'settings', 'corsProxySecret', corsProxySecret)
          };
        } else {
          // Vault disabled: the secret still never leaves IndexedDB.
          record.value = { ...plain, corsProxySecret };
        }
      }

      store.put(record);
    } catch (err) {
      if (err instanceof VaultLockedError) throw err;
      notifyStorageUnavailable(err);
    }

    // Settings mirror stays for resilience, but secrets never touch
    // localStorage: only IndexedDB holds corsProxySecret.
    const mirrorSafe: Partial<AppSettings> = { ...updated };
    delete mirrorSafe.corsProxySecret;
    try {
      localStorage.setItem('sw_settings', JSON.stringify(mirrorSafe));
    } catch {
      // ignore: mirror is best-effort
    }
    return updated;
  }

  // ---------------- Vault ----------------

  /**
   * Vault metadata lives in the settings store so it is wiped together with
   * the database and never duplicated into localStorage.
   */
  async readVaultConfig(): Promise<any> {
    try {
      const store = await this.getStore('settings');
      return await new Promise<any>((resolve, reject) => {
        const req = store.get(VAULT_CONFIG_KEY);
        req.onsuccess = () => resolve(req.result?.value ?? null);
        req.onerror = () => reject(req.error);
      });
    } catch (err) {
      notifyStorageUnavailable(err);
      return null;
    }
  }

  async writeVaultConfig(value: unknown): Promise<void> {
    const store = await this.getStore('settings', 'readwrite');
    await new Promise<void>((resolve, reject) => {
      const req = store.put({ key: VAULT_CONFIG_KEY, value });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async dropVaultConfig(): Promise<void> {
    try {
      const store = await this.getStore('settings', 'readwrite');
      await new Promise<void>((resolve) => {
        const req = store.delete(VAULT_CONFIG_KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
      });
    } catch (err) {
      notifyStorageUnavailable(err);
    }
  }

  /**
   * Re-encrypts every record written before the vault existed. Runs on each
   * unlock; only plain-text records are touched, so it is idempotent.
   */
  async migrateToVault(): Promise<{ migrated: number }> {
    if (!isVaultUnlocked()) return { migrated: 0 };

    const rows = await this.readAllAccounts();

    let migrated = 0;
    for (const row of rows) {
      if (row.v === 2) continue;
      await this.saveAccount(row);
      migrated++;
    }

    // The proxy secret of a pre-vault settings record.
    const settings = await this.readSettingsRecord(await this.rawSettingsRecord());
    if (settings.corsProxySecret) {
      await this.saveSettings({ corsProxySecret: settings.corsProxySecret });
      migrated++;
    }

    return { migrated };
  }

  private async rawSettingsRecord(): Promise<any> {
    try {
      const store = await this.getStore('settings');
      return await new Promise<any>((resolve) => {
        const req = store.get('app_settings');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  /**
   * Writes every record back in plain text. Used only when the user turns the
   * vault off, so no data is left encrypted with a discarded key.
   */
  async migrateToPlaintext(): Promise<{ migrated: number }> {
    const rows = await this.readAllAccounts();

    let migrated = 0;
    for (const row of rows) {
      if (row.v !== 2) continue;
      // Decrypt first, then write in a fresh transaction.
      const plain = await decryptAccountSecrets(row);
      delete plain.v;
      delete plain.secrets;
      await this.writeAccount(plain);
      migrated++;
    }

    const settings = await this.readSettingsRecord(await this.rawSettingsRecord());
    if (settings.corsProxySecret) {
      await this.saveSettings({ corsProxySecret: settings.corsProxySecret });
      migrated++;
    }

    return { migrated };
  }

  /** Plain read of every account row. */
  private async readAllAccounts(): Promise<StoredAccount[]> {
    const store = await this.getStore('accounts');
    return new Promise<StoredAccount[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  /** Writes one record in its own transaction. */
  private async writeAccount(account: StoredAccount): Promise<void> {
    const store = await this.getStore('accounts', 'readwrite');
    await new Promise<void>((resolve, reject) => {
      const req = store.put(account);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ---------------- Export & Backup ----------------

  /**
   * The backup file intentionally contains decrypted secrets: it is the
   * user's own portable copy (.maFile style). Losing the vault passphrase
   * therefore means using a backup file as the recovery path.
   */
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
      settings: {
        ...settings,
        corsProxyUrl: settings.corsProxyUrl || '',
        corsProxySecret: settings.corsProxySecret || ''
      }
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
      await this.saveSettings({
        ...data.settings,
        corsProxyUrl: data.settings.corsProxyUrl ?? '',
        corsProxySecret: data.settings.corsProxySecret ?? ''
      });
    }

    return { accountsImported: data.accounts.length };
  }
}

// ---------------------------------------------------------------------------
// Vault field plumbing
// ---------------------------------------------------------------------------

/** Every field that holds a Steam secret. Only these are encrypted. */
const SECRET_FIELDS = [
  'sharedSecret',
  'identitySecret',
  'revocationCode',
  'lastCode',
  'session.steamLoginSecure',
  'session.sessionid',
  'session.oauthToken',
  'session.refreshToken'
] as const;

type SecretField = (typeof SECRET_FIELDS)[number];

function readSecret(account: StoredAccount, field: SecretField): string | undefined {
  switch (field) {
    case 'sharedSecret':
      return account.sharedSecret;
    case 'identitySecret':
      return account.identitySecret;
    case 'revocationCode':
      return account.revocationCode;
    case 'lastCode':
      return account.lastCode;
    case 'session.steamLoginSecure':
      return account.session?.steamLoginSecure;
    case 'session.sessionid':
      return account.session?.sessionid;
    case 'session.oauthToken':
      return account.session?.oauthToken;
    case 'session.refreshToken':
      return account.session?.refreshToken;
  }
}

/**
 * Writes (or, with `undefined`, removes) one secret field. Removal has to drop
 * the key entirely so the plain text never lingers in the stored record.
 */
function writeSecret(account: StoredAccount, field: SecretField, value: string | undefined): void {
  switch (field) {
    case 'sharedSecret':
      if (value === undefined) delete (account as Partial<StoredAccount>).sharedSecret;
      else account.sharedSecret = value;
      break;
    case 'identitySecret':
      if (value === undefined) delete (account as Partial<StoredAccount>).identitySecret;
      else account.identitySecret = value;
      break;
    case 'revocationCode':
      if (value === undefined) delete (account as Partial<StoredAccount>).revocationCode;
      else account.revocationCode = value;
      break;
    case 'lastCode':
      if (value === undefined) delete (account as Partial<StoredAccount>).lastCode;
      else account.lastCode = value;
      break;
    case 'session.steamLoginSecure':
    case 'session.sessionid':
    case 'session.oauthToken':
    case 'session.refreshToken': {
      const key = field.slice('session.'.length) as keyof NonNullable<StoredAccount['session']>;
      if (!value) {
        if (account.session) delete account.session[key];
        return;
      }
      const session = account.session ?? (account.session = {});
      session[key] = value;
      break;
    }
  }
}

/** Moves the secret fields out of the record and into AES-GCM blobs. */
async function encryptAccountSecrets(account: StoredAccount): Promise<StoredAccount> {
  const key = requireVaultKey();
  const record: StoredAccount = {
    ...account,
    session: account.session ? { ...account.session } : undefined
  };
  const blobs: Record<string, EncryptedBlob> = {};

  for (const field of SECRET_FIELDS) {
    const value = readSecret(record, field);
    writeSecret(record, field, undefined);
    if (!value) continue;
    blobs[field] = await encryptField(key, account.id, field, value);
  }

  // An emptied session object would only add noise to the stored record.
  if (record.session && Object.keys(record.session).length === 0) {
    record.session = undefined;
  }

  record.v = 2;
  record.secrets = blobs;
  return record;
}

/** Inverse of `encryptAccountSecrets`; requires an open vault. */
async function decryptAccountSecrets(record: StoredAccount): Promise<StoredAccount> {
  const key = requireVaultKey();
  const out: StoredAccount = {
    ...record,
    session: record.session ? { ...record.session } : undefined
  };

  for (const [field, blob] of Object.entries(record.secrets ?? {})) {
    writeSecret(out, field as SecretField, await decryptField(key, record.id, field, blob));
  }

  delete out.secrets;
  delete out.v;
  return out;
}

function vaultActive(): boolean {
  return getVaultStatus() !== 'disabled';
}

export const db = new ClientDatabase();

// The vault keeps its wrapped key material in the same database, so turning it
// off is a single delete and a wiped database takes the vault with it.
configureVaultPersistence({
  load: () => db.readVaultConfig(),
  save: (config) => db.writeVaultConfig(config),
  clear: () => db.dropVaultConfig()
});

// Records written before the vault existed are re-encrypted as soon as the
// vault is opened. Failures stay silent: the next unlock retries.
onVaultChange((status) => {
  if (status !== 'unlocked') return;
  void db.migrateToVault().catch((err) => console.warn('Vault migration deferred:', err));
});

// Belt and braces: strip any plain-text leftovers from older builds as soon as
// the module loads, without waiting for the database.
try {
  db.purgeLegacyPlaintextOnLoad();
} catch (err) {
  console.warn('Legacy plain-text cleanup failed:', err);
}

// A blocked database (for example a pending delete after "wipe all data") never
// settles, so the read is time-boxed: the UI must not wait forever.
const VAULT_CONFIG_TIMEOUT_MS = 5000;

void Promise.race([
  loadVaultConfig(),
  new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error('Vault metadata could not be read in time.')),
      VAULT_CONFIG_TIMEOUT_MS
    )
  )
])
  .catch((err) => {
    console.warn('Vault config could not be read:', err);
    notifyStorageUnavailable(err);
    markVaultConfigUnavailable();
  });
