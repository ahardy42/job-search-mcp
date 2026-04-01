declare module "random-useragent" {
  export function getRandom(): string;
  export function getRandom(filter: (agent: unknown) => boolean): string;
}

declare module "pdf-parse" {
  interface TextResult {
    text: string;
    pages: { text: string }[];
  }
  export class PDFParse {
    constructor(options: { url?: string; data?: Buffer | ArrayBuffer });
    getText(options?: { partial?: number[]; first?: number; last?: number }): Promise<TextResult>;
    destroy(): Promise<void>;
  }
}
