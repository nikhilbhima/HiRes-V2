# HiRes Production Setup Guide

Reference document for implementing monetization and backend infrastructure.

## Architecture Overview

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Chrome Ext     │────▶│  Vercel API     │────▶│   Claid.ai      │
│  (User)         │     │  (Proxy)        │     │   (Upscaling)   │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                        ┌────────▼────────┐
                        │    Supabase     │
                        │  (DB + Auth)    │
                        └────────┬────────┘
                                 │
                        ┌────────▼────────┐
                        │  LemonSqueezy   │
                        │  (Payments)     │
                        └─────────────────┘
```

## Services Needed

| Service | Purpose | Free Tier | Docs |
|---------|---------|-----------|------|
| **LemonSqueezy** | Subscriptions, license keys | Yes (% fee only) | lemon.squeezy.com |
| **Vercel** | API proxy, protect Claid key | 100GB bandwidth | vercel.com |
| **Supabase** | Database, Auth (Google OAuth) | 500MB, 50K MAU | supabase.com |

## Pricing Plans (Finalized)

Based on Claid.ai cost: ~$0.05-0.06 per upscale

| Plan | Price | Credits | Cost to Us | Margin |
|------|-------|---------|------------|--------|
| Basic | $4.99/mo | 30/month | ~$1.80 | 64% |
| Pro | $9.99/mo | 100/month | ~$6.00 | 40% |
| Power | $19.99/mo | 300/month | ~$18.00 | 10% |
| Pay-Per-Use | $0.15/each | 1 | ~$0.06 | 60% |

## Implementation Steps

### 1. Supabase Setup
```sql
-- Users table (auto-created by Supabase Auth)

-- Credits table
CREATE TABLE user_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  credits INTEGER DEFAULT 0,
  plan TEXT DEFAULT 'free',
  lemon_customer_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Usage log
CREATE TABLE usage_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id),
  action TEXT, -- 'upscale_2x', 'upscale_4x'
  credits_used INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 2. Vercel API Routes

```
/api/upscale.js       - Proxy to Claid.ai (checks credits first)
/api/webhook.js       - LemonSqueezy webhook (adds credits on purchase)
/api/credits.js       - Get user's current credit balance
```

Example `/api/upscale.js`:
```javascript
export default async function handler(req, res) {
  // 1. Verify user token (from Supabase Auth)
  // 2. Check credits in Supabase
  // 3. If credits > 0, call Claid.ai with OUR API key
  // 4. Deduct 1 credit
  // 5. Return upscaled image URL
}
```

### 3. LemonSqueezy Webhook

On successful payment:
1. Receive webhook with customer email + plan
2. Find/create user in Supabase
3. Add credits based on plan purchased
4. Store `lemon_customer_id` for future reference

### 4. Extension Changes

```javascript
// Instead of calling Claid.ai directly:
const response = await fetch('https://your-app.vercel.app/api/upscale', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${supabaseToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ imageBlob, scale })
});
```

### 5. Auth Flow

1. User clicks "Sign In" in extension popup
2. Opens Supabase OAuth (Google)
3. Redirect back with session token
4. Store token in `chrome.storage.sync`
5. Include token in all API calls

## Environment Variables (Vercel)

```
CLAID_API_KEY=b176fab7d37647a1bb785e0ee2193540
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
LEMON_SQUEEZY_WEBHOOK_SECRET=xxx
```

## Free Tier (Open with HiRes)

- "Open with HiRes" feature remains FREE for everyone
- No login required for this feature
- Only "Upscale with HiRes" requires subscription

## Current State (Pre-Production)

- Extension uses built-in API key directly (visible in source)
- No authentication
- No credit tracking
- Works for demo/investor validation

## Notes

- Claid.ai API key: `b176fab7d37647a1bb785e0ee2193540`
- Consider rate limiting per user (prevent abuse)
- Add error handling for expired credits
- Show remaining credits in extension UI
