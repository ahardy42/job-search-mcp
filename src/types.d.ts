declare module "random-useragent" {
  export function getRandom(): string;
  export function getRandom(filter: (agent: unknown) => boolean): string;
}
