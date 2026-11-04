declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    META_API_KEY?: string;
    META_MODEL?: string;
    META_DAILY_REQUEST_LIMIT?: string;
    BUCKET?: R2Bucket;
  }
}
