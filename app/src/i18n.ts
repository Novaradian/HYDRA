// All UI text goes through t(). Keys are the English strings; a language file (lang/<code>.js) supplies translations
// as window.HYDRA_LANGS['gu'] = { "New Project…": "…" } without code changes.
import i18next from 'i18next';
const langs: Record<string, any> = (window as any).HYDRA_LANGS || {};
const resources: any = { en: { translation: {} } };
Object.keys(langs).forEach(k => { resources[k] = { translation: langs[k] }; });
i18next.init({ lng: 'en', fallbackLng: 'en', resources, keySeparator: false, nsSeparator: false, interpolation: { escapeValue: false }, returnNull: false, initImmediate: false } as any);
export const t = (k: string, o?: any) => i18next.t(k, o) as string;
export const languages = () => ['en', ...Object.keys(langs).filter(k => k !== 'en')];
export const setLanguage = (l: string) => i18next.changeLanguage(l);
