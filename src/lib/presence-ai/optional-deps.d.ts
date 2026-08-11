declare module '@upstash/redis' {
  export class Redis {
    constructor(config: { url: string; token: string });
    get<T = any>(key: string): Promise<T | null>;
    set(key: string, value: any, options?: { px?: number }): Promise<void>;
    pipeline(): {
      zremrangebyscore(key: string, min: number, max: number): void;
      zadd(key: string, item: { score: number; member: string }): void;
      zcard(key: string): void;
      pexpire(key: string, ms: number): void;
      exec(): Promise<any[]>;
    };
  }
}

declare module 'js-tiktoken' {
  export class Tiktoken {
    constructor(ranks: any, special_tokens: any, pat_str: any);
    encode(text: string): Uint32Array;
  }
}

declare module 'js-tiktoken/ranks/cl100k_base' {
  export const cl100k_base: {
    bpe_ranks: any;
    special_tokens: any;
    pat_str: any;
  };
}
