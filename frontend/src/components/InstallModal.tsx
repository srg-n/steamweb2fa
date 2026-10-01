import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Download,
  X,
  Smartphone,
  Share,
  MoreVertical,
  PlusSquare,
  CheckCircle2,
  Sparkles,
  ShieldCheck
} from 'lucide-react';
import { Button } from './ui/Button';

interface InstallModalProps {
  isOpen: boolean;
  onClose: () => void;
  deferredPrompt: any;
  onInstalled?: () => void;
}

export function InstallModal({ isOpen, onClose, deferredPrompt, onInstalled }: InstallModalProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'android' | 'ios'>('android');
  const [isInstalling, setIsInstalling] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isIos = /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
      if (isIos) {
        setActiveTab('ios');
      } else {
        setActiveTab('android');
      }
    }
  }, []);

  if (!isOpen) return null;

  const handleDirectInstall = async () => {
    if (!deferredPrompt) return;
    setIsInstalling(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice?.outcome === 'accepted') {
        onInstalled?.();
        onClose();
      }
    } catch {
      // Continue
    } finally {
      setIsInstalling(false);
    }
  };

  const handleDismissForAWhile = () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('steamweb_pwa_dismissed_until', String(Date.now() + 7 * 86400000));
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div
        className="w-full sm:max-w-md bg-[#0a0a0f] border border-white/[0.1] rounded-t-3xl sm:rounded-3xl shadow-2xl p-5 sm:p-6 text-white overflow-hidden relative"
        style={{ boxShadow: '0 0 50px rgba(0, 210, 255, 0.15)' }}
      >
        {/* Top Glow Accent Bar */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-cyan-500 via-[#00d2ff] to-emerald-400" />

        {/* Close Button */}
        <button
          onClick={handleDismissForAWhile}
          className="absolute top-4 right-4 p-1.5 rounded-full text-base-400 hover:text-white hover:bg-white/10 transition"
          aria-label={t('common.close')}
        >
          <X size={18} />
        </button>

        {/* Header with App Logo */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-accent-600 to-cyan-400 text-black shadow-lg shadow-cyan-500/25 flex-shrink-0">
            <ShieldCheck size={28} className="text-black" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="text-base font-black tracking-tight text-white">{t('installModal.title')}</h3>
              <span className="rounded-md bg-[#00d2ff]/20 px-1.5 py-0.5 text-[9px] font-black uppercase text-[#00d2ff]">
                PWA
              </span>
            </div>
            <p className="text-xs text-base-400 font-medium">
              {t('installModal.subtitle')}
            </p>
          </div>
        </div>

        {/* Direct Install Button (If supported by Chrome / Android) */}
        {deferredPrompt ? (
          <div className="space-y-3 mb-5 p-4 rounded-2xl border border-cyan-500/30 bg-cyan-500/10">
            <div className="flex items-center gap-2 text-xs font-semibold text-cyan-300">
              <Sparkles size={16} className="text-cyan-400" />
              <span>{t('installModal.oneClickSupported')}</span>
            </div>
            <Button
              variant="primary"
              className="w-full h-11 text-xs sm:text-sm font-bold gap-2 bg-[#00d2ff] hover:bg-[#38bdf8] text-black shadow-glow"
              onClick={handleDirectInstall}
              disabled={isInstalling}
            >
              <Download size={16} className={isInstalling ? 'animate-spin' : ''} />
              {isInstalling ? t('installModal.installing') : t('installModal.installBtn')}
            </Button>
          </div>
        ) : null}

        {/* Platform Selection Tabs */}
        <div className="flex rounded-xl bg-white/[0.05] p-1 mb-4 border border-white/[0.08]">
          <button
            onClick={() => setActiveTab('android')}
            className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 ${
              activeTab === 'android'
                ? 'bg-[#00d2ff] text-black shadow-sm'
                : 'text-base-400 hover:text-white'
            }`}
          >
            <Smartphone size={14} />
            {t('installModal.androidTab')}
          </button>
          <button
            onClick={() => setActiveTab('ios')}
            className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition flex items-center justify-center gap-1.5 ${
              activeTab === 'ios'
                ? 'bg-[#00d2ff] text-black shadow-sm'
                : 'text-base-400 hover:text-white'
            }`}
          >
            <Share size={14} />
            {t('installModal.iosTab')}
          </button>
        </div>

        {/* Step by Step Guide */}
        <div className="space-y-2.5 text-xs text-base-300 mb-5">
          {activeTab === 'android' ? (
            <>
              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-base-800 text-cyan-400 font-bold flex-shrink-0">
                  1
                </div>
                <div>
                  {t('installModal.androidStep1')}
                </div>
              </div>
              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-base-800 text-cyan-400 font-bold flex-shrink-0">
                  2
                </div>
                <div>
                  {t('installModal.androidStep2')}
                </div>
              </div>
              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 font-bold flex-shrink-0">
                  <CheckCircle2 size={14} />
                </div>
                <div>
                  {t('installModal.androidStep3')}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-base-800 text-cyan-400 font-bold flex-shrink-0">
                  1
                </div>
                <div>
                  {t('installModal.iosStep1')}
                </div>
              </div>
              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-base-800 text-cyan-400 font-bold flex-shrink-0">
                  2
                </div>
                <div>
                  {t('installModal.iosStep2')}
                </div>
              </div>
              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 font-bold flex-shrink-0">
                  <CheckCircle2 size={14} />
                </div>
                <div>
                  {t('installModal.iosStep3')}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer Dismiss Button */}
        <div className="flex items-center justify-between pt-2 border-t border-white/[0.08]">
          <button
            onClick={handleDismissForAWhile}
            className="text-xs text-base-400 hover:text-white transition py-1"
          >
            {t('installModal.remindLater')}
          </button>

          <Button
            variant="secondary"
            className="h-8 px-3 text-xs bg-white/10 hover:bg-white/15 text-white"
            onClick={onClose}
          >
            {t('installModal.gotIt')}
          </Button>
        </div>
      </div>
    </div>
  );
}
