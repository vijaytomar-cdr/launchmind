/**
 * @file app-store-scraper.d.ts
 * @description Ambient types for `app-store-scraper`, which ships no declarations.
 *
 *   Without this the module resolves to an implicit `any` (TS7016), which failed the
 *   production build. The alternative — casting the import to `any` at each call
 *   site — silently removes type checking from everything downstream of the scraper,
 *   including the competitor data that reaches the Growth Brain.
 *
 *   Only the surface LaunchMind actually calls is declared. Anything else stays a
 *   compile error, which is the point: an undeclared method here means someone added
 *   a call without deciding what it returns.
 *
 * @security Declares shapes only; no runtime behaviour.
 */

declare module 'app-store-scraper' {
  /** One app as returned by search/list. */
  export interface AppStoreApp {
    id?:        number;
    appId?:     string;
    title:      string;
    developer:  string;
    score:      number;
    free:       boolean;
    url:        string;
    price?:     number;
    currency?:  string;
    genres?:    string[];
    icon?:      string;
  }

  export interface SearchOptions {
    term:      string;
    num?:      number;
    country?:  string;
    lang?:     string;
    idsOnly?:  boolean;
    throttle?: number;
  }

  export interface ListOptions {
    collection?: string;
    category?:   number;
    country?:    string;
    num?:        number;
    throttle?:   number;
  }

  export function search(opts: SearchOptions): Promise<AppStoreApp[]>;
  export function list(opts: ListOptions): Promise<AppStoreApp[]>;

  const appStoreScraper: {
    search: typeof search;
    list:   typeof list;
  };
  export default appStoreScraper;
}
