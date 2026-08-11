export class Agent {
  constructor(_options?: any) {}
}
export function request() {
  throw new Error("node:https request is not supported on Cloudflare Workers environment.");
}
export function get() {
  throw new Error("node:https get is not supported on Cloudflare Workers environment.");
}
export default {
  Agent,
  request,
  get,
};
