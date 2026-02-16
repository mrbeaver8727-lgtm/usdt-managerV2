-- USDT v3 数据库升级脚本 - 在 Supabase SQL Editor 执行

-- 1. 交易簿表
CREATE TABLE IF NOT EXISTS ledgers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. transactions 表加新字段
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='ledger_id') THEN ALTER TABLE transactions ADD COLUMN ledger_id TEXT DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='client_name') THEN ALTER TABLE transactions ADD COLUMN client_name TEXT DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='wechat') THEN ALTER TABLE transactions ADD COLUMN wechat TEXT DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='alipay') THEN ALTER TABLE transactions ADD COLUMN alipay TEXT DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='phone') THEN ALTER TABLE transactions ADD COLUMN phone TEXT DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='okx_uid') THEN ALTER TABLE transactions ADD COLUMN okx_uid TEXT DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='gender') THEN ALTER TABLE transactions ADD COLUMN gender TEXT DEFAULT ''; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='transactions' AND column_name='age') THEN ALTER TABLE transactions ADD COLUMN age TEXT DEFAULT ''; END IF;
END $$;

-- 3. 附件表
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL,
  ledger_id TEXT NOT NULL DEFAULT '',
  storage_path TEXT NOT NULL,
  public_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size BIGINT DEFAULT 0,
  file_type TEXT NOT NULL DEFAULT 'other',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. RLS
ALTER TABLE ledgers ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='ledgers' AND policyname='ledgers_all') THEN
    CREATE POLICY "ledgers_all" ON ledgers FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='attachments' AND policyname='att_all') THEN
    CREATE POLICY "att_all" ON attachments FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 5. 实时订阅
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE ledgers;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
